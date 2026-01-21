import { Plugin, Notice, ItemView, WorkspaceLeaf, Setting, MarkdownRenderer, TFile, loadPdfJs, PluginSettingTab, App, moment } from 'obsidian';
import { jsPDF } from "jspdf";
import autoTable from 'jspdf-autotable';
import html2canvas from 'html2canvas';
import { robotoBase64, robotoBoldBase64, robotoItalicBase64, robotoBoldItalicBase64 } from './fonts';

export const PDF_SIDEBAR_VIEW = "pdf-sidebar-view";

interface PdfPluginSettings {
    pdfTheme: 'light' | 'dark' | 'css';
    pageBreaks: string;
    showLineNumbersInPreview: boolean;
    applyCss: boolean;
    fontFamily: string;
    customFontPath: string;
    defaultExportPath: string;
    showTitle: boolean;
    showFootnote: boolean;
    footnoteTemplate: string;
}

const DEFAULT_SETTINGS: PdfPluginSettings = {
    pdfTheme: 'light',
    pageBreaks: '',
    showLineNumbersInPreview: false,
    applyCss: true,
    fontFamily: 'helvetica',
    customFontPath: '',
    defaultExportPath: '',
    showTitle: true,
    showFootnote: false,
    footnoteTemplate: '{title} - {date} {time}'
}

export default class PdfPlugin extends Plugin {
    settings: PdfPluginSettings;
    view: PdfSidebarView;
    private cachedStyles: { colors: Record<string, number[]>, backgrounds: Record<string, number[]>, css: string } | null = null;

    async onload() {
        try {
            console.log('Loading PDF Mobile Plugin');
            await this.loadSettings();
            this.registerView(PDF_SIDEBAR_VIEW, (leaf) => (this.view = new PdfSidebarView(leaf, this)));
            this.addRibbonIcon('dice', 'PDF Settings', () => this.activateView());
            this.addCommand({ id: 'export-pdf', name: 'Export current file to PDF', callback: () => this.exportToPdf() });
            this.addCommand({ id: 'open-pdf-sidebar', name: 'Open PDF Settings Sidebar', callback: () => this.activateView() });
            this.addSettingTab(new PdfSettingTab(this.app, this));


            // Clear page breaks when switching to a different markdown note
            this.registerEvent(this.app.workspace.on('file-open', async (file) => {
                if (file && file.extension === 'md') {
                    this.settings.pageBreaks = '';
                    await this.saveSettings();
                    if (this.view) {
                        this.view.refreshSettings();
                        this.view.triggerPreview();
                    }
                }
            }));
        } catch (e) {
            console.error("Plugin load error", e);
            new Notice("Failed to load PDF Mobile Plugin: " + e);
        }
    }

    async loadSettings() { 
        const data = await this.loadData();
        this.settings = Object.assign({}, DEFAULT_SETTINGS, data);
        // Migration from darkMode to pdfTheme
        if (data && data.hasOwnProperty('darkMode') && !data.hasOwnProperty('pdfTheme')) {
            this.settings.pdfTheme = data.darkMode ? 'dark' : 'light';
        }
    }
    async saveSettings() { await this.saveData(this.settings); }

    clearStyleCache() {
        this.cachedStyles = null;
    }

    private arrayBufferToBase64(buffer: ArrayBuffer): string {
        let binary = '';
        const bytes = new Uint8Array(buffer);
        for (let i = 0; i < bytes.byteLength; i++) {
            binary += String.fromCharCode(bytes[i]);
        }
        return window.btoa(binary);
    }

    /**
     * Fetches heading colors and raw CSS from Obsidian snippets and theme variables.
     */
    async getCssStyles(forceRefresh: boolean = false): Promise<{ colors: Record<string, number[]>, backgrounds: Record<string, number[]>, css: string }> {
        if (!forceRefresh && this.cachedStyles) return this.cachedStyles;
        
        const styles: { colors: Record<string, number[]>, backgrounds: Record<string, number[]>, css: string } = { colors: {}, backgrounds: {}, css: '' };
        if (!this.settings.applyCss) return styles;

        let combinedCss = '';
        const tempContainer = document.body.createDiv();
        // Use visibility hidden and absolute positioning to allow style computation
        tempContainer.style.cssText = "position: absolute; top: -9999px; left: -9999px; visibility: hidden; pointer-events: none;";
        // Add common Obsidian classes to trigger snippet selectors
        let themeClass = 'theme-light';
        if (this.settings.pdfTheme === 'dark') themeClass = 'theme-dark';
        else if (this.settings.pdfTheme === 'css') {
            themeClass = document.body.classList.contains('theme-dark') ? 'theme-dark' : 'theme-light';
        }
        tempContainer.className = `${themeClass} markdown-rendered markdown-preview-view`;
        
        // Load only ENABLED snippets from appearance.json
        try {
            const appearancePath = `${this.app.vault.configDir}/appearance.json`;
            if (await this.app.vault.adapter.exists(appearancePath)) {
                const appearance = JSON.parse(await this.app.vault.adapter.read(appearancePath));
                const enabledSnippets = appearance.enabledCssSnippets || [];
                
                for (const snippetName of enabledSnippets) {
                    const snippetPath = `${this.app.vault.configDir}/snippets/${snippetName}.css`;
                    if (await this.app.vault.adapter.exists(snippetPath)) {
                        const content = await this.app.vault.adapter.read(snippetPath);
                        combinedCss += content + '\n';
                        const styleEl = document.createElement('style');
                        styleEl.textContent = content;
                        tempContainer.appendChild(styleEl);
                    }
                }
            }
        } catch (e) {
            console.log("Error reading active snippets from appearance.json", e);
        }

        const parseColor = (colorStr: string): number[] | null => {
            const match = colorStr.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*[\d.]+)?\)/);
            if (match) return [parseInt(match[1]), parseInt(match[2]), parseInt(match[3])];
            return this.hexToRgb(colorStr);
        };

        // Detect colors for H1-H6, title, bold, italic, underline, strike, highlight, code
        const selectors = {
            'h1': 'h1', 'h2': 'h2', 'h3': 'h3', 'h4': 'h4', 'h5': 'h5', 'h6': 'h6',
            'title': 'div.inline-title', 'bold': 'strong', 'italic': 'em',
            'underline': 'u', 'strikethrough': 's', 'highlight': 'mark', 'code': 'code'
        };

        for (const [key, selector] of Object.entries(selectors)) {
            let el: HTMLElement;
            if (key === 'title') {
                el = tempContainer.createDiv({ cls: 'inline-title' });
            } else {
                el = tempContainer.createEl(selector as keyof HTMLElementTagNameMap);
            }
            
            const computedStyle = window.getComputedStyle(el);
            
            // Check for Obsidian CSS variables first (e.g. --h1-color)
            if (key.startsWith('h')) {
                const varColor = window.getComputedStyle(tempContainer).getPropertyValue(`--${key}-color`).trim();
                if (varColor) {
                    const parsedVar = parseColor(varColor);
                    if (parsedVar) { styles.colors[key] = parsedVar; continue; }
                }
            }
            
            const color = computedStyle.color;
            const parsed = parseColor(color);
            if (parsed) styles.colors[key] = parsed;

            // Capture background for highlight and code
            if (key === 'highlight' || key === 'code') {
                const bg = computedStyle.backgroundColor;
                const parsedBg = parseColor(bg);
                if (parsedBg && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent') styles.backgrounds[key] = parsedBg;
            }
        }

        // Capture page background
        const pageBg = window.getComputedStyle(tempContainer).backgroundColor;
        const parsedPageBg = parseColor(pageBg);
        if (parsedPageBg && pageBg !== 'rgba(0, 0, 0, 0)' && pageBg !== 'transparent') {
            styles.backgrounds['page'] = parsedPageBg;
        }

        tempContainer.remove();
        styles.css = combinedCss;
        this.cachedStyles = styles;
        return styles;
    }

    private hexToRgb(hex: string): number[] | null {
        const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex.trim());
        return result ? [
            parseInt(result[1], 16),
            parseInt(result[2], 16),
            parseInt(result[3], 16)
        ] : null;
    }

    async activateView() {
        const { workspace } = this.app;
        let leaf = workspace.getLeavesOfType(PDF_SIDEBAR_VIEW)[0];
        if (!leaf) {
            const rightLeaf = workspace.getRightLeaf(false);
            if (rightLeaf) {
                leaf = rightLeaf;
                await leaf.setViewState({ type: PDF_SIDEBAR_VIEW, active: true });
            }
        }
        if (leaf) workspace.revealLeaf(leaf);
    }
    
    async generatePdfData(file: TFile, showLineNumbers: boolean = false): Promise<ArrayBuffer | null> {
        const content = await this.app.vault.read(file);
        const lines = content.split('\n');
        
        // Initialize jsPDF with A4 format
        const doc = new jsPDF({ orientation: 'p', unit: 'mm', format: 'a4' });
        const pageHeight = doc.internal.pageSize.height;
        const pageWidth = doc.internal.pageSize.width;
        
        // Fetch CSS styles early
        const cssStyles = await this.getCssStyles();
        const { colors: cssColors, backgrounds: cssBackgrounds, css: rawSnippetCss } = cssStyles;

        // Theme-based colors
        let isDark = false;
        let bgColor = [255, 255, 255];
        let textColor = [0, 0, 0];

        if (this.settings.pdfTheme === 'dark') {
            isDark = true;
            bgColor = [0, 0, 0]; textColor = [255, 255, 255];
        } else if (this.settings.pdfTheme === 'css') {
            isDark = document.body.classList.contains('theme-dark');
            if (cssBackgrounds['page']) {
                bgColor = cssBackgrounds['page'];
            } else {
                bgColor = isDark ? [0, 0, 0] : [255, 255, 255];
            }
            textColor = isDark ? [255, 255, 255] : [0, 0, 0];
        }

        const originalAddPage = doc.addPage.bind(doc);
        const builtInFonts = ['helvetica', 'times', 'courier'];
        const isBuiltIn = builtInFonts.includes(this.settings.fontFamily);
        const activeFont = isBuiltIn ? this.settings.fontFamily : (this.settings.fontFamily === 'roboto' ? 'Roboto' : 'custom-font');

        doc.addPage = function(...args: any[]) {
            const result = originalAddPage.apply(this, args);
            // Save current state
            const curFill = this.getFillColor();
            const curText = this.getTextColor();
            
            // Draw background
            this.setFillColor(bgColor[0], bgColor[1], bgColor[2]);
            this.rect(0, 0, pageWidth, pageHeight, 'F');
            
            // Restore state so styles persist across pages
            this.setFillColor(curFill);
            this.setTextColor(curText);
            this.setFont(activeFont); // Restore font
            return result;
        };

        // Load Custom Font if needed
        if (this.settings.fontFamily === 'custom' && this.settings.customFontPath) {
            const fontFile = this.app.vault.getAbstractFileByPath(this.settings.customFontPath);
            if (fontFile instanceof TFile && fontFile.extension === 'ttf') {
                try {
                    const binary = await this.app.vault.readBinary(fontFile);
                    const base64 = this.arrayBufferToBase64(binary);
                    const fontName = fontFile.name;
                    doc.addFileToVFS(fontName, base64);
                    doc.addFont(fontName, activeFont, 'normal', 'Identity-H');
                    doc.addFont(fontName, activeFont, 'bold', 'Identity-H');
                    doc.addFont(fontName, activeFont, 'italic', 'Identity-H');
                    doc.addFont(fontName, activeFont, 'bolditalic', 'Identity-H');
                } catch (e) {
                    console.error("Error loading custom font:", e);
                    new Notice("Error loading custom font: " + e);
                }
            } else {
                new Notice("Custom font file not found at: " + this.settings.customFontPath);
            }
        } else if (this.settings.fontFamily === 'roboto') {
            doc.addFileToVFS('Roboto-Regular.ttf', robotoBase64);
            doc.addFont('Roboto-Regular.ttf', 'Roboto', 'normal');
            doc.addFileToVFS('Roboto-Bold.ttf', robotoBoldBase64);
            doc.addFont('Roboto-Bold.ttf', 'Roboto', 'bold');
            doc.addFileToVFS('Roboto-Italic.ttf', robotoItalicBase64);
            doc.addFont('Roboto-Italic.ttf', 'Roboto', 'italic');
            doc.addFileToVFS('Roboto-BoldItalic.ttf', robotoBoldItalicBase64);
            doc.addFont('Roboto-BoldItalic.ttf', 'Roboto', 'bolditalic');
        }

        doc.setFillColor(bgColor[0], bgColor[1], bgColor[2]);
        doc.rect(0, 0, pageWidth, pageHeight, 'F');
        doc.setTextColor(textColor[0], textColor[1], textColor[2]);
        doc.setFont(activeFont, "normal");

        const margin = 15;
        const maxLineWidth = pageWidth - (margin * 2);
        const lineHeight = 6; 
        let y = 20;
        let cursorX = margin;

        // Render document title (filename) if enabled
        if (this.settings.showTitle) {
            doc.setFont(activeFont, "bold");
            doc.setFontSize(24);
            const titleText = file.basename || "Untitled";
            
            // Apply title color if available (from .inline-title)
            const titleColor = cssColors['title'];
            if (titleColor) doc.setTextColor(titleColor[0], titleColor[1], titleColor[2]);
            else doc.setTextColor(textColor[0], textColor[1], textColor[2]);

            doc.text(titleText, (pageWidth - doc.getTextWidth(titleText)) / 2, y);
            y += 15;

            // Reset text color after title
            doc.setTextColor(textColor[0], textColor[1], textColor[2]);
        }

        // Parse custom page breaks from settings
        const breakLines = this.settings.pageBreaks.split(',').map(s => parseInt(s.trim())).filter(n => !isNaN(n));
        doc.setFont(activeFont, "normal");
        doc.setFontSize(11);

        /**
         * Checks if a page break is needed and adds a new page if necessary.
         */
        const checkPageBreak = (neededHeight: number = 0, force: boolean = false) => {
            if (force || y + neededHeight > pageHeight - margin) {
                doc.addPage();
                y = 20;
                cursorX = margin;
                return true;
            }
            return false;
        }

        let inFrontmatter = lines.length > 0 && lines[0].trim() === '---';
        let frontmatterEnded = false;

        // Iterate through each line of the Markdown content
        for (let i = 0; i < lines.length; i++) {
            if (breakLines.includes(i + 1)) checkPageBreak(0, true);
            let line = lines[i].trimEnd();
            
            let hasRenderedLineNumber = false;
            /**
             * Renders the line number on the left margin.
             */
            const renderLineNumber = (targetY: number) => {
                if (showLineNumbers && !hasRenderedLineNumber && (!inFrontmatter || frontmatterEnded)) {
                    doc.saveGraphicsState();
                    doc.setFontSize(8); doc.setTextColor(100, 100, 100);
                    doc.text(`${i + 1}`, 5, targetY);
                    doc.restoreGraphicsState();
                    hasRenderedLineNumber = true;
                }
            };

            // Skip YAML frontmatter
            if (inFrontmatter && !frontmatterEnded) {
                if (i > 0 && line.trim() === '---') { frontmatterEnded = true; inFrontmatter = false; }
                continue; 
            }

            // Remove block IDs (^identifier)
            line = line.replace(/\s+\^[a-zA-Z0-9-]+$/, '');

            // Handle Callouts and Blockquotes (> [!info])
            if (line.trim().startsWith('>')) {
                const calloutLines = [];
                let tempI = i;
                while (tempI < lines.length && lines[tempI].trim().startsWith('>')) {
                    calloutLines.push(lines[tempI].trim());
                    tempI++;
                }
                const calloutContent = calloutLines.join('\n');
                
                const hiddenContainer = document.body.createDiv();
                hiddenContainer.style.position = 'absolute'; hiddenContainer.style.left = '-9999px';
                hiddenContainer.style.width = '700px'; 
                hiddenContainer.className = `${isDark ? 'theme-dark' : 'theme-light'} markdown-rendered markdown-preview-view`;
                
                // Use the styles already fetched at the start of generatePdfData
                let injection = rawSnippetCss || '';
                // Force text color and remove margins to eliminate white space
                injection += `
                    .markdown-rendered { background-color: ${isDark ? '#000000' : '#ffffff'} !important; color: ${isDark ? '#ffffff' : '#000000'} !important; }
                    .callout, blockquote { margin: 0 !important; padding: 12px !important; }
                    .callout-title, .callout-content { color: ${isDark ? '#ffffff' : '#000000'} !important; }
                `;
                const styleEl = hiddenContainer.createEl('style'); styleEl.textContent = injection;

                await MarkdownRenderer.render(this.app, calloutContent, hiddenContainer, file.path, this);
                await new Promise(r => setTimeout(r, 250)); 

                try {
                    // Target the specific rendered element to avoid container whitespace
                    const targetEl = hiddenContainer.querySelector('.callout, blockquote') || hiddenContainer;
                    const canvas = await html2canvas(targetEl as HTMLElement, { 
                        backgroundColor: isDark ? '#000000' : '#ffffff', 
                        scale: 2,
                        logging: false,
                        useCORS: true
                    });
                    
                    const imgData = canvas.toDataURL('image/png');
                    let imgWidth = (canvas.width / 2) * 0.264583, imgHeight = (canvas.height / 2) * 0.264583;
                    const maxW = pageWidth - margin * 2;
                    if (imgWidth > maxW) { const ratio = maxW / imgWidth; imgWidth = maxW; imgHeight = imgHeight * ratio; }
                    
                    if (checkPageBreak(imgHeight + 2)) cursorX = margin;
                    renderLineNumber(y + (imgHeight / 2));
                    doc.addImage(imgData, 'PNG', margin, y, imgWidth, imgHeight);
                    y += imgHeight + 2;
                    i = tempI - 1; 
                } catch (e) {
                    console.error("Callout render error:", e);
                } finally { hiddenContainer.remove(); }
                continue;
            }

            // Handle Tables
            if (line.trim().startsWith('|') && line.trim().endsWith('|')) {
                checkPageBreak(lineHeight);
                renderLineNumber(y + 4);
                const tableRows: string[][] = [];
                let tempI = i;
                while (tempI < lines.length && lines[tempI].trim().startsWith('|')) {
                    const row = lines[tempI].trim().split('|').map(c => c.trim()).filter((c, idx, arr) => idx > 0 && idx < arr.length - 1);
                    tableRows.push(row);
                    tempI++;
                }
                if (tableRows.length >= 2) {
                    autoTable(doc, {
                        head: [tableRows[0]], body: tableRows.slice(2), startY: y, margin: { left: margin, right: margin }, theme: 'grid',
                        styles: { fontSize: 10, cellPadding: 2, textColor: isDark ? 255 : 0, fillColor: isDark ? [20, 20, 20] : [240, 240, 240], lineColor: 80 },
                        headStyles: { fillColor: isDark ? [100, 100, 100] : [180, 180, 180], textColor: isDark ? 255 : 0, fontStyle: 'bold' },
                    });
                    y = (doc as any).lastAutoTable.finalY + 8;
                    i = tempI - 1; continue;
                }
            }

            // Handle Headings (#, ##, ...)
            const headingMatch = line.match(/^(#{1,6})\s+(.*)/);
            if (headingMatch) {
                const level = headingMatch[1].length; const text = headingMatch[2];
                doc.setFont(activeFont, "bold");
                doc.setFontSize([22, 18, 16, 14, 12, 12][level - 1] || 12);
                
                // Use CSS color if available
                const hColor = cssColors[`h${level}`];
                if (hColor) doc.setTextColor(hColor[0], hColor[1], hColor[2]);
                else doc.setTextColor(textColor[0], textColor[1], textColor[2]);
                
                if (y > margin + 5) y += (level === 1 ? 8 : 6);
                checkPageBreak(8); renderLineNumber(y);
                const splitTitle = doc.splitTextToSize(text, maxLineWidth);
                for (const splitLine of splitTitle) { checkPageBreak(8); doc.text(splitLine, margin, y); y += (level === 1 ? 8 : 5); }
                doc.setFont(activeFont, "normal"); doc.setFontSize(11);
                doc.setTextColor(textColor[0], textColor[1], textColor[2]);
                y += 1; continue;
            }

            checkPageBreak(lineHeight);
            let indentOffset = margin;
            let textStartX = margin;
            
            // Handle Lists and Indentation
            const listMatch = line.match(/^(\s*)([-*]|\d+\.)\s+(.*)/);
            const indentMatch = !listMatch ? line.match(/^(\s+)(.*)/) : null;
            let textContent = line;

            if (listMatch) {
                textContent = listMatch[3];
                indentOffset = (listMatch[1].replace(/\t/g, '    ').length * 1.5) + margin; 
                let displayMarker = ['-', '*'].includes(listMatch[2]) ? '•' : listMatch[2];
                doc.text(displayMarker, indentOffset, y);
                textStartX = indentOffset + doc.getTextWidth(displayMarker) + 2;
            } else if (indentMatch) {
                textContent = indentMatch[2];
                textStartX = (indentMatch[1].replace(/\t/g, '    ').length * 1.5) + margin;
            }
            cursorX = textStartX;

            // Split line into text parts and embedded image links
            const parts = textContent.split(/(!\[\[.*?\]\])/g);
            for (const part of parts) {
                if (part.startsWith('![[')) {
                    // Handle Embedded Images (![[image.png]])
                    const innerMatch = part.match(/!\[\[(.*?)\]\]/);
                    if (innerMatch) {
                        const linkParts = innerMatch[1].split('|');
                        const imageFile = this.app.metadataCache.getFirstLinkpathDest(linkParts[0], file.path);
                        if (imageFile) {
                            try {
                                const arrayBuffer = await this.app.vault.readBinary(imageFile);
                                let format = imageFile.extension.toUpperCase(); if (format === 'JPG') format = 'JPEG';
                                if (['PNG', 'JPEG', 'WEBP'].includes(format)) {
                                    const props = doc.getImageProperties(new Uint8Array(arrayBuffer));
                                    let imgWidth = props.width * 0.264583;
                                    let caption = '';
                                    
                                    // Parse link parts for caption and dimensions
                                    if (linkParts.length > 1) {
                                        // Standard Obsidian behavior: if a part is a number, it's width.
                                        // If not, it's the description/caption.
                                        for (let j = 1; j < linkParts.length; j++) {
                                            const p = linkParts[j];
                                            const pW = parseInt(p);
                                            if (!isNaN(pW)) {
                                                imgWidth = pW * 0.264583;
                                            } else {
                                                caption = p;
                                            }
                                        }
                                    }
                                    
                                    // Move to a new line if there is preceding text
                                    if (cursorX > textStartX) { 
                                        y += lineHeight + 2; cursorX = textStartX; 
                                    }
                                    
                                    let availableW = pageWidth - margin * 2;
                                    if (imgWidth > availableW) imgWidth = availableW;
                                    const imgHeight = (props.height * imgWidth) / props.width;
                                    
                                    // Spacing and sizes for caption (matching user request)
                                    const captionFontSize = 11;
                                    const captionPadding = 3;
                                    const imagePadding = 1.5; // Small padding around the image (approx 5-6 pixels)
                                    
                                    // Calculate wrap if caption exists
                                    let wrappedCaption: string[] = [];
                                    let captionBoxHeight = 0;
                                    const lineStep = captionFontSize * 0.45;
                                    
                                    if (caption) {
                                        const maxCaptionWidth = imgWidth - 4;
                                        wrappedCaption = doc.splitTextToSize(caption, maxCaptionWidth);
                                        captionBoxHeight = (wrappedCaption.length * lineStep) + captionPadding;
                                    }

                                    const totalBoxHeight = imgHeight + (caption ? captionBoxHeight + imagePadding : imagePadding * 2);
                                    const totalNeededHeight = totalBoxHeight + 5;

                                    if (checkPageBreak(totalNeededHeight)) cursorX = textStartX;
                                    renderLineNumber(y + (imgHeight / 2));
                                    
                                    // Always respect indentation level, stop auto-centering
                                    const xPos = textStartX + imagePadding;
                                    
                                    const boxX = xPos - imagePadding;
                                    const boxY = y - imagePadding;
                                    const boxWidth = imgWidth + (imagePadding * 2);

                                    // Draw gray background box for BOTH image and caption
                                    doc.saveGraphicsState();
                                    doc.setFillColor(isDark ? 40 : 240, isDark ? 40 : 240, isDark ? 40 : 240);
                                    doc.rect(boxX, boxY, boxWidth, totalBoxHeight, 'F');
                                    doc.restoreGraphicsState();

                                    // Draw the image
                                    doc.addImage(new Uint8Array(arrayBuffer), format, xPos, y, imgWidth, imgHeight);
                                    
                                    if (caption) {
                                        doc.saveGraphicsState();
                                        doc.setFont(activeFont, "normal");
                                        doc.setFontSize(captionFontSize);
                                        
                                        const textYBase = y + imgHeight + (imagePadding / 2);
                                        
                                        // Draw pure black/white text lines centered relative to the box/image
                                        doc.setTextColor(textColor[0], textColor[1], textColor[2]);
                                        let currentLineY = textYBase + (captionFontSize * 0.35);
                                        const centerX = boxX + (boxWidth / 2);
                                        for (const line of wrappedCaption) {
                                            doc.text(line, centerX, currentLineY, { align: 'center' });
                                            currentLineY += lineStep;
                                        }
                                        
                                        doc.restoreGraphicsState();
                                        y += totalBoxHeight + 4;
                                    } else {
                                        y += totalBoxHeight + 2; 
                                    }
                                    cursorX = textStartX;
                                }
                            } catch (e) {}
                        }
                    }
                } else if (part.length > 0) {
                    // Handle Text and Inline Styling
                    let textPart = part;
                    
                    // Replace wikilinks [[link|display]] with their display text
                    while(textPart.includes('[[')) {
                        const s = textPart.indexOf('[['), e = textPart.indexOf(']]', s);
                        if (e === -1) break;
                        const inner = textPart.substring(s + 2, e);
                        const display = inner.includes('|') ? inner.split('|')[1] : inner;
                        textPart = textPart.substring(0, s) + display + textPart.substring(e + 2);
                    }
                    
                    // Tokenize for bold, italic, colors, math, underline, strike, highlight and code
                    const tokens = textPart.split(/(\$\$[\s\S]*?\$\$)|(\$[^$\n]+\$)|(<span style="color:rgb[^>]*>.*?<\/span>)|(<u>.*?<\/u>)|(<s>.*?<\/s>)|(<mark>.*?<\/mark>)|(<code>.*?<\/code>)|(==.*?==)|(~~.*?~~)|(`.*?`)|(\*\*\*|\*\*|\*|_)/g).filter(t => t !== undefined && t !== '');
                    let isBold = false, isItalic = false;
                    for (const token of tokens) {
                        if (!token) continue;
                        if (token === '***') { isBold = !isBold; isItalic = !isItalic; continue; }
                        if (token === '**') { isBold = !isBold; continue; }
                        if (token === '*' || token === '_') { isItalic = !isItalic; continue; }

                        let isUnderline = false, isStrike = false, isHighlight = false, isCode = false;
                        let textToRender = token;

                        // Check for HTML and Markdown tags
                        if (token.startsWith('<u>') && token.endsWith('</u>')) { isUnderline = true; textToRender = token.substring(3, token.length - 4); }
                        else if ((token.startsWith('<s>') && token.endsWith('</s>')) || (token.startsWith('~~') && token.endsWith('~~'))) { 
                            isStrike = true; textToRender = token.startsWith('~~') ? token.substring(2, token.length - 2) : token.substring(3, token.length - 4); 
                        }
                        else if ((token.startsWith('<mark>') && token.endsWith('</mark>')) || (token.startsWith('==') && token.endsWith('=='))) { 
                            isHighlight = true; textToRender = token.startsWith('==') ? token.substring(2, token.length - 2) : token.substring(6, token.length - 7); 
                        }
                        else if ((token.startsWith('<code>') && token.endsWith('</code>')) || (token.startsWith('`') && token.endsWith('`'))) { 
                            isCode = true; textToRender = token.startsWith('`') ? token.substring(1, token.length - 1) : token.substring(6, token.length - 7); 
                        }

                        const colorMatch = textToRender.match(/<span style="color:rgb\(([^)]+)\)">(.*?)<\/span>/);
                        const blockMathMatch = textToRender.match(/^\$\$([\s\S]*?)\$\$/);
                        const inlineMathMatch = textToRender.match(/^\$([^$\n]+)\$/);

                        let hasColor = false, isMath = false;

                        if (colorMatch) {
                            const colors = colorMatch[1].split(',').map(c => parseInt(c.trim()));
                            if (colors.length === 3) doc.setTextColor(colors[0], colors[1], colors[2]);
                            textToRender = colorMatch[2]; hasColor = true;
                        } else if (blockMathMatch || inlineMathMatch) {
                            // Handle LaTeX Math using MarkdownRenderer + html2canvas
                            isMath = true;
                            const mathSource = blockMathMatch ? blockMathMatch[1] : inlineMathMatch[1];
                            const isBlock = !!blockMathMatch;
                            const hiddenContainer = document.body.createDiv();
                            hiddenContainer.style.position = 'absolute'; hiddenContainer.style.left = '-9999px'; hiddenContainer.style.top = '0';
                            if (isBlock) hiddenContainer.style.width = '600px'; 
                            hiddenContainer.style.backgroundColor = isDark ? '#000000' : '#ffffff';
                            hiddenContainer.style.color = isDark ? '#ffffff' : '#000000';
                            hiddenContainer.style.padding = '0px'; 
                            
                            await MarkdownRenderer.render(this.app, isBlock ? `$$${mathSource}$$` : `$${mathSource}$`, hiddenContainer, file.path, this);
                            await new Promise(r => setTimeout(r, 200)); // Wait for MathJax
                            
                            try {
                                let targetEl = hiddenContainer;
                                if (!isBlock) {
                                    const mathEl = hiddenContainer.querySelector('.math-inline') || hiddenContainer.querySelector('.jax-element');
                                    if (mathEl instanceof HTMLElement) targetEl = mathEl;
                                }
                                const canvas = await html2canvas(targetEl, { backgroundColor: null, scale: 2 });
                                const imgData = canvas.toDataURL('image/png');
                                let imgWidth = (canvas.width / 2) * 0.264583, imgHeight = (canvas.height / 2) * 0.264583;
                                
                                if (isBlock) {
                                    const maxW = pageWidth - margin * 2; 
                                    if (imgWidth > maxW) { const ratio = maxW / imgWidth; imgWidth = maxW; imgHeight = imgHeight * ratio; }
                                    if (y + imgHeight + 2 > pageHeight - margin) { doc.addPage(); y = 20; cursorX = margin; }
                                    renderLineNumber(y + (imgHeight / 2)); 
                                    doc.addImage(imgData, 'PNG', margin, y, imgWidth, imgHeight);
                                    y += imgHeight + 5; cursorX = margin;
                                } else {
                                    if (cursorX + imgWidth > pageWidth - margin) { y += lineHeight + 2; checkPageBreak(); cursorX = textStartX; }
                                    renderLineNumber(y); 
                                    doc.addImage(imgData, 'PNG', cursorX, y - (imgHeight * 0.95), imgWidth, imgHeight);
                                    cursorX += imgWidth + 1;
                                }
                            } catch (e) { renderLineNumber(y); doc.text("[Math Error]", cursorX, y); cursorX += 20; }
                            finally { hiddenContainer.remove(); }
                            continue;
                        } else { if (!hasColor) doc.setTextColor(textColor[0], textColor[1], textColor[2]); }

                        if (!isMath) {
                            // Render normal text with word wrapping
                            const currentBoldColor = cssColors['bold'];
                            const currentItalicColor = cssColors['italic'];
                            
                            // Apply colors - Prioritize italic for bold-italic cases
                            if (isItalic && currentItalicColor) doc.setTextColor(currentItalicColor[0], currentItalicColor[1], currentItalicColor[2]);
                            else if (isBold && currentBoldColor) doc.setTextColor(currentBoldColor[0], currentBoldColor[1], currentBoldColor[2]);
                            else if (!hasColor) doc.setTextColor(textColor[0], textColor[1], textColor[2]);

                            const renderFont = isCode ? 'courier' : activeFont;
                            doc.setFont(renderFont, (isBold && isItalic) ? 'bolditalic' : (isBold ? 'bold' : (isItalic ? 'italic' : 'normal')));
                            
                            const words = textToRender.split(/(\s+)/);
                            for (const word of words) {
                                if (word.length === 0) continue;
                                const wordWidth = doc.getTextWidth(word);
                                if (cursorX + wordWidth > pageWidth - margin) { 
                                    y += lineHeight; checkPageBreak(); cursorX = textStartX; 
                                    if (word.trim() === '') continue; 
                                }
                                if (cursorX === textStartX && word.trim() === '') continue;
                                renderLineNumber(y); 

                                // Highlight background
                                if (isHighlight) {
                                    const hBg = cssBackgrounds['highlight'] || [255, 255, 0];
                                    doc.setFillColor(hBg[0], hBg[1], hBg[2]);
                                    doc.rect(cursorX, y - 4, wordWidth, 5, 'F');
                                }
                                // Code background
                                if (isCode) {
                                    const cBg = cssBackgrounds['code'] || (isDark ? [40, 40, 40] : [240, 240, 240]);
                                    doc.setFillColor(cBg[0], cBg[1], cBg[2]);
                                    doc.rect(cursorX, y - 4, wordWidth, 5, 'F');
                                }

                                doc.text(word, cursorX, y); 

                                // Underline
                                if (isUnderline) {
                                    const uCol = cssColors['underline'] || (hasColor ? [0,0,0] : (isDark ? [255,255,255] : [0,0,0]));
                                    doc.setDrawColor(uCol[0], uCol[1], uCol[2]);
                                    doc.setLineWidth(0.2);
                                    doc.line(cursorX, y + 0.5, cursorX + wordWidth, y + 0.5);
                                }
                                // Strikethrough
                                if (isStrike) {
                                    doc.setLineWidth(0.2);
                                    doc.line(cursorX, y - 1.5, cursorX + wordWidth, y - 1.5);
                                }

                                cursorX += wordWidth;
                            }
                        }
                        if (hasColor) doc.setTextColor(textColor[0], textColor[1], textColor[2]);
                    }
                }
            }
            renderLineNumber(y); y += lineHeight;
        }

        // Add Footnotes
        if (this.settings.showFootnote) {
            const totalPages = doc.internal.getNumberOfPages();
            doc.setFontSize(9);
            const footerY = pageHeight - 10;
            const now = moment();
            
            for (let i = 1; i <= totalPages; i++) {
                doc.setPage(i);
                doc.setTextColor(textColor[0], textColor[1], textColor[2]);
                doc.setFont(activeFont, "normal"); // Ensure font is reset
                
                let text = this.settings.footnoteTemplate;
                
                // Allow custom date formats inside {date:FORMAT}
                text = text.replace(/{date:([^}]+)}/g, (match, format) => now.format(format));
                
                // Standard replacements
                text = text.replace(/{date}/g, now.format('YYYY-MM-DD'))
                    .replace(/{time}/g, now.format('HH:mm'))
                    .replace(/{title}/g, file.basename)
                    .replace(/{page}/g, i.toString())
                    .replace(/{total}/g, totalPages.toString());

                doc.text(text, margin, footerY);
            }
        }

        return doc.output("arraybuffer");
    }

    async exportToPdf() {
        const file = this.app.workspace.getActiveFile();
        if (!file || file.extension !== 'md') {
            new Notice('Please open a Markdown note to export.');
            return;
        }
        new Notice('Generating PDF...');
        try {
            const pdfOutput = await this.generatePdfData(file); if (!pdfOutput) return;
            
            let folderPath = file.parent ? file.parent.path : "";
            if (this.settings.defaultExportPath && this.settings.defaultExportPath.trim() !== '') {
                folderPath = this.settings.defaultExportPath.trim();
                if (folderPath.endsWith('/')) folderPath = folderPath.slice(0, -1);
                if (folderPath.startsWith('/')) folderPath = folderPath.slice(1);

                if (folderPath !== "") {
                    const exists = await this.app.vault.adapter.exists(folderPath);
                    if (!exists) {
                        try {
                            await this.app.vault.createFolder(folderPath);
                        } catch (e) {
                             console.error("Error creating export folder:", e);
                        }
                    }
                }
            }
            
            const pdfPath = (folderPath === "" ? "" : folderPath + "/") + file.basename + ".pdf";
            await this.app.vault.adapter.writeBinary(pdfPath, pdfOutput);
            new Notice(`Saved to ${pdfPath}`);
            await new Promise(r => setTimeout(r, 500));
            const pdfTFile = this.app.vault.getAbstractFileByPath(pdfPath);
            if (pdfTFile) await this.app.workspace.getLeaf(true).openFile(pdfTFile as any);
        } catch (e) { new Notice('Error saving PDF: ' + e); }
    }
}

class PdfSidebarView extends ItemView {
    plugin: PdfPlugin; previewContainer: HTMLElement; zoomWrapper: HTMLElement; debounceTimer: any;
    private lastDist = 0; private zoomLevel = 1.0;
    private pageBreakArea: any;

    constructor(leaf: WorkspaceLeaf, plugin: PdfPlugin) { super(leaf); this.plugin = plugin; }
    getViewType() { return PDF_SIDEBAR_VIEW; }
    getDisplayText() { return "PDF Settings"; }
    getIcon() { return "dice"; }

    refreshSettings() {
        if (this.pageBreakArea) {
            this.pageBreakArea.setValue(this.plugin.settings.pageBreaks);
        }
    }

    async onOpen() {
        await this.display();
    }

    async display() {
        const container = this.contentEl; container.empty();
        
        new Setting(container).setName("Font Family").setDesc("Choose a font (built-in or custom .ttf)").addDropdown(d => {
            d.addOption("helvetica", "Helvetica (Sans-serif)")
             .addOption("times", "Times (Serif)")
             .addOption("courier", "Courier (Monospace)")
             .addOption("roboto", "Roboto (Supports Accents)")
             .addOption("custom", "Custom (.ttf from vault)")
             .setValue(this.plugin.settings.fontFamily)
             .onChange(async v => {
                 this.plugin.settings.fontFamily = v;
                 await this.plugin.saveSettings();
                 this.triggerPreview();
                 this.display();
             });
        });

        // Show path field if 'custom' is selected
        if (this.plugin.settings.fontFamily === 'custom') {
            new Setting(container).setName("Font Path (.ttf)").setDesc("Path to the .ttf file in your vault (e.g. 'Fonts/MyFont.ttf' or 'MyFont.ttf' if in root)").addText(t => {
                t.setPlaceholder("e.g. MyFont.ttf")
                 .setValue(this.plugin.settings.customFontPath)
                 .onChange(async v => {
                     this.plugin.settings.customFontPath = v;
                     await this.plugin.saveSettings();
                     this.triggerPreview();
                 });
            });
        }

        new Setting(container).setName("Page Theme").setDesc("Light, Dark, or match Obsidian CSS (Requires 'Apply CSS Snippets' to be ON)").addDropdown(d => {
            d.addOption("light", "Light")
             .addOption("dark", "Dark")
             .addOption("css", "From CSS (Current Theme)")
             .setValue(this.plugin.settings.pdfTheme)
             .onChange(async v => {
                 this.plugin.settings.pdfTheme = v as any;
                 if (v === 'css') this.plugin.settings.applyCss = true;
                 this.plugin.clearStyleCache();
                 await this.plugin.saveSettings();
                 this.display();
                 this.triggerPreview();
             });
        });

        new Setting(container).setName("Apply CSS Snippets").setDesc("Try to apply colors from your Obsidian CSS snippets").addToggle(t => t.setValue(this.plugin.settings.applyCss).onChange(async v => { 
            this.plugin.settings.applyCss = v; 
            if (!v && this.plugin.settings.pdfTheme === 'css') {
                const isObsidianDark = document.body.classList.contains('theme-dark');
                this.plugin.settings.pdfTheme = isObsidianDark ? 'dark' : 'light';
            }
            this.plugin.clearStyleCache();
            await this.plugin.saveSettings(); 
            this.display();
            this.triggerPreview(); 
        }));

        new Setting(container).setName("Show Note Title").setDesc("Include the note title at the top of the PDF").addToggle(t => t.setValue(this.plugin.settings.showTitle).onChange(async v => { this.plugin.settings.showTitle = v; await this.plugin.saveSettings(); this.triggerPreview(); }));

        new Setting(container).setName("Show Footnote").setDesc("Include a footnote on every page").addToggle(t => t.setValue(this.plugin.settings.showFootnote).onChange(async v => { 
            this.plugin.settings.showFootnote = v; 
            await this.plugin.saveSettings(); 
            this.display(); // Force refresh to show/hide the template field
            this.triggerPreview(); 
        }));

        if (this.plugin.settings.showFootnote) {
            new Setting(container).setName("Footnote Template").setDesc("Variables: {date}, {time}, {title}, {page}, {total}").addText(t => {
                t.setValue(this.plugin.settings.footnoteTemplate)
                 .onChange(async v => {
                     this.plugin.settings.footnoteTemplate = v;
                     await this.plugin.saveSettings();
                     this.triggerPreview();
                 });
            });
        }


        new Setting(container).setName("Show Line Numbers (Preview)").setDesc("Show line numbers in the sidebar preview").addToggle(t => t.setValue(this.plugin.settings.showLineNumbersInPreview).onChange(async v => { this.plugin.settings.showLineNumbersInPreview = v; await this.plugin.saveSettings(); this.triggerPreview(); }));

        new Setting(container).setName("Page Breaks").setDesc("Comma separated line numbers").addTextArea(t => {
            this.pageBreakArea = t;
            t.inputEl.style.width = '100%';
            t.inputEl.rows = 2;
            t.setPlaceholder("e.g. 10, 25").setValue(this.plugin.settings.pageBreaks).onChange(async v => { 
                this.plugin.settings.pageBreaks = v; 
                await this.plugin.saveSettings(); 
                this.triggerPreview(); 
            });
        });

        container.createDiv().style.borderTop = "1px solid var(--background-modifier-border)";
        container.createEl("h3", { text: "Preview" }).style.marginTop = "15px";
        this.previewContainer = container.createEl("div", { cls: "pdf-preview-container" });
        this.previewContainer.style.width = "100%"; this.previewContainer.style.height = "500px"; this.previewContainer.style.overflow = "auto"; this.previewContainer.style.border = "1px solid var(--background-modifier-border)";
        this.zoomWrapper = this.previewContainer.createEl("div");
        this.zoomWrapper.style.display = "flex"; this.zoomWrapper.style.flexDirection = "column"; this.zoomWrapper.style.gap = "10px"; this.zoomWrapper.style.padding = "10px 10px 50px 25px"; this.zoomWrapper.style.width = "100%";
        
        container.createDiv().style.cssText = "border-top: 1px solid var(--background-modifier-border); margin-top: 15px;";
        
        // Generate PDF button moved below preview
        new Setting(container).setName("Generate PDF").addButton(b => b.setButtonText("Generate").setCta().onClick(() => this.plugin.exportToPdf()));

        this.previewContainer.addEventListener('touchstart', (e) => { if (e.touches.length === 2) this.lastDist = Math.hypot(e.touches[0].pageX - e.touches[1].pageX, e.touches[0].pageY - e.touches[1].pageY); }, { passive: false });
        this.previewContainer.addEventListener('touchmove', (e) => {
            if (e.touches.length === 2) {
                e.preventDefault(); 
                const dist = Math.hypot(e.touches[0].pageX - e.touches[1].pageX, e.touches[0].pageY - e.touches[1].pageY);
                const oldZoom = this.zoomLevel; this.zoomLevel = Math.max(1.0, this.zoomLevel * (1 + (dist / this.lastDist - 1) * 0.4)); this.lastDist = dist;
                const ratio = this.zoomLevel / oldZoom;
                const top = this.previewContainer.scrollTop, left = this.previewContainer.scrollLeft;
                this.zoomWrapper.style.width = `${100 * this.zoomLevel}%`;
                this.previewContainer.scrollTop = top * ratio; this.previewContainer.scrollLeft = left * ratio;
            }
        }, { passive: false });
        this.triggerPreview();
    }

    triggerPreview() { if (this.debounceTimer) clearTimeout(this.debounceTimer); this.debounceTimer = setTimeout(() => this.updatePreview(), 1500); }
    async updatePreview() {
        const file = this.plugin.app.workspace.getActiveFile();
        this.zoomWrapper.empty(); this.zoomLevel = 1.0; this.zoomWrapper.style.width = "100%";

        if (!file || file.extension !== 'md') {
            this.zoomWrapper.createEl("div", { text: "Please open a Markdown note to export.", cls: "pdf-no-file" }).style.padding = "20px";
            return;
        }

        const loading = this.zoomWrapper.createEl("div", { text: "Generating...", cls: "pdf-loading" });
        try {
            const buffer = await this.plugin.generatePdfData(file, this.plugin.settings.showLineNumbersInPreview);
            if (buffer) {
                this.zoomWrapper.empty(); const pdfjsLib = await loadPdfJs(); const pdf = await pdfjsLib.getDocument({ data: buffer.slice(0) }).promise;
                for (let i = 1; i <= pdf.numPages; i++) {
                    const page = await pdf.getPage(i); const viewport = page.getViewport({ scale: 2.0 });
                    const wrapper = this.zoomWrapper.createEl("div"); wrapper.style.textAlign = "center"; wrapper.style.backgroundColor = "var(--background-secondary)"; wrapper.style.padding = "5px";
                    const canvas = wrapper.createEl("canvas"); const context = canvas.getContext('2d');
                    canvas.height = viewport.height; canvas.width = viewport.width; canvas.style.width = "100%"; canvas.style.height = "auto"; canvas.style.boxShadow = "0 2px 5px rgba(0,0,0,0.2)";
                    await page.render({ canvasContext: context, viewport: viewport }).promise;
                    wrapper.createEl("div", { text: `Page ${i} / ${pdf.numPages}`, cls: "setting-item-description" }).style.fontSize = "10px";
                }
            }
        } catch (e) { this.zoomWrapper.empty(); this.zoomWrapper.createEl("div", { text: "Error: " + e }); }
    }
}

class PdfSettingTab extends PluginSettingTab {
    plugin: PdfPlugin;

    constructor(app: App, plugin: PdfPlugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display(): void {
        const { containerEl } = this;
        containerEl.empty();
        containerEl.createEl('h2', { text: 'PDF Mobile Settings' });

        new Setting(containerEl)
            .setName('Default Export Path')
            .setDesc('Folder where PDFs will be saved. Use "/" for vault root. Leave empty to save in the same folder as the note.')
            .addText(text => text
                .setPlaceholder('e.g. PDFs/Exports')
                .setValue(this.plugin.settings.defaultExportPath)
                .onChange(async (value) => {
                    this.plugin.settings.defaultExportPath = value;
                    await this.plugin.saveSettings();
                }));
    }
}
