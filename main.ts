import {
    App,
    Editor,
    Plugin,
    PluginSettingTab,
    Modal,
    Notice,
    ItemView,
    WorkspaceLeaf,
    Setting,
    MarkdownRenderer,
    MarkdownView,
    TFile,
    TFolder,
    loadPdfJs,
    moment,
    Component,
    Platform,
    SectionCache,
    requestUrl,
    setIcon,
    parseYaml,
    normalizePath,
    TextAreaComponent,
    TextComponent
} from 'obsidian';
import { jsPDF } from "jspdf";
import html2canvas from 'html2canvas';

const PDF_SIDEBAR_VIEW = "pdf-sidebar-view";

interface PdfPluginSettings {
    pdfTheme: 'light' | 'dark' | 'css';
    pageSize: 'a4' | 'letter' | 'a5';
    pageOrientation: 'portrait' | 'landscape';
    autoLandscapeWidePages: boolean;
    marginPreset: 'narrow' | 'normal' | 'wide' | 'custom';
    customMarginMm: number;
    contentScale: number;
    pageBreaks: string;
    showLineNumbersInPreview: boolean;
    fontFamily: string;
    customFontPath: string;
    defaultExportPath: string;
    folderExportPath: string;
    showTitle: boolean;
    showFrontmatter: boolean;
    showHeader: boolean;
    headerTemplate: string;
    headerDateFormat: string;
    headerTimeFormat: string;
    showFootnote: boolean;
    footnoteTemplate: string;
    footnoteDateFormat: string;
    footnoteTimeFormat: string;
    optimizeImages: boolean;
    includeBookmarks: boolean;
    includeTocPage: boolean;
    bookmarkHeadingLevels: number[];
    enableClickableLinks: boolean;
    autoRegeneratePreview: boolean;
    autoRunAutomationJob: boolean;
}

interface AutomationJobTask {
    type: 'note' | 'folder' | 'merge';
    notePath?: string;
    folderPath?: string;
    notes?: string[];
    mode?: 'separate' | 'merged';
    outputDir?: string;
    outputName?: string;
    options?: Partial<PdfPluginSettings>;
}

interface AutomationJobSpec {
    jobId?: string;
    options?: Partial<PdfPluginSettings>;
    openResult?: boolean;
    tasks: AutomationJobTask[];
}

interface AutomationTaskResult {
    index: number;
    type: string;
    status: 'completed' | 'failed' | 'skipped';
    outputs: string[];
    failedFiles?: string[];
    error?: string;
    durationMs: number;
}

interface AutomationJobResult {
    jobId: string;
    status: 'running' | 'completed' | 'partial' | 'failed';
    startedAt: string;
    updatedAt: string;
    finishedAt?: string;
    totalTasks: number;
    completedTaskIndices: number[];
    tasks: AutomationTaskResult[];
    error?: string;
}

const DEFAULT_SETTINGS: PdfPluginSettings = {
    pdfTheme: 'css',
    pageSize: 'a4',
    pageOrientation: 'portrait',
    autoLandscapeWidePages: true,
    marginPreset: 'normal',
    customMarginMm: 15,
    contentScale: 100,
    pageBreaks: '',
    showLineNumbersInPreview: false,
    fontFamily: 'obsidian',
    customFontPath: '',
    defaultExportPath: '',
    folderExportPath: '',
    showTitle: true,
    showFrontmatter: false,
    showHeader: false,
    headerTemplate: '{title}',
    headerDateFormat: 'YYYY-MM-DD',
    headerTimeFormat: 'HH:mm',
    showFootnote: false,
    footnoteTemplate: '{title} - {date} {time}',
    footnoteDateFormat: 'YYYY-MM-DD',
    footnoteTimeFormat: 'HH:mm',
    optimizeImages: true,
    includeBookmarks: true,
    includeTocPage: false,
    bookmarkHeadingLevels: [1, 2, 3, 4, 5, 6],
    enableClickableLinks: true,
    autoRegeneratePreview: true,
    autoRunAutomationJob: false
};

const SHARED_SIDEBAR_SETTING_KEYS: Array<keyof PdfPluginSettings> = [
    'pdfTheme',
    'pageSize',
    'pageOrientation',
    'autoLandscapeWidePages',
    'marginPreset',
    'customMarginMm',
    'contentScale',
    'fontFamily',
    'customFontPath',
    'defaultExportPath',
    'showTitle',
    'showFrontmatter',
    'showHeader',
    'headerTemplate',
    'headerDateFormat',
    'headerTimeFormat',
    'showFootnote',
    'footnoteTemplate',
    'footnoteDateFormat',
    'footnoteTimeFormat',
    'optimizeImages',
    'includeBookmarks',
    'includeTocPage',
    'bookmarkHeadingLevels',
    'enableClickableLinks'
];

const FOOTNOTE_DATE_FORMATS: string[] = [
    'YYYY-MM-DD',
    'YYYY/MM/DD',
    'YYYY MMM DD',
    'YYYY MMMM DD',
    'DD/MM/YYYY',
    'DD-MM-YYYY',
    'DD.MM.YYYY',
    'DD/MM/YY',
    'D MMM YYYY',
    'DD MMM YYYY',
    'D MMMM YYYY',
    'DD MMMM YYYY',
    'ddd D MMM YYYY',
    'dddd D MMMM YYYY',
    'MM/DD/YYYY',
    'MM-DD-YYYY',
    'MMM D, YYYY',
    'MMMM D, YYYY',
    'ddd, MMM D, YYYY',
    'dddd, MMMM D, YYYY'
];

const FOOTNOTE_TIME_FORMATS: string[] = [
    'HH:mm',
    'HH:mm:ss',
    'hh:mm A',
    'h:mm A',
    'hh:mm:ss A',
    'h:mm:ss A',
    'hh:mm a',
    'h:mm a',
    'hh:mm:ss a',
    'h:mm:ss a'
];

interface BlockItem {
    el: HTMLElement;
    startLine: number; // 1-indexed source line number
    endLine: number; // 1-indexed end line number
    isTitle?: boolean;
    forceBreakBefore?: boolean;
    isWide?: boolean;
}

interface MarkdownSegment {
    markdown: string;
    startLine: number; // 1-indexed
    endLine: number; // 1-indexed
    forceBreakBefore: boolean;
}

interface PageChunk {
    elements: HTMLElement[];
    lineMarkers: Array<{ line: number; el: HTMLElement }>;
    startLine: number;
    endLine: number;
    startsWithForcedBreak?: boolean;
    isLandscape?: boolean;
    contentScaleOverride?: number;
    allowMultiPageSlice?: boolean;
}

interface CachedPdfSlice {
    imgData: string;
    format: 'JPEG' | 'PNG';
    heightMm: number;
    xMm?: number;
    widthMm?: number;
    mmPerPx?: number;
    sliceTopCssPx?: number;
    sliceBottomCssPx?: number;
}

interface CachedPdfTextSpan {
    text: string;
    xPx: number;
    topPx: number;
    widthPx: number;
    heightPx: number;
    fontSizePx: number;
    dir?: 'ltr' | 'rtl';
    bidiRunRects?: Array<{ xPx: number; widthPx: number }>;
}

interface CachedPdfHeading {
    level: number;
    title: string;
    topPx: number;
    anchorKeys: string[];
}

interface CachedPdfAnchor {
    keys: string[];
    topPx: number;
}

interface CachedPdfLinkRect {
    xPx: number;
    topPx: number;
    widthPx: number;
    heightPx: number;
}

interface CachedPdfLink {
    kind: 'external' | 'internal';
    url?: string;
    targetKey?: string;
    targetScope?: string;
    rects: CachedPdfLinkRect[];
}

interface EmittedPdfSliceMeta {
    pdfPageNum: number;
    sliceTopCssPx: number;
    sliceBottomCssPx: number;
    pageWidthMm?: number;
    pageHeightMm?: number;
    mmPerPx?: number;
    noteScope?: string;
    headings: CachedPdfHeading[];
    anchors: CachedPdfAnchor[];
    links: CachedPdfLink[];
}

interface PdfPageLayout {
    format: 'a4' | 'letter' | 'a5';
    orientation: 'p' | 'l';
    pageWidth: number;
    pageHeight: number;
    margin: number;
    topMargin: number;
    bottomMargin: number;
    contentWidthMm: number;
    maxContentHeightMm: number;
    contentWidthPx: number;
    mmPerPx: number;
    maxPageContentPx: number;
    contentScale: number;
}

interface ExportThemeSnapshot {
    themeClass: 'theme-light' | 'theme-dark';
    isDark: boolean;
    bgColor: number[];
    textColor: number[];
    bgHex: string;
    footerFontFamily: string;
    frozenCssVars: Record<string, string>;
}

interface MergedAppendTarget {
    doc: jsPDF;
    layout: PdfPageLayout;
    existingPdfPages: number;
    emittedSlicesMeta: EmittedPdfSliceMeta[];
    noteScopeId: string;
    mergedNoteScopeMap: Map<string, string>;
    pageTitlesByPage: string[];
    cachedFont: { fontFile: TFile; fontName: string; base64: string } | null;
    isCustomUnicodeFont: boolean;
    effectiveTextLayerFont: string;
    lockedTheme?: ExportThemeSnapshot;
    outTheme?: { bgColor: number[]; textColor: number[]; bgHex: string; footerFontFamily: string };
    outEmittedPages?: number;
}

interface CachedPdfPage {
    startLine: number;
    endLine: number;
    htmlSignature: string;
    isLandscape?: boolean;
    contentScaleOverride?: number;
    slices: CachedPdfSlice[];
    markerOffsets: Array<{ line: number; offsetTopPx: number }>;
    textSpans: CachedPdfTextSpan[];
    headings?: CachedPdfHeading[];
    anchors?: CachedPdfAnchor[];
    links?: CachedPdfLink[];
}

interface PreviewRenderCache {
    docKey: string;
    breakLines: number[];
    pages: CachedPdfPage[];
    bgColor: number[];
    textColor: number[];
    bgHex: string;
    footerFontFamily: string;
    captureScale: number;
}

interface CachedExportPdf {
    key: string;
    buffer: ArrayBuffer;
}

interface DevicePerfProfile {
    tier: 'high' | 'medium' | 'low';
    imageConcurrency: number;
    maxBatchPages: number;
    maxBatchCanvasHeightPx: number;
    pageYieldMs: number;
    batchYieldBaseMs: number;
    batchYieldMaxMs: number;
}

type PdfWorkJobKind = 'preview' | 'note' | 'folder' | 'merged' | 'automation';

interface PdfWorkJobControl {
    isCancelled: () => boolean;
    cancel: () => void;
}

interface PdfWorkQueueItem {
    id: number;
    kind: PdfWorkJobKind;
    label: string;
    run: () => Promise<void>;
    cancel: () => void;
    cancelQueued: () => void;
    onQueueChanged?: (position: number) => void;
}

interface ObsidianReadingSection {
    el?: HTMLElement;
    rendered?: boolean;
    shown?: boolean;
    text?: string;
    lineStart?: number;
    lineEnd?: number;
    startLine?: number;
    endLine?: number;
    position?: { start?: { line?: number }; end?: { line?: number } };
    info?: { lineStart?: number; lineEnd?: number };
    render?: () => void;
    resize?: () => void;
}

type ReadingRendererHook = 'queueRender' | 'onRender' | 'updateVirtualDisplay' | 'rerender' | 'checkScroll' | 'onScroll' | 'onResize';

interface ObsidianReadingRenderer extends Partial<Component> {
    sections?: ObsidianReadingSection[];
    previewEl?: HTMLElement;
    sizerEl?: HTMLElement;
    promises?: Promise<unknown>[];
    parsing?: boolean;
    rendering?: boolean;
    _loaded?: boolean;
    unfoldAll?: () => void;
    showAll?: (() => void) | boolean;
    render?: () => void;
    rerender?: (full?: boolean) => void;
    queueRender?: () => void;
    onRender?: () => void;
    onResize?: () => void;
    onScroll?: () => void;
    checkScroll?: () => void;
    updateVirtualDisplay?: () => void;
    forceRender?: () => void;
    measureAll?: () => void;
    set?: (markdown: string, clear?: boolean) => void;
    show?: () => void;
    getSectionInfo?: (el: HTMLElement) => { lineStart?: number; lineEnd?: number } | null;
    rendered?: boolean;
}

interface ObsidianMarkdownPreviewMode extends Partial<Component> {
    renderer?: ObsidianReadingRenderer;
    sections?: ObsidianReadingSection[];
    previewEl?: HTMLElement;
    sizerEl?: HTMLElement;
    _loaded?: boolean;
    rerender?: (full?: boolean) => void;
    set?: (data: string, clear?: boolean) => void;
    containerEl?: HTMLElement;
}

interface ObsidianReadingSource {
    previewMode?: ObsidianMarkdownPreviewMode;
    renderer?: ObsidianReadingRenderer;
    sections?: ObsidianReadingSection[];
    sizerEl?: HTMLElement;
}

interface ObsidianWorkspaceLeafInternal extends WorkspaceLeaf {
    containerEl: HTMLElement;
    getRoot: () => ReturnType<WorkspaceLeaf['getRoot']>;
    getContainer: () => ReturnType<WorkspaceLeaf['getContainer']>;
    updateHeader: () => void;
}

type WorkspaceLeafConstructor = new (app: App) => ObsidianWorkspaceLeafInternal;

type ObsidianMarkdownViewInternal = MarkdownView & {
    _loaded?: boolean;
    renderer?: ObsidianReadingRenderer;
};

interface ObsidianViewLifecycle {
    onOpen?: () => Promise<void>;
    onClose?: () => Promise<void>;
}

interface ObsidianMarkdownEmbed extends Component {
    loadFile?: () => Promise<void>;
    _loaded?: boolean;
    embedEl?: HTMLElement;
    renderer?: ObsidianReadingRenderer;
    previewMode?: ObsidianMarkdownPreviewMode;
    containerEl?: HTMLElement;
    editMode?: unknown;
}

interface ObsidianAppInternal extends App {
    embedRegistry?: {
        embedByExtension?: {
            md?: (
                ctx: {
                    app: App;
                    containerEl: HTMLElement;
                    linktext: string;
                    sourcePath: string;
                    displayMode: boolean;
                    showInline: boolean;
                    showTitle: boolean;
                    depth: number;
                },
                file: TFile,
                subpath: string
            ) => ObsidianMarkdownEmbed;
        };
    };
}

interface ObsidianWorkspaceItemInternal {
    collapsed?: boolean;
    parent?: ObsidianWorkspaceItemInternal | null;
    children?: WorkspaceLeaf[];
    currentTab?: number;
    getRoot?: () => ObsidianWorkspaceItemInternal | null;
}

interface JsPdfFontRecord {
    id: string;
    objectNumber?: number;
    fontName?: string;
    fontStyle?: string;
    encoding?: string;
    metadata?: { __obsidianGlyphLess?: unknown };
    isAlreadyPutted?: boolean;
}

interface JsPdfOutlineItem {
    title: string;
    options?: { pageNumber?: number; top?: number };
    children: JsPdfOutlineItem[];
    id?: number;
    parent?: JsPdfOutlineItem;
    prev?: JsPdfOutlineItem;
    next?: JsPdfOutlineItem;
}

interface JsPdfPutFontEventArgs {
    font?: JsPdfFontRecord;
    out: (line: string) => void;
    newObject: () => number;
    putStream: (params: { data: string; addLength1?: boolean; objectId?: number }) => void;
}

interface JsPdfInternalApi {
    pageSize: { getWidth: () => number; getHeight: () => number };
    pages: unknown[];
    events: {
        subscribe: (event: string, cb: (args: JsPdfPutFontEventArgs) => void) => void;
    };
    out: (line: string) => void;
    newObject: () => number;
    pdfEscape: (text: string) => string;
    getCoordinateString: (x: number) => string;
    getVerticalCoordinateString: (y: number) => string;
    getPageInfo: (pageNumber: number) => { objId?: number; pageNumber?: number; pageContext?: { objId?: number } } | undefined;
    scaleFactor: number;
    write: (line: string) => void;
}

interface JsPdfOutlineApi {
    __obsidianEnhanced?: boolean;
    add: (parent: JsPdfOutlineItem | null, title: string, options: { pageNumber: number; top?: number }) => JsPdfOutlineItem;
    makeString?: (str: string) => string;
    makeRef: (node: JsPdfOutlineItem) => string;
    objStart: (node: JsPdfOutlineItem) => void;
    objEnd: () => void;
    line: (text: string) => void;
    count_r: (acc: { count: number }, node: JsPdfOutlineItem) => number;
    renderItems?: (this: JsPdfOutlineApi, node: JsPdfOutlineItem) => void;
    ctx?: { pdf?: { internal?: JsPdfInternalApi } };
}

interface JsPdfExtended {
    getFont: (fontName?: string, fontStyle?: string) => JsPdfFontRecord | undefined;
    outline?: JsPdfOutlineApi;
}

interface PdfJsViewport {
    width: number;
    height: number;
}

interface PdfJsPage {
    getViewport: (params: { scale: number }) => PdfJsViewport;
    render: (params: { canvasContext: CanvasRenderingContext2D; viewport: PdfJsViewport }) => { promise: Promise<void> };
}

interface PdfJsDocument {
    numPages: number;
    getPage: (pageNum: number) => Promise<PdfJsPage>;
    destroy?: () => Promise<void>;
}

interface PdfJsLib {
    getDocument: (params: { data: ArrayBuffer }) => { promise: Promise<PdfJsDocument> };
}

interface WindowWithPlatformApis extends Window {
    Capacitor?: {
        Plugins?: {
            Clipboard?: {
                write?: (opts: { string: string }) => Promise<void>;
            };
        };
    };
    require?: (mod: string) => { clipboard?: { writeText?: (text: string) => void } } | undefined;
    CompressionStream?: new (format: string) => {
        readable: ReadableStream<Uint8Array>;
        writable: WritableStream<Uint8Array>;
    };
}

interface NavigatorWithMemory extends Navigator {
    deviceMemory?: number;
}

export default class PdfPlugin extends Plugin {
    settings: PdfPluginSettings = { ...DEFAULT_SETTINGS };
    globalSettings: PdfPluginSettings = { ...DEFAULT_SETTINGS };
    sidebarSettings: PdfPluginSettings = { ...DEFAULT_SETTINGS };
    private sidebarOverriddenKeys = new Set<keyof PdfPluginSettings>();
    private loadedCustomFontFace: { key: string; face: FontFace } | null = null;
    lastReusedPreviewPages: number = 0;
    private colorResolverCtx: CanvasRenderingContext2D | null = null;
    private fontValidatorCtx: CanvasRenderingContext2D | null = null;
    private previewRenderCache: PreviewRenderCache | null = null;
    private cachedExportPdf: CachedExportPdf | null = null;
    private lastActiveNotePath: string | null = null;
    private workQueue: PdfWorkQueueItem[] = [];
    private activeWorkJob: PdfWorkQueueItem | null = null;
    private nextWorkJobId = 1;
    private isProcessingWorkQueue = false;
    private queueStateListeners = new Set<() => void>();
    private isRenderingHiddenView = false;
    private sessionColorCache = new Map<string, string>();
    private sessionFontCache = new Map<string, string>();
    private cachedCustomFont: { path: string; mtime: number; fontName: string; base64: string } | null = null;
    private foreignObjectSupported: boolean | null = null;
    private sessionFontUrlCache = new Map<string, string>();
    private sessionFontRuleCache = new Map<string, string>();
    private unicodeWidthCtx: CanvasRenderingContext2D | null = null;
    private unicodeCharWidthCache = new Map<string, number>();
    private docUnicodeLayerMap = new WeakMap<jsPDF, {
        fontId: string;
        charToCid: Map<string, number>;
        cidToChar: string[];
        cidWidths: number[];
    }>();

    getSidebarView(): PdfSidebarView | null {
        const leaves = this.app.workspace.getLeavesOfType(PDF_SIDEBAR_VIEW);
        for (const leaf of leaves) {
            if (leaf.view instanceof PdfSidebarView) {
                return leaf.view;
            }
        }
        return null;
    }

    async onload() {
        try {
            await this.loadSettings();
            const initialActive = this.app.workspace.getActiveFile();
            if (initialActive && initialActive.extension === 'md') {
                this.lastActiveNotePath = initialActive.path;
            }
            this.registerView(PDF_SIDEBAR_VIEW, (leaf) => new PdfSidebarView(leaf, this));
            this.addSettingTab(new PdfPluginSettingTab(this.app, this));
            this.addRibbonIcon('file-down', 'PDF settings', () => { void this.activateView(); });
            this.addCommand({ id: 'export-pdf', name: 'Export current note to PDF', callback: () => { void this.exportToPdf(); } });
            this.addCommand({ id: 'open-pdf-sidebar', name: 'Open PDF settings sidebar', callback: () => { void this.activateView(); } });
            this.addCommand({
                id: 'export-folder-pdfs',
                name: 'Export folder to separate PDF files',
                callback: () => new FolderExportModal(this.app, this, 'separate').open()
            });
            this.addCommand({
                id: 'export-folder-merged-pdf',
                name: 'Export folder as a single merged PDF',
                callback: () => new FolderExportModal(this.app, this, 'merged').open()
            });
            this.addCommand({
                id: 'merge-notes-pdf',
                name: 'Merge multiple notes into a single PDF',
                callback: () => new MultiNoteMergeModal(this.app, this).open()
            });
            this.addCommand({
                id: 'insert-page-break',
                name: 'Insert page break at cursor',
                editorCallback: (editor: Editor) => this.insertPageBreakInEditor(editor)
            });
            this.addCommand({
                id: 'copy-page-break-syntax',
                name: 'Copy page break syntax to clipboard',
                callback: () => { void this.copyPageBreakSyntaxToClipboard(); }
            });
            this.addCommand({
                id: 'run-automation-job',
                name: 'Run queued automation export job (export-job.json)',
                callback: () => { void this.runAutomationJob(); }
            });
            this.addCommand({
                id: 'clear-pdf-export-queue',
                name: 'Clear queued PDF exports',
                callback: () => {
                    const cleared = this.clearWorkQueue(false);
                    if (cleared > 0) {
                        new Notice(`Cleared ${cleared} queued PDF job${cleared === 1 ? '' : 's'}.`);
                    } else {
                        new Notice('No queued PDF exports to clear.');
                    }
                }
            });

            // Register obsidian://mobile-pdf-export protocol handler for CLI, Termux, iOS Shortcuts, and AI agents
            this.registerObsidianProtocolHandler('mobile-pdf-export', (params) => {
                void this.handleAutomationProtocol(params);
            });

            // Auto-check & resume queued automation job on startup once workspace is ready
            this.app.workspace.onLayoutReady(() => {
                if (this.settings.autoRunAutomationJob) {
                    window.setTimeout(() => {
                        void this.checkAndRunQueuedAutomationJob();
                    }, 1200);
                }
            });

            // Add folder context menu actions in Obsidian's Files view (desktop right-click & mobile long-press)
            this.registerEvent(this.app.workspace.on('file-menu', (menu, file) => {
                if (file instanceof TFolder) {
                    menu.addItem((item) => {
                        item
                            .setTitle('Mobile PDF export (separate PDF files)')
                            .setIcon('file-down')
                            .onClick(() => {
                                void this.exportFolderToPdfs(file);
                            });
                    });
                    menu.addItem((item) => {
                        item
                            .setTitle('Mobile PDF export (single merged PDF)')
                            .setIcon('files')
                            .onClick(() => {
                                void this.exportFolderAsMergedPdf(file);
                            });
                    });
                }
            }));

            // Clear page breaks when switching to a different markdown note; only trigger preview if sidebar is visible
            this.registerEvent(this.app.workspace.on('file-open', (file) => {
                if (this.isRenderingHiddenView) return;
                if (file && file.extension === 'md') {
                    const sidebarView = this.getSidebarView();
                    if (this.lastActiveNotePath !== null && file.path !== this.lastActiveNotePath) {
                        this.sidebarSettings.pageBreaks = '';
                        this.clearRenderCache();
                        if (sidebarView) {
                            sidebarView.refreshSettings();
                        }
                    }
                    this.lastActiveNotePath = file.path;
                    if (sidebarView && this.globalSettings.autoRegeneratePreview) {
                        if (sidebarView.isSidebarVisible()) {
                            sidebarView.triggerPreview();
                        } else {
                            sidebarView.markPendingRefresh();
                        }
                    }
                }
            }));

            // Refresh deferred preview automatically when the user reveals/opens the PDF sidebar
            this.registerEvent(this.app.workspace.on('layout-change', () => {
                if (this.isRenderingHiddenView) return;
                this.getSidebarView()?.refreshIfVisible();
            }));
            this.registerEvent(this.app.workspace.on('active-leaf-change', () => {
                if (this.isRenderingHiddenView) return;
                this.getSidebarView()?.refreshIfVisible();
            }));
            this.registerEvent(this.app.workspace.on('resize', () => {
                if (this.isRenderingHiddenView) return;
                this.getSidebarView()?.refreshIfVisible();
            }));
        } catch (e) {
            console.error("Plugin load error", e);
            new Notice("Failed to load PDF mobile plugin: " + String(e));
        }
    }

    onunload() {
        this.clearWorkQueue(true);
    }

    getWorkQueueStatus(): {
        active: { id: number; kind: PdfWorkJobKind; label: string } | null;
        pending: Array<{ id: number; kind: PdfWorkJobKind; label: string }>;
    } {
        return {
            active: this.activeWorkJob
                ? { id: this.activeWorkJob.id, kind: this.activeWorkJob.kind, label: this.activeWorkJob.label }
                : null,
            pending: this.workQueue.map(item => ({ id: item.id, kind: item.kind, label: item.label }))
        };
    }

    onQueueStateChange(listener: () => void): () => void {
        this.queueStateListeners.add(listener);
        return () => {
            this.queueStateListeners.delete(listener);
        };
    }

    private notifyQueueStateListeners(): void {
        for (let i = 0; i < this.workQueue.length; i++) {
            try {
                this.workQueue[i].onQueueChanged?.(i + 1);
            } catch {
                // ignore listener errors
            }
        }
        for (const listener of Array.from(this.queueStateListeners)) {
            try {
                listener();
            } catch {
                // ignore listener errors
            }
        }
    }

    enqueueWorkJob<T>(options: {
        kind: PdfWorkJobKind;
        label: string;
        run: (ctrl: PdfWorkJobControl) => Promise<T>;
        onCancel?: () => void;
        dedupePendingPreview?: boolean;
        notifyIfQueued?: boolean;
        onQueueChanged?: (position: number) => void;
        onCancelledWhileQueued?: () => void;
    }): { id: number; position: number; promise: Promise<T | undefined> } {
        const id = this.nextWorkJobId++;
        let cancelled = false;
        let settled = false;
        let resolvePromise!: (value: T | undefined) => void;
        const promise = new Promise<T | undefined>((resolve) => {
            resolvePromise = resolve;
        });

        const ctrl: PdfWorkJobControl = {
            isCancelled: () => cancelled,
            cancel: () => {
                if (cancelled) return;
                cancelled = true;
                try {
                    options.onCancel?.();
                } catch {
                    // ignore
                }
            }
        };

        const item: PdfWorkQueueItem = {
            id,
            kind: options.kind,
            label: options.label,
            cancel: () => ctrl.cancel(),
            cancelQueued: () => {
                ctrl.cancel();
                try {
                    options.onCancelledWhileQueued?.();
                } catch {
                    // ignore
                }
                if (!settled) {
                    settled = true;
                    resolvePromise(undefined);
                }
            },
            onQueueChanged: options.onQueueChanged,
            run: async () => {
                if (cancelled) {
                    if (!settled) {
                        settled = true;
                        resolvePromise(undefined);
                    }
                    return;
                }
                try {
                    const value = await options.run(ctrl);
                    if (!settled) {
                        settled = true;
                        resolvePromise(value);
                    }
                } catch (err) {
                    console.error(`PDF queue job "${options.label}" failed:`, err);
                    if (!settled) {
                        settled = true;
                        resolvePromise(undefined);
                    }
                }
            }
        };

        const willWait = this.isProcessingWorkQueue || this.activeWorkJob !== null;
        let insertedIdx = this.workQueue.length;
        if (options.dedupePendingPreview) {
            const existingIdx = this.workQueue.findIndex(q => q.kind === 'preview');
            if (existingIdx >= 0) {
                const previous = this.workQueue[existingIdx];
                this.workQueue[existingIdx] = item;
                insertedIdx = existingIdx;
                previous.cancelQueued();
            } else {
                this.workQueue.push(item);
            }
        } else {
            this.workQueue.push(item);
        }

        const position = willWait ? insertedIdx + 1 : 0;
        if (willWait) {
            this.notifyQueueStateListeners();
            if (options.notifyIfQueued) {
                const runningLabel = this.activeWorkJob ? ` — waiting for ${this.activeWorkJob.label}` : '';
                new Notice(`Queued (#${position}): ${options.label}${runningLabel}`, 4500);
            }
        }

        void this.processWorkQueue();
        return { id, position, promise };
    }

    cancelWorkJob(id: number): boolean {
        if (this.activeWorkJob && this.activeWorkJob.id === id) {
            this.activeWorkJob.cancel();
            return true;
        }
        const idx = this.workQueue.findIndex(item => item.id === id);
        if (idx >= 0) {
            const [removed] = this.workQueue.splice(idx, 1);
            removed.cancelQueued();
            this.notifyQueueStateListeners();
            return true;
        }
        return false;
    }

    clearWorkQueue(cancelActive: boolean = false): number {
        const removed = this.workQueue.splice(0, this.workQueue.length);
        for (const item of removed) {
            item.cancelQueued();
        }
        if (cancelActive && this.activeWorkJob) {
            this.activeWorkJob.cancel();
        }
        this.notifyQueueStateListeners();
        return removed.length;
    }

    private async processWorkQueue(): Promise<void> {
        if (this.isProcessingWorkQueue) return;
        this.isProcessingWorkQueue = true;
        try {
            while (this.workQueue.length > 0) {
                const next = this.workQueue.shift();
                if (!next) break;
                this.activeWorkJob = next;
                this.notifyQueueStateListeners();
                try {
                    await next.run();
                } catch (err) {
                    console.error(`PDF work queue job "${next.label}" threw:`, err);
                } finally {
                    if (this.activeWorkJob === next) {
                        this.activeWorkJob = null;
                    }
                    this.notifyQueueStateListeners();
                }
                if (this.workQueue.length > 0) {
                    await new Promise(r => window.setTimeout(r, 80));
                }
            }
        } finally {
            this.isProcessingWorkQueue = false;
            this.activeWorkJob = null;
            this.notifyQueueStateListeners();
        }
    }

    async loadSettings() {
        const rawData: unknown = await this.loadData();
        const data = (rawData && typeof rawData === 'object') ? (rawData as Record<string, unknown>) : {};
        this.settings = Object.assign({}, DEFAULT_SETTINGS, data as Partial<PdfPluginSettings>);
        // Clean up legacy applyCss setting if present
        if (Object.prototype.hasOwnProperty.call(this.settings, 'applyCss')) {
            delete (this.settings as unknown as Record<string, unknown>).applyCss;
        }
        // Migration from darkMode to pdfTheme
        if (Object.prototype.hasOwnProperty.call(data, 'darkMode') && !Object.prototype.hasOwnProperty.call(data, 'pdfTheme')) {
            this.settings.pdfTheme = data.darkMode ? 'dark' : 'light';
        }
        // Migrate removed built-in font options to Obsidian Default
        if (this.settings.fontFamily !== 'obsidian' && this.settings.fontFamily !== 'custom') {
            this.settings.fontFamily = 'obsidian';
        }
        // Normalize bookmark heading levels (valid integers 1..6, deduplicated and sorted)
        if (!Array.isArray(this.settings.bookmarkHeadingLevels)) {
            this.settings.bookmarkHeadingLevels = [...DEFAULT_SETTINGS.bookmarkHeadingLevels];
        } else {
            this.settings.bookmarkHeadingLevels = Array.from(
                new Set(
                    this.settings.bookmarkHeadingLevels
                        .map((n: unknown) => Number(n))
                        .filter((n: number) => Number.isInteger(n) && n >= 1 && n <= 6)
                )
            ).sort((a, b) => a - b);
        }
        if (typeof this.settings.includeBookmarks !== 'boolean') {
            this.settings.includeBookmarks = DEFAULT_SETTINGS.includeBookmarks;
        }
        if (typeof this.settings.includeTocPage !== 'boolean') {
            this.settings.includeTocPage = DEFAULT_SETTINGS.includeTocPage;
        }
        if (typeof this.settings.enableClickableLinks !== 'boolean') {
            this.settings.enableClickableLinks = DEFAULT_SETTINGS.enableClickableLinks;
        }
        if (typeof this.settings.autoRegeneratePreview !== 'boolean') {
            this.settings.autoRegeneratePreview = DEFAULT_SETTINGS.autoRegeneratePreview;
        }
        if (!['a4', 'letter', 'a5'].includes(this.settings.pageSize)) {
            this.settings.pageSize = DEFAULT_SETTINGS.pageSize;
        }
        if (!['portrait', 'landscape'].includes(this.settings.pageOrientation)) {
            this.settings.pageOrientation = DEFAULT_SETTINGS.pageOrientation;
        }
        if (typeof this.settings.autoLandscapeWidePages !== 'boolean') {
            this.settings.autoLandscapeWidePages = DEFAULT_SETTINGS.autoLandscapeWidePages;
        }
        if (typeof this.settings.optimizeImages !== 'boolean') {
            this.settings.optimizeImages = DEFAULT_SETTINGS.optimizeImages;
        }
        if (typeof this.settings.showFrontmatter !== 'boolean') {
            this.settings.showFrontmatter = DEFAULT_SETTINGS.showFrontmatter;
        }
        if (typeof this.settings.showHeader !== 'boolean') {
            this.settings.showHeader = DEFAULT_SETTINGS.showHeader;
        }
        if (typeof this.settings.headerTemplate !== 'string') {
            this.settings.headerTemplate = DEFAULT_SETTINGS.headerTemplate;
        }
        if (typeof this.settings.headerDateFormat !== 'string' || !this.settings.headerDateFormat.trim()) {
            this.settings.headerDateFormat = DEFAULT_SETTINGS.headerDateFormat;
        }
        if (typeof this.settings.headerTimeFormat !== 'string' || !this.settings.headerTimeFormat.trim()) {
            this.settings.headerTimeFormat = DEFAULT_SETTINGS.headerTimeFormat;
        }
        if (typeof this.settings.autoRunAutomationJob !== 'boolean') {
            this.settings.autoRunAutomationJob = DEFAULT_SETTINGS.autoRunAutomationJob;
        }
        if (!['narrow', 'normal', 'wide', 'custom'].includes(this.settings.marginPreset)) {
            this.settings.marginPreset = DEFAULT_SETTINGS.marginPreset;
        }
        const parsedCustomMargin = Number(this.settings.customMarginMm);
        this.settings.customMarginMm = Number.isFinite(parsedCustomMargin)
            ? Math.max(5, Math.min(45, Math.round(parsedCustomMargin)))
            : DEFAULT_SETTINGS.customMarginMm;
        const parsedScale = Number(this.settings.contentScale);
        this.settings.contentScale = Number.isFinite(parsedScale)
            ? Math.max(80, Math.min(120, Math.round(parsedScale / 5) * 5))
            : DEFAULT_SETTINGS.contentScale;
        this.settings.pageBreaks = '';
        this.globalSettings = this.settings;
        this.sidebarSettings = this.cloneSettings(this.globalSettings);
        this.sidebarOverriddenKeys.clear();
    }

    /**
     * Resolves active page dimensions (mm), margins (mm), and scaled CSS render viewport (px)
     * from user settings. Keeps base text density identical to A4 Portrait @ 100% (700px / 180mm)
     * across page sizes and orientations, and applies Content Scale (80%–120%) proportionally.
     */
    getPdfPageLayout(overrideOrientation?: 'portrait' | 'landscape', overrideContentScale?: number): PdfPageLayout {
        const format: 'a4' | 'letter' | 'a5' = ['a4', 'letter', 'a5'].includes(this.settings.pageSize)
            ? this.settings.pageSize
            : 'a4';
        const effectiveOrientation = overrideOrientation ?? this.settings.pageOrientation;
        const orientation: 'p' | 'l' = effectiveOrientation === 'landscape' ? 'l' : 'p';

        const baseDims: Record<'a4' | 'letter' | 'a5', [number, number]> = {
            a4: [210, 297],
            letter: [215.9, 279.4],
            a5: [148, 210]
        };
        const [rawW, rawH] = baseDims[format];
        const pageWidth = orientation === 'l' ? rawH : rawW;
        const pageHeight = orientation === 'l' ? rawW : rawH;

        let margin = 15;
        if (this.settings.marginPreset === 'narrow') {
            margin = 10;
        } else if (this.settings.marginPreset === 'wide') {
            margin = 25;
        } else if (this.settings.marginPreset === 'custom') {
            const customVal = Number(this.settings.customMarginMm);
            margin = Number.isFinite(customVal) ? Math.max(5, Math.min(45, customVal)) : 15;
        }
        // Guard against extreme margins on small formats like A5
        margin = Math.min(margin, Math.floor((Math.min(pageWidth, pageHeight) - 40) / 2));

        const topMargin = this.settings.showHeader ? Math.max(margin, 12) + 3 : margin;
        const bottomMargin = this.settings.showFootnote ? Math.max(margin, 12) + 3 : margin;
        const contentWidthMm = Math.max(40, pageWidth - margin * 2);
        const maxContentHeightMm = Math.max(40, pageHeight - topMargin - bottomMargin);

        const contentScale = overrideContentScale !== undefined && Number.isFinite(overrideContentScale)
            ? Math.max(35, Math.min(120, Math.round(overrideContentScale)))
            : Math.max(80, Math.min(120, Number(this.settings.contentScale) || 100));
        const basePxPerMm = 700 / 180; // Exact 700px on A4 Portrait with 15mm margins at 100%
        const contentWidthPx = Math.max(280, Math.round((contentWidthMm * basePxPerMm) / (contentScale / 100)));
        const mmPerPx = contentWidthMm / contentWidthPx;
        const maxPageContentPx = Math.max(120, Math.floor(maxContentHeightMm / mmPerPx));

        return {
            format,
            orientation,
            pageWidth,
            pageHeight,
            margin,
            topMargin,
            bottomMargin,
            contentWidthMm,
            maxContentHeightMm,
            contentWidthPx,
            mmPerPx,
            maxPageContentPx,
            contentScale
        };
    }

    getTargetMarkdownFile(): TFile | null {
        const active = this.app.workspace.getActiveFile();
        if (active && active.extension === 'md') {
            this.lastActiveNotePath = active.path;
            return active;
        }
        const activeSidebar = this.app.workspace.getActiveViewOfType(PdfSidebarView);
        if (activeSidebar && this.lastActiveNotePath) {
            const abstractFile = this.app.vault.getAbstractFileByPath(this.lastActiveNotePath);
            if (abstractFile instanceof TFile && abstractFile.extension === 'md') {
                return abstractFile;
            }
        }
        return null;
    }

    cloneSettings(src: PdfPluginSettings): PdfPluginSettings {
        return {
            ...src,
            bookmarkHeadingLevels: [...src.bookmarkHeadingLevels]
        };
    }

    private areSettingValuesEqual(key: keyof PdfPluginSettings, a: PdfPluginSettings, b: PdfPluginSettings): boolean {
        if (key === 'bookmarkHeadingLevels') {
            const arrA = a.bookmarkHeadingLevels || [];
            const arrB = b.bookmarkHeadingLevels || [];
            return arrA.length === arrB.length && arrA.every((v, idx) => v === arrB[idx]);
        }
        return a[key] === b[key];
    }

    getSidebarOverrideCount(): number {
        let count = 0;
        for (const key of SHARED_SIDEBAR_SETTING_KEYS) {
            if (!this.areSettingValuesEqual(key, this.sidebarSettings, this.globalSettings)) {
                count++;
            }
        }
        return count;
    }

    updateSidebarSetting<K extends keyof PdfPluginSettings>(key: K, value: PdfPluginSettings[K]): void {
        this.sidebarSettings[key] = (Array.isArray(value) ? [...value] : value) as PdfPluginSettings[K];
        if (SHARED_SIDEBAR_SETTING_KEYS.includes(key)) {
            if (this.areSettingValuesEqual(key, this.sidebarSettings, this.globalSettings)) {
                this.sidebarOverriddenKeys.delete(key);
            } else {
                this.sidebarOverriddenKeys.add(key);
            }
            this.getSidebarView()?.updateOverrideBanner();
        }
    }

    async saveSidebarAsGlobalDefaults(): Promise<void> {
        for (const key of SHARED_SIDEBAR_SETTING_KEYS) {
            const val = this.sidebarSettings[key];
            (this.globalSettings as unknown as Record<string, unknown>)[key] = Array.isArray(val) ? [...val] : val;
        }
        this.sidebarOverriddenKeys.clear();
        await this.saveSettings();
        this.getSidebarView()?.updateOverrideBanner();
        new Notice('Saved sidebar settings as global defaults.');
    }

    resetSidebarToGlobalDefaults(): void {
        for (const key of SHARED_SIDEBAR_SETTING_KEYS) {
            const val = this.globalSettings[key];
            (this.sidebarSettings as unknown as Record<string, unknown>)[key] = Array.isArray(val) ? [...val] : val;
        }
        this.sidebarOverriddenKeys.clear();
        this.clearRenderCache();
        const sidebarView = this.getSidebarView();
        if (sidebarView) {
            void sidebarView.display(this.globalSettings.autoRegeneratePreview);
        }
        new Notice('Sidebar settings reset to global defaults.');
    }

    async runWithSettings<T>(override: PdfPluginSettings | undefined, fn: () => Promise<T>): Promise<T> {
        if (!override) return await fn();
        const prev = this.settings;
        this.settings = override;
        try {
            return await fn();
        } finally {
            this.settings = prev;
        }
    }

    async saveSettings() {
        await this.saveData({
            ...this.globalSettings,
            pageBreaks: ''
        });
    }

    clearRenderCache() {
        this.previewRenderCache = null;
        this.cachedExportPdf = null;
        this.lastReusedPreviewPages = 0;
        this.sessionFontRuleCache.clear();
    }

    resolveVaultFontFile(rawPath: string): TFile | null {
        const normalized = (rawPath || '').trim().replace(/^\/+/, '');
        if (!normalized) return null;
        const direct = this.app.vault.getAbstractFileByPath(normalized);
        if (direct instanceof TFile && (direct.extension.toLowerCase() === 'ttf' || direct.name.toLowerCase().endsWith('.ttf'))) {
            return direct;
        }
        const lowerTarget = normalized.toLowerCase();
        const match = this.app.vault.getFiles().find(
            f => (f.extension.toLowerCase() === 'ttf' || f.name.toLowerCase().endsWith('.ttf')) &&
                f.path.toLowerCase() === lowerTarget
        );
        return match ?? null;
    }

    private arrayBufferToBase64(buffer: ArrayBuffer): string {
        const bytes = new Uint8Array(buffer);
        const chunkSize = 0x8000;
        const parts: string[] = [];
        for (let i = 0; i < bytes.byteLength; i += chunkSize) {
            const slice = bytes.subarray(i, Math.min(i + chunkSize, bytes.byteLength));
            parts.push(String.fromCharCode(...Array.from(slice)));
        }
        return window.btoa(parts.join(''));
    }

    private static readonly UNSUPPORTED_COLOR_REGEX = /(?:oklch|oklab|color-mix|light-dark|\blab|\blch|\bcolor|\bhwb)\(|\b(?:rgb|rgba|hsl|hsla)\(\s*from\b/i;

    /**
     * Resolves any CSS color string (including oklch, oklab, color-mix, light-dark)
     * into an rgb/rgba string that html2canvas 1.4.1 can safely parse.
     */
    private resolveCssColorToRgba(colorValue: string): string | null {
        if (!colorValue || colorValue === 'transparent' || colorValue === 'none') return null;
        const trimmed = colorValue.trim();
        if (/^rgba?\(\s*\d+\s*,\s*\d+\s*,\s*\d+/i.test(trimmed)) {
            return trimmed;
        }

        if (!this.colorResolverCtx) {
            const canvas = createEl('canvas');
            canvas.width = 1;
            canvas.height = 1;
            this.colorResolverCtx = canvas.getContext('2d', { willReadFrequently: true });
        }
        const ctx = this.colorResolverCtx;
        if (!ctx) return null;

        try {
            ctx.globalAlpha = 1;
            ctx.globalCompositeOperation = 'copy';
            ctx.clearRect(0, 0, 1, 1);
            ctx.fillStyle = 'rgba(0, 0, 0, 0)';
            ctx.fillStyle = trimmed;
            ctx.fillRect(0, 0, 1, 1);
            const data = ctx.getImageData(0, 0, 1, 1).data;
            const alpha = +(data[3] / 255).toFixed(3);
            return `rgba(${data[0]}, ${data[1]}, ${data[2]}, ${alpha})`;
        } catch {
            return null;
        }
    }

    /**
     * Replaces any unsupported CSS color function calls (with balanced parentheses, including nested calls)
     * inside a CSS value string with resolved rgba(...) strings.
     */
    private replaceUnsupportedColorFunctions(value: string, cache?: Map<string, string>): string {
        if (!value || !PdfPlugin.UNSUPPORTED_COLOR_REGEX.test(value)) return value;

        const fnPattern = /(oklch|oklab|color-mix|light-dark|\blab|\blch|\bcolor|\bhwb)\(|\b(?:rgb|rgba|hsl|hsla)\((?=\s*from\b)/gi;
        let result = '';
        let i = 0;

        while (i < value.length) {
            fnPattern.lastIndex = i;
            const match = fnPattern.exec(value);
            if (!match) {
                result += value.slice(i);
                break;
            }

            const startIdx = match.index;
            if (startIdx > 0 && /[-a-zA-Z0-9_]/.test(value[startIdx - 1])) {
                result += value.slice(i, startIdx + match[0].length);
                i = startIdx + match[0].length;
                continue;
            }

            result += value.slice(i, startIdx);

            let depth = 0;
            let endIdx = startIdx + match[0].length - 1;
            while (endIdx < value.length) {
                const ch = value[endIdx];
                if (ch === '(') depth++;
                else if (ch === ')') {
                    depth--;
                    if (depth === 0) {
                        endIdx++;
                        break;
                    }
                }
                endIdx++;
            }

            const expr = value.slice(startIdx, endIdx);
            let resolved = cache?.get(expr);
            if (resolved === undefined) {
                resolved = this.resolveCssColorToRgba(expr) || 'rgba(0, 0, 0, 0)';
                cache?.set(expr, resolved);
            }
            result += resolved;
            i = endIdx;
        }

        return result;
    }

    private parseColorToRgbArray(colorStr: string): number[] | null {
        const rgba = this.resolveCssColorToRgba(colorStr);
        if (!rgba) return null;
        const match = rgba.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/);
        if (match) {
            const alpha = match[4] !== undefined ? parseFloat(match[4]) : 1;
            if (!isNaN(alpha) && alpha <= 0.001) return null;
            return [parseInt(match[1], 10), parseInt(match[2], 10), parseInt(match[3], 10)];
        }
        return null;
    }

    /**
     * Normalizes CSS font-family stacks for html2canvas 1.4.1.
     * Obsidian's default CSS includes sentinel tokens like '??' which html2canvas unquotes into `??`,
     * causing Chromium Canvas2D `ctx.font` assignment to fail and fall back to 10px sans-serif.
     */
    private sanitizeFontFamilyForHtml2Canvas(rawFontFamily: string): string {
        if (!rawFontFamily) return '';

        if (!this.fontValidatorCtx) {
            const canvas = createEl('canvas');
            canvas.width = 1;
            canvas.height = 1;
            this.fontValidatorCtx = canvas.getContext('2d');
        }
        const testCtx = this.fontValidatorCtx;

        const isValidHtml2CanvasFontToken = (name: string): boolean => {
            if (!name || name.includes('?') || /[;{}()\\/"']/.test(name)) return false;
            const formatted = name.includes(' ') ? `'${name}'` : name;
            // Single-word tokens must be valid CSS identifiers because html2canvas strips quotes on single words
            if (!name.includes(' ') && !/^(?!--|-\d)[a-zA-Z_-][a-zA-Z0-9_-]*$/.test(name)) {
                return false;
            }
            if (!testCtx) return true;
            try {
                testCtx.font = 'italic 11px fantasy';
                const sentinel = testCtx.font;
                testCtx.font = `normal normal 400 16px ${formatted}`;
                return testCtx.font !== sentinel;
            } catch {
                return false;
            }
        };

        // Split by top-level commas respecting quotes
        const rawTokens: string[] = [];
        let current = '';
        let quoteChar: string | null = null;
        for (let i = 0; i < rawFontFamily.length; i++) {
            const ch = rawFontFamily[i];
            if (quoteChar) {
                if (ch === quoteChar && rawFontFamily[i - 1] !== '\\') {
                    quoteChar = null;
                }
                current += ch;
            } else if (ch === '"' || ch === "'") {
                quoteChar = ch;
                current += ch;
            } else if (ch === ',') {
                rawTokens.push(current.trim());
                current = '';
            } else {
                current += ch;
            }
        }
        if (current.trim()) rawTokens.push(current.trim());

        const validTokens: string[] = [];
        for (const raw of rawTokens) {
            const unquoted = raw.replace(/^(['"])(.*)\1$/, '$2').trim();
            if (!isValidHtml2CanvasFontToken(unquoted)) continue;
            validTokens.push(unquoted.includes(' ') ? `"${unquoted}"` : unquoted);
        }

        if (validTokens.length === 0) {
            return 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
        }

        const joined = validTokens.join(', ');
        if (testCtx) {
            try {
                testCtx.font = 'italic 11px fantasy';
                const sentinel = testCtx.font;
                const html2CanvasSim = validTokens
                    .map(t => t.replace(/^(['"])(.*)\1$/, '$2'))
                    .map(t => (t.includes(' ') ? `'${t}'` : t))
                    .join(', ');
                testCtx.font = `normal normal 400 16px ${html2CanvasSim}`;
                if (testCtx.font === sentinel) {
                    return 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
                }
            } catch {
                return 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
            }
        }
        return joined;
    }

    /**
     * Computes a device performance profile based on platform, CPU cores, and available RAM
     * so long notes and batch folder exports run fast on desktops while staying smooth and
     * memory-safe on lower-end mobile devices.
     */
    private getDevicePerfProfile(): DevicePerfProfile {
        const isMobile = Platform.isMobile;
        const cores = typeof navigator !== 'undefined' && typeof navigator.hardwareConcurrency === 'number'
            ? navigator.hardwareConcurrency
            : (isMobile ? 4 : 8);
        const navWithMem = typeof navigator !== 'undefined' ? (navigator as NavigatorWithMemory) : null;
        const memGb = navWithMem && typeof navWithMem.deviceMemory === 'number'
            ? navWithMem.deviceMemory
            : (isMobile ? 4 : 8);

        if (!isMobile && cores >= 8 && memGb >= 8) {
            return {
                tier: 'high',
                imageConcurrency: 6,
                maxBatchPages: 3,
                maxBatchCanvasHeightPx: 6500,
                pageYieldMs: 4,
                batchYieldBaseMs: 12,
                batchYieldMaxMs: 60
            };
        }
        if (isMobile && (cores <= 4 || memGb <= 4)) {
            return {
                tier: 'low',
                imageConcurrency: 2,
                maxBatchPages: 2,
                maxBatchCanvasHeightPx: 4500,
                pageYieldMs: 16,
                batchYieldBaseMs: 50,
                batchYieldMaxMs: 220
            };
        }
        return {
            tier: 'medium',
            imageConcurrency: 4,
            maxBatchPages: 3,
            maxBatchCanvasHeightPx: 5800,
            pageYieldMs: 8,
            batchYieldBaseMs: 25,
            batchYieldMaxMs: 120
        };
    }

    /**
     * Yields briefly to the browser event loop without ever stalling or suffering Chromium's
     * 1000ms background timer throttling when Obsidian is minimized or occluded (uses MessageChannel).
     */
    private yieldFrameSafe(timeoutMs: number = 32): Promise<void> {
        if (activeDocument.visibilityState === 'hidden' && typeof MessageChannel === 'function') {
            return new Promise<void>((resolve) => {
                const channel = new MessageChannel();
                channel.port1.onmessage = () => {
                    channel.port1.onmessage = null;
                    resolve();
                };
                channel.port2.postMessage(null);
            });
        }
        return new Promise<void>((resolve) => {
            let settled = false;
            let rafId = 0;
            const finish = () => {
                if (settled) return;
                settled = true;
                window.clearTimeout(timer);
                if (rafId && typeof window.cancelAnimationFrame === 'function') {
                    window.cancelAnimationFrame(rafId);
                }
                resolve();
            };
            const timer = window.setTimeout(finish, timeoutMs);
            if (typeof window.requestAnimationFrame === 'function' && activeDocument.visibilityState !== 'hidden') {
                rafId = window.requestAnimationFrame(finish);
            }
        });
    }

    /**
     * Reads and base64-encodes the configured custom .ttf font once and caches it by path + mtime
     * so jsPDF registration, DOM @font-face CSS, previews, and folder exports never duplicate work.
     */
    private async getCachedCustomFont(): Promise<{ fontFile: TFile; fontName: string; base64: string } | null> {
        if (this.settings.fontFamily !== 'custom' || !this.settings.customFontPath || this.settings.customFontPath.trim() === '') {
            return null;
        }
        const fontFile = this.resolveVaultFontFile(this.settings.customFontPath);
        if (!fontFile) return null;

        const mtime = fontFile.stat?.mtime ?? 0;
        if (
            this.cachedCustomFont &&
            this.cachedCustomFont.path === fontFile.path &&
            this.cachedCustomFont.mtime === mtime
        ) {
            return {
                fontFile,
                fontName: this.cachedCustomFont.fontName,
                base64: this.cachedCustomFont.base64
            };
        }

        const binary = await this.app.vault.readBinary(fontFile);
        const base64 = this.arrayBufferToBase64(binary);
        this.cachedCustomFont = {
            path: fontFile.path,
            mtime,
            fontName: fontFile.name,
            base64
        };
        return { fontFile, fontName: fontFile.name, base64 };
    }

    /**
     * Builds the @font-face and font-family CSS for the chosen plugin font setting.
     */
    private buildFontCssFromCached(
        activeFontName: string,
        cachedFont: { base64: string } | null
    ): { css: string; cssFontFamily: string } {
        if (cachedFont) {
            const css = `
                @font-face {
                    font-family: '${activeFontName}';
                    src: url('data:font/ttf;base64,${cachedFont.base64}') format('truetype');
                    font-weight: 100 900;
                    font-style: normal;
                }
            `;
            return { css, cssFontFamily: `'${activeFontName}', system-ui, sans-serif` };
        }
        return { css: '', cssFontFamily: '' };
    }

    /**
     * Loads the cached custom .ttf font into the document via the FontFace API (without injecting <style> tags).
     */
    private async ensureCustomFontLoadedInDocument(
        activeFontName: string,
        cachedFont: { fontFile: TFile; base64: string } | null
    ): Promise<void> {
        if (!cachedFont || typeof FontFace !== 'function') return;
        const key = `${activeFontName}::${cachedFont.fontFile.path}::${cachedFont.fontFile.stat?.mtime ?? 0}`;
        if (this.loadedCustomFontFace && this.loadedCustomFontFace.key === key) {
            return;
        }
        try {
            if (this.loadedCustomFontFace) {
                try {
                    activeDocument.fonts.delete(this.loadedCustomFontFace.face);
                } catch {
                    // ignore removal failure
                }
                this.loadedCustomFontFace = null;
            }
            const face = new FontFace(
                activeFontName,
                `url("data:font/ttf;base64,${cachedFont.base64}") format("truetype")`,
                { weight: '100 900', style: 'normal' }
            );
            const loadedFace = await face.load();
            activeDocument.fonts.add(loadedFace);
            this.loadedCustomFontFace = { key, face: loadedFace };
        } catch (err) {
            console.warn('Could not register custom FontFace in document.fonts:', err);
        }
    }

    private static readonly CORE_THEME_CSS_VARS: readonly string[] = [
        '--background-primary',
        '--background-primary-alt',
        '--background-secondary',
        '--background-secondary-alt',
        '--background-modifier-border',
        '--background-modifier-border-hover',
        '--background-modifier-border-focus',
        '--background-modifier-hover',
        '--background-modifier-active-hover',
        '--background-modifier-form-field',
        '--background-modifier-cover',
        '--background-modifier-box-shadow',
        '--text-normal',
        '--text-muted',
        '--text-faint',
        '--text-on-accent',
        '--text-on-accent-inverted',
        '--text-accent',
        '--text-accent-hover',
        '--text-error',
        '--text-warning',
        '--text-success',
        '--text-selection',
        '--text-highlight-bg',
        '--interactive-normal',
        '--interactive-hover',
        '--interactive-accent',
        '--interactive-accent-hsl',
        '--interactive-accent-hover',
        '--link-color',
        '--link-color-hover',
        '--link-external-color',
        '--link-external-color-hover',
        '--link-unresolved-color',
        '--link-unresolved-opacity',
        '--code-normal',
        '--code-background',
        '--code-comment',
        '--code-function',
        '--code-important',
        '--code-keyword',
        '--code-operator',
        '--code-property',
        '--code-punctuation',
        '--code-string',
        '--code-tag',
        '--code-value',
        '--hr-color',
        '--blockquote-border-color',
        '--blockquote-color',
        '--blockquote-background-color',
        '--table-background',
        '--table-header-background',
        '--table-border-color',
        '--table-row-even-background',
        '--table-row-odd-background',
        '--table-header-color',
        '--table-text-color',
        '--h1-color',
        '--h2-color',
        '--h3-color',
        '--h4-color',
        '--h5-color',
        '--h6-color',
        '--bold-color',
        '--italic-color',
        '--inline-title-color',
        '--list-marker-color',
        '--indentation-guide-color',
        '--indentation-guide-color-active',
        '--tag-color',
        '--tag-background',
        '--tag-border-color',
        '--callout-default',
        '--callout-info',
        '--callout-todo',
        '--callout-tip',
        '--callout-success',
        '--callout-question',
        '--callout-warning',
        '--callout-fail',
        '--callout-error',
        '--callout-bug',
        '--callout-example',
        '--callout-quote',
        '--callout-summary',
        '--checkbox-color',
        '--checkbox-color-hover',
        '--checkbox-border-color',
        '--checkbox-marker-color',
        '--color-base-00',
        '--color-base-05',
        '--color-base-10',
        '--color-base-20',
        '--color-base-25',
        '--color-base-30',
        '--color-base-35',
        '--color-base-40',
        '--color-base-50',
        '--color-base-60',
        '--color-base-70',
        '--color-base-100',
        '--color-red',
        '--color-orange',
        '--color-yellow',
        '--color-green',
        '--color-cyan',
        '--color-blue',
        '--color-purple',
        '--color-pink',
        '--color-red-rgb',
        '--color-orange-rgb',
        '--color-yellow-rgb',
        '--color-green-rgb',
        '--color-cyan-rgb',
        '--color-blue-rgb',
        '--color-purple-rgb',
        '--color-pink-rgb',
        '--mono-rgb-0',
        '--mono-rgb-100',
        '--accent-h',
        '--accent-s',
        '--accent-l'
    ];

    /**
     * Collects all theme-related CSS custom property names from Obsidian core + active theme/snippet
     * stylesheets so their computed values can be snapshotted and frozen at export start.
     */
    private collectActiveThemeCssVarNames(): Set<string> {
        const varNames = new Set<string>(PdfPlugin.CORE_THEME_CSS_VARS);
        const inspectStyleDecl = (decl: CSSStyleDeclaration | null | undefined) => {
            if (!decl) return;
            for (let i = 0; i < decl.length; i++) {
                const prop = decl.item(i);
                if (prop && prop.startsWith('--') && !prop.startsWith('--pdf-')) {
                    varNames.add(prop);
                }
            }
        };
        const inspectRules = (rules: CSSRuleList | null | undefined) => {
            if (!rules) return;
            for (let i = 0; i < rules.length; i++) {
                const rule = rules[i];
                if (rule instanceof CSSStyleRule) {
                    const sel = rule.selectorText || '';
                    if (
                        sel.includes('theme-dark') ||
                        sel.includes('theme-light') ||
                        sel.includes(':root') ||
                        sel.includes('body')
                    ) {
                        inspectStyleDecl(rule.style);
                    }
                } else if ('cssRules' in rule) {
                    try {
                        inspectRules((rule as CSSGroupingRule).cssRules);
                    } catch {
                        // ignore restricted nested rules
                    }
                }
            }
        };

        try {
            inspectStyleDecl(activeDocument.documentElement?.style);
            inspectStyleDecl(activeDocument.body?.style);
            const sheets = activeDocument.styleSheets;
            for (let i = 0; i < sheets.length; i++) {
                try {
                    inspectRules(sheets[i].cssRules);
                } catch {
                    // ignore cross-origin stylesheets
                }
            }
        } catch {
            // keep core variable set
        }
        return varNames;
    }

    /**
     * Snapshots and freezes the resolved theme class, background/text RGB, footer font, and all
     * computed Obsidian CSS theme custom properties at export start so an OS or Obsidian theme
     * change mid-export can never invert text colors or flip page backgrounds mid-document.
     */
    private captureExportThemeSnapshot(
        cssFontFamily: string,
        contentWidthPx: number,
        landscapeContentWidthPx?: number
    ): ExportThemeSnapshot {
        let themeClass: 'theme-light' | 'theme-dark' = 'theme-light';
        if (this.settings.pdfTheme === 'dark') {
            themeClass = 'theme-dark';
        } else if (this.settings.pdfTheme === 'css') {
            themeClass = activeDocument.body.classList.contains('theme-dark') ? 'theme-dark' : 'theme-light';
        }
        const isDark = themeClass === 'theme-dark';

        const probe = activeDocument.body.createDiv({
            cls: `${themeClass} pdf-export-root pdf-export-hidden-root`
        });
        try {
            this.applyExportRootStyles(probe, isDark, cssFontFamily, contentWidthPx, landscapeContentWidthPx);
            const probeCs = window.getComputedStyle(probe);
            const bodyBg = this.settings.pdfTheme === 'css'
                ? this.parseColorToRgbArray(window.getComputedStyle(activeDocument.body).backgroundColor)
                : null;
            const bgColor = this.parseColorToRgbArray(probeCs.backgroundColor) || bodyBg || (isDark ? [0, 0, 0] : [255, 255, 255]);
            const textColor = this.parseColorToRgbArray(probeCs.color) || (isDark ? [255, 255, 255] : [0, 0, 0]);
            const bgHex = `rgb(${bgColor[0]}, ${bgColor[1]}, ${bgColor[2]})`;
            const textHex = `rgb(${textColor[0]}, ${textColor[1]}, ${textColor[2]})`;
            const footerFontFamily = cssFontFamily || this.sanitizeFontFamilyForHtml2Canvas(probeCs.fontFamily || '');

            const frozenCssVars: Record<string, string> = {};
            const varNames = this.collectActiveThemeCssVarNames();
            varNames.forEach((prop) => {
                const val = probeCs.getPropertyValue(prop).trim();
                if (val) {
                    frozenCssVars[prop] = val;
                }
            });
            frozenCssVars['--background-primary'] = bgHex;
            frozenCssVars['--text-normal'] = textHex;

            return {
                themeClass,
                isDark,
                bgColor,
                textColor,
                bgHex,
                footerFontFamily,
                frozenCssVars
            };
        } finally {
            probe.remove();
        }
    }

    /**
     * Applies theme, contrast, link-visibility, font, frozen theme variables, and viewport width
     * classes/variables onto the hidden render root using static rules defined in styles.css + setCssProps.
     */
    private applyExportRootStyles(
        renderRoot: HTMLElement,
        isDark: boolean,
        cssFontFamily: string,
        contentWidthPx: number,
        landscapeContentWidthPx?: number,
        lockedTheme?: ExportThemeSnapshot
    ): void {
        const useObsidianThemeVars = this.settings.pdfTheme === 'css';
        const bodyIsDark = activeDocument.body.classList.contains('theme-dark');
        const needsContrastFlipVars = !lockedTheme && !useObsidianThemeVars && (bodyIsDark !== isDark);

        renderRoot.addClass(isDark ? 'pdf-mode-dark' : 'pdf-mode-light');
        if (useObsidianThemeVars) {
            renderRoot.addClass('pdf-theme-css');
        } else {
            renderRoot.addClass(isDark ? 'pdf-theme-dark' : 'pdf-theme-light');
        }
        if (needsContrastFlipVars) {
            renderRoot.addClass(isDark ? 'pdf-contrast-dark' : 'pdf-contrast-light');
        }
        if (!this.settings.enableClickableLinks) {
            renderRoot.addClass('pdf-disable-links');
        }
        const props: Record<string, string> = lockedTheme ? { ...lockedTheme.frozenCssVars } : {};
        props['--pdf-content-width'] = `${contentWidthPx}px`;
        props['--pdf-landscape-width'] = `${landscapeContentWidthPx && landscapeContentWidthPx > contentWidthPx ? landscapeContentWidthPx : contentWidthPx}px`;
        if (cssFontFamily) {
            renderRoot.addClass('pdf-custom-font');
            props['--pdf-custom-font-family'] = cssFontFamily;
        }
        renderRoot.setCssProps(props);
        if (lockedTheme) {
            renderRoot.style.backgroundColor = lockedTheme.bgHex;
            renderRoot.style.color = `rgb(${lockedTheme.textColor[0]}, ${lockedTheme.textColor[1]}, ${lockedTheme.textColor[2]})`;
        }
    }

    private static readonly ASYNC_WIDGET_SELECTOR =
        '[class*="block-language-"], .mermaid, .internal-embed, .dataview, .math, mjx-container, canvas, iframe';

    /**
     * Interactive Obsidian / plugin chrome controls that must never be painted or extracted into
     * exported PDFs, even if a mobile or custom theme overrides CSS display rules with !important.
     */
    private static readonly PDF_EXCLUDED_UI_SELECTOR = [
        '.copy-code-button',
        '.edit-block-button',
        '.collapse-indicator',
        '.heading-collapse-indicator',
        '.list-collapse-indicator',
        '.markdown-embed-link',
        '.file-embed-link',
        '.metadata-container',
        '.frontmatter',
        '.view-header',
        '.workspace-leaf-resize-handle',
        '.markdown-source-view',
        '.markdown-preview-pusher',
        '.switchable-layout .switch-button',
        '.diagram-zoom-drag-controls',
        '.dzd-controls',
        '.dzd-toolbar',
        '.mermaid-toolbar',
        '.mermaid-controls',
        '.mermaid-zoom-buttons',
        '.zoom-controls',
        '.pan-zoom-controls',
        '.mermaid button',
        '.block-language-mermaid button',
        '.mermaid .clickable-icon',
        '.block-language-mermaid .clickable-icon',
        '[class*="mermaid"] button',
        '[class*="diagram-zoom"] button'
    ].join(', ');

    /**
     * Waits for async Obsidian renderers (images, Mermaid diagrams, MathJax, internal embeds) to finish.
     * Adapts wait times automatically: plain notes settle quickly, while notes with async widgets or
     * live DOM mutations receive the full settle window.
     */
    private async waitForAsyncRenderers(container: HTMLElement): Promise<void> {
        await activeDocument.fonts.ready.catch(() => {});
        const hasAsyncWidgets = !!container.querySelector(PdfPlugin.ASYNC_WIDGET_SELECTOR);
        const initialFrames = hasAsyncWidgets ? 2 : 1;
        for (let f = 0; f < initialFrames; f++) {
            await this.yieldFrameSafe(24);
        }

        // Wait for async community plugin post-processors & MarkdownRenderChild mutations to settle.
        // Plain notes start with a short 60ms probe; if any DOM mutation occurs, automatically widen
        // to the full 220ms quiet window so late plugins never get cut off.
        const initialQuietMs = hasAsyncWidgets ? 220 : 60;
        const activeQuietMs = 220;
        const maxWaitMs = hasAsyncWidgets ? 3500 : 1800;

        await new Promise<void>(resolve => {
            let settled = false;
            let quietTimer: number | null = null;
            let maxTimer: number | null = null;
            const observer = typeof MutationObserver !== 'undefined'
                ? new MutationObserver(() => {
                    if (quietTimer !== null) window.clearTimeout(quietTimer);
                    quietTimer = window.setTimeout(finish, activeQuietMs);
                })
                : null;
            const finish = () => {
                if (settled) return;
                settled = true;
                if (quietTimer !== null) window.clearTimeout(quietTimer);
                if (maxTimer !== null) window.clearTimeout(maxTimer);
                observer?.disconnect();
                resolve();
            };
            observer?.observe(container, { childList: true, subtree: true, attributes: true, characterData: true });
            quietTimer = window.setTimeout(finish, initialQuietMs);
            maxTimer = window.setTimeout(finish, maxWaitMs);
        });

        // Wait for Mermaid / internal embeds only if present and still rendering (up to 1200ms max)
        if (hasAsyncWidgets || container.querySelector('.mermaid, .internal-embed')) {
            const start = Date.now();
            while (Date.now() - start < 1200) {
                const pendingMermaid = container.querySelector('.mermaid:not([data-processed="true"]):not(:has(svg))');
                const pendingEmbed = container.querySelector('.internal-embed.markdown-embed:empty, .internal-embed.image-embed:empty');
                if (!pendingMermaid && !pendingEmbed) break;
                await new Promise<void>(r => window.setTimeout(r, 60));
            }
        }

        // Wait for all <img> elements to finish loading
        const imgs = Array.from(container.querySelectorAll('img'));
        if (imgs.length > 0) {
            await Promise.all(imgs.map(img => {
                if (img.complete) return Promise.resolve();
                return new Promise<void>(resolve => {
                    const timer = window.setTimeout(resolve, 2500);
                    img.addEventListener('load', () => { window.clearTimeout(timer); resolve(); }, { once: true });
                    img.addEventListener('error', () => { window.clearTimeout(timer); resolve(); }, { once: true });
                });
            }));
        }
    }


    private resolveVaultImageFile(linkRaw: string, sourcePath: string): TFile | null {
        if (!linkRaw) return null;
        const cleaned = linkRaw.split('#')[0].split('|')[0].trim();
        if (!cleaned) return null;

        let found = this.app.metadataCache.getFirstLinkpathDest(cleaned, sourcePath);
        if (found instanceof TFile) return found;

        const candidates = [cleaned];
        try {
            const decoded = decodeURIComponent(cleaned);
            if (decoded !== cleaned) {
                candidates.push(decoded);
                found = this.app.metadataCache.getFirstLinkpathDest(decoded, sourcePath);
                if (found instanceof TFile) return found;
            }
        } catch {
            // ignore malformed URI sequence
        }

        // Fallback: scan vault files by exact path or basename
        const allFiles = this.app.vault.getFiles();
        for (const cand of candidates) {
            const normalized = cand.replace(/^\/+/, '').toLowerCase();
            const base = normalized.split('/').pop() || normalized;
            const byPath = allFiles.find(f => f.path.toLowerCase() === normalized);
            if (byPath) return byPath;
            const byName = allFiles.find(f => f.name.toLowerCase() === base);
            if (byName) return byName;
        }
        return null;
    }

    private resolveVaultFileFromImgSrc(src: string): TFile | null {
        if (!src || src.startsWith('data:') || src.startsWith('blob:') || src.startsWith('http://') || src.startsWith('https://')) {
            // Also allow capacitor/localhost vault URLs on mobile
            if (!src.includes('_capacitor_file_') && !src.includes('localhost')) return null;
        }
        const noQuery = src.split('#')[0].split('?')[0];
        let decoded = noQuery;
        try {
            decoded = decodeURIComponent(noQuery);
        } catch {
            // ignore
        }
        const lower = decoded.replace(/\\/g, '/').toLowerCase();
        const allFiles = this.app.vault.getFiles();
        let bestMatch: TFile | null = null;
        for (const f of allFiles) {
            const p = f.path.toLowerCase();
            if (lower === p || lower.endsWith('/' + p)) {
                if (!bestMatch || p.length > bestMatch.path.length) {
                    bestMatch = f;
                }
            }
        }
        return bestMatch;
    }

    /**
     * Reads binary data from either remote HTTP(S) URLs (via Obsidian's CORS-free `requestUrl`)
     * or local app/capacitor/blob URLs (via `XMLHttpRequest` arraybuffer) without calling global `fetch`.
     */
    private async readUrlAsArrayBuffer(url: string): Promise<{ buffer: ArrayBuffer; contentType: string } | null> {
        if (!url) return null;

        const isHttp = url.startsWith('http://') || url.startsWith('https://');
        let isLocalWebViewOrigin = !isHttp;
        if (isHttp) {
            try {
                const parsed = new URL(url, window.location.href);
                const host = parsed.hostname.toLowerCase();
                // On Obsidian Mobile (Android Capacitor), window.location.origin is http://localhost
                // (or https://localhost). Bundled assets such as MathJax CHTML .woff/.woff2 fonts
                // and /_capacitor_file_/ vault files are served by the WebView's local asset
                // interceptor and MUST be read via XHR rather than requestUrl (which hits the OS
                // network stack and fails with connection refused on localhost).
                isLocalWebViewOrigin =
                    parsed.origin === window.location.origin ||
                    host === 'localhost' ||
                    host === '127.0.0.1' ||
                    host === '[::1]';
            } catch {
                isLocalWebViewOrigin = false;
            }
        }

        const readViaXhr = (): Promise<{ buffer: ArrayBuffer; contentType: string } | null> =>
            new Promise<{ buffer: ArrayBuffer; contentType: string } | null>((resolve) => {
                try {
                    const xhr = new XMLHttpRequest();
                    xhr.open('GET', url, true);
                    xhr.responseType = 'arraybuffer';
                    xhr.onload = () => {
                        if ((xhr.status === 0 || (xhr.status >= 200 && xhr.status < 300)) && xhr.response instanceof ArrayBuffer) {
                            resolve({
                                buffer: xhr.response,
                                contentType: xhr.getResponseHeader('content-type') || ''
                            });
                        } else {
                            resolve(null);
                        }
                    };
                    xhr.onerror = () => resolve(null);
                    xhr.onabort = () => resolve(null);
                    xhr.send();
                } catch {
                    resolve(null);
                }
            });

        if (isLocalWebViewOrigin) {
            const localRes = await readViaXhr();
            if (localRes && localRes.buffer.byteLength > 0) {
                return localRes;
            }
            if (!isHttp) return null;
        }

        try {
            const resp = await requestUrl({ url });
            const ct = resp.headers['content-type'] || resp.headers['Content-Type'] || '';
            return { buffer: resp.arrayBuffer, contentType: ct };
        } catch {
            return null;
        }
    }

    private async loadSourceToCanvas(
        source: { kind: 'dataUrl'; url: string; isSvg?: boolean; svgText?: string }
            | { kind: 'domImg'; img: HTMLImageElement }
            | { kind: 'url'; url: string },
        maxBackingWidthPx: number
    ): Promise<{ canvas: HTMLCanvasElement; natW: number; natH: number } | null> {
        let imgEl: HTMLImageElement | null;

        if (source.kind === 'domImg') {
            const domImg = source.img;
            imgEl = domImg;
            if (!domImg.complete) {
                await new Promise<void>(resolve => {
                    const timer = window.setTimeout(resolve, 3000);
                    domImg.addEventListener('load', () => { window.clearTimeout(timer); resolve(); }, { once: true });
                    domImg.addEventListener('error', () => { window.clearTimeout(timer); resolve(); }, { once: true });
                });
            }
        } else {
            imgEl = await new Promise<HTMLImageElement | null>((resolve) => {
                const tempImg = new Image();
                if (source.kind === 'url' && !source.url.startsWith('data:') && !source.url.startsWith('blob:')) {
                    tempImg.crossOrigin = 'anonymous';
                }
                const timer = window.setTimeout(() => resolve(null), 5000);
                tempImg.onload = () => { window.clearTimeout(timer); resolve(tempImg); };
                tempImg.onerror = () => { window.clearTimeout(timer); resolve(null); };
                tempImg.src = source.url;
            });
        }

        if (!imgEl) return null;
        await imgEl.decode().catch(() => {});

        let natW = imgEl.naturalWidth || imgEl.width || 0;
        let natH = imgEl.naturalHeight || imgEl.height || 0;

        if ((natW <= 0 || natH <= 0) && source.kind === 'dataUrl' && source.isSvg && source.svgText) {
            const vbMatch = source.svgText.match(/viewBox\s*=\s*["'][\s,]*[\d.-]+[\s,]+[\d.-]+[\s,]+([\d.]+)[\s,]+([\d.]+)/i);
            if (vbMatch) {
                natW = Math.max(1, Math.round(parseFloat(vbMatch[1])));
                natH = Math.max(1, Math.round(parseFloat(vbMatch[2])));
            }
        }

        if (natW <= 0 || natH <= 0) return null;

        const imgSrcLower = (imgEl.currentSrc || imgEl.src || '').toLowerCase();
        const isSvg = (source.kind === 'dataUrl' && !!source.isSvg) ||
            imgSrcLower.startsWith('data:image/svg+xml') ||
            /\.svg(?:[?#]|$)/.test(imgSrcLower);
        const targetW = isSvg
            ? Math.min(2400, Math.max(64, maxBackingWidthPx))
            : Math.max(1, Math.min(natW, maxBackingWidthPx));
        const targetH = Math.max(1, Math.round((targetW * natH) / natW));

        const canvas = createEl('canvas');
        canvas.width = targetW;
        canvas.height = targetH;
        const ctx = canvas.getContext('2d');
        if (!ctx) return null;

        try {
            ctx.drawImage(imgEl, 0, 0, targetW, targetH);
            ctx.getImageData(0, 0, 1, 1); // ensure untainted
        } catch {
            canvas.width = 0;
            canvas.height = 0;
            return null;
        }

        return { canvas, natW, natH };
    }

    private createImageSlotElement(
        id: string,
        natW: number,
        natH: number,
        customWidth: number | null,
        customHeight: number | null,
        maxSlotWidthPx: number,
        isSmallInlineIcon: boolean = false
    ): HTMLElement {
        const slot = createDiv({ cls: 'pdf-image-slot' });
        slot.setAttribute('data-pdf-img-id', id);
        slot.setAttribute('data-pdf-nat-w', String(natW));
        slot.setAttribute('data-pdf-nat-h', String(natH));
        if (customWidth && customWidth > 0) slot.setAttribute('data-pdf-custom-w', String(customWidth));
        if (customHeight && customHeight > 0) slot.setAttribute('data-pdf-custom-h', String(customHeight));

        if (isSmallInlineIcon && customWidth && customHeight) {
            slot.setAttribute('data-pdf-inline-icon', '1');
            slot.addClass('pdf-image-slot-inline');
            slot.style.width = `${customWidth}px`;
            slot.style.height = `${customHeight}px`;
        } else {
            const baseW = customWidth && customWidth > 0 ? customWidth : natW;
            const finalW = Math.max(1, Math.min(baseW, maxSlotWidthPx));
            const finalH = customHeight && customHeight > 0
                ? Math.max(1, Math.round((finalW * customHeight) / baseW))
                : Math.max(1, Math.round((finalW * natH) / natW));
            slot.addClass('pdf-image-slot-block');
            slot.style.width = `${finalW}px`;
            slot.style.height = `${finalH}px`;
        }

        return slot;
    }

    /**
     * Expands (or adjusts) non-inline `.pdf-image-slot` elements inside a block when it moves
     * onto a wider Landscape page so panoramic/wide diagrams utilize the full Landscape width.
     */
    private resizeImageSlotsForWidth(rootEl: HTMLElement, maxSlotWidthPx: number): void {
        const slots: HTMLElement[] = [];
        if (rootEl.classList.contains('pdf-image-slot')) {
            slots.push(rootEl);
        }
        slots.push(...Array.from(rootEl.querySelectorAll<HTMLElement>('.pdf-image-slot')));
        for (const slot of slots) {
            if (
                slot.getAttribute('data-pdf-inline-icon') === '1' ||
                slot.getAttribute('data-pdf-height-fitted') === '1' ||
                slot.getAttribute('data-pdf-css-sized') === '1'
            ) continue;
            const natW = parseFloat(slot.getAttribute('data-pdf-nat-w') || '0');
            const natH = parseFloat(slot.getAttribute('data-pdf-nat-h') || '0');
            if (!(natW > 0 && natH > 0)) continue;
            const customW = parseFloat(slot.getAttribute('data-pdf-custom-w') || '0');
            const customH = parseFloat(slot.getAttribute('data-pdf-custom-h') || '0');
            const baseW = customW > 0 ? customW : natW;
            const finalW = Math.max(1, Math.min(baseW, maxSlotWidthPx));
            const finalH = customH > 0
                ? Math.max(1, Math.round((finalW * customH) / baseW))
                : Math.max(1, Math.round((finalW * natH) / natW));
            slot.style.width = `${finalW}px`;
            slot.style.height = `${finalH}px`;
        }
    }

    /**
     * Proportionally scales down a single tall visual block (image slot, Mermaid/diagram SVG, canvas, or img)
     * so it fits cleanly on one PDF page instead of being sliced in half across pages.
     * Respects `minScaleRatio` (default 0.45) so ultra-tall infographics (>2.2x page height) stay readable
     * by falling back to multi-page slicing rather than shrinking to microscopic text.
     */
    private findSingleScalableMediaVisual(blockEl: HTMLElement): { visualEl: HTMLElement | SVGSVGElement; kind: 'slot' | 'svg' | 'media' } | null {
        const { target } = this.unwrapSplittableContainer(blockEl);
        if (
            target.tagName === 'TABLE' ||
            target.tagName === 'UL' ||
            target.tagName === 'OL' ||
            target.tagName === 'PRE' ||
            target.classList.contains('callout')
        ) {
            return null;
        }

        const slots = Array.from(
            blockEl.querySelectorAll<HTMLElement>('.pdf-image-slot:not([data-pdf-inline-icon="1"]):not([data-pdf-css-sized="1"])')
        );
        if (
            blockEl.classList.contains('pdf-image-slot') &&
            blockEl.getAttribute('data-pdf-inline-icon') !== '1' &&
            blockEl.getAttribute('data-pdf-css-sized') !== '1'
        ) {
            slots.unshift(blockEl);
        }
        if (slots.length === 1) {
            return { visualEl: slots[0], kind: 'slot' };
        }
        if (slots.length === 0) {
            const svgs = Array.from(blockEl.querySelectorAll<SVGSVGElement>('svg')).filter(svg => {
                if (svg.closest('mjx-container, .math, .callout-icon, .task-list-item-checkbox, .pdf-vector-checkbox, button, .clickable-icon')) {
                    return false;
                }
                const svgCs = window.getComputedStyle(svg);
                return svgCs.display !== 'none' && svgCs.visibility !== 'hidden';
            });
            if (svgs.length === 1) {
                return { visualEl: svgs[0], kind: 'svg' };
            }
            if (svgs.length === 0) {
                const media = Array.from(blockEl.querySelectorAll<HTMLElement>('canvas, img')).filter(
                    m => !m.classList.contains('emoji')
                );
                if (media.length === 1) {
                    return { visualEl: media[0], kind: 'media' };
                }
            }
        }
        return null;
    }

    /**
     * Returns true when an unbreakable block can fit intact on a single fresh page,
     * either natively or by proportionally scaling a single image/SVG diagram down to `minScaleRatio`.
     * Returns false for ultra-tall blocks (e.g. multi-page vertical Mermaid flowcharts) that will
     * inevitably require multi-page slicing even alone on a blank page.
     */
    private canBlockFitOnSinglePage(
        blockEl: HTMLElement,
        maxPageContentPx: number,
        minScaleRatio: number = 0.45
    ): boolean {
        if (!blockEl || maxPageContentPx <= 0) return true;
        const blockRect = blockEl.getBoundingClientRect();
        if (blockRect.height <= 0 || blockRect.height <= maxPageContentPx) return true;

        const found = this.findSingleScalableMediaVisual(blockEl);
        if (!found) return false;

        const visRect = found.visualEl.getBoundingClientRect();
        if (visRect.width <= 0 || visRect.height <= 0) return false;

        const chromeH = Math.max(0, blockRect.height - visRect.height);
        const minPossibleHeight = visRect.height * minScaleRatio + chromeH + 6;
        return minPossibleHeight <= maxPageContentPx;
    }

    private fitTallMediaBlockToPageHeight(
        blockEl: HTMLElement,
        sizerEl: HTMLElement,
        maxPageContentPx: number,
        minScaleRatio: number = 0.45
    ): boolean {
        if (!blockEl || !sizerEl || maxPageContentPx <= 0) return false;
        const sizerH = sizerEl.scrollHeight;
        if (sizerH <= maxPageContentPx) return true;

        const found = this.findSingleScalableMediaVisual(blockEl);
        if (!found) return false;
        const { visualEl, kind } = found;

        const visRect = visualEl.getBoundingClientRect();
        if (visRect.width <= 0 || visRect.height <= 0) return false;

        const overflowPx = sizerH - maxPageContentPx;
        const targetVisH = Math.floor(visRect.height - overflowPx - 6);
        if (targetVisH <= 0) return false;

        const ratio = targetVisH / visRect.height;
        if (ratio < minScaleRatio || ratio >= 1) return false;

        const applySize = (scaleRatio: number) => {
            const newW = Math.max(40, Math.floor(visRect.width * scaleRatio));
            const newH = Math.max(40, Math.floor(visRect.height * scaleRatio));
            if (kind === 'slot') {
                const slotEl = visualEl as HTMLElement;
                slotEl.style.width = `${newW}px`;
                slotEl.style.height = `${newH}px`;
                slotEl.setAttribute('data-pdf-height-fitted', '1');
            } else if (kind === 'svg') {
                const svgEl = visualEl as SVGSVGElement;
                if (!svgEl.getAttribute('viewBox')) {
                    svgEl.setAttribute('viewBox', `0 0 ${visRect.width} ${visRect.height}`);
                }
                svgEl.classList.add('pdf-tall-fitted-svg');
                svgEl.style.setProperty('width', `${newW}px`, 'important');
                svgEl.style.setProperty('height', `${newH}px`, 'important');
            } else {
                const mediaEl = visualEl as HTMLElement;
                mediaEl.addClass('pdf-tall-fitted-media');
                mediaEl.style.width = `${newW}px`;
                mediaEl.style.height = `${newH}px`;
            }
        };

        applySize(ratio);
        if (sizerEl.scrollHeight > maxPageContentPx) {
            const extraOver = sizerEl.scrollHeight - maxPageContentPx;
            const retryRatio = Math.floor(visRect.height * ratio - extraOver - 4) / visRect.height;
            if (retryRatio >= minScaleRatio && retryRatio < ratio) {
                applySize(retryRatio);
            }
        }
        return sizerEl.scrollHeight <= maxPageContentPx;
    }

    /**
     * Returns true when a block is a standalone heading (H1-H6) so auto-landscape pagination
     * can keep a section heading attached to the wide table/diagram immediately below it.
     */
    private isHeadingBlock(el: HTMLElement): boolean {
        if (/^H[1-6]$/.test(el.tagName)) return true;
        if (el.children.length === 1 && /^H[1-6]$/.test(el.children[0].tagName)) return true;
        return false;
    }

    /**
     * Measures the true horizontal content extent of a rendered block (tables, diagrams, math,
     * canvases, images, or non-standard widgets) inside its current layout container so wide
     * Landscape pages can detect remaining horizontal overflow and auto-scale down cleanly.
     */
    private measureBlockOverflowWidthPx(el: HTMLElement): number {
        if (!el) return 0;
        const elRect = el.getBoundingClientRect();
        let maxW = 0;

        const considerRect = (r: DOMRect) => {
            if (r.width <= 0 || r.height <= 0) return;
            const span = Math.max(r.width, r.right - elRect.left);
            if (span > maxW) maxW = span;
        };

        const tables: HTMLTableElement[] = [];
        if (el.tagName === 'TABLE') tables.push(el as HTMLTableElement);
        else tables.push(...Array.from(el.querySelectorAll<HTMLTableElement>('table')));
        for (const table of tables) {
            const r = table.getBoundingClientRect();
            considerRect(r);
            const sw = table.scrollWidth;
            if (sw > maxW) maxW = sw;
            if (table.parentElement && table.parentElement !== el) {
                const pSw = table.parentElement.scrollWidth;
                if (pSw > maxW) maxW = pSw;
            }
        }

        const svgs = Array.from(el.querySelectorAll<SVGSVGElement>('svg'));
        for (const svg of svgs) {
            if (svg.closest('.callout-icon, .task-list-item-checkbox, .pdf-vector-checkbox')) continue;
            const cs = window.getComputedStyle(svg);
            if (cs.display === 'none' || cs.visibility === 'hidden') continue;
            considerRect(svg.getBoundingClientRect());
        }

        const canvases = Array.from(el.querySelectorAll<HTMLCanvasElement>('canvas'));
        for (const canvas of canvases) {
            considerRect(canvas.getBoundingClientRect());
        }

        const mathBlocks: HTMLElement[] = [];
        if (el.matches('mjx-container[display="true"], .math-block')) mathBlocks.push(el);
        mathBlocks.push(...Array.from(el.querySelectorAll<HTMLElement>('mjx-container[display="true"], .math-block')));
        for (const mathEl of mathBlocks) {
            considerRect(mathEl.getBoundingClientRect());
            if (mathEl.scrollWidth > maxW) maxW = mathEl.scrollWidth;
            const mathInner = mathEl.querySelector<HTMLElement>('mjx-math, svg');
            if (mathInner) {
                considerRect(mathInner.getBoundingClientRect());
                if (mathInner.scrollWidth > maxW) maxW = mathInner.scrollWidth;
            }
        }

        const imgSlots = Array.from(el.querySelectorAll<HTMLElement>('.pdf-image-slot, img'));
        for (const slot of imgSlots) {
            considerRect(slot.getBoundingClientRect());
        }

        // For non-standard custom widgets (e.g. Kanban/Dataview), also check real visible children
        const standardMarkdownClasses = [
            'el-p', 'el-ul', 'el-ol', 'el-pre', 'el-blockquote',
            'el-h1', 'el-h2', 'el-h3', 'el-h4', 'el-h5', 'el-h6',
            'el-hr', 'callout', 'footnotes'
        ];
        const isStandardWrapper = standardMarkdownClasses.some(cls => el.classList.contains(cls));
        const nonOverflowTags = new Set(['P', 'UL', 'OL', 'PRE', 'BLOCKQUOTE']);
        if (!isStandardWrapper && !nonOverflowTags.has(el.tagName)) {
            if (el.scrollWidth > maxW) maxW = el.scrollWidth;
        }

        return maxW;
    }

    /**
     * Detects whether a rendered block genuinely overflows Portrait orientation (or is a severely
     * cramped wide table / wide diagram) and should automatically be placed on a Landscape page.
     * Deliberately conservative so normal text, indented lines, lists, and images that fit cleanly
     * inside Portrait never trigger false Landscape page breaks.
     */
    private isWideBlockForPortrait(el: HTMLElement, portraitContentWidthPx: number): boolean {
        if (!el || portraitContentWidthPx <= 0) return false;
        const tag = el.tagName;
        if (/^H[1-6]$/.test(tag) || tag === 'HR') return false;
        if (el.classList.contains('mod-header') || el.classList.contains('inline-title')) return false;
        if (this.isHeadingBlock(el)) return false;

        const isListContainer =
            tag === 'UL' ||
            tag === 'OL' ||
            el.classList.contains('el-ul') ||
            el.classList.contains('el-ol');

        // 1. Wide or severely cramped multi-column tables
        const tables: HTMLTableElement[] = [];
        if (tag === 'TABLE') {
            tables.push(el as HTMLTableElement);
        } else {
            tables.push(...Array.from(el.querySelectorAll<HTMLTableElement>('table')));
        }
        for (const table of tables) {
            const rect = table.getBoundingClientRect();
            if (rect.width < 10 || rect.height < 10) continue;
            if (table.scrollWidth > portraitContentWidthPx * 1.03 || rect.width > portraitContentWidthPx * 1.03) {
                return true;
            }
            const rows = Array.from(table.querySelectorAll('tr'));
            let colCount = 0;
            for (const row of rows) {
                const cells = row.querySelectorAll(':scope > th, :scope > td').length;
                if (cells > colCount) colCount = cells;
            }
            if (colCount >= 6 && rect.width >= portraitContentWidthPx * 0.90 && rect.width / colCount < 115) {
                let naturalW: number;
                try {
                    table.addClass('pdf-table-measure');
                    naturalW = Math.max(table.scrollWidth, table.getBoundingClientRect().width);
                } finally {
                    table.removeClass('pdf-table-measure');
                }
                if (naturalW > portraitContentWidthPx * 1.20) {
                    return true;
                }
            }
        }

        // 2. Wide diagrams / SVGs (Mermaid, Excalidraw, Flowcharts, Sequence, Gantt, ER, standalone SVGs)
        const svgs = Array.from(el.querySelectorAll<SVGSVGElement>('svg'));
        for (const svg of svgs) {
            if (svg.closest('mjx-container, .math, .callout-icon, .task-list-item-checkbox, .pdf-vector-checkbox')) continue;
            const cs = window.getComputedStyle(svg);
            if (cs.display === 'none' || cs.visibility === 'hidden') continue;
            const rect = svg.getBoundingClientRect();
            if (rect.width > portraitContentWidthPx * 1.03) {
                return true;
            }
            // Only treat a shrunk SVG as wide if it is actually filling nearly the full Portrait width
            // (so small icons or comfortably fitting diagrams never trigger Landscape)
            if (rect.width >= portraitContentWidthPx * 0.92) {
                let intrinsicW = 0;
                let intrinsicH = 0;
                const vbAttr = svg.getAttribute('viewBox');
                if (vbAttr) {
                    const parts = vbAttr.trim().split(/[\s,]+/).map(Number);
                    if (parts.length === 4 && parts[2] > 0 && parts[3] > 0) {
                        intrinsicW = parts[2];
                        intrinsicH = parts[3];
                    }
                }
                if (!(intrinsicW > 0 && intrinsicH > 0)) {
                    const wAttr = svg.getAttribute('width') || '';
                    const hAttr = svg.getAttribute('height') || '';
                    if (!wAttr.includes('%') && !hAttr.includes('%')) {
                        const pw = parseFloat(wAttr);
                        const ph = parseFloat(hAttr);
                        if (pw > 0 && ph > 0) {
                            intrinsicW = pw;
                            intrinsicH = ph;
                        }
                    }
                }
                if (intrinsicW >= 160 && intrinsicH > 0 && intrinsicW > portraitContentWidthPx * 1.25 && intrinsicW / intrinsicH >= 1.55) {
                    return true;
                }
            }
        }

        // 3. Wide Canvas elements (charts, diagrams, whiteboards)
        const canvases = Array.from(el.querySelectorAll<HTMLCanvasElement>('canvas'));
        const dpr = Math.max(1, window.devicePixelRatio || 1);
        for (const canvas of canvases) {
            const rect = canvas.getBoundingClientRect();
            if (rect.width > portraitContentWidthPx * 1.03) return true;
            const logicalW = canvas.width / dpr;
            if (rect.width >= portraitContentWidthPx * 0.92 && logicalW > portraitContentWidthPx * 1.25 && canvas.height > 0 && canvas.width / canvas.height >= 1.6) {
                return true;
            }
        }

        // 4. Wide images — NEVER trigger on normal embedded images that already fit cleanly in Portrait,
        // and NEVER let an embedded image inside a multi-item list turn an entire list into Landscape.
        if (!isListContainer) {
            const imgSlots = Array.from(el.querySelectorAll<HTMLElement>('.pdf-image-slot'));
            for (const slot of imgSlots) {
                if (slot.getAttribute('data-pdf-inline-icon') === '1') continue;
                const rect = slot.getBoundingClientRect();
                const natW = parseFloat(slot.getAttribute('data-pdf-nat-w') || '0');
                const natH = parseFloat(slot.getAttribute('data-pdf-nat-h') || '0');
                const customW = parseFloat(slot.getAttribute('data-pdf-custom-w') || '0');
                if (customW > portraitContentWidthPx * 1.05) return true;
                if (rect.width > portraitContentWidthPx * 1.03) return true;
                // Only ultra-panoramic unresized images that hit the full Portrait edge
                if (!(customW > 0) && rect.width >= portraitContentWidthPx * 0.94 && natW > portraitContentWidthPx * 1.5 && natH > 0 && natW / natH >= 2.8) {
                    return true;
                }
            }
            const rawImgs = Array.from(el.querySelectorAll<HTMLImageElement>('img'));
            for (const img of rawImgs) {
                const rect = img.getBoundingClientRect();
                if (rect.width > portraitContentWidthPx * 1.03) return true;
                if (rect.width >= portraitContentWidthPx * 0.94 && img.naturalWidth > portraitContentWidthPx * 1.5 && img.naturalHeight > 0 && img.naturalWidth / img.naturalHeight >= 2.8) {
                    return true;
                }
            }
        }

        // 5. Wide Display Math equations (actual overflow only, including MathJax CHTML mjx-math)
        const mathBlocks: HTMLElement[] = [];
        if (el.matches('mjx-container[display="true"], .math-block')) mathBlocks.push(el);
        mathBlocks.push(...Array.from(el.querySelectorAll<HTMLElement>('mjx-container[display="true"], .math-block')));
        for (const mathEl of mathBlocks) {
            const rect = mathEl.getBoundingClientRect();
            if (mathEl.scrollWidth > portraitContentWidthPx * 1.02 || rect.width > portraitContentWidthPx * 1.02) {
                return true;
            }
            const mathInner = mathEl.querySelector<HTMLElement>('mjx-math');
            if (mathInner) {
                const innerRect = mathInner.getBoundingClientRect();
                if (innerRect.width > portraitContentWidthPx * 1.02 || mathInner.scrollWidth > portraitContentWidthPx * 1.02) {
                    return true;
                }
            }
            const mathSvg = mathEl.querySelector('svg');
            if (mathSvg && mathSvg.getBoundingClientRect().width > portraitContentWidthPx * 1.02) {
                return true;
            }
        }

        // 6. Other horizontally overflowing custom blocks (Dataview, Kanban, embedded widgets, etc.)
        // Never trigger on standard Obsidian Markdown text/list/code/quote/callout wrappers (including indented blocks).
        const standardMarkdownClasses = [
            'el-p', 'el-ul', 'el-ol', 'el-pre', 'el-blockquote',
            'el-h1', 'el-h2', 'el-h3', 'el-h4', 'el-h5', 'el-h6',
            'el-hr', 'callout', 'footnotes'
        ];
        const isStandardWrapper = standardMarkdownClasses.some(cls => el.classList.contains(cls));
        const nonOverflowTags = new Set(['P', 'UL', 'OL', 'PRE', 'BLOCKQUOTE']);
        if (!isStandardWrapper && !nonOverflowTags.has(tag)) {
            const { target } = this.unwrapSplittableContainer(el);
            const isStandardTarget = nonOverflowTags.has(target.tagName) || target.classList.contains('callout');
            if (!isStandardTarget && el.scrollWidth > portraitContentWidthPx * 1.08) {
                const elRect = el.getBoundingClientRect();
                const children = Array.from(el.children) as HTMLElement[];
                const hasRealWideChild = children.some(ch => {
                    const cs = window.getComputedStyle(ch);
                    if (cs.display === 'none' || cs.visibility === 'hidden') return false;
                    return ch.scrollWidth > portraitContentWidthPx * 1.08 || ch.getBoundingClientRect().right - elRect.left > portraitContentWidthPx * 1.08;
                });
                if (hasRealWideChild) return true;
            }
        }

        return false;
    }

    /**
     * Ensures the active jsPDF page has the exact target orientation (handling mixed Portrait/Landscape
     * pages cleanly, including when Page 1 itself is Landscape).
     */
    private ensurePdfPageOrientation(doc: jsPDF, emittedSoFar: number, pageLayout: PdfPageLayout): void {
        if (emittedSoFar === 0) {
            const curW = doc.internal.pageSize.getWidth();
            const curH = doc.internal.pageSize.getHeight();
            const curIsLandscape = curW > curH;
            const wantIsLandscape = pageLayout.orientation === 'l';
            if (curIsLandscape !== wantIsLandscape) {
                doc.addPage(pageLayout.format, pageLayout.orientation);
                doc.deletePage(1);
                doc.setPage(1);
            }
        } else {
            doc.addPage(pageLayout.format, pageLayout.orientation);
        }
    }

    /**
     * Decodes all vault/external images into offscreen untainted <canvas> buffers and replaces
     * them in the DOM with exact-sized `.pdf-image-slot` placeholders that get composited directly
     * onto each captured page canvas after html2canvas finishes (100% immune to html2canvas img/CORS bugs).
     */
    private async prepareImagesAndCaptions(
        container: HTMLElement,
        sourcePath: string,
        maxContentWidthPx: number,
        imageCanvasesById: Map<string, HTMLCanvasElement>,
        imageConcurrency: number = 4,
        maxLandscapeWidthPx?: number
    ): Promise<void> {
        const mimeMap: Record<string, string> = {
            png: 'image/png',
            jpg: 'image/jpeg',
            jpeg: 'image/jpeg',
            webp: 'image/webp',
            gif: 'image/gif',
            svg: 'image/svg+xml',
            bmp: 'image/bmp',
            avif: 'image/avif',
            ico: 'image/x-icon',
            tif: 'image/tiff',
            tiff: 'image/tiff'
        };

        const optimizeCanvasWithWebP = async (
            loaded: { canvas: HTMLCanvasElement; natW: number; natH: number },
            origByteLength: number,
            mime: string
        ): Promise<{ canvas: HTMLCanvasElement; natW: number; natH: number }> => {
            if (!this.settings.optimizeImages) return loaded;
            // Skip images that are already WebP or vector SVGs
            if (mime === 'image/webp' || mime === 'image/svg+xml') return loaded;
            if (typeof loaded.canvas.toBlob !== 'function') return loaded;
            try {
                const webpBlob = await new Promise<Blob | null>((resolve) => {
                    try {
                        loaded.canvas.toBlob((b) => resolve(b), 'image/webp', 0.99);
                    } catch {
                        resolve(null);
                    }
                });
                if (!webpBlob || webpBlob.type !== 'image/webp' || webpBlob.size <= 0) {
                    return loaded;
                }
                // Only keep WebP conversion if it is actually smaller than the original image
                if (origByteLength > 0 && webpBlob.size >= origByteLength) {
                    return loaded;
                }
                if (typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function') {
                    const blobUrl = URL.createObjectURL(webpBlob);
                    try {
                        const decoded = await this.loadSourceToCanvas(
                            { kind: 'dataUrl', url: blobUrl, isSvg: false },
                            loaded.canvas.width
                        );
                        if (decoded) {
                            loaded.canvas.width = 0;
                            loaded.canvas.height = 0;
                            return { canvas: decoded.canvas, natW: loaded.natW, natH: loaded.natH };
                        }
                    } finally {
                        try { URL.revokeObjectURL(blobUrl); } catch { /* ignore */ }
                    }
                }
            } catch {
                // Keep original rasterized canvas if WebP encoding/decoding is unavailable
            }
            return loaded;
        };

        const rasterizeBinary = async (binary: ArrayBuffer, mime: string, targetWidthHint: number) => {
            const isSvg = mime === 'image/svg+xml';
            const backingW = Math.round(targetWidthHint * 2);

            // Use zero-copy Blob URL for raster images (much faster & lower RAM than base64 strings)
            if (!isSvg && typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function') {
                const blobUrl = URL.createObjectURL(new Blob([binary], { type: mime }));
                try {
                    const result = await this.loadSourceToCanvas({ kind: 'dataUrl', url: blobUrl, isSvg: false }, backingW);
                    if (result) return await optimizeCanvasWithWebP(result, binary.byteLength, mime);
                } finally {
                    try { URL.revokeObjectURL(blobUrl); } catch { /* ignore */ }
                }
            }

            const dataUrl = `data:${mime};base64,${this.arrayBufferToBase64(binary)}`;
            let svgText: string | undefined;
            if (isSvg) {
                try {
                    svgText = new TextDecoder().decode(binary);
                } catch {
                    // ignore
                }
            }
            const loaded = await this.loadSourceToCanvas(
                { kind: 'dataUrl', url: dataUrl, isSvg, svgText },
                backingW
            );
            return loaded ? await optimizeCanvasWithWebP(loaded, binary.byteLength, mime) : null;
        };

        const allEmbeds = Array.from(container.querySelectorAll<HTMLElement>('.internal-embed'));
        const embeds = allEmbeds.filter(el => {
            if (el.classList.contains('markdown-embed')) return false;
            if (el.classList.contains('image-embed') || el.classList.contains('media-embed')) return true;
            const s = (el.getAttribute('src') || '').split('#')[0].split('?')[0].toLowerCase();
            return /\.(png|jpe?g|webp|gif|svg|bmp|avif|ico|tiff?)$/.test(s);
        });

        // Pre-resolve and prefetch vault image binaries in bounded parallel batches based on device power
        const prefetchedBinaries = new Map<string, ArrayBuffer>();
        const embedFilesToPrefetch: TFile[] = [];
        const seenPrefetchPaths = new Set<string>();
        for (const embed of embeds) {
            const srcAttr = embed.getAttribute('src') || '';
            const img = embed.querySelector<HTMLImageElement>('img');
            const imageFile = this.resolveVaultImageFile(srcAttr, sourcePath)
                || (img ? this.resolveVaultImageFile(img.getAttribute('alt') || '', sourcePath) : null);
            if (imageFile instanceof TFile && !seenPrefetchPaths.has(imageFile.path)) {
                seenPrefetchPaths.add(imageFile.path);
                embedFilesToPrefetch.push(imageFile);
            }
        }
        const batchSize = Math.max(1, imageConcurrency);
        for (let i = 0; i < embedFilesToPrefetch.length; i += batchSize) {
            const chunk = embedFilesToPrefetch.slice(i, i + batchSize);
            await Promise.all(chunk.map(async (f) => {
                try {
                    const bin = await this.app.vault.readBinary(f);
                    prefetchedBinaries.set(f.path, bin);
                } catch {
                    // fallback handled per embed
                }
            }));
        }

        const containerRect = container.getBoundingClientRect();
        for (const embed of embeds) {
            const srcAttr = embed.getAttribute('src') || '';
            const altAttr = embed.getAttribute('alt') || '';
            const img = embed.querySelector<HTMLImageElement>('img');

            const imageFile = this.resolveVaultImageFile(srcAttr, sourcePath)
                || (img ? this.resolveVaultImageFile(img.getAttribute('alt') || '', sourcePath) : null);

            let customWidth: number | null = null;
            let customHeight: number | null = null;

            const rawWidthAttr = embed.getAttribute('width') || img?.getAttribute('width');
            if (rawWidthAttr) {
                const parsedW = parseInt(rawWidthAttr, 10);
                if (!isNaN(parsedW) && parsedW > 0) customWidth = parsedW;
            }
            const rawHeightAttr = embed.getAttribute('height') || img?.getAttribute('height');
            if (rawHeightAttr) {
                const parsedH = parseInt(rawHeightAttr, 10);
                if (!isNaN(parsedH) && parsedH > 0) customHeight = parsedH;
            }

            if (altAttr) {
                const parts = altAttr.trim().split('|').map(p => p.trim()).filter(Boolean);
                for (const part of parts) {
                    const dimMatch = part.match(/^(\d+)(?:x(\d+))?$/);
                    if (dimMatch) {
                        customWidth = parseInt(dimMatch[1], 10);
                        if (dimMatch[2]) customHeight = parseInt(dimMatch[2], 10);
                    }
                }
            }

            // Compute exact available width inside embed's indented container (e.g. bullet list, callout, blockquote, figure)
            // without altering or replacing any user/plugin caption elements or CSS pseudo-elements.
            const existingFig = embed.querySelector<HTMLElement>('figure') || embed.closest<HTMLElement>('figure');
            const embedCs = window.getComputedStyle(embed);
            const figCs = existingFig ? window.getComputedStyle(existingFig) : null;
            const embedExtraW =
                (parseFloat(embedCs.paddingLeft) || 0) +
                (parseFloat(embedCs.paddingRight) || 0) +
                (parseFloat(embedCs.borderLeftWidth) || 0) +
                (parseFloat(embedCs.borderRightWidth) || 0) +
                (figCs ? (
                    (parseFloat(figCs.paddingLeft) || 0) +
                    (parseFloat(figCs.paddingRight) || 0) +
                    (parseFloat(figCs.borderLeftWidth) || 0) +
                    (parseFloat(figCs.borderRightWidth) || 0)
                ) : 0);
            const parentBlock = embed.closest<HTMLElement>('li, blockquote, .callout-content, td, th, p');
            const parentRect = parentBlock ? parentBlock.getBoundingClientRect() : containerRect;
            const parentCs = parentBlock ? window.getComputedStyle(parentBlock) : null;
            const parentLeftPad = parentCs ? (parseFloat(parentCs.paddingLeft) || 0) : 0;
            const parentRightPad = parentCs ? (parseFloat(parentCs.paddingRight) || 0) : 0;
            const blockRight = Math.min(containerRect.right, parentRect.right - parentRightPad);
            const anchorLeft = Math.max(containerRect.left, parentRect.left + parentLeftPad);
            const availWidthAtEmbed = Math.max(60, Math.floor(blockRight - anchorLeft - embedExtraW));

            const maxSlotW = availWidthAtEmbed;
            const maxBackingW = maxLandscapeWidthPx && maxLandscapeWidthPx > maxSlotW ? maxLandscapeWidthPx : maxSlotW;
            const backingWidthHint = customWidth && customWidth > 0 ? Math.min(customWidth, maxBackingW) : maxBackingW;
            let loaded: { canvas: HTMLCanvasElement; natW: number; natH: number } | null = null;

            if (imageFile instanceof TFile) {
                const mime = mimeMap[imageFile.extension.toLowerCase()] || 'image/png';
                try {
                    const binary = prefetchedBinaries.get(imageFile.path) || await this.app.vault.readBinary(imageFile);
                    loaded = await rasterizeBinary(binary, mime, backingWidthHint);
                } catch (e) {
                    console.warn("Could not read vault image:", imageFile.path, e);
                }
            }

            // Fallback 1: draw directly from the already-rendered Obsidian <img> if untainted
            if (!loaded && img && (img.currentSrc || img.src)) {
                loaded = await this.loadSourceToCanvas({ kind: 'domImg', img }, Math.round(backingWidthHint * 2));
            }

            // Fallback 2: read URL via requestUrl (HTTP/S) or local XHR (app/capacitor/blob) -> canvas
            if (!loaded && img && (img.currentSrc || img.src)) {
                const fallbackSrc = img.currentSrc || img.src;
                const fetched = await this.readUrlAsArrayBuffer(fallbackSrc);
                if (fetched && fetched.buffer.byteLength > 0) {
                    const ct = fetched.contentType || 'image/png';
                    loaded = await rasterizeBinary(fetched.buffer, ct.split(';')[0].trim(), backingWidthHint);
                }
                if (!loaded) {
                    loaded = await this.loadSourceToCanvas({ kind: 'url', url: fallbackSrc }, Math.round(backingWidthHint * 2));
                }
            }

            let renderedNode: HTMLElement | null = img;
            if (loaded) {
                const imgId = `pdf-img-${imageCanvasesById.size}`;
                imageCanvasesById.set(imgId, loaded.canvas);
                const slot = this.createImageSlotElement(imgId, loaded.natW, loaded.natH, customWidth, customHeight, maxSlotW);
                if (img) {
                    img.replaceWith(slot);
                } else if (embed.childNodes.length > 0) {
                    embed.prepend(slot);
                } else {
                    embed.appendChild(slot);
                }
                renderedNode = slot;
            } else if (renderedNode && customWidth && !isNaN(customWidth)) {
                renderedNode.addClass('pdf-img-clamped');
                renderedNode.style.width = `${Math.min(customWidth, maxSlotW)}px`;
                renderedNode.style.height = customHeight ? `${customHeight}px` : 'auto';
            }

            // Final post-layout proportional clamp so the image + embed padding never clips past the page right edge
            if (renderedNode) {
                const embedRightExtra =
                    (parseFloat(embedCs.paddingRight) || 0) +
                    (parseFloat(embedCs.borderRightWidth) || 0) +
                    (figCs ? ((parseFloat(figCs.paddingRight) || 0) + (parseFloat(figCs.borderRightWidth) || 0)) : 0);
                const maxAllowedRight = blockRight - embedRightExtra;
                const rRect = renderedNode.getBoundingClientRect();
                if (rRect.width > 0 && rRect.height > 0 && rRect.right > maxAllowedRight + 0.5) {
                    const clampedW = Math.max(40, Math.floor(maxAllowedRight - rRect.left));
                    const clampedH = Math.max(1, Math.round((clampedW * rRect.height) / rRect.width));
                    renderedNode.style.width = `${clampedW}px`;
                    renderedNode.style.height = `${clampedH}px`;
                }
            }
        }

        // Convert any remaining non-embed <img> tags (standard markdown images, HTML <img>, plugin layouts, inline icons)
        const remainingImgs = Array.from(container.querySelectorAll<HTMLImageElement>('img'));
        for (const img of remainingImgs) {
            const src = img.currentSrc || img.src || '';
            const altAttr = img.getAttribute('alt') || '';
            const cs = window.getComputedStyle(img);
            const rect = img.getBoundingClientRect();
            const isSmallIcon = img.classList.contains('emoji') || (rect.width > 0 && rect.width <= 28 && rect.height > 0 && rect.height <= 28);

            const pluginLayoutRoot = img.closest<HTMLElement>(
                '.block-language-image-layout, .image-layouts, .switchable-layout, .carousel'
            );
            const parentEl = img.parentElement;
            const parentDisplay = parentEl ? window.getComputedStyle(parentEl).display : '';
            const objectFit = (cs.objectFit || 'fill').toLowerCase();
            const hasExplicitObjectFit =
                objectFit === 'cover' ||
                objectFit === 'contain' ||
                objectFit === 'scale-down' ||
                objectFit === 'none';
            const isFlexOrGridChild =
                parentDisplay.includes('flex') || parentDisplay.includes('grid');
            const isCssSized =
                !isSmallIcon && (
                    !!pluginLayoutRoot ||
                    (rect.width > 1 && rect.height > 1 && (hasExplicitObjectFit || isFlexOrGridChild))
                );

            const attrW = parseInt(img.getAttribute('width') || '', 10);
            const attrH = parseInt(img.getAttribute('height') || '', 10);
            const csW = parseFloat(cs.width);
            const csH = parseFloat(cs.height);
            const dispW = !isNaN(attrW) && attrW > 0 ? attrW : (isSmallIcon && !isNaN(csW) && csW > 0 ? csW : null);
            const dispH = !isNaN(attrH) && attrH > 0 ? attrH : (isSmallIcon && !isNaN(csH) && csH > 0 ? csH : null);

            let cssBoxW = rect.width;
            let cssBoxH = rect.height;
            if (isCssSized && (cssBoxW <= 1 || cssBoxH <= 1) && parentEl) {
                const pRect = parentEl.getBoundingClientRect();
                if (pRect.width > 1 && pRect.height > 1) {
                    cssBoxW = pRect.width;
                    cssBoxH = pRect.height;
                }
            }

            const backingHint = isCssSized && cssBoxW > 1
                ? Math.max(64, Math.min(Math.ceil(cssBoxW), maxContentWidthPx))
                : (dispW && dispW > 0 ? Math.min(dispW, maxContentWidthPx) : maxContentWidthPx);

            let loaded: { canvas: HTMLCanvasElement; natW: number; natH: number } | null = null;

            const vaultFile = this.resolveVaultImageFile(altAttr, sourcePath)
                || this.resolveVaultImageFile(img.getAttribute('data-path') || '', sourcePath)
                || this.resolveVaultFileFromImgSrc(src);

            if (vaultFile instanceof TFile) {
                const mime = mimeMap[vaultFile.extension.toLowerCase()] || 'image/png';
                try {
                    const bin = await this.app.vault.readBinary(vaultFile);
                    loaded = await rasterizeBinary(bin, mime, backingHint);
                } catch {
                    // ignore
                }
            }

            if (!loaded && src) {
                loaded = await this.loadSourceToCanvas({ kind: 'domImg', img }, Math.round(backingHint * 2));
            }

            if (!loaded && src) {
                const fetched = await this.readUrlAsArrayBuffer(src);
                if (fetched && fetched.buffer.byteLength > 0) {
                    const ct = fetched.contentType || 'image/png';
                    loaded = await rasterizeBinary(fetched.buffer, ct.split(';')[0].trim(), backingHint);
                }
            }

            if (loaded) {
                const imgId = `pdf-img-${imageCanvasesById.size}`;
                imageCanvasesById.set(imgId, loaded.canvas);
                const parentBlock = img.closest<HTMLElement>('li, blockquote, .callout-content, td, th, p');
                const parentRight = parentBlock
                    ? Math.min(containerRect.right, parentBlock.getBoundingClientRect().right - (parseFloat(window.getComputedStyle(parentBlock).paddingRight) || 0))
                    : containerRect.right;
                const availW = Math.max(40, Math.floor(parentRight - Math.max(containerRect.left, rect.left)));

                if (isCssSized && cssBoxW > 1 && cssBoxH > 1) {
                    const slot = createDiv({ cls: 'pdf-image-slot' });
                    slot.setAttribute('data-pdf-img-id', imgId);
                    slot.setAttribute('data-pdf-nat-w', String(loaded.natW));
                    slot.setAttribute('data-pdf-nat-h', String(loaded.natH));
                    slot.setAttribute('data-pdf-css-sized', '1');
                    slot.setAttribute('data-pdf-object-fit', objectFit);
                    if (cs.objectPosition) {
                        slot.setAttribute('data-pdf-object-position', cs.objectPosition);
                    }
                    if (cs.borderRadius && cs.borderRadius !== '0px') {
                        slot.setAttribute('data-pdf-border-radius', cs.borderRadius);
                        slot.style.borderRadius = cs.borderRadius;
                    }

                    let finalW = Math.max(1, Math.round(cssBoxW));
                    let finalH = Math.max(1, Math.round(cssBoxH));
                    if (finalW > availW + 1 && !pluginLayoutRoot) {
                        const ratio = availW / finalW;
                        finalW = availW;
                        if (objectFit !== 'cover') {
                            finalH = Math.max(1, Math.round(finalH * ratio));
                        }
                    }

                    slot.addClass('pdf-image-slot-css-sized');
                    slot.style.display = cs.display === 'inline' ? 'inline-block' : (cs.display || 'block');
                    slot.style.width = `${finalW}px`;
                    slot.style.height = `${finalH}px`;
                    slot.style.boxSizing = cs.boxSizing || 'border-box';
                    if (cs.margin && cs.margin !== '0px') slot.style.margin = cs.margin;
                    if (cs.flexShrink && cs.flexShrink !== '1') slot.style.flexShrink = cs.flexShrink;
                    if (cs.flexGrow && cs.flexGrow !== '0') slot.style.flexGrow = cs.flexGrow;
                    if (cs.alignSelf && cs.alignSelf !== 'auto') slot.style.alignSelf = cs.alignSelf;
                    if (cs.justifySelf && cs.justifySelf !== 'auto') slot.style.justifySelf = cs.justifySelf;
                    if (cs.gridColumn && cs.gridColumn !== 'auto') slot.style.gridColumn = cs.gridColumn;
                    if (cs.gridRow && cs.gridRow !== 'auto') slot.style.gridRow = cs.gridRow;

                    img.replaceWith(slot);
                } else {
                    const slot = this.createImageSlotElement(imgId, loaded.natW, loaded.natH, dispW, dispH, availW, isSmallIcon);
                    img.replaceWith(slot);
                    if (!isSmallIcon) {
                        const sRect = slot.getBoundingClientRect();
                        if (sRect.width > 0 && sRect.height > 0 && sRect.right > parentRight + 0.5) {
                            const clampedW = Math.max(40, Math.floor(parentRight - sRect.left));
                            const clampedH = Math.max(1, Math.round((clampedW * sRect.height) / sRect.width));
                            slot.style.width = `${clampedW}px`;
                            slot.style.height = `${clampedH}px`;
                        }
                    }
                }
            } else {
                await img.decode().catch(() => {});
            }
        }
    }

    /**
     * Collects needed style/attribute fixes for a single element WITHOUT mutating the DOM.
     * Used by two-phase read-then-write sanitization to prevent O(N^2) browser style thrashing.
     */
    private collectElementSanitization(
        el: Element,
        computedView: Window,
        colorCache: Map<string, string>,
        fontCache: Map<string, string>
    ): { el: HTMLElement | SVGElement; svgW?: string; svgH?: string; props: Array<[string, string]> } | null {
        let svgW: string | undefined;
        let svgH: string | undefined;
        if (el.instanceOf(SVGSVGElement)) {
            const rect = el.getBoundingClientRect();
            if (rect.width > 0 && rect.height > 0) {
                if (!el.getAttribute('width')) svgW = `${rect.width}`;
                if (!el.getAttribute('height')) svgH = `${rect.height}`;
            }
        }

        if (!el.instanceOf(HTMLElement) && !el.instanceOf(SVGElement)) return null;
        const cs = computedView.getComputedStyle(el);
        const props: Array<[string, string]> = [];

        if (el.instanceOf(HTMLElement) && cs.visibility === 'visible' && el.style.visibility && el.style.visibility !== 'visible') {
            props.push(['visibility', 'visible']);
        }

        const rawFont = cs.fontFamily;
        if (rawFont) {
            let cleanFont = fontCache.get(rawFont);
            if (cleanFont === undefined) {
                const sanitized = this.sanitizeFontFamilyForHtml2Canvas(rawFont);
                cleanFont = sanitized !== rawFont ? sanitized : '';
                fontCache.set(rawFont, cleanFont);
            }
            if (cleanFont) {
                props.push(['font-family', cleanFont]);
            }
        }

        const checkColor = (cssProp: string, val: string | undefined) => {
            if (val && PdfPlugin.UNSUPPORTED_COLOR_REGEX.test(val)) {
                let resolved = colorCache.get(val);
                if (resolved === undefined) {
                    resolved = this.resolveCssColorToRgba(val) || 'rgba(0, 0, 0, 0)';
                    colorCache.set(val, resolved);
                }
                props.push([cssProp, resolved]);
            }
        };
        const checkCompound = (cssProp: string, val: string | undefined, fallback: string) => {
            if (val && PdfPlugin.UNSUPPORTED_COLOR_REGEX.test(val)) {
                const sanitized = this.replaceUnsupportedColorFunctions(val, colorCache);
                props.push([cssProp, PdfPlugin.UNSUPPORTED_COLOR_REGEX.test(sanitized) ? fallback : sanitized]);
            }
        };

        checkColor('color', cs.color);
        checkColor('background-color', cs.backgroundColor);
        checkColor('border-top-color', cs.borderTopColor);
        checkColor('border-right-color', cs.borderRightColor);
        checkColor('border-bottom-color', cs.borderBottomColor);
        checkColor('border-left-color', cs.borderLeftColor);
        checkColor('outline-color', cs.outlineColor);
        checkColor('text-decoration-color', cs.textDecorationColor);
        checkColor('-webkit-text-stroke-color', cs.getPropertyValue('-webkit-text-stroke-color'));
        checkColor('caret-color', cs.caretColor);
        checkColor('column-rule-color', cs.columnRuleColor);
        if (el.instanceOf(SVGElement)) {
            checkColor('fill', cs.getPropertyValue('fill'));
            checkColor('stroke', cs.getPropertyValue('stroke'));
            checkColor('stop-color', cs.getPropertyValue('stop-color'));
        }

        checkCompound('box-shadow', cs.boxShadow, 'none');
        checkCompound('text-shadow', cs.textShadow, 'none');
        checkCompound('background-image', cs.backgroundImage, 'none');
        checkCompound('list-style-image', cs.listStyleImage, 'none');

        return { el, svgW, svgH, props };
    }

    private applyElementSanitization(
        patch: { el: HTMLElement | SVGElement; svgW?: string; svgH?: string; props: Array<[string, string]> }
    ) {
        if (patch.svgW !== undefined) patch.el.setAttribute('width', patch.svgW);
        if (patch.svgH !== undefined) patch.el.setAttribute('height', patch.svgH);
        for (let i = 0; i < patch.props.length; i++) {
            patch.el.style.setProperty(patch.props[i][0], patch.props[i][1], 'important');
        }
        patch.el.setAttribute('data-pdf-san', '1');
    }

    private sanitizeSingleElementForHtml2Canvas(
        el: Element,
        computedView: Window = window,
        colorCache: Map<string, string> = new Map(),
        fontCache: Map<string, string> = new Map()
    ) {
        const patch = this.collectElementSanitization(el, computedView, colorCache, fontCache);
        if (patch) this.applyElementSanitization(patch);
    }

    /**
     * Two-phase read-then-write DOM sanitizer: reads all computed styles in one pass (1 browser style
     * recalc total) and applies all style overrides & `data-pdf-san` markers in a second write-only pass.
     * When `onlyUnsanitized` is true, skips elements already sanitized before DocumentCloner ran.
     */
    private sanitizePageForHtml2Canvas(
        pageEl: HTMLElement,
        computedView: Window = window,
        colorCache: Map<string, string> = new Map(),
        fontCache: Map<string, string> = new Map(),
        onlyUnsanitized: boolean = false
    ) {
        const patches: Array<{ el: HTMLElement | SVGElement; svgW?: string; svgH?: string; props: Array<[string, string]> }> = [];

        if (!onlyUnsanitized || pageEl.getAttribute('data-pdf-san') !== '1') {
            const p = this.collectElementSanitization(pageEl, computedView, colorCache, fontCache);
            if (p) patches.push(p);
        }
        const descendants = pageEl.querySelectorAll('*');
        for (let i = 0; i < descendants.length; i++) {
            const node = descendants[i];
            if (onlyUnsanitized && node.getAttribute('data-pdf-san') === '1') continue;
            const p = this.collectElementSanitization(node, computedView, colorCache, fontCache);
            if (p) patches.push(p);
        }

        for (let i = 0; i < patches.length; i++) {
            this.applyElementSanitization(patches[i]);
        }
    }

    /**
     * Sanitizes Obsidian's root CSS font variables (`--font-text`, `--font-interface`, `--font-monospace`, etc.)
     * once on `renderRoot` so 99% of descendant text elements inherit clean font stacks without needing per-node inline styles.
     */
    private sanitizeRootFontVariables(renderRoot: HTMLElement, fontCache: Map<string, string>): void {
        if (this.settings.fontFamily === 'custom') return;
        const rootCs = window.getComputedStyle(renderRoot);
        const fontVars = [
            '--font-text',
            '--font-text-theme',
            '--font-interface',
            '--font-interface-theme',
            '--font-monospace',
            '--font-monospace-theme',
            '--font-default'
        ];
        for (const cssVar of fontVars) {
            const raw = rootCs.getPropertyValue(cssVar).trim();
            if (!raw) continue;
            let clean = fontCache.get(raw);
            if (clean === undefined) {
                const sanitized = this.sanitizeFontFamilyForHtml2Canvas(raw);
                clean = sanitized !== raw ? sanitized : '';
                fontCache.set(raw, clean);
            }
            if (clean) {
                renderRoot.style.setProperty(cssVar, clean);
            }
        }
    }

    /**
     * Renders a single-line Unicode/emoji footnote directly on an opaque Canvas 2D buffer (~0.2ms)
     * instead of invoking html2canvas per page.
     */
    private renderFootnoteToDataUrl(
        text: string,
        contentWidthPx: number,
        scale: number,
        bgHex: string,
        textColor: number[],
        fontFamily: string
    ): { img: string; heightPx: number } {
        const cssHeightPx = 18;
        const canvas = createEl('canvas');
        canvas.width = Math.max(1, Math.round(contentWidthPx * scale));
        canvas.height = Math.max(1, Math.round(cssHeightPx * scale));
        const ctx = canvas.getContext('2d', { alpha: false });
        if (ctx) {
            ctx.scale(scale, scale);
            ctx.fillStyle = bgHex;
            ctx.fillRect(0, 0, contentWidthPx, cssHeightPx);
            ctx.fillStyle = `rgb(${textColor[0]}, ${textColor[1]}, ${textColor[2]})`;
            ctx.font = `400 12px ${fontFamily || 'system-ui, -apple-system, sans-serif'}`;
            ctx.textBaseline = 'middle';
            const isRtl = /[\u0591-\u07FF\uFB1D-\uFDFD\uFE70-\uFEFC]/.test(text);
            if (isRtl) {
                ctx.direction = 'rtl';
                ctx.textAlign = 'right';
                ctx.fillText(text, contentWidthPx, cssHeightPx * 0.54, contentWidthPx);
            } else {
                ctx.direction = 'ltr';
                ctx.textAlign = 'left';
                ctx.fillText(text, 0, cssHeightPx * 0.54, contentWidthPx);
            }
        }
        const img = canvas.toDataURL('image/png');
        canvas.width = 0;
        canvas.height = 0;
        return { img, heightPx: cssHeightPx };
    }

    /**
     * Sanitizes the cloned iframe document created by html2canvas (html, body, cloned pseudo-elements)
     * right before html2canvas parses computed styles.
     */
    private sanitizeClonedDocForHtml2Canvas(
        clonedDoc: Document,
        clonedEl: HTMLElement,
        bgHex: string,
        colorCache: Map<string, string>,
        fontCache: Map<string, string>
    ) {
        const clonedWin = clonedDoc.defaultView || window;

        // 1. Ensure cloned target and its hidden renderRoot ancestors are fully opaque for capture
        let ancestor: HTMLElement | null = clonedEl;
        while (ancestor && ancestor !== clonedDoc.body) {
            ancestor.classList.add('pdf-capture-visible');
            ancestor = ancestor.parentElement;
        }

        // 1b. Strip interactive Obsidian/plugin UI buttons (e.g. copy-code-button) directly from the
        // cloned capture DOM so high-specificity or !important theme rules can never make them visible.
        const excludedUiEls = clonedEl.querySelectorAll(PdfPlugin.PDF_EXCLUDED_UI_SELECTOR);
        for (let i = 0; i < excludedUiEls.length; i++) {
            excludedUiEls[i].remove();
        }

        // 2. Replace all visible checkboxes (Obsidian task checkboxes AND raw HTML / plugin
        // <input type="checkbox">) in the cloned document only, because html2canvas 1.4.1 cannot
        // reliably paint native checkbox controls or CSS `-webkit-mask-image` checkmarks.
        const clonedCheckboxes = Array.from(clonedEl.querySelectorAll<HTMLInputElement>('input[type="checkbox"]'));
        for (const cb of clonedCheckboxes) {
            const cbCs = clonedWin.getComputedStyle(cb);
            if (cbCs.display === 'none' || cbCs.visibility === 'hidden' || parseFloat(cbCs.opacity) === 0) {
                continue;
            }
            const box = this.buildVectorCheckboxElement(cb, cbCs, clonedDoc, colorCache);
            cb.replaceWith(box);
        }

        // 3. Sanitize only newly injected nodes in the cloned tree (e.g. :before / :after clones created by DocumentCloner)
        this.sanitizePageForHtml2Canvas(clonedEl, clonedWin, colorCache, fontCache, true);

        // 4. Ensure html & body never expose oklch/oklab/color-mix or invalid fonts to html2canvas
        for (const rootEl of [clonedDoc.documentElement, clonedDoc.body]) {
            if (!rootEl) continue;
            this.sanitizeSingleElementForHtml2Canvas(rootEl, clonedWin, colorCache, fontCache);
            rootEl.classList.add('pdf-capture-root-clean');
            rootEl.style.setProperty('background-color', bgHex, 'important');
        }
    }

    private buildVectorCheckboxElement(
        cb: HTMLInputElement,
        cbCs: CSSStyleDeclaration,
        targetDoc: Document,
        colorCache: Map<string, string>
    ): HTMLSpanElement {
        const resolveColor = (raw: string | undefined, fallback: string): string => {
            if (!raw) return fallback;
            if (PdfPlugin.UNSUPPORTED_COLOR_REGEX.test(raw)) {
                let resolved = colorCache.get(raw);
                if (resolved === undefined) {
                    resolved = this.resolveCssColorToRgba(raw) || fallback;
                    colorCache.set(raw, resolved);
                }
                return resolved;
            }
            return raw;
        };
        const isTransparentColor = (color: string): boolean => {
            if (!color || color === 'transparent') return true;
            const m = color.match(/rgba\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*,\s*([\d.]+)\s*\)/i);
            return !!m && parseFloat(m[1]) <= 0.01;
        };

        const w = parseFloat(cbCs.width) || 16;
        const h = parseFloat(cbCs.height) || 16;
        const isChecked = cb.checked || cb.hasAttribute('checked');

        const resolvedText = resolveColor(cbCs.color, 'rgb(120, 120, 120)');
        const resolvedBg = resolveColor(cbCs.backgroundColor, 'rgba(0, 0, 0, 0)');
        const bTopW = parseFloat(cbCs.borderTopWidth) || 0;
        const bRightW = parseFloat(cbCs.borderRightWidth) || 0;
        const bBottomW = parseFloat(cbCs.borderBottomWidth) || 0;
        const bLeftW = parseFloat(cbCs.borderLeftWidth) || 0;
        const hasVisibleBorder =
            (bTopW > 0 && cbCs.borderTopStyle !== 'none') ||
            (bRightW > 0 && cbCs.borderRightStyle !== 'none') ||
            (bBottomW > 0 && cbCs.borderBottomStyle !== 'none') ||
            (bLeftW > 0 && cbCs.borderLeftStyle !== 'none');

        const box = targetDoc.createElement('span');
        box.classList.add('pdf-vector-checkbox');
        const boxStyles: string[] = [
            'display:inline-flex',
            'align-items:center',
            'justify-content:center',
            'box-sizing:border-box',
            'flex-shrink:0',
            `width:${w}px`,
            `height:${h}px`,
            `min-width:${w}px`,
            `min-height:${h}px`,
            `margin-top:${cbCs.marginTop}`,
            `margin-right:${cbCs.marginRight}`,
            `margin-bottom:${cbCs.marginBottom}`,
            `margin-left:${cbCs.marginLeft}`,
            `vertical-align:${cbCs.verticalAlign || 'middle'}`,
            `border-radius:${cbCs.borderRadius && cbCs.borderRadius !== '0px' ? cbCs.borderRadius : '4px'}`,
            `background-color:${resolvedBg}`,
            `position:${cbCs.position === 'absolute' ? 'absolute' : 'relative'}`
        ];

        if (hasVisibleBorder) {
            boxStyles.push(
                `border-top:${cbCs.borderTopWidth} ${cbCs.borderTopStyle} ${resolveColor(cbCs.borderTopColor, resolvedText)}`,
                `border-right:${cbCs.borderRightWidth} ${cbCs.borderRightStyle} ${resolveColor(cbCs.borderRightColor, resolvedText)}`,
                `border-bottom:${cbCs.borderBottomWidth} ${cbCs.borderBottomStyle} ${resolveColor(cbCs.borderBottomColor, resolvedText)}`,
                `border-left:${cbCs.borderLeftWidth} ${cbCs.borderLeftStyle} ${resolveColor(cbCs.borderLeftColor, resolvedText)}`
            );
        } else {
            box.classList.add('pdf-vector-checkbox-unchecked');
            boxStyles.push(`border:1.5px solid ${resolvedText}`);
        }

        if (cbCs.position === 'absolute') {
            boxStyles.push(`top:${cbCs.top}`, `left:${cbCs.left}`);
        }
        box.setAttribute('style', boxStyles.join(';'));

        if (isChecked) {
            let strokeColor = '#ffffff';
            if (isTransparentColor(resolvedBg)) {
                strokeColor = resolvedText;
            } else {
                const bgRgb = this.parseColorToRgbArray(resolvedBg);
                if (bgRgb) {
                    const lum = (0.299 * bgRgb[0] + 0.587 * bgRgb[1] + 0.114 * bgRgb[2]) / 255;
                    if (lum > 0.72) strokeColor = '#111111';
                }
            }
            const svgNS = 'http://www.w3.org/2000/svg';
            const svg = targetDoc.createElementNS(svgNS, 'svg');
            svg.setAttribute('xmlns', svgNS);
            svg.setAttribute('viewBox', '0 0 12 12');
            svg.setAttribute('width', `${Math.max(8, Math.round(w * 0.72))}`);
            svg.setAttribute('height', `${Math.max(8, Math.round(h * 0.72))}`);
            svg.classList.add('pdf-vector-checkbox-svg');
            const path = targetDoc.createElementNS(svgNS, 'path');
            path.setAttribute('d', 'M2.2 6.3 L4.8 8.9 L9.8 3.2');
            path.setAttribute('fill', 'none');
            path.setAttribute('stroke', strokeColor);
            path.setAttribute('stroke-width', '2');
            path.setAttribute('stroke-linecap', 'round');
            path.setAttribute('stroke-linejoin', 'round');
            svg.appendChild(path);
            box.appendChild(svg);
        }
        box.setAttribute('data-pdf-san', '1');
        return box;
    }

    private static readonly FO_INHERITED_PROPS: readonly string[] = [
        'color',
        'font-family',
        'font-size',
        'font-weight',
        'font-style',
        'font-variant',
        'line-height',
        'letter-spacing',
        'word-spacing',
        'text-align',
        'text-indent',
        'text-transform',
        'white-space',
        'word-break',
        'overflow-wrap',
        'hyphens',
        'direction',
        'tab-size',
        'list-style-type',
        'list-style-position',
        'border-collapse',
        'border-spacing',
        'caption-side',
        'visibility',
        'font-feature-settings',
        'quotes'
    ];

    private static readonly FO_RESET_CSS = [
        '*,*::before,*::after{box-sizing:border-box;}',
        'h1,h2,h3,h4,h5,h6,b,strong,th{font-weight:inherit;font-size:inherit;}',
        'i,em,cite,dfn,var,address{font-style:inherit;}',
        'code,kbd,samp,pre,tt{font-family:inherit;font-size:inherit;}',
        'pre{white-space:inherit;}',
        'small,sub,sup{font-size:inherit;}',
        'mark{color:inherit;}',
        'a{color:inherit;text-decoration:none;}',
        'p,h1,h2,h3,h4,h5,h6,ul,ol,li,blockquote,pre,figure,figcaption,caption,hr,dl,dd,table,thead,tbody,tfoot,tr,td,th{margin:0;padding:0;}',
        'ul,ol,ul ul,ul ul ul,ol ul,ol ol,li{list-style-type:inherit;list-style-position:inherit;}',
        'th,caption{text-align:inherit;}',
        'hr{border:0;}',
        '*{scrollbar-width:none!important;}',
        '*::-webkit-scrollbar{display:none!important;width:0!important;height:0!important;}'
    ].join('');

    private unquoteCssContent(raw: string): string {
        const trimmed = raw.trim();
        if (trimmed.length < 2) return '';
        const quote = trimmed[0];
        if ((quote !== '"' && quote !== "'") || trimmed[trimmed.length - 1] !== quote) {
            return '';
        }
        const inner = trimmed.slice(1, -1);
        return inner.replace(/\\([0-9a-fA-F]{1,6})\s?|\\(.)/g, (_m: string, hex?: string, ch?: string) => {
            if (hex) {
                const cp = parseInt(hex, 16);
                if (!isNaN(cp) && cp > 0 && cp <= 0x10ffff) {
                    try { return String.fromCodePoint(cp); } catch { return ''; }
                }
                return '';
            }
            if (ch === 'n' || ch === 'A') return '\n';
            return ch || '';
        });
    }

    private collectFontFamiliesFromCss(fontFamilyCss: string, target: Set<string>): void {
        if (!fontFamilyCss) return;
        const parts = fontFamilyCss.split(',');
        for (const p of parts) {
            const clean = p.trim().replace(/^["']|["']$/g, '').trim().toLowerCase();
            if (clean && clean !== 'inherit' && clean !== 'initial' && clean !== 'unset') {
                target.add(clean);
            }
        }
    }

    private async fetchUrlAsDataUrl(rawUrl: string): Promise<string> {
        const cached = this.sessionFontUrlCache.get(rawUrl);
        if (cached !== undefined) return cached;
        const isLocalUrl =
            !rawUrl.startsWith('http://') && !rawUrl.startsWith('https://') ||
            rawUrl.startsWith(window.location.origin) ||
            /^https?:\/\/(?:localhost|127\.0\.0\.1)(?:[:/]|$)/i.test(rawUrl);
        try {
            const fetched = await this.readUrlAsArrayBuffer(rawUrl);
            if (!fetched) {
                if (!isLocalUrl) this.sessionFontUrlCache.set(rawUrl, '');
                return '';
            }
            const buf = fetched.buffer;
            if (buf.byteLength === 0 || buf.byteLength > 12_000_000) {
                if (!isLocalUrl) this.sessionFontUrlCache.set(rawUrl, '');
                return '';
            }
            const cleanUrlPath = rawUrl.split(/[?#]/)[0].toLowerCase();
            const extMime =
                cleanUrlPath.endsWith('.woff2') ? 'font/woff2' :
                cleanUrlPath.endsWith('.woff') ? 'font/woff' :
                cleanUrlPath.endsWith('.otf') ? 'font/otf' :
                cleanUrlPath.endsWith('.ttf') ? 'font/ttf' :
                cleanUrlPath.endsWith('.svg') ? 'image/svg+xml' :
                cleanUrlPath.endsWith('.png') ? 'image/png' :
                cleanUrlPath.endsWith('.webp') ? 'image/webp' :
                (cleanUrlPath.endsWith('.jpg') || cleanUrlPath.endsWith('.jpeg')) ? 'image/jpeg' : '';
            const rawCt = (fetched.contentType || '').split(';')[0].trim().toLowerCase();
            const mime = extMime || (rawCt && rawCt !== 'application/octet-stream' && rawCt !== 'text/plain' ? rawCt : 'font/ttf');
            const dataUrl = `data:${mime};base64,${this.arrayBufferToBase64(buf)}`;
            this.sessionFontUrlCache.set(rawUrl, dataUrl);
            return dataUrl;
        } catch {
            if (!isLocalUrl) this.sessionFontUrlCache.set(rawUrl, '');
            return '';
        }
    }

    private async getInlinedDocumentFontFaceCss(usedFontFamilies: Set<string>, customFontCss: string): Promise<string> {
        const key = `${Array.from(usedFontFamilies).sort().join('|')}::${customFontCss.length}`;
        const cachedCss = this.sessionFontRuleCache.get(key);
        if (cachedCss !== undefined) return cachedCss;

        const rulesOut: string[] = [];
        const sheets = Array.from(activeDocument.styleSheets || []);
        for (const sheet of sheets) {
            let cssRules: CSSRuleList;
            try {
                cssRules = sheet.cssRules;
            } catch {
                continue;
            }
            if (!cssRules) continue;
            const baseHref = sheet.href || window.location.href;
            for (let i = 0; i < cssRules.length; i++) {
                const rule = cssRules[i];
                // Use CSSRule.FONT_FACE_RULE (5) instead of instanceof so popout windows work cross-realm
                if (!rule || rule.type !== 5) continue;
                const ffRule = rule as CSSFontFaceRule;
                const rawFamily = ffRule.style.getPropertyValue('font-family').trim().replace(/^["']|["']$/g, '').trim().toLowerCase();
                if (!rawFamily || !usedFontFamilies.has(rawFamily)) continue;

                let cssText = ffRule.cssText;
                const urlMatches = Array.from(cssText.matchAll(/url\(\s*(['"]?)([^'")]+)\1\s*\)/gi));
                let hasUsableSrc = urlMatches.length === 0;
                for (const m of urlMatches) {
                    const originalUrl = m[2].trim();
                    if (!originalUrl || originalUrl.startsWith('data:')) {
                        hasUsableSrc = true;
                        continue;
                    }
                    let resolvedUrl = originalUrl;
                    try {
                        resolvedUrl = new URL(originalUrl, baseHref).href;
                    } catch {
                        // keep originalUrl
                    }
                    const dataUrl = await this.fetchUrlAsDataUrl(resolvedUrl);
                    if (dataUrl) {
                        cssText = cssText.split(m[0]).join(`url("${dataUrl}")`);
                        hasUsableSrc = true;
                    }
                }
                if (hasUsableSrc) {
                    rulesOut.push(cssText);
                }
            }
        }
        if (customFontCss) {
            rulesOut.push(customFontCss);
        }
        const combined = rulesOut.join('\n');
        this.sessionFontRuleCache.set(key, combined);
        return combined;
    }

    private cloneSvgForForeignObject(srcSvg: SVGElement, win: Window, usedFontFamilies?: Set<string>): SVGElement {
        const clonedSvg = srcSvg.cloneNode(true) as SVGElement;
        const svgNS = 'http://www.w3.org/2000/svg';
        clonedSvg.setAttribute('xmlns', svgNS);

        const resolveCssVarsInString = (raw: string, refCs: CSSStyleDeclaration): string => {
            if (!raw || !raw.includes('var(')) return raw;
            let out = raw;
            for (let pass = 0; pass < 3 && out.includes('var('); pass++) {
                out = out.replace(/var\(\s*(--[a-zA-Z0-9_-]+)(?:\s*,\s*([^()]+))?\s*\)/g, (_m: string, varName: string, fallback?: string) => {
                    const resolved = refCs.getPropertyValue(varName).trim();
                    if (resolved) return resolved;
                    return fallback ? fallback.trim() : '';
                });
            }
            return out;
        };

        const cs = win.getComputedStyle(srcSvg);
        const rect = srcSvg.getBoundingClientRect();
        if (rect.width > 0 && !clonedSvg.getAttribute('width')) {
            clonedSvg.setAttribute('width', `${rect.width}`);
        }
        if (rect.height > 0 && !clonedSvg.getAttribute('height')) {
            clonedSvg.setAttribute('height', `${rect.height}`);
        }
        const styleParts: string[] = [
            `display:${cs.display || 'inline-block'}`,
            `color:${cs.color}`
        ];
        if (cs.fontFamily) {
            styleParts.push(`font-family:${cs.fontFamily}`);
            if (usedFontFamilies) this.collectFontFamiliesFromCss(cs.fontFamily, usedFontFamilies);
        }
        if (cs.fontSize) styleParts.push(`font-size:${cs.fontSize}`);
        if (rect.width > 0) styleParts.push(`width:${rect.width}px`);
        if (rect.height > 0) styleParts.push(`height:${rect.height}px`);
        if (cs.verticalAlign && cs.verticalAlign !== 'baseline') styleParts.push(`vertical-align:${cs.verticalAlign}`);
        if (cs.marginTop !== '0px') styleParts.push(`margin-top:${cs.marginTop}`);
        if (cs.marginRight !== '0px') styleParts.push(`margin-right:${cs.marginRight}`);
        if (cs.marginBottom !== '0px') styleParts.push(`margin-bottom:${cs.marginBottom}`);
        if (cs.marginLeft !== '0px') styleParts.push(`margin-left:${cs.marginLeft}`);
        if (cs.fill && cs.fill !== 'rgb(0, 0, 0)') styleParts.push(`fill:${cs.fill}`);
        if (cs.stroke && cs.stroke !== 'none') styleParts.push(`stroke:${cs.stroke}`);
        if (cs.overflow && cs.overflow !== 'hidden') styleParts.push(`overflow:${cs.overflow}`);
        if (cs.opacity && cs.opacity !== '1') styleParts.push(`opacity:${cs.opacity}`);
        if (cs.transform && cs.transform !== 'none') styleParts.push(`transform:${cs.transform}`);
        clonedSvg.setAttribute('style', styleParts.join(';'));

        // Inline external <use href="#id"> definitions (essential for MathJax global SVG glyph caches)
        const uses = Array.from(clonedSvg.querySelectorAll('use'));
        if (uses.length > 0) {
            let defsEl = clonedSvg.querySelector('defs');
            const importedIds = new Set<string>();
            for (const useEl of uses) {
                const href = useEl.getAttribute('href') || useEl.getAttribute('xlink:href') || '';
                if (!href.startsWith('#')) continue;
                const refId = href.slice(1);
                if (!refId || importedIds.has(refId)) continue;
                if (clonedSvg.querySelector(`#${CSS.escape(refId)}`)) {
                    importedIds.add(refId);
                    continue;
                }
                const globalDef = activeDocument.getElementById(refId);
                if (globalDef) {
                    if (!defsEl) {
                        defsEl = activeDocument.createElementNS(svgNS, 'defs');
                        clonedSvg.insertBefore(defsEl, clonedSvg.firstChild);
                    }
                    defsEl.appendChild(globalDef.cloneNode(true));
                    importedIds.add(refId);
                }
            }
        }

        // Resolve CSS variables inside embedded <style> blocks (critical for Mermaid diagrams in standalone SVG capture)
        const svgStyles = Array.from(clonedSvg.querySelectorAll('style'));
        for (const stEl of svgStyles) {
            const rawCss = stEl.textContent || '';
            if (rawCss.includes('var(')) {
                stEl.textContent = resolveCssVarsInString(rawCss, cs);
            }
        }

        const isDiagramSvg = Boolean(
            srcSvg.closest('.mermaid, [class*="block-language-mermaid"]') ||
            srcSvg.getAttribute('aria-roledescription') ||
            (srcSvg.getAttribute('id') || '').toLowerCase().includes('mermaid')
        );
        const fontBag = usedFontFamilies || new Set<string>();
        const dummyFlags = { hasExternalBgUrl: false };
        const svgShapeTags = new Set(['RECT', 'PATH', 'LINE', 'POLYLINE', 'POLYGON', 'CIRCLE', 'ELLIPSE']);

        // Resolve CSS variables & inline computed typography/theme styles on SVG children and nested <foreignObject> HTML labels
        const srcChildren = srcSvg.querySelectorAll('*');
        const clonedChildren = clonedSvg.querySelectorAll('*');
        const len = Math.min(srcChildren.length, clonedChildren.length);
        for (let i = 0; i < len; i++) {
            const sEl = srcChildren[i];
            const cEl = clonedChildren[i];
            const tagUp = sEl.tagName.toUpperCase();
            if (tagUp === 'STYLE' || tagUp === 'DEFS' || tagUp === 'SCRIPT' || tagUp === 'MARKER') continue;
            const inDefsOrMarker = !!sEl.closest('defs, marker');

            // HTML elements inside SVG <foreignObject> (e.g. Mermaid node/actor/edge labels) lose Obsidian CSS rules
            // inside standalone SVG images unless their computed styles are serialized explicitly.
            if (!inDefsOrMarker && sEl.instanceOf(HTMLElement) && cEl.instanceOf(HTMLElement)) {
                const childCs = win.getComputedStyle(sEl);
                const parentCs = sEl.parentElement ? win.getComputedStyle(sEl.parentElement) : null;
                const serialized = this.serializeElementStyleForForeignObject(sEl, childCs, parentCs, fontBag, false, dummyFlags);
                if (serialized) cEl.setAttribute('style', serialized);
                continue;
            }

            const rawStyle = cEl.getAttribute('style') || '';
            const rawFill = cEl.getAttribute('fill') || '';
            const rawStroke = cEl.getAttribute('stroke') || '';
            const isTextTag = !inDefsOrMarker && (tagUp === 'TEXT' || tagUp === 'TSPAN');
            const isShapeTag = !inDefsOrMarker && isDiagramSvg && svgShapeTags.has(tagUp);
            const hasVar = rawStyle.includes('var(') || rawFill.includes('var(') || rawStroke.includes('var(');

            if (hasVar || isTextTag || isShapeTag) {
                const childCs = win.getComputedStyle(sEl);
                if (rawFill.includes('var(') && childCs.fill) cEl.setAttribute('fill', childCs.fill);
                if (rawStroke.includes('var(') && childCs.stroke) cEl.setAttribute('stroke', childCs.stroke);

                let nextStyle = rawStyle ? resolveCssVarsInString(rawStyle, childCs) : '';
                const extraParts: string[] = [];

                if (isTextTag) {
                    if (childCs.fontFamily) {
                        extraParts.push(`font-family:${childCs.fontFamily}`);
                        this.collectFontFamiliesFromCss(childCs.fontFamily, fontBag);
                    }
                    if (childCs.fontSize) extraParts.push(`font-size:${childCs.fontSize}`);
                    if (childCs.fontWeight && childCs.fontWeight !== '400') extraParts.push(`font-weight:${childCs.fontWeight}`);
                    if (childCs.fontStyle && childCs.fontStyle !== 'normal') extraParts.push(`font-style:${childCs.fontStyle}`);
                    if (childCs.fill) extraParts.push(`fill:${childCs.fill}`);
                    if (childCs.textAnchor) extraParts.push(`text-anchor:${childCs.textAnchor}`);
                    const domBase = childCs.getPropertyValue('dominant-baseline');
                    if (domBase && domBase !== 'auto') extraParts.push(`dominant-baseline:${domBase}`);
                } else if (isShapeTag) {
                    if (childCs.fill) extraParts.push(`fill:${childCs.fill}`);
                    if (childCs.stroke) extraParts.push(`stroke:${childCs.stroke}`);
                    if (childCs.strokeWidth) extraParts.push(`stroke-width:${childCs.strokeWidth}`);
                    if (childCs.strokeDasharray && childCs.strokeDasharray !== 'none') extraParts.push(`stroke-dasharray:${childCs.strokeDasharray}`);
                    if (childCs.opacity && childCs.opacity !== '1') extraParts.push(`opacity:${childCs.opacity}`);
                } else if (rawStyle.includes('var(')) {
                    if (childCs.fill) extraParts.push(`fill:${childCs.fill}`);
                    if (childCs.stroke) extraParts.push(`stroke:${childCs.stroke}`);
                    if (childCs.color) extraParts.push(`color:${childCs.color}`);
                    if (childCs.fontFamily) {
                        extraParts.push(`font-family:${childCs.fontFamily}`);
                        this.collectFontFamiliesFromCss(childCs.fontFamily, fontBag);
                    }
                    if (childCs.fontSize) extraParts.push(`font-size:${childCs.fontSize}`);
                }

                if (extraParts.length > 0) {
                    const prefix = nextStyle ? (nextStyle.endsWith(';') ? nextStyle : `${nextStyle};`) : '';
                    cEl.setAttribute('style', `${prefix}${extraParts.join(';')}`);
                } else if (nextStyle && nextStyle !== rawStyle) {
                    cEl.setAttribute('style', nextStyle);
                }
            }
        }

        return clonedSvg;
    }

    private serializeElementStyleForForeignObject(
        el: HTMLElement,
        cs: CSSStyleDeclaration,
        parentCs: CSSStyleDeclaration | null,
        usedFontFamilies: Set<string>,
        isRoot: boolean,
        outFlags: { hasExternalBgUrl: boolean; externalBgUrls?: Set<string> }
    ): string {
        const parts: string[] = [];
        const collectExternalCssUrls = (cssVal: string) => {
            if (!outFlags.externalBgUrls) return;
            const matches = cssVal.matchAll(/url\(\s*(['"]?)([^'")]+)\1\s*\)/gi);
            for (const m of matches) {
                const rawUrl = (m[2] || '').trim();
                if (rawUrl && !rawUrl.startsWith('data:') && !rawUrl.startsWith('#')) {
                    outFlags.externalBgUrls.add(rawUrl);
                }
            }
        };

        if (isRoot) {
            parts.push('opacity:1', 'visibility:visible');
        }

        const normalizeTextAlign = (raw: string): string => {
            if (raw === '-webkit-left') return 'left';
            if (raw === '-webkit-center' || raw === '-internal-center') return 'center';
            if (raw === '-webkit-right') return 'right';
            if (raw === '-webkit-auto') return 'start';
            return raw;
        };

        // 1. Inherited typography/text properties (emit on root or when differing from parent)
        for (let i = 0; i < PdfPlugin.FO_INHERITED_PROPS.length; i++) {
            const prop = PdfPlugin.FO_INHERITED_PROPS[i];
            const rawVal = cs.getPropertyValue(prop);
            if (!rawVal) continue;
            const val = prop === 'text-align' ? normalizeTextAlign(rawVal) : rawVal;
            if (prop === 'font-family') {
                this.collectFontFamiliesFromCss(val, usedFontFamilies);
            }
            const parentRaw = parentCs ? parentCs.getPropertyValue(prop) : '';
            const parentVal = prop === 'text-align' && parentRaw ? normalizeTextAlign(parentRaw) : parentRaw;
            if (isRoot || !parentCs || val !== parentVal) {
                parts.push(`${prop}:${val}`);
            }
        }

        // 2. Display & box model
        // Elements with overflow:auto/scroll (e.g. Obsidian's <div style="overflow-x:auto"> wrapper around every
        // <table> and scrollable math/code containers) or layout containment establish a Block Formatting Context (BFC)
        // in the live DOM, preventing child margins from collapsing with outside siblings. Since we omit overflow:auto/scroll
        // below to avoid static scrollbars, promote display:block -> display:flow-root so the BFC and vertical flow
        // inside <foreignObject> match the live DOM to the exact pixel (zero text-layer or link-hitbox drift).
        const rawDisplay = cs.display;
        const containVal = cs.getPropertyValue('contain') || '';
        const createsBfcWithoutOverflow =
            !isRoot &&
            rawDisplay === 'block' &&
            (
                cs.overflowX === 'auto' || cs.overflowX === 'scroll' ||
                cs.overflowY === 'auto' || cs.overflowY === 'scroll' ||
                containVal.includes('layout') || containVal.includes('content') || containVal === 'strict'
            );
        const display = createsBfcWithoutOverflow ? 'flow-root' : rawDisplay;
        if (display) parts.push(`display:${display}`);
        if (cs.boxSizing && cs.boxSizing !== 'border-box') {
            parts.push(`box-sizing:${cs.boxSizing}`);
        }

        // Margins & paddings (resetCss zeroes UA defaults so 0px can be safely skipped)
        if (!isRoot) {
            if (cs.marginTop !== '0px') parts.push(`margin-top:${cs.marginTop}`);
            if (cs.marginRight !== '0px') parts.push(`margin-right:${cs.marginRight}`);
            if (cs.marginBottom !== '0px') parts.push(`margin-bottom:${cs.marginBottom}`);
            if (cs.marginLeft !== '0px') parts.push(`margin-left:${cs.marginLeft}`);
        }
        if (cs.paddingTop !== '0px') parts.push(`padding-top:${cs.paddingTop}`);
        if (cs.paddingRight !== '0px') parts.push(`padding-right:${cs.paddingRight}`);
        if (cs.paddingBottom !== '0px') parts.push(`padding-bottom:${cs.paddingBottom}`);
        if (cs.paddingLeft !== '0px') parts.push(`padding-left:${cs.paddingLeft}`);

        // Sizing: preserve exact widths on slots, MathJax elements, full-width tables, replaced/positioned/explicitly-narrow blocks.
        // Do NOT freeze computed pixel widths onto auto-sized <table>/<td>/<th> cells (avoids subpixel last-letter wrapping and height drift).
        const tag = el.tagName;
        const isMathJaxEl = tag.startsWith('MJX-');
        const isDisplayMathContainer =
            (tag === 'MJX-CONTAINER' && el.getAttribute('display') === 'true') ||
            el.classList.contains('math-block');
        const isImgSlot = el.hasAttribute('data-pdf-img-id');
        const isPosNonStatic = cs.position && cs.position !== 'static';
        if (!isRoot) {
            if (cs.minWidth && cs.minWidth !== '0px' && cs.minWidth !== 'auto') parts.push(`min-width:${cs.minWidth}`);
            if (cs.maxWidth && cs.maxWidth !== 'none') parts.push(`max-width:${cs.maxWidth}`);
            if (cs.minHeight && cs.minHeight !== '0px' && cs.minHeight !== 'auto') parts.push(`min-height:${cs.minHeight}`);
            if (cs.maxHeight && cs.maxHeight !== 'none') parts.push(`max-height:${cs.maxHeight}`);

            const parentW = parentCs ? parseFloat(parentCs.width) : 0;
            const selfW = parseFloat(cs.width);
            const hasExplicitInlineWidth = Boolean(el.style && el.style.width && el.style.width !== 'auto');
            const isInlineSized = rawDisplay === 'inline-block' || rawDisplay === 'inline-flex' || rawDisplay === 'inline-grid';
            const isEmptyOrReplaced = tag === 'IMG' || tag === 'CANVAS' || tag === 'SVG' || el.childNodes.length === 0;
            const isTableEl = tag === 'TABLE' || rawDisplay === 'table' || rawDisplay === 'inline-table';
            const isTableCell = tag === 'TD' || tag === 'TH';
            const isFullWidthTable = isTableEl && parentW > 0 && selfW >= parentW - 2;
            const isFrontmatterKey = el.classList.contains('pdf-frontmatter-key');
            const needsWidth =
                isImgSlot ||
                isMathJaxEl ||
                isFrontmatterKey ||
                tag === 'HR' || tag === 'IMG' ||
                isPosNonStatic ||
                (isTableEl && (hasExplicitInlineWidth || isFullWidthTable)) ||
                (isTableCell && hasExplicitInlineWidth) ||
                (isInlineSized && (hasExplicitInlineWidth || isEmptyOrReplaced)) ||
                (rawDisplay === 'block' && parentW > 0 && selfW > 0 && selfW < parentW - 1.5);
            if (needsWidth && cs.width && cs.width !== 'auto') {
                parts.push(`width:${cs.width}`);
            }
            const hasExplicitInlineHeight = Boolean(el.style && el.style.height && el.style.height !== 'auto');
            const hasAspectRatio = Boolean(cs.aspectRatio && cs.aspectRatio !== 'auto');
            const isOverflowClippedBox = (cs.overflowX === 'hidden' || cs.overflowX === 'clip' || cs.overflowY === 'hidden' || cs.overflowY === 'clip') && cs.height && cs.height !== 'auto';
            const needsHeight =
                isImgSlot ||
                isDisplayMathContainer ||
                tag === 'HR' || tag === 'IMG' ||
                hasExplicitInlineHeight ||
                hasAspectRatio ||
                (isOverflowClippedBox && Boolean(parentCs && (parentCs.display.includes('flex') || parentCs.display.includes('grid')))) ||
                (isMathJaxEl && (cs.height === '0px' || el.childNodes.length === 0 || isPosNonStatic)) ||
                (isPosNonStatic && cs.height && cs.height !== 'auto') ||
                (el.childNodes.length === 0 && cs.height && cs.height !== '0px' && cs.height !== 'auto');
            if (needsHeight && cs.height && cs.height !== 'auto') {
                parts.push(`height:${cs.height}`);
            }
        }

        // Backgrounds
        const bgColor = cs.backgroundColor;
        if (bgColor && bgColor !== 'rgba(0, 0, 0, 0)' && bgColor !== 'transparent') {
            parts.push(`background-color:${bgColor}`);
        }
        const bgImg = cs.backgroundImage;
        if (bgImg && bgImg !== 'none') {
            const hasExtBg = /url\(\s*['"]?(?!data:|#)/i.test(bgImg);
            if (hasExtBg && !outFlags.externalBgUrls) {
                outFlags.hasExternalBgUrl = true;
            } else {
                if (hasExtBg) collectExternalCssUrls(bgImg);
                parts.push(`background-image:${bgImg}`);
                if (cs.backgroundSize && cs.backgroundSize !== 'auto') parts.push(`background-size:${cs.backgroundSize}`);
                if (cs.backgroundPosition && cs.backgroundPosition !== '0% 0%') parts.push(`background-position:${cs.backgroundPosition}`);
                if (cs.backgroundRepeat && cs.backgroundRepeat !== 'repeat') parts.push(`background-repeat:${cs.backgroundRepeat}`);
                if (cs.backgroundClip && cs.backgroundClip !== 'border-box') parts.push(`background-clip:${cs.backgroundClip}`);
            }
        }

        // Borders, border-image (custom CSS gradient <hr> etc.) & radius
        if (cs.borderTopWidth !== '0px' && cs.borderTopStyle !== 'none') {
            parts.push(`border-top:${cs.borderTopWidth} ${cs.borderTopStyle} ${cs.borderTopColor}`);
        }
        if (cs.borderRightWidth !== '0px' && cs.borderRightStyle !== 'none') {
            parts.push(`border-right:${cs.borderRightWidth} ${cs.borderRightStyle} ${cs.borderRightColor}`);
        }
        if (cs.borderBottomWidth !== '0px' && cs.borderBottomStyle !== 'none') {
            parts.push(`border-bottom:${cs.borderBottomWidth} ${cs.borderBottomStyle} ${cs.borderBottomColor}`);
        }
        if (cs.borderLeftWidth !== '0px' && cs.borderLeftStyle !== 'none') {
            parts.push(`border-left:${cs.borderLeftWidth} ${cs.borderLeftStyle} ${cs.borderLeftColor}`);
        }
        const borderImgSrc = cs.getPropertyValue('border-image-source');
        if (borderImgSrc && borderImgSrc !== 'none') {
            const hasExtBi = /url\(\s*['"]?(?!data:|#)/i.test(borderImgSrc);
            if (hasExtBi && !outFlags.externalBgUrls) {
                outFlags.hasExternalBgUrl = true;
            } else {
                if (hasExtBi) collectExternalCssUrls(borderImgSrc);
                parts.push(`border-image-source:${borderImgSrc}`);
                const biSlice = cs.getPropertyValue('border-image-slice');
                if (biSlice) parts.push(`border-image-slice:${biSlice}`);
                const biWidth = cs.getPropertyValue('border-image-width');
                if (biWidth) parts.push(`border-image-width:${biWidth}`);
                const biOutset = cs.getPropertyValue('border-image-outset');
                if (biOutset) parts.push(`border-image-outset:${biOutset}`);
                const biRepeat = cs.getPropertyValue('border-image-repeat');
                if (biRepeat) parts.push(`border-image-repeat:${biRepeat}`);
            }
        }
        if (cs.borderRadius && cs.borderRadius !== '0px') {
            parts.push(`border-radius:${cs.borderRadius}`);
        }

        // Text decoration
        const tdLine = cs.textDecorationLine;
        if (tdLine && tdLine !== 'none') {
            parts.push(`text-decoration-line:${tdLine}`);
            if (cs.textDecorationColor) parts.push(`text-decoration-color:${cs.textDecorationColor}`);
            if (cs.textDecorationStyle && cs.textDecorationStyle !== 'solid') parts.push(`text-decoration-style:${cs.textDecorationStyle}`);
            const tdThick = cs.getPropertyValue('text-decoration-thickness');
            if (tdThick && tdThick !== 'auto') parts.push(`text-decoration-thickness:${tdThick}`);
            const tdOff = cs.getPropertyValue('text-underline-offset');
            if (tdOff && tdOff !== 'auto') parts.push(`text-underline-offset:${tdOff}`);
        }

        // Visual effects, masks & overflow
        if (cs.boxShadow && cs.boxShadow !== 'none') parts.push(`box-shadow:${cs.boxShadow}`);
        if (cs.textShadow && cs.textShadow !== 'none') parts.push(`text-shadow:${cs.textShadow}`);
        if (cs.filter && cs.filter !== 'none') parts.push(`filter:${cs.filter}`);
        const elMaskImg = cs.getPropertyValue('-webkit-mask-image') || cs.getPropertyValue('mask-image');
        if (elMaskImg && elMaskImg !== 'none') {
            const hasExtMask = /url\(\s*['"]?(?!data:|#)/i.test(elMaskImg);
            if (!hasExtMask || outFlags.externalBgUrls) {
                if (hasExtMask) collectExternalCssUrls(elMaskImg);
                parts.push(`-webkit-mask-image:${elMaskImg}`, `mask-image:${elMaskImg}`);
                const elMaskSize = cs.getPropertyValue('-webkit-mask-size') || cs.getPropertyValue('mask-size');
                if (elMaskSize) parts.push(`-webkit-mask-size:${elMaskSize}`, `mask-size:${elMaskSize}`);
                const elMaskRep = cs.getPropertyValue('-webkit-mask-repeat') || cs.getPropertyValue('mask-repeat');
                if (elMaskRep) parts.push(`-webkit-mask-repeat:${elMaskRep}`, `mask-repeat:${elMaskRep}`);
                const elMaskPos = cs.getPropertyValue('-webkit-mask-position') || cs.getPropertyValue('mask-position');
                if (elMaskPos) parts.push(`-webkit-mask-position:${elMaskPos}`, `mask-position:${elMaskPos}`);
            }
        }
        if (!isRoot && cs.opacity && cs.opacity !== '1') parts.push(`opacity:${cs.opacity}`);
        if (cs.transform && cs.transform !== 'none') {
            parts.push(`transform:${cs.transform}`);
            if (cs.transformOrigin) parts.push(`transform-origin:${cs.transformOrigin}`);
        }
        // Never emit overflow: auto/scroll into static PDF captures (prevents browser scrollbars)
        if (cs.overflowX === 'hidden' || cs.overflowX === 'clip') parts.push('overflow-x:hidden');
        else if (tag === 'HR' && cs.overflowX === 'visible') parts.push('overflow-x:visible');
        if (cs.overflowY === 'hidden' || cs.overflowY === 'clip') parts.push('overflow-y:hidden');
        else if (tag === 'HR' && cs.overflowY === 'visible') parts.push('overflow-y:visible');
        if (cs.verticalAlign && cs.verticalAlign !== 'baseline') parts.push(`vertical-align:${cs.verticalAlign}`);
        if (cs.cssFloat && cs.cssFloat !== 'none') parts.push(`float:${cs.cssFloat}`);
        if (cs.clear && cs.clear !== 'none') parts.push(`clear:${cs.clear}`);

        // Positioning
        if (isPosNonStatic) {
            parts.push(`position:${cs.position}`);
            if (cs.top !== 'auto') parts.push(`top:${cs.top}`);
            if (cs.right !== 'auto') parts.push(`right:${cs.right}`);
            if (cs.bottom !== 'auto') parts.push(`bottom:${cs.bottom}`);
            if (cs.left !== 'auto') parts.push(`left:${cs.left}`);
            if (cs.zIndex && cs.zIndex !== 'auto') parts.push(`z-index:${cs.zIndex}`);
        }

        // Flex / Grid container & item properties
        if (display.includes('flex')) {
            if (cs.flexDirection !== 'row') parts.push(`flex-direction:${cs.flexDirection}`);
            if (cs.flexWrap !== 'nowrap') parts.push(`flex-wrap:${cs.flexWrap}`);
            if (cs.justifyContent !== 'normal') parts.push(`justify-content:${cs.justifyContent}`);
            if (cs.alignItems !== 'normal') parts.push(`align-items:${cs.alignItems}`);
            if (cs.alignContent !== 'normal') parts.push(`align-content:${cs.alignContent}`);
            if (cs.rowGap && cs.rowGap !== 'normal' && cs.rowGap !== '0px') parts.push(`row-gap:${cs.rowGap}`);
            if (cs.columnGap && cs.columnGap !== 'normal' && cs.columnGap !== '0px') parts.push(`column-gap:${cs.columnGap}`);
        } else if (display.includes('grid')) {
            if (cs.gridTemplateColumns && cs.gridTemplateColumns !== 'none') parts.push(`grid-template-columns:${cs.gridTemplateColumns}`);
            if (cs.gridTemplateRows && cs.gridTemplateRows !== 'none') parts.push(`grid-template-rows:${cs.gridTemplateRows}`);
            if (cs.justifyItems !== 'normal') parts.push(`justify-items:${cs.justifyItems}`);
            if (cs.alignItems !== 'normal') parts.push(`align-items:${cs.alignItems}`);
            if (cs.rowGap && cs.rowGap !== 'normal' && cs.rowGap !== '0px') parts.push(`row-gap:${cs.rowGap}`);
            if (cs.columnGap && cs.columnGap !== 'normal' && cs.columnGap !== '0px') parts.push(`column-gap:${cs.columnGap}`);
        }
        if (parentCs && (parentCs.display.includes('flex') || parentCs.display.includes('grid'))) {
            if (cs.flexGrow && cs.flexGrow !== '0') parts.push(`flex-grow:${cs.flexGrow}`);
            if (cs.flexShrink && cs.flexShrink !== '1') parts.push(`flex-shrink:${cs.flexShrink}`);
            if (cs.flexBasis && cs.flexBasis !== 'auto') parts.push(`flex-basis:${cs.flexBasis}`);
            if (cs.alignSelf && cs.alignSelf !== 'auto') parts.push(`align-self:${cs.alignSelf}`);
            if (cs.order && cs.order !== '0') parts.push(`order:${cs.order}`);
            if (parentCs.display.includes('grid')) {
                if (cs.gridColumn && cs.gridColumn !== 'auto') parts.push(`grid-column:${cs.gridColumn}`);
                if (cs.gridRow && cs.gridRow !== 'auto') parts.push(`grid-row:${cs.gridRow}`);
                if (cs.justifySelf && cs.justifySelf !== 'auto') parts.push(`justify-self:${cs.justifySelf}`);
            }
        }
        // Always emit list/table/caption overrides so browser UA rules (like `ul ul { list-style-type: circle }`
        // or `figcaption`/`table-caption` defaulting to `caption-side: top`) can never override computed styles
        if (tag === 'UL' || tag === 'OL' || tag === 'LI' || tag === 'MENU' || tag === 'DIR') {
            if (cs.listStyleType) parts.push(`list-style-type:${cs.listStyleType}`);
            if (cs.listStylePosition) parts.push(`list-style-position:${cs.listStylePosition}`);
        }
        if (tag === 'CAPTION' || tag === 'FIGCAPTION' || display === 'table-caption') {
            if (cs.captionSide) parts.push(`caption-side:${cs.captionSide}`);
        }
        if (tag === 'TH' || tag === 'TD' || tag === 'CAPTION' || tag === 'TABLE') {
            if (cs.textAlign) parts.push(`text-align:${normalizeTextAlign(cs.textAlign)}`);
        }
        if (tag === 'TH' || tag === 'TD') {
            if (cs.verticalAlign) parts.push(`vertical-align:${cs.verticalAlign}`);
        }
        if (tag === 'TABLE' || display === 'table' || display === 'inline-table') {
            if (cs.tableLayout && cs.tableLayout !== 'auto') parts.push(`table-layout:${cs.tableLayout}`);
            if (cs.borderCollapse) parts.push(`border-collapse:${cs.borderCollapse}`);
            if (cs.borderSpacing) parts.push(`border-spacing:${cs.borderSpacing}`);
        }
        if (cs.outlineStyle && cs.outlineStyle !== 'none' && cs.outlineWidth && cs.outlineWidth !== '0px') {
            parts.push(`outline:${cs.outlineWidth} ${cs.outlineStyle} ${cs.outlineColor}`);
            if (cs.outlineOffset && cs.outlineOffset !== '0px') parts.push(`outline-offset:${cs.outlineOffset}`);
        }

        return parts.join(';');
    }

    private buildPseudoElementNode(
        cs: CSSStyleDeclaration,
        parentCs: CSSStyleDeclaration,
        usedFontFamilies: Set<string>,
        parentTagUpper: string = '',
        externalBgUrls?: Set<string>
    ): HTMLElement | null {
        const content = cs.content;
        if (!content || content === 'none' || content === 'normal') return null;
        if (cs.display === 'none' || cs.visibility === 'hidden' || parseFloat(cs.opacity) === 0) return null;

        const text = this.unquoteCssContent(content);
        const w = parseFloat(cs.width) || 0;
        const h = parseFloat(cs.height) || 0;
        const hasBg = cs.backgroundColor && cs.backgroundColor !== 'rgba(0, 0, 0, 0)' && cs.backgroundColor !== 'transparent';
        const hasBgImg = cs.backgroundImage && cs.backgroundImage !== 'none';
        const hasBorder =
            (cs.borderTopWidth !== '0px' && cs.borderTopStyle !== 'none') ||
            (cs.borderRightWidth !== '0px' && cs.borderRightStyle !== 'none') ||
            (cs.borderBottomWidth !== '0px' && cs.borderBottomStyle !== 'none') ||
            (cs.borderLeftWidth !== '0px' && cs.borderLeftStyle !== 'none');
        const hasPadding =
            cs.paddingTop !== '0px' ||
            cs.paddingRight !== '0px' ||
            cs.paddingBottom !== '0px' ||
            cs.paddingLeft !== '0px';
        if (!text && !hasBg && !hasBgImg && !hasBorder && !hasPadding && w <= 0 && h <= 0) return null;

        const span = createSpan();
        if (text) span.textContent = text;
        const flags = { hasExternalBgUrl: false, externalBgUrls };
        const styleText = this.serializeElementStyleForForeignObject(span, cs, parentCs, usedFontFamilies, false, flags);
        const extra: string[] = styleText ? [styleText] : [];
        const isParentMathJax = parentTagUpper.startsWith('MJX-');
        // Preserve explicit width:0px on MathJax CHTML glyphs (mjx-c::before uses width:0 + padding-right for glyph advance)
        const needsZeroWidth = cs.width === '0px' && (
            isParentMathJax ||
            cs.paddingRight !== '0px' ||
            cs.paddingLeft !== '0px' ||
            cs.borderLeftWidth !== '0px' ||
            cs.borderRightWidth !== '0px'
        );
        if ((w > 0 || needsZeroWidth) && !/(?:^|;)width:/.test(styleText)) extra.push(`width:${cs.width}`);
        if ((h > 0 || (isParentMathJax && cs.height === '0px')) && !/(?:^|;)height:/.test(styleText)) extra.push(`height:${cs.height}`);
        const maskImg = cs.getPropertyValue('-webkit-mask-image') || cs.getPropertyValue('mask-image');
        if (maskImg && maskImg !== 'none' && /url\(\s*['"]?data:/i.test(maskImg) && !/(?:^|;)mask-image:/.test(styleText)) {
            extra.push(`-webkit-mask-image:${maskImg}`, `mask-image:${maskImg}`);
            const maskSize = cs.getPropertyValue('-webkit-mask-size') || cs.getPropertyValue('mask-size');
            if (maskSize) extra.push(`-webkit-mask-size:${maskSize}`, `mask-size:${maskSize}`);
            const maskRep = cs.getPropertyValue('-webkit-mask-repeat') || cs.getPropertyValue('mask-repeat');
            if (maskRep) extra.push(`-webkit-mask-repeat:${maskRep}`, `mask-repeat:${maskRep}`);
        }
        span.setAttribute('style', extra.join(';'));
        return span;
    }

    /**
     * Ultra-fast native browser rasterizer using SVG <foreignObject> + Blink/Skia directly on an
     * opaque Canvas 2D buffer (colorType=2 RGB PNG for instant jsPDF embedding).
     * Automatically falls back to html2canvas if the page contains unsupported elements (iframes,
     * un-slotted external images) or if the platform WebView taints/blocks SVG <foreignObject>.
     */
    private async captureElementViaForeignObject(
        targetEl: HTMLElement,
        widthPx: number,
        bgHex: string,
        bgRgb: number[],
        scale: number,
        customFontCss: string,
        colorCache: Map<string, string>,
        imageCanvasesById?: Map<string, HTMLCanvasElement>,
        maxAllowedHeightPx?: number
    ): Promise<HTMLCanvasElement | null> {
        if (this.foreignObjectSupported === false) return null;

        // Fast compatibility pre-scan: fall back to html2canvas for pages with iframes or un-slotted external <img>
        if (targetEl.querySelector('iframe')) return null;
        const imgs = targetEl.querySelectorAll('img');
        for (let i = 0; i < imgs.length; i++) {
            const src = imgs[i].getAttribute('src') || '';
            if (src && !src.startsWith('data:')) return null;
        }

        const rect = targetEl.getBoundingClientRect();
        const rawHeightPx = Math.max(1, Math.ceil(Math.max(rect.height, targetEl.scrollHeight)));
        const heightPx = maxAllowedHeightPx && rawHeightPx < maxAllowedHeightPx
            ? Math.min(maxAllowedHeightPx, rawHeightPx + 4)
            : rawHeightPx;
        const usedFontFamilies = new Set<string>();
        const flags = { hasExternalBgUrl: false, externalBgUrls: new Set<string>() };

        const cloneNodeRecursive = (node: Node, parentCs: CSSStyleDeclaration | null, isRoot: boolean): Node | null => {
            if (node.nodeType === Node.TEXT_NODE) {
                const rawText = node.textContent || '';
                // Strip invalid XML 1.0 control characters so SVG XHTML serialization never fails silently
                let hasBadCtrl = false;
                for (let cIdx = 0; cIdx < rawText.length; cIdx++) {
                    const code = rawText.charCodeAt(cIdx);
                    if (code < 0x20 && code !== 0x09 && code !== 0x0A && code !== 0x0D) {
                        hasBadCtrl = true;
                        break;
                    }
                }
                if (!hasBadCtrl) {
                    return activeDocument.createTextNode(rawText);
                }
                let safeText = '';
                for (let cIdx = 0; cIdx < rawText.length; cIdx++) {
                    const code = rawText.charCodeAt(cIdx);
                    if (code >= 0x20 || code === 0x09 || code === 0x0A || code === 0x0D) {
                        safeText += rawText[cIdx];
                    }
                }
                return activeDocument.createTextNode(safeText);
            }
            if (node.nodeType !== Node.ELEMENT_NODE) return null;

            const el = node as Element;
            const tagUpper = el.tagName.toUpperCase();
            if (tagUpper === 'STYLE' || tagUpper === 'SCRIPT' || tagUpper === 'NOSCRIPT' || tagUpper === 'LINK') {
                return null;
            }

            if (el.instanceOf(SVGElement)) {
                const svgCs = window.getComputedStyle(el);
                if (svgCs.display === 'none' || svgCs.visibility === 'hidden' || parseFloat(svgCs.opacity) === 0) {
                    return null;
                }
                return this.cloneSvgForForeignObject(el, window, usedFontFamilies);
            }

            const htmlEl = el as HTMLElement;
            if (!isRoot && htmlEl.matches(PdfPlugin.PDF_EXCLUDED_UI_SELECTOR)) {
                return null;
            }
            const cs = window.getComputedStyle(htmlEl);
            if (!isRoot && (cs.display === 'none' || parseFloat(cs.opacity) === 0)) {
                return null;
            }

            // Replace checkboxes with crisp vector SVG spans (identical to html2canvas path)
            if (tagUpper === 'INPUT' && (htmlEl as HTMLInputElement).type === 'checkbox') {
                if (cs.visibility === 'hidden') return null;
                return this.buildVectorCheckboxElement(htmlEl as HTMLInputElement, cs, activeDocument, colorCache);
            }

            // Convert <canvas> elements to inline data:image/png <img>
            if (tagUpper === 'CANVAS') {
                try {
                    const dataUrl = (htmlEl as HTMLCanvasElement).toDataURL('image/png');
                    const img = createEl('img');
                    img.setAttribute('src', dataUrl);
                    const cRect = htmlEl.getBoundingClientRect();
                    img.setAttribute('style', `display:${cs.display || 'inline-block'};width:${cRect.width || widthPx}px;height:${cRect.height || 1}px;`);
                    return img;
                } catch {
                    return null;
                }
            }

            const tagLower = htmlEl.tagName.toLowerCase();
            // Clone <hr> as <div> so materialized ::before/::after CSS ornaments (stars, gradients) render cleanly
            // inside XHTML <foreignObject> without void-element clipping or Chromium UA overflow:hidden.
            const safeTag = tagUpper === 'HR' ? 'div' : (/^[a-z][a-z0-9-]*$/.test(tagLower) ? tagLower : 'div');
            const cloned = createEl(safeTag as keyof HTMLElementTagNameMap);

            // Copy essential structural HTML attributes only
            if (tagUpper === 'OL' && htmlEl.hasAttribute('start')) cloned.setAttribute('start', htmlEl.getAttribute('start') || '');
            if (tagUpper === 'LI' && htmlEl.hasAttribute('value')) cloned.setAttribute('value', htmlEl.getAttribute('value') || '');
            if ((tagUpper === 'TD' || tagUpper === 'TH') && htmlEl.hasAttribute('colspan')) cloned.setAttribute('colspan', htmlEl.getAttribute('colspan') || '');
            if ((tagUpper === 'TD' || tagUpper === 'TH') && htmlEl.hasAttribute('rowspan')) cloned.setAttribute('rowspan', htmlEl.getAttribute('rowspan') || '');
            if (tagUpper === 'IMG' && htmlEl.hasAttribute('src')) cloned.setAttribute('src', htmlEl.getAttribute('src') || '');
            if (htmlEl.hasAttribute('dir')) cloned.setAttribute('dir', htmlEl.getAttribute('dir') || '');
            if (htmlEl.hasAttribute('lang')) cloned.setAttribute('lang', htmlEl.getAttribute('lang') || '');

            let styleText = this.serializeElementStyleForForeignObject(htmlEl, cs, parentCs, usedFontFamilies, isRoot, flags);
            if (flags.hasExternalBgUrl) return null;
            if (isRoot) {
                styleText = `${styleText};width:${widthPx}px;min-height:${heightPx}px;margin:0;background-color:${bgHex};overflow:hidden;`;
            }
            if (styleText) {
                cloned.setAttribute('style', styleText);
            }

            // Materialize visible ::before pseudo-element
            const beforeCs = window.getComputedStyle(htmlEl, '::before');
            const beforeNode = this.buildPseudoElementNode(beforeCs, cs, usedFontFamilies, tagUpper, flags.externalBgUrls);
            if (beforeNode) cloned.appendChild(beforeNode);

            // Recurse children
            const children = htmlEl.childNodes;
            for (let i = 0; i < children.length; i++) {
                const childClone = cloneNodeRecursive(children[i], cs, false);
                if (flags.hasExternalBgUrl) return null;
                if (childClone) cloned.appendChild(childClone);
            }

            // Materialize visible ::after pseudo-element
            const afterCs = window.getComputedStyle(htmlEl, '::after');
            const afterNode = this.buildPseudoElementNode(afterCs, cs, usedFontFamilies, tagUpper, flags.externalBgUrls);
            if (afterNode) cloned.appendChild(afterNode);

            return cloned;
        };

        const clonedRoot = cloneNodeRecursive(targetEl, null, true) as HTMLElement | null;
        if (!clonedRoot || flags.hasExternalBgUrl) return null;

        // Inline any non-data CSS url(...) references (e.g. Obsidian's a.external-link icon) as data: URIs
        // so pages containing external links stay on the crisp native <foreignObject> path instead of falling back to html2canvas.
        if (flags.externalBgUrls.size > 0) {
            const urlMap = new Map<string, string>();
            await Promise.all(
                Array.from(flags.externalBgUrls).map(async (rawUrl) => {
                    let resolved = rawUrl;
                    try {
                        resolved = new URL(rawUrl, window.location.href).href;
                    } catch {
                        // keep rawUrl
                    }
                    const dataUrl = await this.fetchUrlAsDataUrl(resolved);
                    urlMap.set(rawUrl, dataUrl);
                })
            );
            const rewriteStyleUrls = (el: Element) => {
                const st = el.getAttribute('style');
                if (!st || !st.includes('url(')) return;
                const updated = st.replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/gi, (full: string, _q: string, inner?: string) => {
                    const raw = (inner || '').trim();
                    if (!raw || raw.startsWith('data:') || raw.startsWith('#')) return full;
                    const dataUrl = urlMap.get(raw);
                    return dataUrl ? `url("${dataUrl}")` : 'none';
                });
                if (updated !== st) el.setAttribute('style', updated);
            };
            rewriteStyleUrls(clonedRoot);
            const styledEls = clonedRoot.querySelectorAll('[style*="url("]');
            for (let i = 0; i < styledEls.length; i++) {
                rewriteStyleUrls(styledEls[i]);
            }
        }

        clonedRoot.setAttribute('xmlns', 'http://www.w3.org/1999/xhtml');

        const fontFaceCss = await this.getInlinedDocumentFontFaceCss(usedFontFamilies, customFontCss);
        const svgNS = 'http://www.w3.org/2000/svg';
        const svg = activeDocument.createElementNS(svgNS, 'svg');
        svg.setAttribute('xmlns', svgNS);
        svg.setAttribute('width', `${widthPx}`);
        svg.setAttribute('height', `${heightPx}`);
        svg.setAttribute('viewBox', `0 0 ${widthPx} ${heightPx}`);

        const styleNode = activeDocument.createElementNS(svgNS, 'style');
        styleNode.textContent = `${PdfPlugin.FO_RESET_CSS}\n${fontFaceCss}`;
        svg.appendChild(styleNode);

        const fo = activeDocument.createElementNS(svgNS, 'foreignObject');
        fo.setAttribute('x', '0');
        fo.setAttribute('y', '0');
        fo.setAttribute('width', `${widthPx}`);
        fo.setAttribute('height', `${heightPx}`);
        fo.appendChild(clonedRoot);
        svg.appendChild(fo);

        let svgString: string;
        try {
            svgString = new XMLSerializer().serializeToString(svg);
        } catch {
            return null;
        }

        const svgDataUrl = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svgString)}`;
        const img = await new Promise<HTMLImageElement | null>((resolve) => {
            const image = new Image();
            let done = false;
            const finish = (res: HTMLImageElement | null) => {
                if (done) return;
                done = true;
                window.clearTimeout(timer);
                resolve(res);
            };
            const timer = window.setTimeout(() => finish(null), 8000);
            image.onload = () => finish(image.naturalWidth > 0 ? image : null);
            image.onerror = () => finish(null);
            image.src = svgDataUrl;
        });

        if (!img) {
            if (this.foreignObjectSupported === null) {
                this.foreignObjectSupported = false;
            }
            return null;
        }

        // Wait for Blink/Skia to complete SVG <foreignObject> & embedded @font-face decode before drawing
        if (typeof img.decode === 'function') {
            await Promise.race([
                img.decode().catch(() => {}),
                new Promise<void>(r => window.setTimeout(r, 1500))
            ]);
        }

        const canvas = createEl('canvas');
        canvas.width = Math.max(1, Math.round(widthPx * scale));
        canvas.height = Math.max(1, Math.round(heightPx * scale));
        const ctx = canvas.getContext('2d', { alpha: false });
        if (!ctx) {
            canvas.width = 0;
            canvas.height = 0;
            return null;
        }

        const trimmedTextLen = (targetEl.textContent || '').trim().length;
        const hasImageSlots = !!targetEl.querySelector('[data-pdf-img-id]');
        const expectsPaintedPixels =
            trimmedTextLen > 0 ||
            !!targetEl.querySelector('svg, hr, table, canvas, input, .pdf-vector-checkbox');

        ctx.fillStyle = bgHex;
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        try {
            ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
            // Verify canvas is not tainted (catches iOS WKWebView / strict WebViews immediately)
            ctx.getImageData(0, 0, 1, 1);

            // Verify EVERY page with visible DOM content actually painted non-background pixels.
            // Prevents transient Chromium/WebView <foreignObject> paint drops (e.g. under memory pressure
            // or delayed SVG @font-face decode on late pages of long documents) from emitting solid blank pages.
            if (expectsPaintedPixels) {
                let painted = this.canvasHasNonBgPixels(ctx, canvas.width, canvas.height, bgRgb);
                if (!painted) {
                    // Single fast retry after yielding a paint frame in case SVG font/layout commit lagged
                    await this.yieldFrameSafe(40);
                    ctx.fillStyle = bgHex;
                    ctx.fillRect(0, 0, canvas.width, canvas.height);
                    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
                    painted = this.canvasHasNonBgPixels(ctx, canvas.width, canvas.height, bgRgb);
                }
                if (!painted) {
                    if (this.foreignObjectSupported === null && trimmedTextLen > 10 && !hasImageSlots) {
                        this.foreignObjectSupported = false;
                    }
                    canvas.width = 0;
                    canvas.height = 0;
                    return null;
                }
                if (this.foreignObjectSupported === null && trimmedTextLen > 10 && !hasImageSlots) {
                    this.foreignObjectSupported = true;
                }
            }
        } catch {
            this.foreignObjectSupported = false;
            canvas.width = 0;
            canvas.height = 0;
            return null;
        }

        if (imageCanvasesById && imageCanvasesById.size > 0) {
            this.compositeImagesOntoCanvas(canvas, targetEl, scale, imageCanvasesById);
        }

        return canvas;
    }

    /**
     * Samples horizontal scanlines across a rendered page canvas to verify that at least some pixels
     * differ from the uniform page background color (detects silent blank-canvas rasterization drops).
     */
    private canvasHasNonBgPixels(
        ctx: CanvasRenderingContext2D,
        width: number,
        height: number,
        bgRgb: number[]
    ): boolean {
        if (width <= 0 || height <= 0) return false;
        const sampleRows = Math.min(height, 24);
        const stepBytes = 12; // every 3rd pixel (RGBA = 4 bytes)
        for (let r = 1; r <= sampleRows; r++) {
            const sy = Math.min(height - 1, Math.floor((height * r) / (sampleRows + 1)));
            const rowData = ctx.getImageData(0, sy, width, 1).data;
            for (let px = 0; px < rowData.length; px += stepBytes) {
                if (
                    Math.abs(rowData[px] - bgRgb[0]) > 6 ||
                    Math.abs(rowData[px + 1] - bgRgb[1]) > 6 ||
                    Math.abs(rowData[px + 2] - bgRgb[2]) > 6
                ) {
                    return true;
                }
            }
        }
        return false;
    }

    /**
     * Ensures a canvas has an opaque 2D context (alpha: false) so Chromium encodes a 24-bit RGB PNG
     * (colorType=2), letting jsPDF embed the compressed IDAT stream directly (~100x faster than RGBA PNG).
     */
    private toOpaqueCanvas(src: HTMLCanvasElement, bgHex: string): HTMLCanvasElement {
        const opaque = createEl('canvas');
        opaque.width = src.width;
        opaque.height = src.height;
        const ctx = opaque.getContext('2d', { alpha: false });
        if (ctx) {
            ctx.fillStyle = bgHex;
            ctx.fillRect(0, 0, opaque.width, opaque.height);
            ctx.drawImage(src, 0, 0);
        }
        return opaque;
    }

    private async captureElementToCanvas(
        targetEl: HTMLElement,
        renderRoot: HTMLElement,
        bgHex: string,
        scale: number,
        widthPx: number,
        colorCache: Map<string, string>,
        fontCache: Map<string, string>,
        imageCanvasesById?: Map<string, HTMLCanvasElement>
    ): Promise<HTMLCanvasElement> {
        this.sanitizePageForHtml2Canvas(targetEl, window, colorCache, fontCache);
        const pageCanvas = await html2canvas(targetEl, {
            backgroundColor: bgHex,
            scale,
            logging: false,
            useCORS: true,
            allowTaint: true,
            width: widthPx,
            windowWidth: widthPx,
            ignoreElements: (el) => {
                const parent = el.parentElement;
                if (parent === activeDocument.body) return el !== renderRoot;
                if (parent === renderRoot) return el !== targetEl && !el.contains(targetEl);
                if (parent === activeDocument.head) {
                    const tag = el.tagName;
                    if (tag === 'META' || tag === 'TITLE' || tag === 'BASE' || tag === 'NOSCRIPT' || tag === 'SCRIPT') return true;
                    if (tag === 'LINK' && (el.getAttribute('rel') || '').toLowerCase() !== 'stylesheet') return true;
                    if (tag === 'STYLE') {
                        const styleNode = el as HTMLStyleElement;
                        if (styleNode.sheet?.disabled || (styleNode.media && styleNode.media.toLowerCase() === 'print')) return true;
                    }
                }
                return false;
            },
            onclone: (clonedDoc, clonedEl) => {
                this.sanitizeClonedDocForHtml2Canvas(clonedDoc, clonedEl, bgHex, colorCache, fontCache);
            }
        });

        // Composite pre-decoded image canvases directly onto pageCanvas at exact slot coordinates.
        // IMPORTANT: html2canvas leaves ctx.scale(scale, scale) and ctx.translate(-options.x, -options.y)
        // active on pageCanvas's 2D context, so reset to identity before drawing pixel coordinates.
        if (imageCanvasesById && imageCanvasesById.size > 0) {
            this.compositeImagesOntoCanvas(pageCanvas, targetEl, scale, imageCanvasesById);
        }

        return pageCanvas;
    }

    private parseCssObjectPositionAxis(token: string | undefined, defaultFrac: number): number {
        if (!token) return defaultFrac;
        const lower = token.trim().toLowerCase();
        if (lower === 'left' || lower === 'top') return 0;
        if (lower === 'center') return 0.5;
        if (lower === 'right' || lower === 'bottom') return 1;
        if (lower.endsWith('%')) {
            const pct = parseFloat(lower);
            if (Number.isFinite(pct)) return Math.max(0, Math.min(1, pct / 100));
        }
        return defaultFrac;
    }

    private compositeImagesOntoCanvas(
        canvas: HTMLCanvasElement,
        targetEl: HTMLElement,
        scale: number,
        imageCanvasesById: Map<string, HTMLCanvasElement>
    ): void {
        const slots = Array.from(targetEl.querySelectorAll<HTMLElement>('[data-pdf-img-id]'));
        if (slots.length === 0) return;
        const pageCtx = canvas.getContext('2d');
        if (!pageCtx) return;
        const targetRect = targetEl.getBoundingClientRect();
        pageCtx.save();
        pageCtx.setTransform(1, 0, 0, 1, 0, 0);
        pageCtx.globalAlpha = 1;
        pageCtx.globalCompositeOperation = 'source-over';
        for (const slot of slots) {
            const imgId = slot.getAttribute('data-pdf-img-id');
            const srcCanvas = imgId ? imageCanvasesById.get(imgId) : undefined;
            if (!srcCanvas || srcCanvas.width <= 0 || srcCanvas.height <= 0) continue;
            const slotRect = slot.getBoundingClientRect();
            if (slotRect.width <= 0 || slotRect.height <= 0) continue;

            const dx = Math.round((slotRect.left - targetRect.left) * scale);
            const dy = Math.round((slotRect.top - targetRect.top) * scale);
            const dw = Math.max(1, Math.round(slotRect.width * scale));
            const dh = Math.max(1, Math.round(slotRect.height * scale));

            // Respect ancestor overflow:hidden / overflow:clip containers (e.g. carousels, grids, cards)
            let clipLeft = 0;
            let clipTop = 0;
            let clipRight = canvas.width;
            let clipBottom = canvas.height;
            let hasAncestorClip = false;
            let anc = slot.parentElement;
            while (anc && anc !== targetEl) {
                const aCs = window.getComputedStyle(anc);
                const clipX = aCs.overflowX === 'hidden' || aCs.overflowX === 'clip';
                const clipY = aCs.overflowY === 'hidden' || aCs.overflowY === 'clip';
                if (clipX || clipY) {
                    const aRect = anc.getBoundingClientRect();
                    if (clipX) {
                        clipLeft = Math.max(clipLeft, Math.round((aRect.left - targetRect.left) * scale));
                        clipRight = Math.min(clipRight, Math.round((aRect.right - targetRect.left) * scale));
                    }
                    if (clipY) {
                        clipTop = Math.max(clipTop, Math.round((aRect.top - targetRect.top) * scale));
                        clipBottom = Math.min(clipBottom, Math.round((aRect.bottom - targetRect.top) * scale));
                    }
                    hasAncestorClip = true;
                }
                anc = anc.parentElement;
            }
            if (hasAncestorClip && (clipRight <= clipLeft || clipBottom <= clipTop)) continue;

            const objectFit = (slot.getAttribute('data-pdf-object-fit') || 'fill').toLowerCase();
            const rawObjPos = slot.getAttribute('data-pdf-object-position') || '50% 50%';
            const posParts = rawObjPos.trim().split(/\s+/);
            const posX = this.parseCssObjectPositionAxis(posParts[0], 0.5);
            const posY = this.parseCssObjectPositionAxis(posParts[1] ?? posParts[0], 0.5);

            const radiusAttr = slot.getAttribute('data-pdf-border-radius') || window.getComputedStyle(slot).borderRadius || '';
            const parsedRadiusPx = parseFloat(radiusAttr);
            const cornerRadius = Number.isFinite(parsedRadiusPx) && parsedRadiusPx > 0.5
                ? Math.min(parsedRadiusPx * scale, dw / 2, dh / 2)
                : 0;

            const needsSave = hasAncestorClip || cornerRadius > 0 || objectFit === 'none' || objectFit === 'scale-down';
            if (needsSave) {
                pageCtx.save();
                if (hasAncestorClip) {
                    pageCtx.beginPath();
                    pageCtx.rect(clipLeft, clipTop, clipRight - clipLeft, clipBottom - clipTop);
                    pageCtx.clip();
                }
                if (cornerRadius > 0) {
                    const r = cornerRadius;
                    pageCtx.beginPath();
                    pageCtx.moveTo(dx + r, dy);
                    pageCtx.lineTo(dx + dw - r, dy);
                    pageCtx.quadraticCurveTo(dx + dw, dy, dx + dw, dy + r);
                    pageCtx.lineTo(dx + dw, dy + dh - r);
                    pageCtx.quadraticCurveTo(dx + dw, dy + dh, dx + dw - r, dy + dh);
                    pageCtx.lineTo(dx + r, dy + dh);
                    pageCtx.quadraticCurveTo(dx, dy + dh, dx, dy + dh - r);
                    pageCtx.lineTo(dx, dy + r);
                    pageCtx.quadraticCurveTo(dx, dy, dx + r, dy);
                    pageCtx.closePath();
                    pageCtx.clip();
                } else if (objectFit === 'none' || objectFit === 'scale-down') {
                    pageCtx.beginPath();
                    pageCtx.rect(dx, dy, dw, dh);
                    pageCtx.clip();
                }
            }

            const srcW = srcCanvas.width;
            const srcH = srcCanvas.height;
            const srcAspect = srcW / srcH;
            const dstAspect = dw / dh;

            if (objectFit === 'contain') {
                let drawW = dw;
                let drawH = dh;
                if (srcAspect > dstAspect) {
                    drawH = Math.max(1, Math.round(dw / srcAspect));
                } else {
                    drawW = Math.max(1, Math.round(dh * srcAspect));
                }
                const offX = Math.round((dw - drawW) * posX);
                const offY = Math.round((dh - drawH) * posY);
                pageCtx.drawImage(srcCanvas, 0, 0, srcW, srcH, dx + offX, dy + offY, drawW, drawH);
            } else if (objectFit === 'cover') {
                let sx = 0;
                let sy = 0;
                let sw = srcW;
                let sh = srcH;
                if (srcAspect > dstAspect) {
                    sw = Math.max(1, srcH * dstAspect);
                    sx = (srcW - sw) * posX;
                } else {
                    sh = Math.max(1, srcW / dstAspect);
                    sy = (srcH - sh) * posY;
                }
                pageCtx.drawImage(srcCanvas, sx, sy, sw, sh, dx, dy, dw, dh);
            } else if (objectFit === 'none' || objectFit === 'scale-down') {
                const natW = parseFloat(slot.getAttribute('data-pdf-nat-w') || '0') || srcW;
                const natH = parseFloat(slot.getAttribute('data-pdf-nat-h') || '0') || srcH;
                let drawW = Math.max(1, Math.round(natW * scale));
                let drawH = Math.max(1, Math.round(natH * scale));
                if (objectFit === 'scale-down' && (drawW > dw || drawH > dh)) {
                    if (srcAspect > dstAspect) {
                        drawW = dw;
                        drawH = Math.max(1, Math.round(dw / srcAspect));
                    } else {
                        drawH = dh;
                        drawW = Math.max(1, Math.round(dh * srcAspect));
                    }
                }
                const offX = Math.round((dw - drawW) * posX);
                const offY = Math.round((dh - drawH) * posY);
                pageCtx.drawImage(srcCanvas, 0, 0, srcW, srcH, dx + offX, dy + offY, drawW, drawH);
            } else {
                pageCtx.drawImage(srcCanvas, 0, 0, srcW, srcH, dx, dy, dw, dh);
            }

            if (needsSave) {
                pageCtx.restore();
            }
        }
        pageCtx.restore();
    }

    /**
     * Strips leading YAML frontmatter and returns the remaining markdown plus the number of stripped lines.
     */
    private stripYamlFrontmatter(content: string): { markdown: string; frontmatterLineCount: number } {
        const lines = content.split('\n');
        if (lines.length > 0 && lines[0].trim() === '---') {
            for (let i = 1; i < lines.length; i++) {
                if (lines[i].trim() === '---' || lines[i].trim() === '...') {
                    return {
                        markdown: lines.slice(i + 1).join('\n'),
                        frontmatterLineCount: i + 1
                    };
                }
            }
        }
        return { markdown: content, frontmatterLineCount: 0 };
    }

    /**
     * Parses leading YAML Frontmatter (Obsidian Properties) and renders it as a clean,
     * theme-aware Properties card suitable for Page 1 of the PDF.
     */
    private buildFrontmatterElement(rawContent: string, parent: HTMLElement): HTMLElement | null {
        const lines = rawContent.split('\n');
        if (lines.length < 2 || lines[0].trim() !== '---') return null;

        let endIdx = -1;
        for (let i = 1; i < lines.length; i++) {
            const t = lines[i].trim();
            if (t === '---' || t === '...') {
                endIdx = i;
                break;
            }
        }
        if (endIdx <= 1) return null;

        const yamlBody = lines.slice(1, endIdx).join('\n').trim();
        if (!yamlBody) return null;

        let parsedObj: Record<string, unknown> | null = null;
        try {
            const parsed: unknown = parseYaml(yamlBody);
            if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
                parsedObj = parsed as Record<string, unknown>;
            }
        } catch {
            // Fallback simple key: value parser for slightly malformed YAML
            const fallback: Record<string, unknown> = {};
            for (const line of lines.slice(1, endIdx)) {
                const m = line.match(/^([^:#]+):\s*(.*)$/);
                if (m) {
                    const k = m[1].trim();
                    const v = m[2].trim();
                    if (k) fallback[k] = v;
                }
            }
            if (Object.keys(fallback).length > 0) {
                parsedObj = fallback;
            }
        }

        if (!parsedObj) return null;
        const entries = Object.entries(parsedObj).filter(([, val]) => val !== undefined && val !== null && val !== '');
        if (entries.length === 0) return null;

        const card = parent.createDiv({ cls: 'pdf-frontmatter-card' });
        card.createDiv({ cls: 'pdf-frontmatter-title', text: 'Properties' });
        const grid = card.createDiv({ cls: 'pdf-frontmatter-grid' });

        for (const [key, value] of entries) {
            const row = grid.createDiv({ cls: 'pdf-frontmatter-row' });
            row.createDiv({ cls: 'pdf-frontmatter-key', text: key });
            const valCell = row.createDiv({ cls: 'pdf-frontmatter-val' });

            if (Array.isArray(value)) {
                const filtered = value.filter(v => v !== undefined && v !== null && (typeof v === 'object' ? JSON.stringify(v) : String(v)).trim() !== '');
                if (filtered.length === 0) {
                    valCell.textContent = '—';
                } else {
                    for (const item of filtered) {
                        const text = typeof item === 'object' ? JSON.stringify(item) : String(item);
                        valCell.createSpan({ cls: 'pdf-frontmatter-pill', text });
                    }
                }
            } else if (typeof value === 'boolean') {
                valCell.createSpan({ cls: 'pdf-frontmatter-pill', text: value ? 'true' : 'false' });
            } else if (value instanceof Date) {
                valCell.textContent = moment(value).format(this.settings.footnoteDateFormat || 'YYYY-MM-DD');
            } else if (typeof value === 'object') {
                valCell.textContent = JSON.stringify(value);
            } else if (typeof value === 'string' || typeof value === 'number' || typeof value === 'bigint') {
                valCell.textContent = String(value);
            } else {
                valCell.textContent = '';
            }
        }

        return card;
    }

    /**
     * Splits markdown at exact 1-indexed line numbers from the Page Breaks setting,
     * safely closing/reopening fenced code blocks when a break lands inside one.
     */
    private splitMarkdownByPageBreaks(
        contentWithoutYaml: string,
        frontmatterLineCount: number,
        breakLines: number[]
    ): MarkdownSegment[] {
        const lines = contentWithoutYaml.split('\n');
        if (breakLines.length === 0) {
            const firstLine = frontmatterLineCount + 1;
            return [{
                markdown: contentWithoutYaml,
                startLine: firstLine,
                endLine: firstLine + lines.length - 1,
                forceBreakBefore: false
            }];
        }

        const breakSet = new Set(breakLines);
        const segments: MarkdownSegment[] = [];
        let currentLines: string[] = [];
        let segStartLine = frontmatterLineCount + 1;
        let openFenceLine: string | null = null;
        let openFenceMarker: string | null = null;

        for (let idx = 0; idx < lines.length; idx++) {
            const lineNum = frontmatterLineCount + 1 + idx;
            const line = lines[idx];

            if (breakSet.has(lineNum) && currentLines.length > 0) {
                const segLines = [...currentLines];
                if (openFenceMarker) {
                    segLines.push(openFenceMarker);
                }
                segments.push({
                    markdown: segLines.join('\n'),
                    startLine: segStartLine,
                    endLine: lineNum - 1,
                    forceBreakBefore: segments.length > 0
                });

                currentLines = [];
                segStartLine = lineNum;
                if (openFenceLine) {
                    currentLines.push(openFenceLine);
                }
            }

            currentLines.push(line);

            const fenceMatch = line.match(/^(\s*)(`{3,}|~{3,})(.*)$/);
            if (fenceMatch) {
                const marker = fenceMatch[2];
                if (!openFenceMarker) {
                    openFenceLine = line;
                    openFenceMarker = marker;
                } else if (marker[0] === openFenceMarker[0] && marker.length >= openFenceMarker.length && fenceMatch[3].trim() === '') {
                    openFenceLine = null;
                    openFenceMarker = null;
                }
            }
        }

        if (currentLines.length > 0 || segments.length === 0) {
            segments.push({
                markdown: currentLines.join('\n'),
                startLine: segStartLine,
                endLine: frontmatterLineCount + lines.length,
                forceBreakBefore: segments.length > 0
            });
        }

        return segments;
    }

    /**
     * Maps rendered top-level DOM elements to 1-indexed editor line numbers using Obsidian's metadataCache sections.
     */
    private buildBlockItems(
        sizerEl: HTMLElement,
        file: TFile,
        segment: MarkdownSegment
    ): BlockItem[] {
        const rawChildren = Array.from(sizerEl.children).filter(
            (el): el is HTMLElement => el.instanceOf(HTMLElement) && el.tagName !== 'STYLE'
        );

        const sections: SectionCache[] = (this.app.metadataCache.getFileCache(file)?.sections || []).filter(s => {
            if (s.type === 'yaml' || s.type === 'comment' || s.type === 'footnoteDefinition') return false;
            const sLine = s.position.start.line + 1;
            return sLine >= segment.startLine && sLine <= segment.endLine;
        });

        const items: BlockItem[] = [];
        let sectionCursor = 0;
        const fallbackTotalLines = Math.max(1, segment.endLine - segment.startLine + 1);
        let appliedSegmentBreak = false;

        for (let idx = 0; idx < rawChildren.length; idx++) {
            const el = rawChildren[idx];
            if (el.classList.contains('pdf-export-title') || el.classList.contains('mod-header')) {
                items.push({ el, startLine: 1, endLine: 1, isTitle: true });
                continue;
            }

            let line: number;
            let endLine: number;
            if (sectionCursor < sections.length) {
                const sec = sections[sectionCursor];
                line = sec.position.start.line + 1;
                endLine = Math.max(line, sec.position.end.line + 1);
                sectionCursor++;
            } else {
                const progress = rawChildren.length > 1 ? idx / rawChildren.length : 0;
                line = segment.startLine + Math.floor(progress * fallbackTotalLines);
                endLine = line;
            }

            const forceBreak = segment.forceBreakBefore && !appliedSegmentBreak;
            appliedSegmentBreak = true;

            items.push({ el, startLine: line, endLine, forceBreakBefore: forceBreak });
        }

        return items;
    }

    private isSplittableNode(el: HTMLElement): boolean {
        const tag = el.tagName;
        return tag === 'UL'
            || tag === 'OL'
            || tag === 'TABLE'
            || tag === 'PRE'
            || tag === 'BLOCKQUOTE'
            || tag === 'P'
            || el.classList.contains('callout');
    }

    private unwrapSplittableContainer(el: HTMLElement): { wrappers: HTMLElement[]; target: HTMLElement } {
        const wrappers: HTMLElement[] = [];
        let curr: HTMLElement = el;
        for (let depth = 0; depth < 3; depth++) {
            if (this.isSplittableNode(curr)) {
                return { wrappers, target: curr };
            }
            const significantChildren = Array.from(curr.children).filter(
                (c): c is HTMLElement =>
                    c.instanceOf(HTMLElement) &&
                    !c.classList.contains('copy-code-button') &&
                    !c.classList.contains('edit-block-button')
            );
            if (significantChildren.length === 1) {
                wrappers.push(curr);
                curr = significantChildren[0];
            } else {
                break;
            }
        }
        if (this.isSplittableNode(curr)) {
            return { wrappers, target: curr };
        }
        return { wrappers: [], target: el };
    }

    private isListChromeElement(el: Element): boolean {
        return (
            el.classList.contains('list-bullet') ||
            el.classList.contains('list-collapse-indicator') ||
            el.classList.contains('collapse-indicator') ||
            el.classList.contains('heading-collapse-indicator') ||
            el.classList.contains('copy-code-button') ||
            el.classList.contains('edit-block-button') ||
            el.classList.contains('cm-fold-indicator')
        );
    }

    private isAtomicVisualNode(node: Node): boolean {
        if (node.nodeType !== Node.ELEMENT_NODE) return false;
        const el = node as HTMLElement;
        if (this.isListChromeElement(el)) return false;
        const tag = el.tagName;
        if (
            tag === 'IMG' ||
            tag === 'FIGURE' ||
            tag === 'CANVAS' ||
            tag === 'VIDEO' ||
            tag === 'SVG' ||
            tag === 'HR' ||
            tag === 'MJX-CONTAINER'
        ) {
            return true;
        }
        if (
            el.classList.contains('pdf-image-slot') ||
            el.classList.contains('image-embed') ||
            el.classList.contains('media-embed') ||
            el.classList.contains('math') ||
            el.classList.contains('mermaid') ||
            el.classList.contains('block-language-image-layout') ||
            el.classList.contains('image-layouts') ||
            el.classList.contains('switchable-layout') ||
            el.classList.contains('carousel')
        ) {
            return true;
        }
        if (el.classList.contains('internal-embed')) {
            const mediaChild = el.querySelector('.pdf-image-slot, img, figure, canvas, svg');
            if (mediaChild && !mediaChild.closest('.list-collapse-indicator, .collapse-indicator')) {
                return true;
            }
        }
        return false;
    }

    private hasVisibleContent(root: HTMLElement): boolean {
        if (this.isListChromeElement(root)) return false;
        if (root.isConnected) {
            const cs = window.getComputedStyle(root);
            if (cs.display === 'none' || cs.visibility === 'hidden') return false;
        }
        if (this.isAtomicVisualNode(root) || root.tagName === 'INPUT' || root.classList.contains('pdf-vector-checkbox')) {
            return true;
        }
        for (let i = 0; i < root.childNodes.length; i++) {
            const ch = root.childNodes[i];
            if (ch.nodeType === Node.TEXT_NODE) {
                if ((ch.textContent || '').replace(/(?:\s|\u200B|\u200C|\u200D|\uFEFF)+/g, '').length > 0) {
                    return true;
                }
            } else if (ch.nodeType === Node.ELEMENT_NODE) {
                const el = ch as HTMLElement;
                if (el.tagName === 'STYLE' || el.tagName === 'SCRIPT' || el.tagName === 'BR') continue;
                if (this.hasVisibleContent(el)) return true;
            }
        }
        return false;
    }

    private measureChildNodeBounds(node: Node): { top: number; bottom: number } | null {
        if (node.nodeType === Node.ELEMENT_NODE) {
            const el = node as HTMLElement;
            if (this.isListChromeElement(el) || el.tagName === 'STYLE' || el.tagName === 'SCRIPT') return null;
            const cs = window.getComputedStyle(el);
            if (cs.display === 'none' || cs.visibility === 'hidden') return null;
            const r = el.getBoundingClientRect();
            let top = r.top;
            let bottom = r.bottom;
            let hasBox = r.width > 0 || r.height > 0;
            // Inline wrappers (e.g. span.internal-embed.image-embed) containing block <figure>/.pdf-image-slot
            // can report a smaller inline box than their block media descendant — include media child bounds.
            if (
                el.classList.contains('internal-embed') ||
                el.classList.contains('image-embed') ||
                el.tagName === 'SPAN' ||
                el.tagName === 'A'
            ) {
                const visualChildren = el.querySelectorAll<HTMLElement>('figure, .pdf-image-slot, img, canvas');
                for (let i = 0; i < visualChildren.length; i++) {
                    const vr = visualChildren[i].getBoundingClientRect();
                    if (vr.width > 0 || vr.height > 0) {
                        if (!hasBox) {
                            top = vr.top;
                            bottom = vr.bottom;
                            hasBox = true;
                        } else {
                            if (vr.top < top) top = vr.top;
                            if (vr.bottom > bottom) bottom = vr.bottom;
                        }
                    }
                }
            }
            return hasBox ? { top, bottom } : null;
        }
        if (node.nodeType === Node.TEXT_NODE) {
            if ((node.textContent || '').replace(/(?:\s|\u200B|\u200C|\u200D|\uFEFF)+/g, '').length === 0) return null;
            const range = activeDocument.createRange();
            range.selectNodeContents(node);
            const r = range.getBoundingClientRect();
            if (r.width <= 0 && r.height <= 0) return null;
            return { top: r.top, bottom: r.bottom };
        }
        return null;
    }

    private splitTextNodeAtWordBoundary(
        textNode: Text,
        effectiveMaxBottom: number,
        minHeightPx: number = 12
    ): { headNode: Text; tailNode: Text } | null {
        const txt = textNode.textContent || '';
        const stops: number[] = [];
        const re = /\S+/g;
        let m: RegExpExecArray | null;
        while ((m = re.exec(txt)) !== null) {
            stops.push(m.index + m[0].length);
        }
        if (stops.length < 2) return null;

        const range = activeDocument.createRange();
        let lo = 0;
        let hi = stops.length - 1;
        let best = -1;
        while (lo <= hi) {
            const mid = (lo + hi) >> 1;
            range.setStart(textNode, 0);
            range.setEnd(textNode, stops[mid]);
            if (range.getBoundingClientRect().bottom <= effectiveMaxBottom) {
                best = mid;
                lo = mid + 1;
            } else {
                hi = mid - 1;
            }
        }
        if (best < 0 || best >= stops.length - 1) return null;
        range.setStart(textNode, 0);
        range.setEnd(textNode, stops[best]);
        if (range.getBoundingClientRect().height < minHeightPx) return null;

        const splitOffset = stops[best];
        const headText = txt.slice(0, splitOffset);
        const tailText = txt.slice(splitOffset).replace(/^ /, '');
        if (headText.trim().length === 0 || tailText.trim().length === 0) return null;
        return {
            headNode: activeDocument.createTextNode(headText),
            tailNode: activeDocument.createTextNode(tailText)
        };
    }

    /**
     * Splits a text-bearing inline container (<p> or single-block <li>) at word boundaries
     * using a live DOM Range binary search against `effectiveMaxBottom`.
     */
    private splitInlineTextContainer(
        target: HTMLElement,
        effectiveMaxBottom: number,
        startLine: number,
        minHeightPx: number = 16
    ): { headEl: HTMLElement; tailEl: HTMLElement; tailStartLine: number } | null {
        const blockingNodes = target.querySelectorAll('.pdf-image-slot, img, canvas, svg, .math, mjx-container, table, ul, ol, pre, blockquote, .callout');
        for (let i = 0; i < blockingNodes.length; i++) {
            const bn = blockingNodes[i];
            if (!bn.closest('.list-collapse-indicator, .collapse-indicator, .heading-collapse-indicator, .copy-code-button, .edit-block-button')) {
                return null;
            }
        }
        const wordStops: Array<{ node: Text; offset: number }> = [];
        const walker = activeDocument.createTreeWalker(target, NodeFilter.SHOW_TEXT);
        let tNode = walker.nextNode() as Text | null;
        while (tNode) {
            const parentEl = tNode.parentElement;
            if (!parentEl || !parentEl.closest('.list-collapse-indicator, .collapse-indicator, .heading-collapse-indicator')) {
                const txt = tNode.textContent || '';
                const re = /\S+/g;
                let m: RegExpExecArray | null;
                while ((m = re.exec(txt)) !== null) {
                    wordStops.push({ node: tNode, offset: m.index + m[0].length });
                }
            }
            tNode = walker.nextNode() as Text | null;
        }
        if (wordStops.length < 4) return null;

        const range = activeDocument.createRange();
        let lo = 0;
        let hi = wordStops.length - 1;
        let best = -1;
        while (lo <= hi) {
            const mid = (lo + hi) >> 1;
            const stop = wordStops[mid];
            range.setStart(target, 0);
            range.setEnd(stop.node, stop.offset);
            if (range.getBoundingClientRect().bottom <= effectiveMaxBottom) {
                best = mid;
                lo = mid + 1;
            } else {
                hi = mid - 1;
            }
        }

        if (best < 1 || best >= wordStops.length - 1) return null;
        const splitStop = wordStops[best];
        range.setStart(target, 0);
        range.setEnd(splitStop.node, splitStop.offset);
        if (range.getBoundingClientRect().height < minHeightPx) return null;

        const extracted = range.extractContents();
        const headEl = target.cloneNode(false) as HTMLElement;
        headEl.appendChild(extracted);
        target.removeAttribute('data-pdf-block-ids');

        // Track line number continuity across <br data-pdf-br-line>
        const headBrs = headEl.querySelectorAll('br[data-pdf-br-line]');
        let tailStartLine = startLine;
        if (headBrs.length > 0) {
            const lastHeadBrLine = parseInt(headBrs[headBrs.length - 1].getAttribute('data-pdf-br-line') || '', 10);
            if (!isNaN(lastHeadBrLine) && lastHeadBrLine > 0) {
                tailStartLine = lastHeadBrLine;
            }
        }

        // Trim leading whitespace and any leading <br> from remaining tail text.
        // Preserve intentional leading indentation after a <br> line break; only trim
        // a single wrap space when splitting mid-line on a word boundary.
        let crossedBr = false;
        while (target.firstChild) {
            const fc = target.firstChild;
            if (fc.nodeType === Node.TEXT_NODE) {
                const rawTxt = fc.textContent || '';
                const trimmedText = crossedBr ? rawTxt.replace(/^\r?\n/, '') : rawTxt.replace(/^ /, '');
                if (trimmedText.length === 0) {
                    target.removeChild(fc);
                    continue;
                }
                fc.textContent = trimmedText;
                break;
            } else if (fc.nodeType === Node.ELEMENT_NODE && (fc as HTMLElement).tagName === 'BR') {
                const brLine = parseInt((fc as HTMLElement).getAttribute('data-pdf-br-line') || '', 10);
                if (!isNaN(brLine) && brLine > 0) {
                    tailStartLine = brLine;
                }
                crossedBr = true;
                target.removeChild(fc);
                continue;
            }
            break;
        }

        if (tailStartLine > 0 && (target.hasAttribute('data-pdf-line') || tailStartLine !== startLine)) {
            target.setAttribute('data-pdf-line', String(tailStartLine));
        }

        if (!this.hasVisibleContent(headEl) || !this.hasVisibleContent(target)) {
            const frag = activeDocument.createDocumentFragment();
            while (headEl.firstChild) frag.appendChild(headEl.firstChild);
            target.insertBefore(frag, target.firstChild);
            return null;
        }

        return { headEl, tailEl: target, tailStartLine };
    }

    /**
     * Splits a mixed-content container (<li> or <p> containing any mix of inline text, images/figures,
     * nested <ul>/<ol>, paragraphs, code blocks, tables, or callouts) cleanly against `effectiveMaxBottom`.
     * Never slices atomic media (images/figures/diagrams) and never produces blank heads or tails.
     */
    private splitMixedContainerToFitHeight(
        container: HTMLElement,
        effectiveMaxBottom: number,
        startLine: number,
        endLine: number,
        depth: number,
        isListItem: boolean
    ): { headEl: HTMLElement; tailEl: HTMLElement; tailStartLine: number } | null {
        if (depth > 16) return null;
        const containerRect = container.getBoundingClientRect();
        if (effectiveMaxBottom - containerRect.top < 24) return null;

        const blockTags = new Set(['UL', 'OL', 'P', 'PRE', 'BLOCKQUOTE', 'DIV', 'TABLE']);
        const childNodes = Array.from(container.childNodes);

        let overflowIdx = -1;
        let overflowBounds: { top: number; bottom: number } | null = null;
        let hasVisibleBefore = false;
        let hasMediaOrBlockBefore = false;

        for (let i = 0; i < childNodes.length; i++) {
            const node = childNodes[i];
            if (node.nodeType === Node.ELEMENT_NODE && this.isListChromeElement(node as Element)) {
                continue;
            }
            const bounds = this.measureChildNodeBounds(node);
            if (!bounds) continue;

            if (bounds.bottom > effectiveMaxBottom) {
                overflowIdx = i;
                overflowBounds = bounds;
                break;
            }

            if (node.nodeType === Node.TEXT_NODE) {
                if ((node.textContent || '').replace(/(?:\s|\u200B|\u200C|\u200D|\uFEFF)+/g, '').length > 0) {
                    hasVisibleBefore = true;
                }
            } else if (node.nodeType === Node.ELEMENT_NODE) {
                const el = node as HTMLElement;
                if (el.tagName !== 'BR' && this.hasVisibleContent(el)) {
                    hasVisibleBefore = true;
                    if (this.isAtomicVisualNode(el) || blockTags.has(el.tagName) || el.classList.contains('callout')) {
                        hasMediaOrBlockBefore = true;
                    }
                }
            }
        }

        if (overflowIdx === -1 || !overflowBounds) return null;

        const overflowNode = childNodes[overflowIdx];
        let childBlockSplit: { head: BlockItem; tail: BlockItem } | null = null;
        let textSplit: { headNode: Text; tailNode: Text } | null = null;
        let inlineElSplit: { headEl: HTMLElement; tailEl: HTMLElement; tailStartLine: number } | null = null;

        if (overflowNode.nodeType === Node.ELEMENT_NODE) {
            const overflowEl = overflowNode as HTMLElement;
            const isAtomic = this.isAtomicVisualNode(overflowEl);
            const isSplittableBlock =
                !isAtomic &&
                !this.isListChromeElement(overflowEl) &&
                (blockTags.has(overflowEl.tagName) || overflowEl.classList.contains('callout'));

            if (isSplittableBlock) {
                if (overflowBounds.top < effectiveMaxBottom - 24) {
                    const childLineAttr = overflowEl.getAttribute('data-pdf-line');
                    const childStart = childLineAttr ? (parseInt(childLineAttr, 10) || startLine) : startLine;
                    childBlockSplit = this.splitBlockToFitHeight(
                        { el: overflowEl, startLine: childStart, endLine },
                        effectiveMaxBottom,
                        depth + 1
                    );
                }
                if (!childBlockSplit && !hasVisibleBefore) {
                    return null;
                }
                // Avoid stranding a bare single-line parent list label (e.g. "- **Parte libera**:") alone
                // at the very bottom of a page when none of its nested list children fit underneath it.
                if (
                    isListItem &&
                    !childBlockSplit &&
                    hasVisibleBefore &&
                    !hasMediaOrBlockBefore &&
                    (overflowEl.tagName === 'UL' || overflowEl.tagName === 'OL') &&
                    overflowBounds.top - containerRect.top <= 56 &&
                    effectiveMaxBottom - overflowBounds.top < 64
                ) {
                    return null;
                }
            } else if (isAtomic) {
                // Keep atomic media (images, figures, diagrams, math) completely intact on the next page
                if (!hasVisibleBefore) {
                    return null;
                }
            } else {
                // Inline element crossing the page boundary
                if (overflowBounds.top < effectiveMaxBottom - 14) {
                    inlineElSplit = this.splitInlineTextContainer(overflowEl, effectiveMaxBottom, startLine, 12);
                }
                if (!inlineElSplit && !hasVisibleBefore) {
                    return null;
                }
            }
        } else if (overflowNode.nodeType === Node.TEXT_NODE) {
            if (overflowBounds.top < effectiveMaxBottom - 12) {
                textSplit = this.splitTextNodeAtWordBoundary(overflowNode as Text, effectiveMaxBottom, 12);
            }
            if (!textSplit && !hasVisibleBefore) {
                return null;
            }
        } else {
            if (!hasVisibleBefore) return null;
        }

        const headEl = container.cloneNode(false) as HTMLElement;
        const tailEl = container.cloneNode(false) as HTMLElement;
        if (isListItem) {
            tailEl.addClass('pdf-no-list-style');
        }
        tailEl.removeAttribute('data-pdf-line');
        tailEl.removeAttribute('data-pdf-block-ids');

        for (let i = 0; i < childNodes.length; i++) {
            const ch = childNodes[i];
            if (i < overflowIdx) {
                headEl.appendChild(ch);
            } else if (i === overflowIdx) {
                if (childBlockSplit) {
                    headEl.appendChild(childBlockSplit.head.el);
                    tailEl.appendChild(childBlockSplit.tail.el);
                } else if (textSplit) {
                    headEl.appendChild(textSplit.headNode);
                    tailEl.appendChild(textSplit.tailNode);
                } else if (inlineElSplit) {
                    headEl.appendChild(inlineElSplit.headEl);
                    tailEl.appendChild(inlineElSplit.tailEl);
                } else {
                    tailEl.appendChild(ch);
                }
            } else {
                tailEl.appendChild(ch);
            }
        }

        // Trim leading <br> / stray whitespace from tailEl while tracking line numbers
        let tailStartLine = childBlockSplit
            ? childBlockSplit.tail.startLine
            : (inlineElSplit ? inlineElSplit.tailStartLine : startLine);

        const headBrs = headEl.querySelectorAll('br[data-pdf-br-line]');
        if (!childBlockSplit && !inlineElSplit && headBrs.length > 0) {
            const lastHeadBrLine = parseInt(headBrs[headBrs.length - 1].getAttribute('data-pdf-br-line') || '', 10);
            if (!isNaN(lastHeadBrLine) && lastHeadBrLine > 0) {
                tailStartLine = lastHeadBrLine;
            }
        }

        let crossedBr = false;
        while (tailEl.firstChild) {
            const fc = tailEl.firstChild;
            if (fc.nodeType === Node.TEXT_NODE) {
                const rawTxt = fc.textContent || '';
                const trimmedText = crossedBr ? rawTxt.replace(/^\r?\n/, '') : rawTxt.replace(/^\s+/, '');
                if (trimmedText.length === 0) {
                    tailEl.removeChild(fc);
                    continue;
                }
                if (trimmedText !== rawTxt) {
                    fc.textContent = trimmedText;
                }
                break;
            } else if (fc.nodeType === Node.ELEMENT_NODE && (fc as HTMLElement).tagName === 'BR') {
                const brLine = parseInt((fc as HTMLElement).getAttribute('data-pdf-br-line') || '', 10);
                if (!isNaN(brLine) && brLine > 0) {
                    tailStartLine = brLine;
                }
                crossedBr = true;
                tailEl.removeChild(fc);
                continue;
            }
            break;
        }

        // Strictly reject any split that would leave a blank head (e.g. only Obsidian list chrome) or blank tail
        if (!this.hasVisibleContent(headEl) || !this.hasVisibleContent(tailEl)) {
            const restoreFrag = activeDocument.createDocumentFragment();
            while (headEl.firstChild) restoreFrag.appendChild(headEl.firstChild);
            while (tailEl.firstChild) restoreFrag.appendChild(tailEl.firstChild);
            container.appendChild(restoreFrag);
            return null;
        }

        const tailLineAttr = tailEl.querySelector('[data-pdf-line]')?.getAttribute('data-pdf-line');
        const parsedTailLine = tailLineAttr ? parseInt(tailLineAttr, 10) : NaN;
        if (!childBlockSplit && !inlineElSplit && !isNaN(parsedTailLine) && parsedTailLine > 0) {
            tailStartLine = parsedTailLine;
        }

        if (
            tailStartLine > 0 &&
            !tailEl.querySelector('[data-pdf-line], [data-pdf-code-start-line]') &&
            tailStartLine !== startLine
        ) {
            tailEl.setAttribute('data-pdf-line', String(tailStartLine));
        }

        return { headEl, tailEl, tailStartLine };
    }

    /**
     * Splits a single overflowing <li> (which may contain nested <ul>/<ol>, multiple indented
     * paragraphs/code/blockquotes/callouts, inline images, or long wrapped text) against `effectiveMaxBottom`.
     */
    private splitListItemToFitHeight(
        li: HTMLElement,
        effectiveMaxBottom: number,
        startLine: number,
        endLine: number,
        depth: number
    ): { headLi: HTMLElement; tailLi: HTMLElement; tailStartLine: number } | null {
        if (depth > 16) return null;
        const liRect = li.getBoundingClientRect();
        if (effectiveMaxBottom - liRect.top < 24) return null;

        // First try unified mixed-content splitter (handles nested lists, blocks, inline images, and mixed text)
        const mixedSplit = this.splitMixedContainerToFitHeight(li, effectiveMaxBottom, startLine, endLine, depth, true);
        if (mixedSplit) {
            return {
                headLi: mixedSplit.headEl,
                tailLi: mixedSplit.tailEl,
                tailStartLine: mixedSplit.tailStartLine
            };
        }

        // Fallback: pure inline/text <li> (including indented continuation lines or <br> inside <li>)
        const inlineSplit = this.splitInlineTextContainer(li, effectiveMaxBottom, startLine, 16);
        if (!inlineSplit) return null;
        inlineSplit.tailEl.addClass('pdf-no-list-style');
        if (inlineSplit.tailStartLine > startLine) {
            inlineSplit.tailEl.setAttribute('data-pdf-line', String(inlineSplit.tailStartLine));
        } else {
            inlineSplit.tailEl.removeAttribute('data-pdf-line');
        }
        return {
            headLi: inlineSplit.headEl,
            tailLi: inlineSplit.tailEl,
            tailStartLine: inlineSplit.tailStartLine
        };
    }

    /**
     * Splits a block (list including nested sub-lists & multi-block items, table, code/indented pre block,
     * callout/blockquote, long text/media paragraph, or multi-child wrapper div) directly against the live
     * `maxAllowedBottom` viewport Y coordinate so content flows continuously without large empty gaps.
     */
    private splitBlockToFitHeight(
        item: BlockItem,
        maxAllowedBottom: number,
        depth: number = 0,
        forceSplitFirstItem: boolean = false
    ): { head: BlockItem; tail: BlockItem } | null {
        if (depth > 16) return null;
        const itemRect = item.el.getBoundingClientRect();
        if (!forceSplitFirstItem && maxAllowedBottom - itemRect.top < 24) return null;

        const { wrappers, target } = this.unwrapSplittableContainer(item.el);
        const itemCs = window.getComputedStyle(item.el);
        const itemMBot = parseFloat(itemCs.marginBottom) || 0;
        const targetCs = window.getComputedStyle(target);
        const targetPBot = parseFloat(targetCs.paddingBottom) || 0;
        const targetMBot = target === item.el ? 0 : (parseFloat(targetCs.marginBottom) || 0);
        const effectiveMaxBottom = maxAllowedBottom - Math.max(itemMBot, targetMBot) - targetPBot - 4;

        const wrapNode = (inner: HTMLElement): HTMLElement => {
            let node = inner;
            for (let i = wrappers.length - 1; i >= 0; i--) {
                const wClone = wrappers[i].cloneNode(false) as HTMLElement;
                wClone.appendChild(node);
                node = wClone;
            }
            return node;
        };

        // 1. Split UL / OL by <li> items AND recursively split the overflowing <li> (nested lists, indented blocks, long text)
        if (target.tagName === 'UL' || target.tagName === 'OL') {
            const listItems = Array.from(target.children).filter(c => c.tagName === 'LI') as HTMLElement[];
            if (listItems.length >= 1) {
                // A split list continuing onto the next page does not need its outer trailing margin-bottom
                // at the bottom of the current page (we flush margin-bottom on headList below), avoiding
                // false fitCount=0 failures when a tall item ends within a few pixels of maxAllowedBottom.
                const listEffectiveMaxBottom = maxAllowedBottom - targetPBot - (depth === 0 ? 2 : 1);
                let fitCount = 0;
                for (let i = 0; i < listItems.length; i++) {
                    if (listItems[i].getBoundingClientRect().bottom <= listEffectiveMaxBottom) {
                        fitCount = i + 1;
                    } else {
                        break;
                    }
                }

                // Attempt to split the overflowing <li> itself whenever meaningful space remains below previous items
                let overflowLiSplit: { headLi: HTMLElement; tailLi: HTMLElement; tailStartLine: number } | null = null;
                if (fitCount < listItems.length) {
                    const overflowLi = listItems[fitCount];
                    const overflowTop = overflowLi.getBoundingClientRect().top;
                    if (listEffectiveMaxBottom - overflowTop >= 28) {
                        const liLineAttr = overflowLi.getAttribute('data-pdf-line');
                        const liStart = liLineAttr ? (parseInt(liLineAttr, 10) || item.startLine) : item.startLine;
                        overflowLiSplit = this.splitListItemToFitHeight(overflowLi, listEffectiveMaxBottom, liStart, item.endLine, depth + 1);
                    }
                }

                // If a nested list's own padding/margin slightly exceeded parent budget even though all
                // child <li>s fit, peel off its last item cleanly instead of aborting the parent list split.
                if (depth > 0 && fitCount === listItems.length && listItems.length >= 2) {
                    fitCount = listItems.length - 1;
                }

                // If we are on a fresh empty page and even item[0] could not split while sibling items follow,
                // peel item[0] off cleanly so only item[0] slices and following items never strand on an empty tail page.
                if (fitCount === 0 && !overflowLiSplit && listItems.length > 1) {
                    if (listItems[0].getBoundingClientRect().bottom <= maxAllowedBottom - 1 || forceSplitFirstItem) {
                        fitCount = 1;
                    }
                }

                if ((fitCount >= 1 && fitCount < listItems.length) || overflowLiSplit) {
                    const headList = target.cloneNode(false) as HTMLElement;
                    const tailList = target.cloneNode(false) as HTMLElement;
                    if (depth === 0) {
                        headList.classList.add('pdf-split-head-flush');
                    }
                    tailList.classList.remove('pdf-split-head-flush');

                    for (let i = 0; i < fitCount; i++) headList.appendChild(listItems[i]);
                    if (overflowLiSplit) {
                        headList.appendChild(overflowLiSplit.headLi);
                        tailList.appendChild(overflowLiSplit.tailLi);
                        for (let i = fitCount + 1; i < listItems.length; i++) tailList.appendChild(listItems[i]);
                    } else {
                        for (let i = fitCount; i < listItems.length; i++) tailList.appendChild(listItems[i]);
                    }

                    if (target.tagName === 'OL') {
                        const startAttr = parseInt(target.getAttribute('start') || '1', 10);
                        const baseStart = isNaN(startAttr) ? 1 : startAttr;
                        tailList.setAttribute('start', String(baseStart + fitCount));
                    }

                    const firstTailLineAttr = tailList.querySelector('[data-pdf-line]')?.getAttribute('data-pdf-line');
                    const parsedTailStart = firstTailLineAttr ? parseInt(firstTailLineAttr, 10) : NaN;
                    const tailStartLine = overflowLiSplit
                        ? overflowLiSplit.tailStartLine
                        : (!isNaN(parsedTailStart) && parsedTailStart > 0 ? parsedTailStart : item.startLine);

                    return {
                        head: { el: wrapNode(headList), startLine: item.startLine, endLine: item.endLine, forceBreakBefore: item.forceBreakBefore },
                        tail: { el: wrapNode(tailList), startLine: tailStartLine, endLine: item.endLine, forceBreakBefore: false }
                    };
                }
            }
        }

        // 2. Split TABLE by <tr> rows while preserving <thead> and respecting rowspan merged cells
        if (target.tagName === 'TABLE') {
            const thead = Array.from(target.children).find(c => c.tagName === 'THEAD') as HTMLTableSectionElement | undefined;
            const primaryTbody = Array.from(target.children).find(c => c.tagName === 'TBODY') as HTMLTableSectionElement | undefined;
            const rows = primaryTbody
                ? (Array.from(primaryTbody.children).filter(c => c.tagName === 'TR') as HTMLTableRowElement[])
                : (Array.from(target.children).filter(c => c.tagName === 'TR') as HTMLTableRowElement[]);
            if (rows.length > 1) {
                const activeRowspanEnds: number[] = [];
                const cleanBreakAfter = new Set<number>();
                for (let i = 0; i < rows.length; i++) {
                    const cells = Array.from(rows[i].children).filter(c => c.tagName === 'TD' || c.tagName === 'TH');
                    for (const cell of cells) {
                        const rs = parseInt(cell.getAttribute('rowspan') || '1', 10);
                        if (!isNaN(rs) && rs > 1) {
                            activeRowspanEnds.push(i + rs - 1);
                        }
                    }
                    if (!activeRowspanEnds.some(endIdx => endIdx > i)) {
                        cleanBreakAfter.add(i + 1);
                    }
                }

                let fitCount = 0;
                for (let i = 0; i < rows.length; i++) {
                    if (rows[i].getBoundingClientRect().bottom <= effectiveMaxBottom) {
                        if (cleanBreakAfter.has(i + 1)) {
                            fitCount = i + 1;
                        }
                    } else {
                        break;
                    }
                }

                if (fitCount >= 1 && fitCount < rows.length) {
                    const headTable = target.cloneNode(false) as HTMLTableElement;
                    const tailTable = target.cloneNode(false) as HTMLTableElement;
                    headTable.classList.add('pdf-table-split-head');
                    tailTable.classList.remove('pdf-table-split-head');
                    if (thead) {
                        headTable.appendChild(thead.cloneNode(true));
                        tailTable.appendChild(thead.cloneNode(true));
                    }
                    const headBody = createEl('tbody');
                    const tailBody = createEl('tbody');
                    for (let i = 0; i < fitCount; i++) headBody.appendChild(rows[i]);
                    for (let i = fitCount; i < rows.length; i++) tailBody.appendChild(rows[i]);
                    headTable.appendChild(headBody);
                    tailTable.appendChild(tailBody);

                    return {
                        head: { el: wrapNode(headTable), startLine: item.startLine, endLine: item.endLine, forceBreakBefore: item.forceBreakBefore },
                        tail: { el: wrapNode(tailTable), startLine: item.startLine, endLine: item.endLine, forceBreakBefore: false }
                    };
                }
            }
        }

        // 3. Split PRE / indented code blocks via exact live DOM Range (handles uneven wrapped lines,
        // 1-3 line indented code blocks, and preserves syntax highlighting spans)
        if (target.tagName === 'PRE') {
            const codeEl = target.querySelector<HTMLElement>('code');
            const textSource = codeEl || target;
            const targetRect = target.getBoundingClientRect();
            const availForPre = effectiveMaxBottom - targetRect.top;
            if (targetRect.height > 0 && availForPre >= 24) {
                const origCodeStartAttr = textSource.getAttribute('data-pdf-code-start-line');
                const origCodeEndAttr = textSource.getAttribute('data-pdf-code-end-line');
                const origCodeStart = origCodeStartAttr ? parseInt(origCodeStartAttr, 10) : NaN;
                const origCodeEnd = origCodeEndAttr ? parseInt(origCodeEndAttr, 10) : NaN;

                const lineStops: Array<{ node: Text; offset: number; lineCountBefore: number }> = [];
                const walker = activeDocument.createTreeWalker(textSource, NodeFilter.SHOW_TEXT);
                let tn = walker.nextNode() as Text | null;
                let newlineCount = 0;
                while (tn) {
                    const txt = tn.textContent || '';
                    for (let cIdx = 0; cIdx < txt.length; cIdx++) {
                        if (txt.charCodeAt(cIdx) === 10) {
                            newlineCount++;
                            lineStops.push({ node: tn, offset: cIdx, lineCountBefore: newlineCount });
                        }
                    }
                    tn = walker.nextNode() as Text | null;
                }

                const range = activeDocument.createRange();
                let splitPoint: { node: Text; offset: number; linesTaken: number; isNewlineSplit: boolean } | null = null;

                if (lineStops.length >= 1) {
                    let lo = 0;
                    let hi = lineStops.length - 1;
                    let best = -1;
                    while (lo <= hi) {
                        const mid = (lo + hi) >> 1;
                        const st = lineStops[mid];
                        range.setStart(textSource, 0);
                        range.setEnd(st.node, st.offset);
                        if (range.getBoundingClientRect().bottom <= effectiveMaxBottom) {
                            best = mid;
                            lo = mid + 1;
                        } else {
                            hi = mid - 1;
                        }
                    }
                    if (best >= 0) {
                        splitPoint = {
                            node: lineStops[best].node,
                            offset: lineStops[best].offset,
                            linesTaken: lineStops[best].lineCountBefore,
                            isNewlineSplit: true
                        };
                    }
                }

                // Fallback for a single very long wrapped line inside <pre> (e.g. indented paragraph)
                if (!splitPoint) {
                    const wordStops: Array<{ node: Text; offset: number }> = [];
                    const wWalker = activeDocument.createTreeWalker(textSource, NodeFilter.SHOW_TEXT);
                    let wNode = wWalker.nextNode() as Text | null;
                    while (wNode) {
                        const txt = wNode.textContent || '';
                        const re = /\S+/g;
                        let m: RegExpExecArray | null;
                        while ((m = re.exec(txt)) !== null) {
                            wordStops.push({ node: wNode, offset: m.index + m[0].length });
                        }
                        wNode = wWalker.nextNode() as Text | null;
                    }
                    if (wordStops.length >= 4) {
                        let lo = 0;
                        let hi = wordStops.length - 1;
                        let best = -1;
                        while (lo <= hi) {
                            const mid = (lo + hi) >> 1;
                            range.setStart(textSource, 0);
                            range.setEnd(wordStops[mid].node, wordStops[mid].offset);
                            if (range.getBoundingClientRect().bottom <= effectiveMaxBottom) {
                                best = mid;
                                lo = mid + 1;
                            } else {
                                hi = mid - 1;
                            }
                        }
                        if (best >= 1 && best < wordStops.length - 1) {
                            range.setStart(textSource, 0);
                            range.setEnd(wordStops[best].node, wordStops[best].offset);
                            if (range.getBoundingClientRect().height >= 16) {
                                splitPoint = {
                                    node: wordStops[best].node,
                                    offset: wordStops[best].offset,
                                    linesTaken: 0,
                                    isNewlineSplit: false
                                };
                            }
                        }
                    }
                }

                if (splitPoint) {
                    range.setStart(textSource, 0);
                    range.setEnd(splitPoint.node, splitPoint.offset);
                    const extracted = range.extractContents();

                    // Trim single leading newline (or leading space on wrapped word split) from tail
                    const trimWalker = activeDocument.createTreeWalker(textSource, NodeFilter.SHOW_TEXT);
                    const firstTailText = trimWalker.nextNode() as Text | null;
                    if (firstTailText && firstTailText.textContent) {
                        if (splitPoint.isNewlineSplit && firstTailText.textContent.startsWith('\n')) {
                            firstTailText.textContent = firstTailText.textContent.slice(1);
                        } else if (!splitPoint.isNewlineSplit) {
                            firstTailText.textContent = firstTailText.textContent.replace(/^[ \t]+/, '');
                        }
                    }

                    if ((extracted.textContent || '').length > 0 && (textSource.textContent || '').trim().length > 0) {
                        const headPre = target.cloneNode(false) as HTMLElement;
                        const headInner = codeEl ? (codeEl.cloneNode(false) as HTMLElement) : headPre;
                        if (codeEl) headPre.appendChild(headInner);
                        headInner.appendChild(extracted);

                        const tailCodeStart = !isNaN(origCodeStart)
                            ? origCodeStart + splitPoint.linesTaken
                            : NaN;
                        if (!isNaN(origCodeStart) && origCodeStart > 0) {
                            const headEnd = Math.max(origCodeStart, origCodeStart + Math.max(0, splitPoint.linesTaken - 1));
                            headInner.setAttribute('data-pdf-code-start-line', String(origCodeStart));
                            headInner.setAttribute('data-pdf-code-end-line', String(headEnd));
                            textSource.setAttribute('data-pdf-code-start-line', String(tailCodeStart));
                            if (!isNaN(origCodeEnd)) {
                                textSource.setAttribute('data-pdf-code-end-line', String(Math.max(tailCodeStart, origCodeEnd)));
                            }
                        }

                        return {
                            head: { el: wrapNode(headPre), startLine: item.startLine, endLine: item.endLine, forceBreakBefore: item.forceBreakBefore },
                            tail: { el: wrapNode(target), startLine: !isNaN(tailCodeStart) ? tailCodeStart : item.startLine, endLine: item.endLine, forceBreakBefore: false }
                        };
                    }
                }
            }
        }

        // 4. Split Obsidian Callout (.callout) or BLOCKQUOTE by internal blocks (including recursive split of overflowing child)
        if (target.classList.contains('callout')) {
            const titleEl = Array.from(target.children).find(c => c.classList.contains('callout-title')) as HTMLElement | undefined;
            const contentEl = Array.from(target.children).find(c => c.classList.contains('callout-content')) as HTMLElement | undefined;
            if (contentEl) {
                const bodyChildren = Array.from(contentEl.children) as HTMLElement[];
                if (bodyChildren.length >= 1) {
                    let fitCount = 0;
                    for (let i = 0; i < bodyChildren.length; i++) {
                        if (bodyChildren[i].getBoundingClientRect().bottom <= effectiveMaxBottom) {
                            fitCount = i + 1;
                        } else {
                            break;
                        }
                    }

                    let childSplit: { head: BlockItem; tail: BlockItem } | null = null;
                    if (fitCount < bodyChildren.length && bodyChildren[fitCount].getBoundingClientRect().top < effectiveMaxBottom - 24) {
                        const childLineAttr = bodyChildren[fitCount].getAttribute('data-pdf-line');
                        const childStart = childLineAttr ? (parseInt(childLineAttr, 10) || item.startLine) : item.startLine;
                        childSplit = this.splitBlockToFitHeight(
                            { el: bodyChildren[fitCount], startLine: childStart, endLine: item.endLine },
                            effectiveMaxBottom,
                            depth + 1
                        );
                    }

                    if ((fitCount >= 1 && fitCount < bodyChildren.length) || childSplit) {
                        const headCallout = target.cloneNode(false) as HTMLElement;
                        const tailCallout = target.cloneNode(false) as HTMLElement;
                        if (titleEl) headCallout.appendChild(titleEl);
                        const headContent = contentEl.cloneNode(false) as HTMLElement;
                        const tailContent = contentEl.cloneNode(false) as HTMLElement;
                        for (let i = 0; i < fitCount; i++) headContent.appendChild(bodyChildren[i]);
                        if (childSplit) {
                            headContent.appendChild(childSplit.head.el);
                            tailContent.appendChild(childSplit.tail.el);
                            for (let i = fitCount + 1; i < bodyChildren.length; i++) tailContent.appendChild(bodyChildren[i]);
                        } else {
                            for (let i = fitCount; i < bodyChildren.length; i++) tailContent.appendChild(bodyChildren[i]);
                        }
                        headCallout.appendChild(headContent);
                        tailCallout.appendChild(tailContent);
                        const tailStartLine = childSplit ? childSplit.tail.startLine : item.startLine;
                        return {
                            head: { el: wrapNode(headCallout), startLine: item.startLine, endLine: item.endLine, forceBreakBefore: item.forceBreakBefore },
                            tail: { el: wrapNode(tailCallout), startLine: tailStartLine, endLine: item.endLine, forceBreakBefore: false }
                        };
                    }
                }
            }
        }

        if (target.tagName === 'BLOCKQUOTE') {
            const quoteChildren = Array.from(target.children) as HTMLElement[];
            if (quoteChildren.length >= 1) {
                let fitCount = 0;
                for (let i = 0; i < quoteChildren.length; i++) {
                    if (quoteChildren[i].getBoundingClientRect().bottom <= effectiveMaxBottom) {
                        fitCount = i + 1;
                    } else {
                        break;
                    }
                }

                let childSplit: { head: BlockItem; tail: BlockItem } | null = null;
                if (fitCount < quoteChildren.length && quoteChildren[fitCount].getBoundingClientRect().top < effectiveMaxBottom - 24) {
                    const childLineAttr = quoteChildren[fitCount].getAttribute('data-pdf-line');
                    const childStart = childLineAttr ? (parseInt(childLineAttr, 10) || item.startLine) : item.startLine;
                    childSplit = this.splitBlockToFitHeight(
                        { el: quoteChildren[fitCount], startLine: childStart, endLine: item.endLine },
                        effectiveMaxBottom,
                        depth + 1
                    );
                }

                if ((fitCount >= 1 && fitCount < quoteChildren.length) || childSplit) {
                    const headQ = target.cloneNode(false) as HTMLElement;
                    const tailQ = target.cloneNode(false) as HTMLElement;
                    for (let i = 0; i < fitCount; i++) headQ.appendChild(quoteChildren[i]);
                    if (childSplit) {
                        headQ.appendChild(childSplit.head.el);
                        tailQ.appendChild(childSplit.tail.el);
                        for (let i = fitCount + 1; i < quoteChildren.length; i++) tailQ.appendChild(quoteChildren[i]);
                    } else {
                        for (let i = fitCount; i < quoteChildren.length; i++) tailQ.appendChild(quoteChildren[i]);
                    }
                    const tailStartLine = childSplit ? childSplit.tail.startLine : item.startLine;
                    return {
                        head: { el: wrapNode(headQ), startLine: item.startLine, endLine: item.endLine, forceBreakBefore: item.forceBreakBefore },
                        tail: { el: wrapNode(tailQ), startLine: tailStartLine, endLine: item.endLine, forceBreakBefore: false }
                    };
                }
            }
        }

        // 5. Split long <p> paragraphs (both pure text and mixed text + inline/block images) cleanly
        if (target.tagName === 'P') {
            const pSplit =
                this.splitInlineTextContainer(target, effectiveMaxBottom, item.startLine, 16) ||
                this.splitMixedContainerToFitHeight(target, effectiveMaxBottom, item.startLine, item.endLine, depth, false);
            if (pSplit) {
                return {
                    head: { el: wrapNode(pSplit.headEl), startLine: item.startLine, endLine: item.endLine, forceBreakBefore: item.forceBreakBefore },
                    tail: { el: wrapNode(pSplit.tailEl), startLine: pSplit.tailStartLine, endLine: item.endLine, forceBreakBefore: false }
                };
            }
        }

        // 6. Split generic multi-block wrapper <div> (e.g. indented HTML/plugin containers wrapping multiple blocks)
        // Never split visual layout widgets (image carousels, grids, masonry, horizontal flex/grid containers).
        const isHorizontalOrGridLayout =
            targetCs.display.includes('grid') ||
            (targetCs.display.includes('flex') && (targetCs.flexDirection === 'row' || targetCs.flexDirection === 'row-reverse'));
        if (
            target.tagName === 'DIV' &&
            !isHorizontalOrGridLayout &&
            !target.classList.contains('mermaid') &&
            !target.classList.contains('math-block') &&
            !target.classList.contains('pdf-image-slot') &&
            !target.classList.contains('block-language-image-layout') &&
            !target.classList.contains('image-layouts') &&
            !target.classList.contains('switchable-layout') &&
            !target.classList.contains('carousel') &&
            !target.querySelector(':scope > svg, :scope > canvas, :scope > .switchable-layout, :scope > .image-layouts, :scope > .carousel')
        ) {
            const divChildren = Array.from(target.children).filter(
                (c): c is HTMLElement =>
                    c.instanceOf(HTMLElement) &&
                    !c.classList.contains('copy-code-button') &&
                    !c.classList.contains('edit-block-button')
            );
            if (divChildren.length > 1) {
                let fitCount = 0;
                for (let i = 0; i < divChildren.length; i++) {
                    if (divChildren[i].getBoundingClientRect().bottom <= effectiveMaxBottom) {
                        fitCount = i + 1;
                    } else {
                        break;
                    }
                }

                let childSplit: { head: BlockItem; tail: BlockItem } | null = null;
                if (fitCount < divChildren.length && divChildren[fitCount].getBoundingClientRect().top < effectiveMaxBottom - 24) {
                    const childLineAttr = divChildren[fitCount].getAttribute('data-pdf-line');
                    const childStart = childLineAttr ? (parseInt(childLineAttr, 10) || item.startLine) : item.startLine;
                    childSplit = this.splitBlockToFitHeight(
                        { el: divChildren[fitCount], startLine: childStart, endLine: item.endLine },
                        effectiveMaxBottom,
                        depth + 1
                    );
                }

                if ((fitCount >= 1 && fitCount < divChildren.length) || childSplit) {
                    const headDiv = target.cloneNode(false) as HTMLElement;
                    const tailDiv = target.cloneNode(false) as HTMLElement;
                    for (let i = 0; i < fitCount; i++) headDiv.appendChild(divChildren[i]);
                    if (childSplit) {
                        headDiv.appendChild(childSplit.head.el);
                        tailDiv.appendChild(childSplit.tail.el);
                        for (let i = fitCount + 1; i < divChildren.length; i++) tailDiv.appendChild(divChildren[i]);
                    } else {
                        for (let i = fitCount; i < divChildren.length; i++) tailDiv.appendChild(divChildren[i]);
                    }
                    const tailStartLine = childSplit ? childSplit.tail.startLine : item.startLine;
                    return {
                        head: { el: wrapNode(headDiv), startLine: item.startLine, endLine: item.endLine, forceBreakBefore: item.forceBreakBefore },
                        tail: { el: wrapNode(tailDiv), startLine: tailStartLine, endLine: item.endLine, forceBreakBefore: false }
                    };
                }
            }
        }

        return null;
    }

    /**
     * Splits a multi-line UL/OL, TABLE, or PRE block when a manual page-break line falls strictly inside it.
     */
    private splitBlockAtLine(item: BlockItem, breakLine: number): [BlockItem, BlockItem] | null {
        const { wrappers, target } = this.unwrapSplittableContainer(item.el);
        const wrapNode = (node: HTMLElement): HTMLElement => {
            let wrapped = node;
            for (let w = wrappers.length - 1; w >= 0; w--) {
                const clone = wrappers[w].cloneNode(false) as HTMLElement;
                clone.appendChild(wrapped);
                wrapped = clone;
            }
            return wrapped;
        };

        if (target.tagName === 'UL' || target.tagName === 'OL') {
            const listItems = Array.from(target.children).filter(
                (c): c is HTMLElement => c.instanceOf(HTMLElement) && c.tagName === 'LI'
            );
            let splitIdx = -1;
            for (let i = 0; i < listItems.length; i++) {
                const liLineAttr = listItems[i].getAttribute('data-pdf-line');
                const liLine = liLineAttr ? parseInt(liLineAttr, 10) : NaN;
                if (!isNaN(liLine) && liLine >= breakLine) {
                    splitIdx = i;
                    break;
                }
            }
            if (splitIdx === -1) {
                splitIdx = breakLine - item.startLine;
            }
            if (splitIdx >= 1 && splitIdx < listItems.length) {
                const headList = target.cloneNode(false) as HTMLElement;
                const tailList = target.cloneNode(false) as HTMLElement;
                if (target.tagName === 'OL') {
                    const startAttr = parseInt(target.getAttribute('start') || '1', 10) || 1;
                    tailList.setAttribute('start', String(startAttr + splitIdx));
                }
                for (let i = 0; i < splitIdx; i++) headList.appendChild(listItems[i]);
                for (let i = splitIdx; i < listItems.length; i++) tailList.appendChild(listItems[i]);
                return [
                    { el: wrapNode(headList), startLine: item.startLine, endLine: breakLine - 1, forceBreakBefore: item.forceBreakBefore },
                    { el: wrapNode(tailList), startLine: breakLine, endLine: item.endLine, forceBreakBefore: true }
                ];
            }
        }

        if (target.tagName === 'TABLE') {
            const thead = target.querySelector('thead');
            const colgroup = target.querySelector('colgroup');
            const tbody = target.querySelector('tbody');
            const rows = tbody
                ? Array.from(tbody.children).filter((c): c is HTMLElement => c.instanceOf(HTMLElement) && c.tagName === 'TR')
                : [];
            // Markdown table: startLine = header, startLine + 1 = separator, startLine + 2 = first body row
            const splitIdx = breakLine - (item.startLine + 2);
            if (tbody && splitIdx >= 1 && splitIdx < rows.length) {
                const buildTable = (slice: HTMLElement[]): HTMLElement => {
                    const tbl = target.cloneNode(false) as HTMLElement;
                    if (colgroup) tbl.appendChild(colgroup.cloneNode(true));
                    if (thead) tbl.appendChild(thead.cloneNode(true));
                    const tb = tbody.cloneNode(false) as HTMLElement;
                    for (const r of slice) tb.appendChild(r);
                    tbl.appendChild(tb);
                    return tbl;
                };
                const headTable = buildTable(rows.slice(0, splitIdx));
                const tailTable = buildTable(rows.slice(splitIdx));
                headTable.classList.add('pdf-table-split-head');
                tailTable.classList.remove('pdf-table-split-head');
                return [
                    { el: wrapNode(headTable), startLine: item.startLine, endLine: breakLine - 1, forceBreakBefore: item.forceBreakBefore },
                    { el: wrapNode(tailTable), startLine: breakLine, endLine: item.endLine, forceBreakBefore: true }
                ];
            }
        }

        if (target.tagName === 'PRE') {
            const codeEl = target.querySelector<HTMLElement>('code');
            if (codeEl) {
                const codeLines = (codeEl.textContent || '').split('\n');
                const origCodeStartAttr = codeEl.getAttribute('data-pdf-code-start-line');
                const origCodeEndAttr = codeEl.getAttribute('data-pdf-code-end-line');
                const codeStartLine = origCodeStartAttr ? parseInt(origCodeStartAttr, 10) : (item.startLine + 1);
                const codeEndLine = origCodeEndAttr ? parseInt(origCodeEndAttr, 10) : item.endLine;
                // Markdown fenced code block: startLine = opening fence, startLine + 1 = first line of code
                const splitIdx = breakLine - codeStartLine;
                if (splitIdx >= 1 && splitIdx < codeLines.length) {
                    const headPre = target.cloneNode(false) as HTMLElement;
                    const headCode = codeEl.cloneNode(false) as HTMLElement;
                    headCode.textContent = codeLines.slice(0, splitIdx).join('\n');
                    if (origCodeStartAttr) {
                        headCode.setAttribute('data-pdf-code-start-line', String(codeStartLine));
                        headCode.setAttribute('data-pdf-code-end-line', String(Math.max(codeStartLine, breakLine - 1)));
                    }
                    headPre.appendChild(headCode);

                    const tailPre = target.cloneNode(false) as HTMLElement;
                    const tailCode = codeEl.cloneNode(false) as HTMLElement;
                    tailCode.textContent = codeLines.slice(splitIdx).join('\n');
                    if (origCodeStartAttr) {
                        tailCode.setAttribute('data-pdf-code-start-line', String(breakLine));
                        tailCode.setAttribute('data-pdf-code-end-line', String(Math.max(breakLine, codeEndLine)));
                    }
                    tailPre.appendChild(tailCode);

                    return [
                        { el: wrapNode(headPre), startLine: item.startLine, endLine: breakLine - 1, forceBreakBefore: item.forceBreakBefore },
                        { el: wrapNode(tailPre), startLine: breakLine, endLine: item.endLine, forceBreakBefore: true }
                    ];
                }
            }
        }

        return null;
    }

    private static readonly PAGE_BREAK_SYNTAX = '<!-- pagebreak -->';

    private insertPageBreakInEditor(editor: Editor): void {
        const syntax = PdfPlugin.PAGE_BREAK_SYNTAX;
        if (editor.somethingSelected()) {
            editor.replaceSelection(syntax);
            return;
        }
        const cursor = editor.getCursor();
        const lineText = editor.getLine(cursor.line);
        if (lineText.trim() === '') {
            editor.replaceRange(syntax, { line: cursor.line, ch: 0 }, { line: cursor.line, ch: lineText.length });
            editor.setCursor({ line: cursor.line, ch: syntax.length });
        } else if (cursor.ch === 0) {
            editor.replaceRange(`${syntax}\n`, cursor);
            editor.setCursor({ line: cursor.line, ch: syntax.length });
        } else if (cursor.ch >= lineText.length) {
            editor.replaceRange(`\n${syntax}`, cursor);
            editor.setCursor({ line: cursor.line + 1, ch: syntax.length });
        } else {
            editor.replaceRange(`\n${syntax}\n`, cursor);
            editor.setCursor({ line: cursor.line + 1, ch: syntax.length });
        }
    }

    /**
     * Copies text to clipboard reliably across Desktop (Electron), Android WebView, and iOS WKWebView
     * using a 3-tier native fallback chain (Clipboard API -> Capacitor Clipboard -> Electron clipboard).
     */
    private async copyTextToClipboard(text: string): Promise<boolean> {
        // Tier 1: Standard Clipboard API (Desktop Electron & modern mobile WebViews)
        if (typeof navigator !== 'undefined' && navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
            try {
                await navigator.clipboard.writeText(text);
                return true;
            } catch {
                // Fall through to platform-specific fallbacks
            }
        }

        const winPlatform = window as WindowWithPlatformApis;

        // Tier 2: Capacitor native Clipboard plugin (Obsidian Mobile Android/iOS)
        try {
            const capClipboard = winPlatform.Capacitor?.Plugins?.Clipboard;
            if (capClipboard && typeof capClipboard.write === 'function') {
                await capClipboard.write({ string: text });
                return true;
            }
        } catch {
            // Fall through
        }

        // Tier 3: Electron native clipboard (Desktop fallback)
        if (!Platform.isMobile) {
            try {
                const electron = winPlatform.require?.('electron');
                if (electron?.clipboard && typeof electron.clipboard.writeText === 'function') {
                    electron.clipboard.writeText(text);
                    return true;
                }
            } catch {
                // Fall through
            }
        }

        return false;
    }

    private async copyPageBreakSyntaxToClipboard(): Promise<void> {
        const syntax = PdfPlugin.PAGE_BREAK_SYNTAX;
        const ok = await this.copyTextToClipboard(syntax);
        if (ok) {
            new Notice(`Copied "${syntax}" to clipboard`);
        } else {
            new Notice(`Could not copy automatically. Page break syntax: ${syntax}`, 6000);
        }
    }

    /**
     * Scans raw Markdown outside YAML frontmatter, fenced code blocks, and Obsidian %% comments
     * for inline `<!-- pagebreak -->` directives and returns their 1-indexed line numbers.
     */
    private extractInlinePageBreakLines(rawContent: string, frontmatterLineCount: number): number[] {
        const lines = rawContent.split('\n');
        const breaks: number[] = [];
        let inFence = false;
        let fenceChar = '';
        let fenceLen = 0;
        let inObsidianComment = false;

        for (let i = Math.max(0, frontmatterLineCount); i < lines.length; i++) {
            const line = lines[i];
            const trimmed = line.trim();

            if (inFence) {
                const closeRe = new RegExp(`^\\s*${fenceChar === '`' ? '`' : '~'}{${fenceLen},}\\s*$`);
                if (closeRe.test(line)) {
                    inFence = false;
                }
                continue;
            }

            if (inObsidianComment) {
                if (line.includes('%%')) {
                    inObsidianComment = false;
                }
                continue;
            }

            const fenceMatch = line.match(/^\s*(`{3,}|~{3,})/);
            if (fenceMatch) {
                inFence = true;
                fenceChar = fenceMatch[1][0];
                fenceLen = fenceMatch[1].length;
                continue;
            }

            if (trimmed.startsWith('%%')) {
                if (!trimmed.slice(2).includes('%%')) {
                    inObsidianComment = true;
                }
                continue;
            }

            if (/^\s*<!--\s*pagebreak\s*-->\s*$/i.test(line)) {
                breaks.push(i + 1);
            }
        }

        return breaks;
    }

    /**
     * Applies user-configured manual page-break line numbers onto rendered Reading Mode blocks.
     */
    private applyPageBreaksToBlocks(blocks: BlockItem[], breakLines: number[]): BlockItem[] {
        if (breakLines.length === 0 || blocks.length === 0) return blocks;
        const result = [...blocks];

        for (const breakLine of breakLines) {
            if (breakLine <= 1) continue;
            const idx = result.findIndex(b => !b.isTitle && (b.endLine >= breakLine || b.startLine >= breakLine));
            if (idx === -1) continue;

            const blk = result[idx];
            const hasEarlierContent = result.slice(0, idx).some(b => !b.isTitle);

            if (blk.startLine >= breakLine) {
                if (hasEarlierContent) {
                    blk.forceBreakBefore = true;
                }
            } else {
                const split = this.splitBlockAtLine(blk, breakLine);
                if (split) {
                    result.splice(idx, 1, split[0], split[1]);
                } else if (idx + 1 < result.length) {
                    result[idx + 1].forceBreakBefore = true;
                }
            }
        }

        return result;
    }

    private resolveReadingRenderer(source: ObsidianReadingSource | null | undefined): ObsidianReadingRenderer | null {
        if (!source) return null;
        if (source.previewMode?.renderer) {
            return source.previewMode.renderer;
        }
        if (source.renderer && (Array.isArray(source.renderer.sections) || source.renderer.sizerEl || typeof source.renderer.set === 'function')) {
            return source.renderer;
        }
        if (source.previewMode && (Array.isArray(source.previewMode.sections) || source.previewMode.sizerEl)) {
            return source.previewMode;
        }
        if (Array.isArray(source.sections) || source.sizerEl) {
            return source as ObsidianReadingRenderer;
        }
        return source.renderer || null;
    }

    /**
     * Drives Obsidian's native MarkdownPreviewRenderer to render and post-process EVERY section
     * (including all MarkdownCodeBlockProcessors and MarkdownPostProcessors) without ever calling
     * raw `sec.render()` without post-processing.
     */
    private async driveReadingModeRenderer(
        renderer: ObsidianReadingRenderer,
        previewEl: HTMLElement | null,
        sizerTarget: HTMLElement,
        file: TFile,
        rawContent: string,
        noteCssClasses: string[],
        frontmatterLineCount: number,
        hasBodyContent: boolean,
        renderComponent: Component,
        shouldCancel?: () => boolean
    ): Promise<{ sizerEl: HTMLElement; blocks: BlockItem[] } | null> {
        // Ensure renderer Component is loaded so ctx.addChild(MarkdownRenderChild) invokes child.onload()
        if (typeof renderer.load === 'function' && !renderer._loaded) {
            renderComponent.addChild(renderer as unknown as Component);
        }

        if (previewEl) {
            previewEl.classList.add('markdown-rendered', 'node-insert-event', 'show-indentation-guide', 'pdf-expand-reading-height');
            for (const cls of noteCssClasses) {
                if (cls) previewEl.classList.add(cls);
            }
        }

        try { renderer.unfoldAll?.(); } catch { /* ignore */ }
        try {
            if (typeof renderer.showAll === 'function') {
                renderer.showAll();
            } else if (typeof renderer.showAll === 'boolean') {
                renderer.showAll = true;
            }
        } catch { /* ignore */ }
        try { renderer.onResize?.(); } catch { /* ignore */ }
        try { renderer.updateVirtualDisplay?.(); } catch { /* ignore */ }
        try { renderer.queueRender?.(); } catch { /* ignore */ }
        try { renderer.onRender?.(); } catch { /* ignore */ }

        const rawLines = rawContent.split('\n');
        const parsedSource = this.computeMarkdownBlockLines(rawContent, frontmatterLineCount);
        const nonEmptySourceLines = this.collectNonEmptySourceLines(
            rawLines,
            Math.max(1, frontmatterLineCount + 1),
            rawLines.length
        );
        const lastExpectedContentLine = Math.max(
            nonEmptySourceLines.length > 0 ? nonEmptySourceLines[nonEmptySourceLines.length - 1] : 0,
            parsedSource.blocks.length > 0 ? parsedSource.blocks[parsedSource.blocks.length - 1].endLine : 0
        );

        const readSectionLineRange = (sec: ObsidianReadingSection, el?: HTMLElement | null): { startLine: number; endLine: number } | null => {
            const toLine = (v: unknown): number | null =>
                typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.floor(v) : null;

            const directStart = toLine(sec?.lineStart) ?? toLine(sec?.startLine) ?? toLine(sec?.position?.start?.line) ?? toLine(sec?.info?.lineStart);
            if (directStart !== null) {
                const directEnd = toLine(sec?.lineEnd) ?? toLine(sec?.endLine) ?? toLine(sec?.position?.end?.line) ?? toLine(sec?.info?.lineEnd);
                const start1 = directStart + 1;
                const end1 = directEnd !== null ? Math.max(start1, directEnd + 1) : start1;
                return { startLine: start1, endLine: end1 };
            }

            if (el && typeof renderer?.getSectionInfo === 'function') {
                try {
                    const info = renderer.getSectionInfo(el);
                    const infoStart = toLine(info?.lineStart);
                    if (infoStart !== null) {
                        const infoEnd = toLine(info?.lineEnd);
                        const start1 = infoStart + 1;
                        const end1 = infoEnd !== null ? Math.max(start1, infoEnd + 1) : start1;
                        return { startLine: start1, endLine: end1 };
                    }
                } catch {
                    // ignore
                }
            }

            if (el) {
                const dataLineAttr = el.getAttribute('data-line') || el.querySelector('[data-line]')?.getAttribute('data-line');
                if (dataLineAttr) {
                    const parsed = parseInt(dataLineAttr, 10);
                    if (!isNaN(parsed) && parsed >= 0) {
                        return { startLine: parsed + 1, endLine: parsed + 1 };
                    }
                }
            }

            return null;
        };

        const getSectionMarkdownSlice = (sec: ObsidianReadingSection, el?: HTMLElement | null): string => {
            const range = readSectionLineRange(sec, el);
            if (range) {
                if (frontmatterLineCount > 0 && range.endLine <= frontmatterLineCount) return '';
                const startIdx = Math.max(0, range.startLine - 1);
                const endIdx = Math.min(rawLines.length - 1, range.endLine - 1);
                if (endIdx >= startIdx) {
                    return rawLines.slice(startIdx, endIdx + 1).join('\n');
                }
            }
            // Only fall back to sec.text when it is an actual per-section snippet, never the whole document
            if (typeof sec.text === 'string' && sec.text.length > 0 && sec.text !== rawContent) {
                return sec.text;
            }
            return '';
        };

        const isNonContentEl = (el: HTMLElement): boolean => {
            if (el.tagName === 'STYLE') return true;
            if (
                el.classList.contains('markdown-preview-pusher') ||
                el.classList.contains('mod-header') ||
                el.classList.contains('mod-footer') ||
                el.classList.contains('mod-frontmatter') ||
                el.classList.contains('frontmatter') ||
                el.classList.contains('metadata-container')
            ) {
                return true;
            }
            if (
                el.children.length === 1 &&
                !!el.querySelector(':scope > .frontmatter, :scope > .metadata-container, :scope > pre.frontmatter')
            ) {
                return true;
            }
            return el.childNodes.length === 0;
        };

        const isSectionMissingDom = (sec: ObsidianReadingSection): boolean => {
            const range = readSectionLineRange(sec, sec.el);
            if (range && frontmatterLineCount > 0 && range.endLine <= frontmatterLineCount) {
                return false;
            }
            const secEl = sec.el;
            if (!secEl) {
                return getSectionMarkdownSlice(sec, null).trim().length > 0;
            }
            if (isNonContentEl(secEl)) {
                // Only treat empty div as missing if it actually corresponds to non-empty body markdown
                if (secEl.childNodes.length === 0) {
                    const md = getSectionMarkdownSlice(sec, secEl).trim();
                    if (!md) return false;
                    // Ignore pure HTML or Obsidian comment sections
                    if (/^(?:<!--[\s\S]*?-->|%%[\s\S]*?%%|\s)+$/.test(md)) return false;
                    return true;
                }
                return false;
            }
            if (!sec.rendered) {
                const hasVisible =
                    (secEl.textContent || '').trim().length > 0 ||
                    !!secEl.querySelector('img, svg, canvas, hr, table, input, .pdf-image-slot, mjx-container, .math');
                return !hasVisible && getSectionMarkdownSlice(sec, secEl).trim().length > 0;
            }
            return false;
        };

        const renderDeadline = Date.now() + Math.min(18000, Math.max(6500, rawLines.length * 35));
        let stablePasses = 0;
        let scrollAttempts = 0;
        let prevSectionCount = -1;
        let prevMaxEndLine = -1;

        while (Date.now() < renderDeadline) {
            if (shouldCancel?.()) return null;

            await this.yieldFrameSafe(20);
            await new Promise<void>(r => window.setTimeout(r, 12));

            const pending: Promise<unknown>[] = Array.isArray(renderer.promises) ? [...renderer.promises] : [];
            if (pending.length > 0) {
                await Promise.allSettled(pending);
                stablePasses = 0;
                continue;
            }

            const sections: ObsidianReadingSection[] = Array.isArray(renderer.sections) ? renderer.sections : [];
            if (renderer.parsing || renderer.rendering) {
                stablePasses = 0;
                continue;
            }

            if (sections.length === 0 && sizerTarget.children.length === 0 && hasBodyContent) {
                stablePasses = 0;
                continue;
            }

            let maxEndLine = 0;
            for (let i = 0; i < sections.length; i++) {
                const r = readSectionLineRange(sections[i], sections[i]?.el);
                if (r && r.endLine > maxEndLine) maxEndLine = r.endLine;
            }

            if (sections.length !== prevSectionCount || maxEndLine !== prevMaxEndLine) {
                prevSectionCount = sections.length;
                prevMaxEndLine = maxEndLine;
                stablePasses = 0;
            }

            const unrendered = sections.filter(s => s && isSectionMissingDom(s));
            const shortOfEnd = lastExpectedContentLine > 0 && maxEndLine > 0 && maxEndLine < lastExpectedContentLine;

            if (unrendered.length > 0 || shortOfEnd) {
                if (scrollAttempts < 6) {
                    scrollAttempts++;
                    if (previewEl) {
                        const firstUnrenderedEl = unrendered[0]?.el;
                        if (firstUnrenderedEl && firstUnrenderedEl.offsetTop > 0) {
                            previewEl.scrollTop = Math.max(0, firstUnrenderedEl.offsetTop - 200);
                        } else if (previewEl.scrollHeight > previewEl.clientHeight) {
                            previewEl.scrollTop = Math.floor((previewEl.scrollHeight * scrollAttempts) / 6);
                        }
                    }
                    try {
                        if (typeof renderer.showAll === 'function') {
                            renderer.showAll();
                        } else if (typeof renderer.showAll === 'boolean') {
                            renderer.showAll = true;
                        }
                    } catch { /* ignore */ }
                    try { renderer.onResize?.(); } catch { /* ignore */ }
                    try { renderer.onScroll?.(); } catch { /* ignore */ }
                    try { renderer.updateVirtualDisplay?.(); } catch { /* ignore */ }
                    try { renderer.queueRender?.(); } catch { /* ignore */ }
                    try { renderer.onRender?.(); } catch { /* ignore */ }
                    stablePasses = 0;
                    continue;
                }
                // Exhausted native virtualizer nudges; break out so we freeze hooks and hydrate remaining sections cleanly
                break;
            }

            stablePasses++;
            const needsExtraPass = !!sizerTarget.querySelector(PdfPlugin.ASYNC_WIDGET_SELECTOR);
            if (stablePasses >= (needsExtraPass ? 2 : 1)) break;
        }

        // CRITICAL: Freeze Obsidian's live virtualizer/re-render hooks BEFORE fallback hydration,
        // BEFORE removing .pdf-expand-reading-height, and BEFORE resetting scrollTop = 0, so
        // Obsidian can never unload or detach sections outside the natural viewport height!
        const hooksToFreeze: ReadingRendererHook[] = ['queueRender', 'onRender', 'updateVirtualDisplay', 'rerender', 'checkScroll', 'onScroll', 'onResize'];
        for (const hook of hooksToFreeze) {
            if (typeof renderer[hook] === 'function') {
                renderer[hook] = () => {};
            }
        }

        // Pass A: Re-attach every section in exact order and hydrate any section that remained
        // unrendered or empty via MarkdownRenderer.render() (which runs all code-block & post-processors).
        const sections: ObsidianReadingSection[] = Array.isArray(renderer.sections) ? renderer.sections : [];
        const sectionsToHydrate: Array<{ sec: ObsidianReadingSection; el: HTMLElement; md: string }> = [];
        for (const sec of sections) {
            if (!sec) continue;
            const range = readSectionLineRange(sec, sec.el);
            if (range && frontmatterLineCount > 0 && range.endLine <= frontmatterLineCount) {
                continue;
            }
            let secEl = sec.el;
            if (!secEl) {
                secEl = createDiv();
                sec.el = secEl;
            }
            if (secEl.parentElement !== sizerTarget) {
                sizerTarget.appendChild(secEl);
            }
            if (isSectionMissingDom(sec)) {
                const secMd = getSectionMarkdownSlice(sec, secEl);
                if (secMd.trim().length > 0 && !/^(?:<!--[\s\S]*?-->|%%[\s\S]*?%%|\s)+$/.test(secMd)) {
                    sectionsToHydrate.push({ sec, el: secEl, md: secMd });
                } else {
                    sec.rendered = true;
                }
            }
        }

        if (sectionsToHydrate.length > 0) {
            const chunkSize = 8;
            for (let i = 0; i < sectionsToHydrate.length; i += chunkSize) {
                if (shouldCancel?.()) return null;
                const chunk = sectionsToHydrate.slice(i, i + chunkSize);
                await Promise.all(chunk.map(async ({ sec, el, md }) => {
                    el.empty();
                    try {
                        await MarkdownRenderer.render(this.app, md, el, file.path, renderComponent);
                        sec.rendered = true;
                    } catch (e) {
                        console.warn('PDF Export: Section MarkdownRenderer fallback error', e);
                    }
                }));
            }
        }

        // Wait for all async MarkdownRenderChild / post-processor renders (including newly hydrated sections)
        await this.waitForAsyncRenderers(sizerTarget);
        if (shouldCancel?.()) return null;

        // Restore natural preview height AFTER hooks are frozen so layout rects measure cleanly
        if (previewEl) {
            previewEl.scrollTop = 0;
            previewEl.removeClass('pdf-expand-reading-height');
            await this.yieldFrameSafe(24);
        }

        const blocks: BlockItem[] = [];
        let nativeResolvedCount = 0;
        let maxNativeEndLine = 0;
        const distinctNativeStarts = new Set<number>();

        if (sections.length > 0) {
            for (const sec of sections) {
                const el = sec?.el;
                if (!el || !el.isConnected) continue;
                if (isNonContentEl(el)) continue;

                const resolved = readSectionLineRange(sec, el);
                const startLine = resolved ? resolved.startLine : -1;
                const endLine = resolved ? resolved.endLine : -1;
                if (resolved) {
                    nativeResolvedCount++;
                    distinctNativeStarts.add(resolved.startLine);
                    if (resolved.endLine > maxNativeEndLine) maxNativeEndLine = resolved.endLine;
                    if (frontmatterLineCount > 0 && endLine <= frontmatterLineCount) continue;
                }

                const rect = el.getBoundingClientRect();
                if (
                    rect.height === 0 &&
                    (el.textContent || '').trim() === '' &&
                    !el.querySelector('img, svg, canvas, hr, table, input, .pdf-image-slot')
                ) {
                    continue;
                }

                blocks.push({ el, startLine, endLine, forceBreakBefore: false });
            }
        } else {
            const rawChildren = Array.from(sizerTarget.children).filter(
                (c): c is HTMLElement => c.instanceOf(HTMLElement) && !isNonContentEl(c)
            );
            for (let i = 0; i < rawChildren.length; i++) {
                blocks.push({ el: rawChildren[i], startLine: -1, endLine: -1, forceBreakBefore: false });
            }
        }

        // Pass B: Tail-truncation safety net. If Obsidian's renderer.sections stopped before the end
        // of the Markdown file (e.g. incremental virtualizer cut off at ~40 sections), render the
        // missing trailing Markdown lines via MarkdownRenderer.render() so zero sections are ever lost.
        if (lastExpectedContentLine > 0 && nativeResolvedCount > 0 && maxNativeEndLine > 0 && maxNativeEndLine < lastExpectedContentLine) {
            const missingStartLine = maxNativeEndLine + 1;
            const remainingNonEmpty = this.collectNonEmptySourceLines(rawLines, missingStartLine, rawLines.length);
            if (remainingNonEmpty.length > 0) {
                const missingTailMd = rawLines.slice(missingStartLine - 1).join('\n');
                const tailHost = sizerTarget.createDiv({ cls: 'pdf-missing-tail-host' });
                try {
                    await MarkdownRenderer.render(this.app, missingTailMd, tailHost, file.path, renderComponent);
                    await this.waitForAsyncRenderers(tailHost);
                    if (shouldCancel?.()) return null;

                    const tailParsed = this.computeMarkdownBlockLines(missingTailMd, 0);
                    const tailChildren = Array.from(tailHost.children).filter(
                        (c): c is HTMLElement => c.instanceOf(HTMLElement) && !isNonContentEl(c)
                    );
                    let tailCursor = 0;
                    let tailLastLine = missingStartLine;
                    for (let tIdx = 0; tIdx < tailChildren.length; tIdx++) {
                        const childEl = tailChildren[tIdx];
                        // Move directly into sizerTarget so CSS selectors match native Reading View sections
                        sizerTarget.appendChild(childEl);
                        const rect = childEl.getBoundingClientRect();
                        if (
                            rect.height === 0 &&
                            (childEl.textContent || '').trim() === '' &&
                            !childEl.querySelector('img, svg, canvas, hr, table, input, .pdf-image-slot')
                        ) {
                            continue;
                        }
                        let tStart = tailLastLine;
                        let tEnd = tailLastLine;
                        if (tailCursor < tailParsed.blocks.length) {
                            tStart = missingStartLine - 1 + tailParsed.blocks[tailCursor].startLine;
                            tEnd = missingStartLine - 1 + tailParsed.blocks[tailCursor].endLine;
                            tailLastLine = tEnd;
                            tailCursor++;
                        } else {
                            tStart = Math.min(rawLines.length, tailLastLine);
                            tEnd = rawLines.length;
                        }
                        blocks.push({ el: childEl, startLine: tStart, endLine: tEnd, forceBreakBefore: false });
                        nativeResolvedCount++;
                        distinctNativeStarts.add(tStart);
                    }
                } catch (e) {
                    console.warn('PDF Export: Missing tail MarkdownRenderer fallback error', e);
                } finally {
                    tailHost.remove();
                }
            }
        }

        // Reconcile line numbers whenever native section line info is missing or collapsed (e.g. all 1s)
        const needsLineReconcile =
            blocks.length > 0 && (
                nativeResolvedCount < blocks.length ||
                (blocks.length > 1 && distinctNativeStarts.size <= 1)
            );

        if (needsLineReconcile) {
            const rawCachedSections: SectionCache[] = this.app.metadataCache.getFileCache(file)?.sections || [];
            const cachedBodySections = rawCachedSections.filter(
                s => s.type !== 'yaml' && s.type !== 'comment' && s.type !== 'footnoteDefinition'
            );
            const cachedFirstFn = rawCachedSections.find(s => s.type === 'footnoteDefinition');

            const sourceBlocks: Array<{ startLine: number; endLine: number; headingText?: string }> =
                parsedSource.blocks.length > 0
                    ? parsedSource.blocks
                    : cachedBodySections.map(s => ({
                        startLine: s.position.start.line + 1,
                        endLine: Math.max(s.position.start.line + 1, s.position.end.line + 1)
                    }));

            const footnoteStartLine =
                parsedSource.firstFootnoteLine ??
                (cachedFirstFn ? cachedFirstFn.position.start.line + 1 : null);

            const totalFileLines = Math.max(frontmatterLineCount + 1, rawLines.length);
            let srcCursor = 0;
            let lastAssignedLine = Math.max(1, frontmatterLineCount + 1);

            for (let i = 0; i < blocks.length; i++) {
                const blk = blocks[i];
                const isFootnotesEl = blk.el.classList.contains('footnotes') || !!blk.el.querySelector(':scope > section.footnotes, section.footnotes');
                if (isFootnotesEl && footnoteStartLine !== null) {
                    blk.startLine = footnoteStartLine;
                    blk.endLine = totalFileLines;
                    lastAssignedLine = Math.max(lastAssignedLine, blk.startLine);
                    continue;
                }

                // Heading anchor sync: if this DOM block is a heading, snap cursor to matching markdown heading
                const headingEl = blk.el.matches('h1, h2, h3, h4, h5, h6')
                    ? blk.el
                    : blk.el.querySelector<HTMLElement>(':scope > h1, :scope > h2, :scope > h3, :scope > h4, :scope > h5, :scope > h6');
                if (headingEl && sourceBlocks.length > 0) {
                    const domHeadingKey = this.normalizeAnchorKey(this.extractHeadingCleanText(headingEl));
                    if (domHeadingKey) {
                        const searchLimit = Math.min(sourceBlocks.length, srcCursor + 12);
                        for (let j = srcCursor; j < searchLimit; j++) {
                            if (sourceBlocks[j].headingText && sourceBlocks[j].headingText === domHeadingKey) {
                                srcCursor = j;
                                break;
                            }
                        }
                    }
                }

                if (srcCursor < sourceBlocks.length) {
                    blk.startLine = sourceBlocks[srcCursor].startLine;
                    blk.endLine = sourceBlocks[srcCursor].endLine;
                    lastAssignedLine = blk.endLine;
                    srcCursor++;
                } else {
                    const progress = blocks.length > 1 ? i / blocks.length : 0;
                    const est = Math.max(lastAssignedLine, frontmatterLineCount + 1 + Math.floor(progress * Math.max(1, totalFileLines - frontmatterLineCount)));
                    blk.startLine = Math.min(totalFileLines, est);
                    blk.endLine = blk.startLine;
                }
            }
        }

        if (blocks.length === 0 && hasBodyContent) {
            return null;
        }

        // Annotate individual sub-block items (list <li>, table <tr>, blockquote/callout items, footnotes)
        // with their exact 1-indexed editor line numbers before pagination or splitting.
        for (let i = 0; i < blocks.length; i++) {
            this.annotateSubBlockLineNumbers(blocks[i].el, blocks[i].startLine, blocks[i].endLine, rawLines);
        }

        // Detach unindented (column-0) non-list lines immediately following a list item into
        // separate flush-left paragraph blocks so PDF output matches Obsidian Live Preview.
        this.detachUnindentedTrailingListContinuations(blocks, rawLines);

        return { sizerEl: sizerTarget, blocks };
    }

    /**
     * CommonMark treats an unindented column-0 text line immediately after a list item (with no
     * blank line) as a lazy continuation inside that <li>, whereas Obsidian Live Preview renders it
     * flush-left as its own paragraph. This splits such column-0 trailing lines out into a sibling
     * flush-left paragraph block while preserving intentionally indented continuation lines inside <li>.
     */
    private detachUnindentedTrailingListContinuations(blocks: BlockItem[], rawLines: string[]): void {
        for (let i = 0; i < blocks.length; i++) {
            const blk = blocks[i];
            if (blk.isTitle) continue;
            const { target } = this.unwrapSplittableContainer(blk.el);
            if (target.tagName !== 'UL' && target.tagName !== 'OL') continue;

            const directLis = Array.from(target.children).filter(
                (ch): ch is HTMLElement => ch.tagName === 'LI'
            );
            if (directLis.length === 0) continue;
            const lastLi = directLis[directLis.length - 1];

            // Find the first <br data-pdf-br-line="..."> owned directly by lastLi (not nested lists)
            // whose source line starts at column 0 with non-list text.
            const brs = Array.from(lastLi.querySelectorAll<HTMLElement>('br[data-pdf-br-line]'));
            let splitBr: HTMLElement | null = null;
            let splitLineNum = 0;
            for (const br of brs) {
                const owningList = br.closest('ul, ol');
                if (owningList !== target) continue;
                const lineNum = parseInt(br.getAttribute('data-pdf-br-line') || '', 10);
                if (!Number.isFinite(lineNum) || lineNum < 1 || lineNum > rawLines.length) continue;
                const rawLine = rawLines[lineNum - 1] ?? '';
                if (!rawLine.trim()) continue;
                // Keep indented lines (e.g. "  continuation" or "\tcontinuation") inside the list item
                if (/^[ \t]/.test(rawLine)) continue;
                // Skip if it looks like another list item, blockquote, or code fence
                if (/^(?:[-*+]\s|\d+[.)]\s|>|```|~~~)/.test(rawLine)) continue;
                splitBr = br;
                splitLineNum = lineNum;
                break;
            }
            if (!splitBr || !splitLineNum) continue;

            try {
                const range = activeDocument.createRange();
                range.setStartAfter(splitBr);
                if (lastLi.lastChild) {
                    range.setEndAfter(lastLi.lastChild);
                } else {
                    continue;
                }
                const extracted = range.extractContents();
                splitBr.remove();

                // Strip leading whitespace-only text nodes so the detached paragraph starts cleanly flush-left
                while (
                    extracted.firstChild &&
                    extracted.firstChild.nodeType === Node.TEXT_NODE &&
                    !/\S/.test(extracted.firstChild.textContent || '')
                ) {
                    extracted.removeChild(extracted.firstChild);
                }
                if (extracted.firstChild && extracted.firstChild.nodeType === Node.TEXT_NODE && extracted.firstChild.textContent) {
                    extracted.firstChild.textContent = extracted.firstChild.textContent.replace(/^\s+/, '');
                }
                if (!extracted.textContent?.trim() && !extracted.querySelector('img, svg, canvas, .internal-embed, mjx-container, .math')) {
                    continue;
                }

                const newWrapper = createDiv({ cls: 'el-p' });
                const newP = createEl('p');
                newP.setAttribute('data-pdf-line', String(splitLineNum));
                newP.appendChild(extracted);
                newWrapper.appendChild(newP);

                // Keep DOM order consistent so pre-measurement getBoundingClientRect() sees the detached paragraph
                blk.el.after(newWrapper);

                const origEndLine = blk.endLine;
                blk.endLine = Math.max(blk.startLine, splitLineNum - 1);
                blocks.splice(i + 1, 0, {
                    el: newWrapper,
                    startLine: splitLineNum,
                    endLine: Math.max(splitLineNum, origEndLine)
                });
            } catch {
                // Keep original list intact if DOM extraction fails
            }
        }
    }

    /**
     * Returns true if `br` is followed by visible text or an atomic inline element inside `container`
     * before any subsequent `<br>` (or before entering an excluded descendant such as a nested list).
     */
    private hasVisibleContentAfterBr(br: HTMLElement, container: HTMLElement, excludeSelector?: string): boolean {
        const walker = activeDocument.createTreeWalker(
            container,
            NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT
        );
        walker.currentNode = br;
        let node = walker.nextNode();
        while (node) {
            if (excludeSelector) {
                const checkEl = node.nodeType === Node.ELEMENT_NODE ? (node as HTMLElement) : node.parentElement;
                const closestExcluded = checkEl?.closest(excludeSelector);
                if (closestExcluded && closestExcluded !== container && container.contains(closestExcluded)) {
                    return false;
                }
            }
            if (node.nodeType === Node.ELEMENT_NODE) {
                const el = node as HTMLElement;
                if (el.tagName === 'BR') return false;
                if (
                    el.tagName === 'IMG' ||
                    el.tagName === 'SVG' ||
                    el.tagName === 'CANVAS' ||
                    el.tagName === 'INPUT' ||
                    el.tagName === 'VIDEO' ||
                    el.tagName === 'AUDIO' ||
                    el.tagName === 'MJX-CONTAINER' ||
                    el.classList.contains('math')
                ) {
                    return true;
                }
            } else if (node.nodeType === Node.TEXT_NODE) {
                if (/\S/.test(node.textContent || '')) {
                    return true;
                }
            }
            node = walker.nextNode();
        }
        return false;
    }

    /**
     * Collects non-empty, non-comment 1-indexed source line numbers in `[startLine..endLine]`.
     * Optionally strips leading blockquote markers (`>`) before checking for emptiness.
     */
    private collectNonEmptySourceLines(
        rawLines: string[],
        startLine: number,
        endLine: number,
        stripQuotePrefix: boolean = false
    ): number[] {
        const result: number[] = [];
        const from = Math.max(1, startLine);
        const to = Math.min(rawLines.length, endLine);
        let inHtmlComment = false;
        let inObsidianComment = false;
        for (let lineNum = from; lineNum <= to; lineNum++) {
            let text = rawLines[lineNum - 1] ?? '';
            if (stripQuotePrefix) {
                text = text.replace(/^\s*(?:>\s*)+/, '');
            }
            const trimmed = text.trim();
            if (inHtmlComment) {
                if (trimmed.includes('-->')) inHtmlComment = false;
                continue;
            }
            if (inObsidianComment) {
                if (trimmed.includes('%%')) inObsidianComment = false;
                continue;
            }
            if (trimmed === '') continue;
            if (trimmed.startsWith('<!--')) {
                if (!trimmed.includes('-->')) inHtmlComment = true;
                continue;
            }
            if (trimmed.startsWith('%%')) {
                if (!trimmed.slice(2).includes('%%')) inObsidianComment = true;
                continue;
            }
            result.push(lineNum);
        }
        return result;
    }

    /**
     * Stamps `data-pdf-line` on `container` (if not already set) and `data-pdf-br-line` on each
     * `<br>` inside `container` that precedes visible content, consuming line numbers from `lineNums`.
     * Returns the number of lines consumed from `lineNums`.
     */
    private annotateBrLinesInElement(
        container: HTMLElement,
        lineNums: number[],
        startIndex: number = 0,
        excludeSelector?: string
    ): number {
        if (startIndex >= lineNums.length) return 0;
        if (!container.hasAttribute('data-pdf-line')) {
            container.setAttribute('data-pdf-line', String(lineNums[startIndex]));
        }
        let consumed = 1;
        const brs = Array.from(container.querySelectorAll('br')) as HTMLElement[];
        for (let i = 0; i < brs.length; i++) {
            const br = brs[i];
            if (excludeSelector) {
                const closestExcluded = br.closest(excludeSelector);
                if (closestExcluded && closestExcluded !== container && container.contains(closestExcluded)) {
                    continue;
                }
            }
            if (!this.hasVisibleContentAfterBr(br, container, excludeSelector)) continue;
            if (startIndex + consumed < lineNums.length) {
                br.setAttribute('data-pdf-br-line', String(lineNums[startIndex + consumed]));
                consumed++;
            } else {
                break;
            }
        }
        return consumed;
    }

    /**
     * Stamps `data-pdf-line`, `data-pdf-br-line`, and `data-pdf-code-start-line` (1-indexed) onto
     * individual sub-elements inside multi-line Markdown blocks (paragraphs with `<br>`, lists,
     * nested lists, tables, blockquotes/callouts, code blocks, footnotes) so preview line numbers
     * appear on every non-empty source line instead of only the first line of the block.
     */
    private annotateSubBlockLineNumbers(
        blockEl: HTMLElement,
        startLine: number,
        endLine: number,
        rawLines: string[]
    ): void {
        if (!blockEl || startLine <= 0) return;
        const clampedStart = Math.max(1, startLine);
        const clampedEnd = Math.min(rawLines.length, Math.max(clampedStart, endLine));

        // 1. Footnotes section (<section class="footnotes">)
        if (blockEl.classList.contains('footnotes') || blockEl.querySelector(':scope > section.footnotes, section.footnotes')) {
            const fnItems = Array.from(blockEl.querySelectorAll<HTMLElement>('ol > li, li'));
            if (fnItems.length > 0) {
                const fnLineNums: number[] = [];
                for (let idx = clampedStart - 1; idx < rawLines.length; idx++) {
                    if (/^\[\^[^\]]+\]:/.test(rawLines[idx].trim())) {
                        fnLineNums.push(idx + 1);
                    }
                }
                const assignedLines: number[] = [];
                for (let k = 0; k < fnItems.length; k++) {
                    const li = fnItems[k];
                    const nativeDataLine = li.getAttribute('data-line');
                    const parsedNative = nativeDataLine ? parseInt(nativeDataLine, 10) : NaN;
                    const lineNum =
                        !isNaN(parsedNative) && parsedNative >= 0
                            ? parsedNative + 1
                            : (fnLineNums[k] ?? Math.min(rawLines.length, clampedStart + k));
                    li.setAttribute('data-pdf-line', String(lineNum));
                    assignedLines.push(lineNum);
                }
                for (let k = 0; k < fnItems.length; k++) {
                    const li = fnItems[k];
                    const nextStart = k + 1 < assignedLines.length ? assignedLines[k + 1] - 1 : rawLines.length;
                    if (nextStart > assignedLines[k] && li.querySelector('br')) {
                        const subLines = this.collectNonEmptySourceLines(rawLines, assignedLines[k], nextStart);
                        this.annotateBrLinesInElement(li, subLines, 0);
                    }
                }
            }
            return;
        }

        // 2. Lists (<ul> / <ol>, including nested sub-lists and multi-line <li> with <br>)
        const hasTopList =
            blockEl.tagName === 'UL' ||
            blockEl.tagName === 'OL' ||
            !!blockEl.querySelector(':scope > ul, :scope > ol');
        if (hasTopList) {
            const allLis = Array.from(blockEl.querySelectorAll('li')) as HTMLElement[];
            if (allLis.length > 0) {
                const listLineNums: number[] = [];
                for (let idx = clampedStart - 1; idx < clampedEnd; idx++) {
                    if (/^\s*(?:[-*+]|\d+[.)])\s+/.test(rawLines[idx])) {
                        listLineNums.push(idx + 1);
                    }
                }
                const assignedLines: number[] = [];
                for (let k = 0; k < allLis.length; k++) {
                    const li = allLis[k];
                    const nativeDataLine = li.getAttribute('data-line');
                    const parsedNative = nativeDataLine ? parseInt(nativeDataLine, 10) : NaN;
                    let lineNum: number;
                    if (!isNaN(parsedNative) && parsedNative >= 0 && parsedNative + 1 >= clampedStart && parsedNative + 1 <= clampedEnd) {
                        lineNum = parsedNative + 1;
                    } else if (k < listLineNums.length) {
                        lineNum = listLineNums[k];
                    } else {
                        lineNum = Math.min(clampedEnd, clampedStart + k);
                    }
                    li.setAttribute('data-pdf-line', String(lineNum));
                    assignedLines.push(lineNum);
                }
                for (let k = 0; k < allLis.length; k++) {
                    const li = allLis[k];
                    const liStart = assignedLines[k];
                    const liEnd = k + 1 < assignedLines.length ? assignedLines[k + 1] - 1 : clampedEnd;
                    if (liEnd <= liStart) continue;
                    const liSourceLines = this.collectNonEmptySourceLines(rawLines, liStart, liEnd);
                    if (liSourceLines.length <= 1) continue;
                    const directBlocks = Array.from(li.children).filter(
                        (c): c is HTMLElement =>
                            c.instanceOf(HTMLElement) &&
                            (c.tagName === 'P' || c.tagName === 'PRE' || c.tagName === 'BLOCKQUOTE' || c.classList.contains('callout'))
                    );
                    if (directBlocks.length > 0) {
                        let cursor = 0;
                        // If there is inline lead text BEFORE the first direct block child, it consumes the <li>'s starting line
                        const firstBlock = directBlocks[0];
                        let hasLeadText = false;
                        for (const node of Array.from(li.childNodes)) {
                            if (node === firstBlock) break;
                            if (node.nodeType === Node.TEXT_NODE && (node.textContent || '').trim().length > 0) {
                                hasLeadText = true;
                                break;
                            }
                            if (node.nodeType === Node.ELEMENT_NODE) {
                                const elN = node as HTMLElement;
                                if (!elN.classList.contains('list-bullet') && !elN.classList.contains('list-collapse-indicator') && (elN.textContent || '').trim().length > 0) {
                                    hasLeadText = true;
                                    break;
                                }
                            }
                        }
                        if (hasLeadText) {
                            cursor = 1;
                        }
                        for (let bIdx = 0; bIdx < directBlocks.length && cursor < liSourceLines.length; bIdx++) {
                            const blk = directBlocks[bIdx];
                            if (blk.tagName === 'P') {
                                cursor += this.annotateBrLinesInElement(blk, liSourceLines, cursor);
                            } else if (blk.tagName === 'PRE') {
                                const codeNode = blk.querySelector<HTMLElement>('code') || blk;
                                const lineCount = Math.max(1, (codeNode.textContent || '').replace(/\n$/, '').split('\n').length);
                                const startL = liSourceLines[cursor];
                                const endL = liSourceLines[Math.min(liSourceLines.length - 1, cursor + lineCount - 1)] ?? startL;
                                codeNode.setAttribute('data-pdf-code-start-line', String(startL));
                                codeNode.setAttribute('data-pdf-code-end-line', String(endL));
                                cursor += lineCount;
                            } else {
                                blk.setAttribute('data-pdf-line', String(liSourceLines[cursor]));
                                cursor++;
                            }
                        }
                    } else if (li.querySelector('br')) {
                        this.annotateBrLinesInElement(li, liSourceLines, 0, 'ul, ol');
                    }
                }
            }
            return;
        }

        // 3. Tables (<table>)
        const tableEl = blockEl.tagName === 'TABLE'
            ? blockEl
            : blockEl.querySelector<HTMLElement>(':scope > table, table');
        if (tableEl) {
            const rows = Array.from(tableEl.querySelectorAll<HTMLElement>('thead > tr, tbody > tr, :scope > tr'));
            if (rows.length > 1) {
                const tableLineNums: number[] = [];
                for (let idx = clampedStart - 1; idx < clampedEnd; idx++) {
                    const line = rawLines[idx];
                    if (line.trim() === '' || /^\s*\|?[\s:-]+\|[\s|:-]*$/.test(line)) continue;
                    if (/\|/.test(line)) tableLineNums.push(idx + 1);
                }
                for (let k = 0; k < rows.length; k++) {
                    const lineNum = k < tableLineNums.length
                        ? tableLineNums[k]
                        : Math.min(clampedEnd, clampedStart + (k === 0 ? 0 : k + 1));
                    rows[k].setAttribute('data-pdf-line', String(lineNum));
                }
            }
            return;
        }

        // 4. Blockquotes / Callouts (paragraphs, <br> soft breaks, headings, lists)
        const bqOrCallout = blockEl.matches('blockquote, .callout')
            ? blockEl
            : blockEl.querySelector<HTMLElement>(':scope > blockquote, :scope > .callout');
        if (bqOrCallout && clampedEnd > clampedStart) {
            const strippedLines = this.collectNonEmptySourceLines(rawLines, clampedStart, clampedEnd, true);
            const titleEl = bqOrCallout.querySelector<HTMLElement>(':scope > .callout-title');
            let lineCursor = 0;
            if (titleEl) {
                titleEl.setAttribute('data-pdf-line', String(strippedLines[0] ?? clampedStart));
                lineCursor = 1;
            }

            const bodyRoot = bqOrCallout.querySelector<HTMLElement>(':scope > .callout-content') || bqOrCallout;
            const bodyItems = Array.from(bodyRoot.querySelectorAll<HTMLElement>('p, li, h1, h2, h3, h4, h5, h6'));
            for (let i = 0; i < bodyItems.length && lineCursor < strippedLines.length; i++) {
                const el = bodyItems[i];
                // Skip <p> inside <li> (the <li> itself handles its first line and <br>s)
                if (el.tagName === 'P' && el.parentElement?.tagName === 'LI') continue;
                if (titleEl && titleEl.contains(el)) continue;

                if (el.tagName === 'LI') {
                    // Prefer the next list-syntax line if available at or after lineCursor
                    let matchIdx = lineCursor;
                    for (let j = lineCursor; j < strippedLines.length; j++) {
                        const stripped = (rawLines[strippedLines[j] - 1] ?? '').replace(/^\s*(?:>\s*)+/, '');
                        if (/^\s*(?:[-*+]|\d+[.)])\s+/.test(stripped)) {
                            matchIdx = j;
                            break;
                        }
                    }
                    lineCursor = matchIdx;
                    const nextItem = bodyItems[i + 1];
                    if (el.querySelector('br') && (!nextItem || nextItem.tagName !== 'LI')) {
                        lineCursor += this.annotateBrLinesInElement(el, strippedLines, lineCursor, 'ul, ol');
                    } else {
                        el.setAttribute('data-pdf-line', String(strippedLines[lineCursor]));
                        lineCursor++;
                    }
                } else {
                    lineCursor += this.annotateBrLinesInElement(el, strippedLines, lineCursor);
                }
            }
            return;
        }

        // 5. Fenced / Indented Code Blocks (<pre><code>) — including single-line indented blocks
        const preEl = blockEl.tagName === 'PRE'
            ? blockEl
            : blockEl.querySelector<HTMLElement>(':scope > pre');
        if (preEl && clampedEnd >= clampedStart) {
            const codeEl = preEl.querySelector<HTMLElement>('code') || preEl;
            if ((codeEl.textContent || '').trim().length > 0) {
                const firstRaw = rawLines[clampedStart - 1] ?? '';
                const isFenced = /^\s*(?:`{3,}|~{3,})/.test(firstRaw);
                const lastRaw = rawLines[clampedEnd - 1] ?? '';
                const hasClosingFence = isFenced && /^\s*(?:`{3,}|~{3,})\s*$/.test(lastRaw) && clampedEnd > clampedStart;
                const codeStartLine = isFenced ? Math.min(clampedEnd, clampedStart + 1) : clampedStart;
                const codeEndLine = hasClosingFence ? Math.max(codeStartLine, clampedEnd - 1) : clampedEnd;
                codeEl.setAttribute('data-pdf-code-start-line', String(codeStartLine));
                codeEl.setAttribute('data-pdf-code-end-line', String(codeEndLine));
            }
            return;
        }

        // 6. Paragraphs (<p>) with <br> soft line breaks (or multiple <p> children inside a block wrapper)
        if (clampedEnd > clampedStart) {
            const paragraphs: HTMLElement[] =
                blockEl.tagName === 'P'
                    ? [blockEl]
                    : Array.from(blockEl.querySelectorAll<HTMLElement>(':scope > p'));
            if (paragraphs.length > 0) {
                const paraLines = this.collectNonEmptySourceLines(rawLines, clampedStart, clampedEnd);
                if (paraLines.length > 1) {
                    let cursor = 0;
                    for (let pIdx = 0; pIdx < paragraphs.length && cursor < paraLines.length; pIdx++) {
                        cursor += this.annotateBrLinesInElement(paragraphs[pIdx], paraLines, cursor);
                    }
                }
            }
        }
    }

    /**
     * Measures the visual top Y coordinate (viewport px) of the first visible content node/glyph
     * immediately following `br` inside `container`, adjusted for half-leading so line numbers
     * align with block-level line numbers on both LTR and RTL lines.
     */
    private measureLineTopAfterBr(br: HTMLElement, container: HTMLElement): number | null {
        const walker = activeDocument.createTreeWalker(
            container,
            NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT
        );
        walker.currentNode = br;
        let node = walker.nextNode();
        while (node) {
            if (node.nodeType === Node.ELEMENT_NODE) {
                const el = node as HTMLElement;
                if (el.tagName === 'BR') return null;
                if (
                    el.tagName === 'IMG' ||
                    el.tagName === 'SVG' ||
                    el.tagName === 'CANVAS' ||
                    el.tagName === 'INPUT' ||
                    el.tagName === 'VIDEO' ||
                    el.tagName === 'AUDIO' ||
                    el.tagName === 'MJX-CONTAINER' ||
                    el.classList.contains('math')
                ) {
                    const r = el.getBoundingClientRect();
                    if (r.height > 0) return r.top;
                }
            } else if (node.nodeType === Node.TEXT_NODE) {
                const txt = node.textContent || '';
                const match = /\S/.exec(txt);
                if (match) {
                    const idx = match.index;
                    const cp = txt.codePointAt(idx);
                    const charLen = cp !== undefined && cp > 0xFFFF ? 2 : 1;
                    const range = activeDocument.createRange();
                    range.setStart(node, idx);
                    range.setEnd(node, Math.min(txt.length, idx + charLen));
                    const rects = range.getClientRects();
                    let rect: DOMRect | null = null;
                    for (let rIdx = 0; rIdx < rects.length; rIdx++) {
                        if (rects[rIdx].height > 0) {
                            rect = rects[rIdx];
                            break;
                        }
                    }
                    if (!rect) {
                        const fallbackRect = range.getBoundingClientRect();
                        if (fallbackRect.height > 0) rect = fallbackRect;
                    }
                    if (rect) {
                        const parentEl = node.parentElement || container;
                        const cs = window.getComputedStyle(parentEl);
                        const parsedLh = parseFloat(cs.lineHeight);
                        const lineHeightPx = !isNaN(parsedLh) && parsedLh > 0 ? parsedLh : rect.height;
                        const halfLeading = Math.max(0, Math.min(6, (lineHeightPx - rect.height) / 2));
                        return rect.top - halfLeading;
                    }
                }
            }
            node = walker.nextNode();
        }
        return null;
    }

    /**
     * Extracts exact `(line, offsetTopPx)` preview line markers for a mounted block element,
     * expanding `[data-pdf-line]`, `br[data-pdf-br-line]`, and `[data-pdf-code-start-line]` markers.
     */
    private extractBlockLineMarkerOffsets(
        blockEl: HTMLElement,
        fallbackLine: number,
        sizerTop: number,
        seenLines: Set<number>,
        out: Array<{ line: number; offsetTopPx: number }>
    ): void {
        const beforeCount = out.length;

        // 1. Sub-elements explicitly stamped with data-pdf-line (including blockEl itself)
        const subMarked: HTMLElement[] = [];
        if (blockEl.matches('[data-pdf-line]')) {
            subMarked.push(blockEl);
        }
        const descMarked = blockEl.querySelectorAll('[data-pdf-line]');
        for (let i = 0; i < descMarked.length; i++) {
            subMarked.push(descMarked[i] as HTMLElement);
        }
        for (let sIdx = 0; sIdx < subMarked.length; sIdx++) {
            const subEl = subMarked[sIdx];
            const parsedLine = parseInt(subEl.getAttribute('data-pdf-line') || '', 10);
            if (isNaN(parsedLine) || parsedLine <= 0 || seenLines.has(parsedLine)) continue;
            const r = subEl.getBoundingClientRect();
            if (r.height <= 0 && r.width <= 0) continue;
            seenLines.add(parsedLine);
            out.push({
                line: parsedLine,
                offsetTopPx: Math.max(0, r.top - sizerTop)
            });
        }

        // 2. Soft line breaks (<br data-pdf-br-line="N">) inside paragraphs, list items, blockquotes, callouts
        const brMarked = blockEl.querySelectorAll('br[data-pdf-br-line]');
        for (let bIdx = 0; bIdx < brMarked.length; bIdx++) {
            const br = brMarked[bIdx] as HTMLElement;
            const parsedLine = parseInt(br.getAttribute('data-pdf-br-line') || '', 10);
            if (isNaN(parsedLine) || parsedLine <= 0 || seenLines.has(parsedLine)) continue;
            const container = br.closest<HTMLElement>('p, li, blockquote, .callout, div') || blockEl;
            const lineTop = this.measureLineTopAfterBr(br, container);
            if (lineTop === null) continue;
            seenLines.add(parsedLine);
            out.push({
                line: parsedLine,
                offsetTopPx: Math.max(0, lineTop - sizerTop)
            });
        }

        // 3. Multi-line code blocks (<code data-pdf-code-start-line="N" data-pdf-code-end-line="M">)
        const codeMarked: HTMLElement[] = [];
        if (blockEl.matches('[data-pdf-code-start-line]')) {
            codeMarked.push(blockEl);
        }
        const descCodeMarked = blockEl.querySelectorAll('[data-pdf-code-start-line]');
        for (let i = 0; i < descCodeMarked.length; i++) {
            codeMarked.push(descCodeMarked[i] as HTMLElement);
        }
        for (let cIdx = 0; cIdx < codeMarked.length; cIdx++) {
            const codeEl = codeMarked[cIdx];
            const codeStart = parseInt(codeEl.getAttribute('data-pdf-code-start-line') || '', 10);
            const codeEnd = parseInt(codeEl.getAttribute('data-pdf-code-end-line') || '', 10);
            if (isNaN(codeStart) || codeStart <= 0) continue;
            const maxCodeLine = !isNaN(codeEnd) && codeEnd >= codeStart ? codeEnd : codeStart + 5000;
            const cs = window.getComputedStyle(codeEl);
            const parsedLh = parseFloat(cs.lineHeight);
            const walker = activeDocument.createTreeWalker(codeEl, NodeFilter.SHOW_TEXT);
            let currentLine = codeStart;
            let emittedCurrentLine = false;
            let tNode = walker.nextNode() as Text | null;
            while (tNode && currentLine <= maxCodeLine) {
                const txt = tNode.textContent || '';
                let segStart = 0;
                while (segStart <= txt.length && currentLine <= maxCodeLine) {
                    const nlIdx = txt.indexOf('\n', segStart);
                    const segEnd = nlIdx === -1 ? txt.length : nlIdx;
                    if (!emittedCurrentLine && segEnd > segStart && !seenLines.has(currentLine)) {
                        const seg = txt.slice(segStart, segEnd);
                        const match = /\S/.exec(seg);
                        if (match) {
                            const charIdx = segStart + match.index;
                            const cp = txt.codePointAt(charIdx);
                            const charLen = cp !== undefined && cp > 0xFFFF ? 2 : 1;
                            const range = activeDocument.createRange();
                            range.setStart(tNode, charIdx);
                            range.setEnd(tNode, Math.min(txt.length, charIdx + charLen));
                            const rects = range.getClientRects();
                            const rect = (rects.length > 0 && rects[0].height > 0) ? rects[0] : range.getBoundingClientRect();
                            if (rect.height > 0) {
                                const lhPx = !isNaN(parsedLh) && parsedLh > 0 ? parsedLh : rect.height;
                                const halfLeading = Math.max(0, Math.min(6, (lhPx - rect.height) / 2));
                                seenLines.add(currentLine);
                                out.push({
                                    line: currentLine,
                                    offsetTopPx: Math.max(0, rect.top - halfLeading - sizerTop)
                                });
                                emittedCurrentLine = true;
                            }
                        }
                    }
                    if (nlIdx === -1) break;
                    currentLine++;
                    emittedCurrentLine = false;
                    segStart = nlIdx + 1;
                }
                tNode = walker.nextNode() as Text | null;
            }
        }

        // 4. Fallback for single-line blocks (headings, single-line paragraphs, HRs, math, images, etc.)
        if (out.length === beforeCount && fallbackLine > 0 && !seenLines.has(fallbackLine)) {
            seenLines.add(fallbackLine);
            out.push({
                line: fallbackLine,
                offsetTopPx: Math.max(0, blockEl.getBoundingClientRect().top - sizerTop)
            });
        }
    }

    /**
     * Parses raw Markdown text into top-level block line ranges (1-indexed) for rock-solid
     * editor line number mapping even on unsaved edits or when Obsidian omits section.lineStart.
     */
    private computeMarkdownBlockLines(
        rawContent: string,
        frontmatterLineCount: number
    ): { blocks: Array<{ startLine: number; endLine: number; headingText?: string }>; firstFootnoteLine: number | null } {
        const lines = rawContent.split('\n');
        const blocks: Array<{ startLine: number; endLine: number; headingText?: string }> = [];
        let firstFootnoteLine: number | null = null;

        let i = Math.max(0, frontmatterLineCount);
        const n = lines.length;

        const isListLine = (s: string): boolean => /^\s*(?:[-*+]|\d+[.)])\s+/.test(s);
        const isHeadingLine = (s: string): boolean => /^\s*#{1,6}\s+/.test(s);
        const isHrLine = (s: string): boolean => /^\s*(?:[-*_]\s*){3,}$/.test(s);
        const isFenceLine = (s: string): RegExpMatchArray | null => s.match(/^\s*(`{3,}|~{3,})/);
        const isTableLine = (s: string): boolean => /\|/.test(s);
        const isFootnoteDef = (s: string): boolean => /^\[\^[^\]]+\]:/.test(s);

        while (i < n) {
            const line = lines[i];
            const trimmed = line.trim();

            if (trimmed === '') {
                i++;
                continue;
            }

            // Skip HTML comments
            if (trimmed.startsWith('<!--')) {
                while (i < n && !lines[i].includes('-->')) i++;
                i++;
                continue;
            }

            // Skip Obsidian %% comments %%
            if (trimmed.startsWith('%%')) {
                if (!trimmed.slice(2).includes('%%')) {
                    i++;
                    while (i < n && !lines[i].includes('%%')) i++;
                }
                i++;
                continue;
            }

            // Footnote definitions render together in a trailing <section class="footnotes">
            if (isFootnoteDef(trimmed)) {
                if (firstFootnoteLine === null) firstFootnoteLine = i + 1;
                i++;
                while (i < n) {
                    const nextLine = lines[i];
                    if (nextLine.trim() === '') {
                        if (i + 1 < n && /^(?: {2,}|\t)/.test(lines[i + 1])) {
                            i++;
                            continue;
                        }
                        break;
                    }
                    if (/^(?: {2,}|\t)/.test(nextLine)) {
                        i++;
                        continue;
                    }
                    break;
                }
                continue;
            }

            // Fenced code block
            const fenceMatch = isFenceLine(line);
            if (fenceMatch) {
                const startLine = i + 1;
                const fenceChar = fenceMatch[1][0];
                const fenceLen = fenceMatch[1].length;
                i++;
                while (i < n) {
                    const closeRe = new RegExp(`^\\s*${fenceChar === '`' ? '`' : '~'}{${fenceLen},}\\s*$`);
                    if (closeRe.test(lines[i])) {
                        i++;
                        break;
                    }
                    i++;
                }
                blocks.push({ startLine, endLine: Math.max(startLine, i) });
                continue;
            }

            // Display math block $$ ... $$
            if (trimmed.startsWith('$$')) {
                const startLine = i + 1;
                if (trimmed.length > 2 && trimmed.endsWith('$$')) {
                    i++;
                } else {
                    i++;
                    while (i < n && !lines[i].trim().endsWith('$$')) i++;
                    if (i < n) i++;
                }
                blocks.push({ startLine, endLine: Math.max(startLine, i) });
                continue;
            }

            // ATX heading
            if (isHeadingLine(line)) {
                const startLine = i + 1;
                const rawHeading = line.replace(/^\s*#{1,6}\s+/, '').replace(/\s+#+\s*$/, '').trim();
                blocks.push({
                    startLine,
                    endLine: startLine,
                    headingText: this.normalizeAnchorKey(rawHeading)
                });
                i++;
                continue;
            }

            // Horizontal rule
            if (isHrLine(line)) {
                blocks.push({ startLine: i + 1, endLine: i + 1 });
                i++;
                continue;
            }

            // Blockquote / Callout
            if (trimmed.startsWith('>')) {
                const startLine = i + 1;
                i++;
                while (i < n && lines[i].trim().startsWith('>')) i++;
                blocks.push({ startLine, endLine: Math.max(startLine, i) });
                continue;
            }

            // List (unordered or ordered, including nested / loose items)
            if (isListLine(line)) {
                const startLine = i + 1;
                i++;
                while (i < n) {
                    const curr = lines[i];
                    const currTrim = curr.trim();
                    if (currTrim === '') {
                        if (i + 1 < n && (isListLine(lines[i + 1]) || /^(?: {2,}|\t)/.test(lines[i + 1]))) {
                            i++;
                            continue;
                        }
                        break;
                    }
                    if (isListLine(curr) || /^(?: {2,}|\t)/.test(curr)) {
                        i++;
                        continue;
                    }
                    if (isHeadingLine(curr) || isFenceLine(curr) || currTrim.startsWith('>') || currTrim.startsWith('$$') || currTrim.startsWith('<!--') || isHrLine(curr) || isFootnoteDef(currTrim)) {
                        break;
                    }
                    i++;
                }
                blocks.push({ startLine, endLine: Math.max(startLine, i) });
                continue;
            }

            // Table
            if (isTableLine(line) && i + 1 < n && /^\s*\|?[\s:-]+\|[\s|:-]*$/.test(lines[i + 1])) {
                const startLine = i + 1;
                i += 2;
                while (i < n && lines[i].trim() !== '' && isTableLine(lines[i])) i++;
                blocks.push({ startLine, endLine: Math.max(startLine, i) });
                continue;
            }

            // Paragraph (contiguous lines until blank line or new block starter)
            const startLine = i + 1;
            i++;
            while (i < n) {
                const curr = lines[i];
                const currTrim = curr.trim();
                if (
                    currTrim === '' ||
                    isHeadingLine(curr) ||
                    isFenceLine(curr) ||
                    currTrim.startsWith('>') ||
                    currTrim.startsWith('$$') ||
                    currTrim.startsWith('<!--') ||
                    isHrLine(curr) ||
                    isListLine(curr) ||
                    isFootnoteDef(currTrim)
                ) {
                    break;
                }
                i++;
            }
            blocks.push({ startLine, endLine: Math.max(startLine, i) });
        }

        return { blocks, firstFootnoteLine };
    }

    /**
     * Primary Reading Mode renderer: instantiates a genuine MarkdownView in Reading Mode ('preview')
     * on an isolated WorkspaceLeaf mounted inside our hidden renderRoot (never added to rootSplit,
     * never touching user tabs, focus, history, or layout). Every Reading Mode plugin (code block
     * processors, post-processors, MarkdownRenderChild lifecycles, DOM ancestry checks) runs natively.
     */
    private async renderWithRealMarkdownView(
        file: TFile,
        rawContent: string,
        isUnsavedFromDisk: boolean,
        renderRoot: HTMLElement,
        noteCssClasses: string[],
        frontmatterLineCount: number,
        hasBodyContent: boolean,
        renderComponent: Component,
        shouldCancel?: () => boolean
    ): Promise<{ sizerEl: HTMLElement; blocks: BlockItem[]; cleanup: () => void } | null> {
        let isolatedLeaf: ObsidianWorkspaceLeafInternal | null = null;
        let mdView: ObsidianMarkdownViewInternal | null = null;
        const cleanup = () => {
            const prevGuard = this.isRenderingHiddenView;
            this.isRenderingHiddenView = true;
            try {
                try { void (mdView as unknown as ObsidianViewLifecycle | null)?.onClose?.(); } catch { /* ignore */ }
                try { mdView?.unload?.(); } catch { /* ignore */ }
                try {
                    if (isolatedLeaf?.containerEl && isolatedLeaf.containerEl.instanceOf(HTMLElement)) {
                        isolatedLeaf.containerEl.remove();
                    }
                } catch { /* ignore */ }
            } finally {
                this.isRenderingHiddenView = prevGuard;
            }
        };

        const prevGuard = this.isRenderingHiddenView;
        this.isRenderingHiddenView = true;
        try {
            const LeafCtor = WorkspaceLeaf as unknown as WorkspaceLeafConstructor;
            isolatedLeaf = new LeafCtor(this.app);
            if (!isolatedLeaf || !isolatedLeaf.containerEl || !isolatedLeaf.containerEl.instanceOf(HTMLElement)) {
                cleanup();
                return null;
            }

            // Keep the leaf completely isolated from Obsidian's visible workspace splits/tabs,
            // while still providing valid root/container references for internal Obsidian APIs.
            // Note: WorkspaceLeaf extends WorkspaceItem/Events (NOT Component), so do not call addChild on it.
            const rootSplit = this.app.workspace.rootSplit;
            isolatedLeaf.getRoot = () => rootSplit;
            isolatedLeaf.getContainer = () => rootSplit;
            isolatedLeaf.updateHeader = () => {};
            if (typeof isolatedLeaf.setEphemeralState === 'function') {
                isolatedLeaf.setEphemeralState = () => {};
            }

            renderRoot.appendChild(isolatedLeaf.containerEl);

            mdView = new MarkdownView(isolatedLeaf);
            const mdLifecycle = mdView as unknown as ObsidianViewLifecycle;
            if (typeof isolatedLeaf.open === 'function') {
                try {
                    await isolatedLeaf.open(mdView);
                } catch {
                    isolatedLeaf.view = mdView;
                    if (mdView.containerEl.parentElement !== isolatedLeaf.containerEl) {
                        isolatedLeaf.containerEl.appendChild(mdView.containerEl);
                    }
                    renderComponent.addChild(mdView);
                    await mdLifecycle.onOpen?.();
                }
            } else {
                isolatedLeaf.view = mdView;
                if (mdView.containerEl.parentElement !== isolatedLeaf.containerEl) {
                    isolatedLeaf.containerEl.appendChild(mdView.containerEl);
                }
                renderComponent.addChild(mdView);
                await mdLifecycle.onOpen?.();
            }

            if (!mdView._loaded && typeof mdView.load === 'function') {
                renderComponent.addChild(mdView);
            }

            if (shouldCancel?.()) {
                cleanup();
                return null;
            }

            // Pre-expand previewEl BEFORE setState so Obsidian's initial virtualized pass already
            // sees the full tall viewport from frame 0.
            const initialPreviewEl = mdView.containerEl.querySelector<HTMLElement>('.markdown-preview-view');
            if (initialPreviewEl) {
                initialPreviewEl.addClass('pdf-expand-reading-height');
            }

            // Load the file in Reading Mode ('preview') without touching navigation history
            await mdView.setState({ file: file.path, mode: 'preview', source: false }, { history: false });
            if (shouldCancel?.()) {
                cleanup();
                return null;
            }

            const previewMode = mdView.previewMode as unknown as ObsidianMarkdownPreviewMode | undefined;
            if (previewMode && typeof previewMode.load === 'function' && !previewMode._loaded) {
                renderComponent.addChild(previewMode as unknown as Component);
            }

            const renderer = this.resolveReadingRenderer(mdView);
            const previewEl: HTMLElement | null = renderer?.previewEl && renderer.previewEl.instanceOf(HTMLElement)
                ? renderer.previewEl
                : mdView.containerEl.querySelector<HTMLElement>('.markdown-preview-view');
            const sizerTarget: HTMLElement | null = renderer?.sizerEl && renderer.sizerEl.instanceOf(HTMLElement)
                ? renderer.sizerEl
                : mdView.containerEl.querySelector<HTMLElement>('.markdown-preview-sizer');

            if (!renderer || !sizerTarget) {
                cleanup();
                return null;
            }

            // Ensure previewMode has the latest markdown data queued for render (including unsaved editor edits)
            if ((isUnsavedFromDisk || !Array.isArray(renderer.sections) || renderer.sections.length === 0) && hasBodyContent) {
                try {
                    if (typeof previewMode?.set === 'function') {
                        previewMode.set(rawContent, true);
                    } else if (typeof renderer?.set === 'function') {
                        renderer.set(rawContent, true);
                    }
                } catch { /* ignore */ }
            }

            const result = await this.driveReadingModeRenderer(
                renderer,
                previewEl,
                sizerTarget,
                file,
                rawContent,
                noteCssClasses,
                frontmatterLineCount,
                hasBodyContent,
                renderComponent,
                shouldCancel
            );

            if (!result) {
                cleanup();
                return null;
            }

            return { ...result, cleanup };
        } catch (e) {
            console.warn('PDF Export: Isolated MarkdownView Reading Mode failed, trying embed fallback', e);
            cleanup();
            return null;
        } finally {
            this.isRenderingHiddenView = prevGuard;
        }
    }

    /**
     * Secondary Reading Mode renderer (fallback): renders via Obsidian's embedRegistry.embedByExtension.md
     * using the same native driveReadingModeRenderer pipeline.
     */
    private async renderWithObsidianEmbedView(
        file: TFile,
        rawContent: string,
        isUnsavedFromDisk: boolean,
        readingEl: HTMLElement,
        noteCssClasses: string[],
        frontmatterLineCount: number,
        hasBodyContent: boolean,
        renderComponent: Component,
        shouldCancel?: () => boolean
    ): Promise<{ sizerEl: HTMLElement; blocks: BlockItem[] } | null> {
        const embedCreator = (this.app as ObsidianAppInternal).embedRegistry?.embedByExtension?.md;
        if (typeof embedCreator !== 'function') return null;

        const hostEl = readingEl.createDiv({ cls: 'pdf-reading-host' });
        const stripEmbedHostClasses = (mdEmbed?: ObsidianMarkdownEmbed) => {
            hostEl.classList.remove('markdown-embed', 'internal-embed', 'inline-embed', 'is-loaded');
            const embedBodyEl = mdEmbed?.embedEl && mdEmbed.embedEl.instanceOf(HTMLElement)
                ? mdEmbed.embedEl
                : hostEl.querySelector<HTMLElement>(':scope > .markdown-embed-content');
            if (embedBodyEl) {
                embedBodyEl.classList.remove('markdown-embed-content');
                embedBodyEl.classList.add('pdf-reading-embed-body');
            }
        };

        try {
            const mdEmbed = embedCreator(
                {
                    app: this.app,
                    containerEl: hostEl,
                    depth: 0,
                    displayMode: true,
                    showInline: false,
                    showTitle: false,
                    linktext: file.path,
                    sourcePath: file.path
                },
                file,
                ''
            );
            if (!mdEmbed || typeof mdEmbed.loadFile !== 'function') {
                hostEl.remove();
                return null;
            }

            stripEmbedHostClasses(mdEmbed);
            renderComponent.addChild(mdEmbed);
            if (!mdEmbed._loaded && typeof mdEmbed.load === 'function') {
                mdEmbed.load();
            }

            await mdEmbed.loadFile();
            if (shouldCancel?.()) return null;

            stripEmbedHostClasses(mdEmbed);
            const renderer = this.resolveReadingRenderer(mdEmbed);
            const previewEl: HTMLElement | null = renderer?.previewEl && renderer.previewEl.instanceOf(HTMLElement)
                ? renderer.previewEl
                : hostEl.querySelector<HTMLElement>('.markdown-preview-view');
            const sizerTarget: HTMLElement | null = renderer?.sizerEl && renderer.sizerEl.instanceOf(HTMLElement)
                ? renderer.sizerEl
                : hostEl.querySelector<HTMLElement>('.markdown-preview-sizer');
            if (!renderer || !sizerTarget) {
                hostEl.remove();
                return null;
            }

            if (isUnsavedFromDisk && hasBodyContent) {
                try {
                    if (typeof renderer.set === 'function') {
                        renderer.set(rawContent, true);
                    }
                } catch { /* ignore */ }
            }

            const result = await this.driveReadingModeRenderer(
                renderer,
                previewEl,
                sizerTarget,
                file,
                rawContent,
                noteCssClasses,
                frontmatterLineCount,
                hasBodyContent,
                renderComponent,
                shouldCancel
            );
            if (!result) {
                hostEl.remove();
                return null;
            }
            return result;
        } catch (e) {
            console.warn('PDF Export: Embed Reading Mode renderer failed, falling back to MarkdownRenderer', e);
            hostEl.remove();
            return null;
        }
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
        if (leaf) {
            await workspace.revealLeaf(leaf);
            this.getSidebarView()?.refreshIfVisible();
            window.setTimeout(() => this.getSidebarView()?.refreshIfVisible(), 80);
        }
    }

    /**
     * Reads the latest markdown content for a file, preferring an open MarkdownView's live
     * editor buffer when it contains unsaved edits ahead of disk.
     */
    private async getLiveFileContent(file: TFile): Promise<{ content: string; isUnsavedFromDisk: boolean }> {
        const diskContent = await this.app.vault.read(file);
        try {
            const mdLeaves = this.app.workspace.getLeavesOfType('markdown');
            for (const leaf of mdLeaves) {
                const view = leaf.view;
                if (view instanceof MarkdownView && view.file?.path === file.path && typeof view.getViewData === 'function') {
                    const liveContent = view.getViewData();
                    if (typeof liveContent === 'string' && liveContent !== diskContent) {
                        return { content: liveContent, isUnsavedFromDisk: true };
                    }
                }
            }
        } catch {
            // Fall back to disk content
        }
        return { content: diskContent, isUnsavedFromDisk: false };
    }

    private computeFastHash(input: string): string {
        let h = 2166136261;
        for (let i = 0; i < input.length; i++) {
            h ^= input.charCodeAt(i);
            h = Math.imul(h, 16777619);
        }
        return `${input.length}:${(h >>> 0).toString(36)}`;
    }

    private getFootnoteTimeStampKey(now: moment.Moment): string {
        if (!this.settings.showFootnote && !this.settings.showHeader) return '';
        const resolveTimeTokens = (template: string, dateFormat: string, timeFormat: string): string => {
            let text = template || '';
            text = text.replace(/{date:([^}]+)}/g, (_match, format: string) => now.format(format));
            text = text.replace(/{time:([^}]+)}/g, (_match, format: string) => now.format(format));
            return text
                .replace(/{date}/g, now.format(dateFormat))
                .replace(/{time}/g, now.format(timeFormat));
        };
        const headerPart = this.settings.showHeader
            ? resolveTimeTokens(
                this.settings.headerTemplate || '',
                this.settings.headerDateFormat || 'YYYY-MM-DD',
                this.settings.headerTimeFormat || 'HH:mm'
            )
            : '';
        const footerPart = this.settings.showFootnote
            ? resolveTimeTokens(
                this.settings.footnoteTemplate || '',
                this.settings.footnoteDateFormat || 'YYYY-MM-DD',
                this.settings.footnoteTimeFormat || 'HH:mm'
            )
            : '';
        return `${headerPart}|${footerPart}`;
    }

    private appendFootnotesToDoc(
        doc: jsPDF,
        file: TFile | null,
        activeJsPdfFont: string,
        margin: number,
        pageHeight: number,
        bottomMargin: number,
        contentWidthMm: number,
        contentWidthPx: number,
        mmPerPx: number,
        captureScale: number,
        bgHex: string,
        textColor: number[],
        footerFontFamily: string,
        now: moment.Moment,
        shouldCancel?: () => boolean,
        getTitleForPage?: (pageNum: number) => string
    ): boolean {
        const drawHeader = !!this.settings.showHeader && (this.settings.headerTemplate || '').trim().length > 0;
        const drawFooter = !!this.settings.showFootnote && (this.settings.footnoteTemplate || '').trim().length > 0;
        if (!drawHeader && !drawFooter) return true;

        const totalPages = doc.getNumberOfPages();
        doc.setFontSize(9);
        const headerDateFormat = this.settings.headerDateFormat || 'YYYY-MM-DD';
        const headerTimeFormat = this.settings.headerTimeFormat || 'HH:mm';
        const footerDateFormat = this.settings.footnoteDateFormat || 'YYYY-MM-DD';
        const footerTimeFormat = this.settings.footnoteTimeFormat || 'HH:mm';
        const renderedStripsByText = new Map<string, { img: string; heightMm: number }>();
        const topMarginForHeader = Math.max(margin, 12) + 3;

        const expandTemplate = (
            template: string,
            pageTitle: string,
            pageNum: number,
            dateFormat: string,
            timeFormat: string
        ): string => {
            let text = template || '';
            text = text.replace(/{date:([^}]+)}/g, (_match, format: string) => now.format(format));
            text = text.replace(/{time:([^}]+)}/g, (_match, format: string) => now.format(format));
            return text
                .replace(/{date}/g, now.format(dateFormat))
                .replace(/{time}/g, now.format(timeFormat))
                .replace(/{title}/g, pageTitle)
                .replace(/{page}/g, pageNum.toString())
                .replace(/{total}/g, totalPages.toString());
        };

        const stampLine = (
            text: string,
            yMm: number,
            curContentWidthMm: number,
            curContentWidthPx: number
        ) => {
            if (!text) return;
            if (/[^\x20-\x7E]/.test(text)) {
                const cacheKey = `${curContentWidthPx}|${text}`;
                let cached = renderedStripsByText.get(cacheKey);
                if (!cached) {
                    const rendered = this.renderFootnoteToDataUrl(
                        text,
                        curContentWidthPx,
                        captureScale,
                        bgHex,
                        textColor,
                        footerFontFamily
                    );
                    cached = {
                        img: rendered.img,
                        heightMm: rendered.heightPx * (curContentWidthMm / curContentWidthPx)
                    };
                    renderedStripsByText.set(cacheKey, cached);
                }
                doc.addImage(cached.img, 'PNG', margin, yMm - 3.5, curContentWidthMm, cached.heightMm, undefined, 'FAST');
            } else {
                doc.text(text, margin, yMm);
            }
        };

        for (let i = 1; i <= totalPages; i++) {
            if (shouldCancel?.()) return false;
            doc.setPage(i);
            const curPageW = doc.internal.pageSize.getWidth();
            const curPageH = doc.internal.pageSize.getHeight();
            const curContentWidthMm = curPageW > 0 ? Math.max(40, curPageW - margin * 2) : contentWidthMm;
            const curContentWidthPx = curPageW > 0 ? Math.max(200, Math.round(curContentWidthMm / mmPerPx)) : contentWidthPx;

            doc.setTextColor(textColor[0], textColor[1], textColor[2]);
            doc.setFont(activeJsPdfFont, "normal");

            const pageTitle = getTitleForPage ? getTitleForPage(i) : (file?.basename || 'Untitled');

            if (drawHeader) {
                const curHeaderY = Math.max(6.5, topMarginForHeader - 5.5);
                const headerText = expandTemplate(this.settings.headerTemplate, pageTitle, i, headerDateFormat, headerTimeFormat);
                stampLine(headerText, curHeaderY, curContentWidthMm, curContentWidthPx);
            }
            if (drawFooter) {
                const curFooterY = (curPageH || pageHeight) - Math.max(5.5, Math.min(10, bottomMargin - 5));
                const footerText = expandTemplate(this.settings.footnoteTemplate, pageTitle, i, footerDateFormat, footerTimeFormat);
                stampLine(footerText, curFooterY, curContentWidthMm, curContentWidthPx);
            }
        }
        return true;
    }

    private static crc32Table: Uint32Array | null = null;
    private static computeCrc32(bytes: Uint8Array, start: number, end: number): number {
        if (!PdfPlugin.crc32Table) {
            const table = new Uint32Array(256);
            for (let n = 0; n < 256; n++) {
                let c = n;
                for (let k = 0; k < 8; k++) {
                    c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
                }
                table[n] = c >>> 0;
            }
            PdfPlugin.crc32Table = table;
        }
        const table = PdfPlugin.crc32Table;
        let c = 0xffffffff;
        for (let i = start; i < end; i++) {
            c = table[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
        }
        return (c ^ 0xffffffff) >>> 0;
    }

    /**
     * Attempts to encode an opaque canvas as a 100% lossless 8-bit Indexed-Palette PNG (colorType = 3)
     * whenever the page uses <= 256 unique RGB colors (typical for crisp text/heading/table pages).
     * Uses 1 byte/pixel instead of 3 bytes/pixel + PNG Sub filter (matching jsPDF Predictor 11),
     * cutting text-page PDF stream size by ~2x–3x with zero compression artifacts.
     */
    private async tryEncodeIndexedPngDataUrl(canvas: HTMLCanvasElement): Promise<string | null> {
        const CompressionStreamCtor = (window as WindowWithPlatformApis).CompressionStream;
        if (typeof CompressionStreamCtor !== 'function') return null;
        const w = canvas.width;
        const h = canvas.height;
        if (w <= 0 || h <= 0) return null;

        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        if (!ctx) return null;

        let rgba: Uint8ClampedArray;
        try {
            rgba = ctx.getImageData(0, 0, w, h).data;
        } catch {
            return null;
        }

        const paletteMap = new Map<number, number>();
        const paletteRgb: number[] = [];
        const stride = 1 + w;
        const rawScanlines = new Uint8Array(h * stride);

        let lastRgb = -1;
        let lastIdx = 0;

        for (let y = 0; y < h; y++) {
            const rowOff = y * stride;
            rawScanlines[rowOff] = 1; // PNG Sub filter (matches jsPDF FAST /Predictor 11)
            let prevPxIdx = 0;
            let src = y * w * 4;
            for (let x = 0; x < w; x++) {
                const rgb = (rgba[src] << 16) | (rgba[src + 1] << 8) | rgba[src + 2];
                src += 4;
                let idx: number;
                if (rgb === lastRgb) {
                    idx = lastIdx;
                } else {
                    const existing = paletteMap.get(rgb);
                    if (existing !== undefined) {
                        idx = existing;
                    } else {
                        if (paletteMap.size >= 256) {
                            return null; // > 256 unique colors; abort immediately
                        }
                        idx = paletteMap.size;
                        paletteMap.set(rgb, idx);
                        paletteRgb.push((rgb >>> 16) & 0xff, (rgb >>> 8) & 0xff, rgb & 0xff);
                    }
                    lastRgb = rgb;
                    lastIdx = idx;
                }
                rawScanlines[rowOff + 1 + x] = (idx - prevPxIdx) & 0xff;
                prevPxIdx = idx;
            }
        }

        try {
            const cs = new CompressionStreamCtor('deflate');
            const compressedPromise = new Response(cs.readable).arrayBuffer();
            const writer = cs.writable.getWriter();
            await writer.write(rawScanlines);
            await writer.close();
            const idat = new Uint8Array(await compressedPromise);

            const makeChunk = (type: string, data: Uint8Array): Uint8Array => {
                const out = new Uint8Array(12 + data.length);
                const dv = new DataView(out.buffer);
                dv.setUint32(0, data.length);
                out[4] = type.charCodeAt(0);
                out[5] = type.charCodeAt(1);
                out[6] = type.charCodeAt(2);
                out[7] = type.charCodeAt(3);
                out.set(data, 8);
                dv.setUint32(8 + data.length, PdfPlugin.computeCrc32(out, 4, 8 + data.length));
                return out;
            };

            const ihdr = new Uint8Array(13);
            const idv = new DataView(ihdr.buffer);
            idv.setUint32(0, w);
            idv.setUint32(4, h);
            ihdr[8] = 8; // 8-bit depth
            ihdr[9] = 3; // colorType 3 = Indexed palette
            const plte = new Uint8Array(paletteRgb);

            const sig = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
            const cIhdr = makeChunk('IHDR', ihdr);
            const cPlte = makeChunk('PLTE', plte);
            const cIdat = makeChunk('IDAT', idat);
            const cIend = makeChunk('IEND', new Uint8Array(0));

            const totalLen = sig.length + cIhdr.length + cPlte.length + cIdat.length + cIend.length;
            const pngBytes = new Uint8Array(totalLen);
            let off = 0;
            for (const part of [sig, cIhdr, cPlte, cIdat, cIend]) {
                pngBytes.set(part, off);
                off += part.length;
            }

            return `data:image/png;base64,${this.arrayBufferToBase64(pngBytes.buffer)}`;
        } catch {
            return null;
        }
    }

    private static readonly WINANSI_EXTRA_MAP: Record<string, string> = {
        '\u20AC': '\x80', '\u201A': '\x82', '\u0192': '\x83', '\u201E': '\x84', '\u2026': '\x85',
        '\u2020': '\x86', '\u2021': '\x87', '\u02C6': '\x88', '\u2030': '\x89', '\u0160': '\x8A',
        '\u2039': '\x8B', '\u0152': '\x8C', '\u017D': '\x8E', '\u2018': '\x91', '\u2019': '\x92',
        '\u201C': '\x93', '\u201D': '\x94', '\u2022': '\x95', '\u2013': '\x96', '\u2014': '\x97',
        '\u02DC': '\x98', '\u2122': '\x99', '\u0161': '\x9A', '\u203A': '\x9B', '\u0153': '\x9C',
        '\u017E': '\x9E', '\u0178': '\x9F'
    };

    private cleanTextForPdfLayer(rawText: string): string {
        let cleaned = rawText;
        try {
            cleaned = cleaned.normalize('NFC');
        } catch {
            // keep raw string if normalize fails
        }
        let noCtrl = '';
        for (let i = 0; i < cleaned.length; i++) {
            const code = cleaned.charCodeAt(i);
            if (
                code === 0x200B ||
                code === 0xFEFF ||
                code <= 0x08 ||
                code === 0x0B ||
                code === 0x0C ||
                (code >= 0x0E && code <= 0x1F) ||
                code === 0x7F
            ) {
                continue;
            }
            noCtrl += cleaned[i];
        }
        return noCtrl
            .replace(/[\u00A0\u2000-\u200A\u202F\u205F\u3000]/g, ' ')
            .replace(/ {2,}/g, ' ')
            .trim();
    }

    private needsUnicodeTextLayer(cleanedText: string): boolean {
        for (let i = 0; i < cleanedText.length; i++) {
            const code = cleanedText.charCodeAt(i);
            if ((code >= 0x20 && code <= 0x7E) || (code >= 0xA0 && code <= 0xFF)) {
                continue;
            }
            if (PdfPlugin.WINANSI_EXTRA_MAP[cleanedText[i]] !== undefined) {
                continue;
            }
            return true;
        }
        return false;
    }

    private static readonly RTL_CHAR_RE = /[\u0590-\u05FF\u0600-\u065F\u066A-\u06EF\u06FA-\u08FF\u200F\uFB1D-\uFDFF\uFE70-\uFEFF]/;
    private static readonly BIDI_DIGIT_RE = /^[0-9\u0660-\u0669\u06F0-\u06F9]$/;
    private static readonly BIDI_LTR_RE = /[\p{L}\u200E]/u;
    private static readonly BIDI_COMBINING_RE = /^[\p{Mn}\p{Me}\uFE0E\uFE0F]$/u;
    private static readonly BIDI_OPEN_TO_CLOSE: Record<string, string> = {
        '(': ')',
        '[': ']',
        '{': '}'
    };

    private hasRtlChars(text: string): boolean {
        return PdfPlugin.RTL_CHAR_RE.test(text);
    }

    /**
     * Splits a text span containing RTL scripts (Arabic, Hebrew, Persian, Urdu, etc.)—including
     * mixed LTR+RTL lines—into pure directional runs using UAX #9 rules.
     * - Respects explicit DOM CSS direction (`ltr` / `rtl`); only falls back to first-strong detection
     *   when `baseDirHint` is undefined (e.g. `unicode-bidi: plaintext`).
     * - Returns runs in LOGICAL stream order so a single copy-paste in PDF viewers preserves exact reading order.
     * - Reverses code points inside RTL runs into PDF visual LTR order without mirroring brackets
     *   (PDF.js `bidi()` reverses character order back to logical without un-mirroring brackets).
     * - Returns `visualOrder` so each run is placed at its exact left-to-right visual X coordinate on screen.
     */
    private splitBidiRunsForPdf(
        text: string,
        baseDirHint?: 'ltr' | 'rtl'
    ): { runs: Array<{ visualText: string; isRtl: boolean; start: number; end: number }>; visualOrder: number[]; baseDir: 'ltr' | 'rtl' } {
        const chars = Array.from(text);
        const charStarts = new Array<number>(chars.length);
        let utf16Cursor = 0;
        for (let i = 0; i < chars.length; i++) {
            charStarts[i] = utf16Cursor;
            utf16Cursor += chars[i].length;
        }
        const types: Array<'R' | 'L' | 'EN' | 'N'> = new Array<'R' | 'L' | 'EN' | 'N'>(chars.length);

        for (let i = 0; i < chars.length; i++) {
            const ch = chars[i];
            if (PdfPlugin.BIDI_COMBINING_RE.test(ch) && i > 0) {
                types[i] = types[i - 1];
            } else if (PdfPlugin.RTL_CHAR_RE.test(ch)) {
                types[i] = 'R';
            } else if (PdfPlugin.BIDI_DIGIT_RE.test(ch)) {
                types[i] = 'EN';
            } else if (PdfPlugin.BIDI_LTR_RE.test(ch)) {
                types[i] = 'L';
            } else {
                types[i] = 'N';
            }
        }

        let baseDir: 'ltr' | 'rtl';
        if (baseDirHint === 'ltr' || baseDirHint === 'rtl') {
            baseDir = baseDirHint;
        } else {
            baseDir = 'ltr';
            for (let i = 0; i < types.length; i++) {
                if (types[i] === 'R') {
                    baseDir = 'rtl';
                    break;
                }
                if (types[i] === 'L') {
                    baseDir = 'ltr';
                    break;
                }
            }
        }
        const baseLevel = baseDir === 'rtl' ? 1 : 0;
        const ltrLevel = baseDir === 'rtl' ? 2 : 0;

        const levels = new Array<number>(chars.length).fill(baseLevel);
        for (let i = 0; i < types.length; i++) {
            if (types[i] === 'R') {
                levels[i] = 1;
            } else if (types[i] === 'L' || types[i] === 'EN') {
                levels[i] = ltrLevel;
            }
        }

        const strongDirAt = (idx: number): 'R' | 'L' | null => {
            if (types[idx] === 'R') return 'R';
            if (types[idx] === 'L' || types[idx] === 'EN') return 'L';
            return null;
        };

        let i = 0;
        while (i < types.length) {
            if (types[i] !== 'N') {
                i++;
                continue;
            }
            let j = i;
            while (j < types.length && types[j] === 'N') j++;

            let leftStrong: 'R' | 'L' | null = null;
            for (let k = i - 1; k >= 0; k--) {
                const s = strongDirAt(k);
                if (s) {
                    leftStrong = s;
                    break;
                }
            }
            let rightStrong: 'R' | 'L' | null = null;
            for (let k = j; k < types.length; k++) {
                const s = strongDirAt(k);
                if (s) {
                    rightStrong = s;
                    break;
                }
            }

            let resolvedLevel = baseLevel;
            if (leftStrong === 'R' && rightStrong === 'R') {
                resolvedLevel = 1;
            } else if (leftStrong === 'L' && rightStrong === 'L') {
                resolvedLevel = ltrLevel;
            }
            for (let k = i; k < j; k++) {
                levels[k] = resolvedLevel;
            }
            i = j;
        }

        // Keep matched bracket pairs (e.g. "(Arabic 123)", "(world)") at the level of their
        // enclosed strong characters so closing brackets do not detach into opposite-direction runs.
        const openStack: Array<{ idx: number; close: string }> = [];
        for (let k = 0; k < chars.length; k++) {
            const ch = chars[k];
            const close = PdfPlugin.BIDI_OPEN_TO_CLOSE[ch];
            if (close) {
                openStack.push({ idx: k, close });
            } else if (ch === ')' || ch === ']' || ch === '}') {
                for (let s = openStack.length - 1; s >= 0; s--) {
                    if (openStack[s].close === ch) {
                        const openIdx = openStack[s].idx;
                        openStack.length = s;
                        let innerR = false;
                        let innerL = false;
                        for (let m = openIdx + 1; m < k; m++) {
                            if (types[m] === 'R') innerR = true;
                            else if (types[m] === 'L' || types[m] === 'EN') innerL = true;
                        }
                        if (innerL && !innerR) {
                            levels[openIdx] = ltrLevel;
                            levels[k] = ltrLevel;
                        } else if (innerR && !innerL) {
                            levels[openIdx] = 1;
                            levels[k] = 1;
                        }
                        break;
                    }
                }
            }
        }

        const grouped: Array<{ level: number; isRtl: boolean; chars: string[]; start: number; end: number }> = [];
        for (let k = 0; k < chars.length; k++) {
            const lv = levels[k];
            const cStart = charStarts[k];
            const cEnd = cStart + chars[k].length;
            if (grouped.length === 0 || grouped[grouped.length - 1].level !== lv) {
                grouped.push({ level: lv, isRtl: (lv & 1) === 1, chars: [chars[k]], start: cStart, end: cEnd });
            } else {
                const last = grouped[grouped.length - 1];
                last.chars.push(chars[k]);
                last.end = cEnd;
            }
        }

        const runs = grouped.map((g) => {
            if (!g.isRtl) {
                return { visualText: g.chars.join(''), isRtl: false, start: g.start, end: g.end };
            }
            const rev: string[] = new Array<string>(g.chars.length);
            for (let k = 0; k < g.chars.length; k++) {
                rev[k] = g.chars[g.chars.length - 1 - k];
            }
            return { visualText: rev.join(''), isRtl: true, start: g.start, end: g.end };
        });

        const visualOrder = runs.map((_, idx) => idx);
        if (baseDir === 'rtl') {
            visualOrder.reverse();
        }
        return { runs, visualOrder, baseDir };
    }

    private encodeTextForWinAnsiLayer(cleanedText: string): string {
        let out = '';
        for (const ch of cleanedText) {
            if (ch === '\u200C' || ch === '\u200D' || ch === '\uFE0E' || ch === '\uFE0F') continue;
            if (ch.length === 1 && ch.charCodeAt(0) <= 0xFF) {
                out += ch;
            } else {
                out += PdfPlugin.WINANSI_EXTRA_MAP[ch] ?? '';
            }
        }
        return out.replace(/ {2,}/g, ' ').trim();
    }

    private measureUnicodeCharWidthEm(ch: string): number {
        if (ch === '\u200B' || ch === '\u200C' || ch === '\u200D' || ch === '\uFE0E' || ch === '\uFE0F') {
            return 0;
        }
        if (/^[\p{Mn}\p{Me}]$/u.test(ch)) {
            return 0;
        }
        const cached = this.unicodeCharWidthCache.get(ch);
        if (cached !== undefined) return cached;

        let widthEm = 550;
        try {
            if (!this.unicodeWidthCtx) {
                const c = createEl('canvas');
                c.width = 16;
                c.height = 16;
                this.unicodeWidthCtx = c.getContext('2d');
                if (this.unicodeWidthCtx) {
                    this.unicodeWidthCtx.font = '400 100px system-ui, -apple-system, sans-serif';
                }
            }
            if (this.unicodeWidthCtx) {
                const measuredPx = this.unicodeWidthCtx.measureText(ch).width;
                if (measuredPx > 0 && isFinite(measuredPx)) {
                    widthEm = Math.max(150, Math.min(2000, Math.round(measuredPx * 10)));
                }
            }
        } catch {
            if (/[\u3000-\u9FFF\uAC00-\uD7AF\uF900-\uFAFF\uFF00-\uFFEF]/.test(ch)) {
                widthEm = 1000;
            } else if (ch === ' ') {
                widthEm = 280;
            }
        }
        this.unicodeCharWidthCache.set(ch, widthEm);
        return widthEm;
    }

    /**
     * Builds a spec-compliant minimal GlyphLess TrueType font (empty outlines, exact per-CID hmtx widths)
     * so Type 0 Identity-H invisible text layers support every Unicode script (Latin Extended, Greek,
     * Cyrillic, CJK, Arabic, Hebrew, Math, Emojis, and mixed-script lines) with ~1-3 KB overhead.
     */
    private buildGlyphLessTrueTypeFont(widths: number[]): Uint8Array {
        const numGlyphs = Math.max(2, Math.min(65535, widths.length));
        const wArr = new Uint16Array(numGlyphs);
        let maxAdv = 1000;
        for (let i = 0; i < numGlyphs; i++) {
            const w = Math.max(0, Math.min(65535, Math.round(widths[i] ?? 500)));
            wArr[i] = w;
            if (w > maxAdv) maxAdv = w;
        }

        const mkBuf = (len: number) => {
            const ab = new ArrayBuffer(len);
            return { u8: new Uint8Array(ab), dv: new DataView(ab) };
        };

        // head (54 bytes)
        const head = mkBuf(54);
        head.dv.setUint32(0, 0x00010000);
        head.dv.setUint32(4, 0x00010000);
        head.dv.setUint32(8, 0);
        head.dv.setUint32(12, 0x5F0F3CF5);
        head.dv.setUint16(16, 0x000B);
        head.dv.setUint16(18, 1000);
        head.dv.setInt16(36, 0);
        head.dv.setInt16(38, -200);
        head.dv.setInt16(40, 1000);
        head.dv.setInt16(42, 800);
        head.dv.setUint16(44, 0);
        head.dv.setUint16(46, 8);
        head.dv.setInt16(48, 2);
        head.dv.setInt16(50, 0); // short loca
        head.dv.setInt16(52, 0);

        // hhea (36 bytes)
        const hhea = mkBuf(36);
        hhea.dv.setUint32(0, 0x00010000);
        hhea.dv.setInt16(4, 800);
        hhea.dv.setInt16(6, -200);
        hhea.dv.setInt16(8, 0);
        hhea.dv.setUint16(10, maxAdv);
        hhea.dv.setInt16(18, 1);
        hhea.dv.setUint16(34, numGlyphs);

        // maxp (32 bytes, v1.0)
        const maxp = mkBuf(32);
        maxp.dv.setUint32(0, 0x00010000);
        maxp.dv.setUint16(4, numGlyphs);
        maxp.dv.setUint16(14, 2); // maxZones

        // OS/2 (86 bytes, v1)
        const os2 = mkBuf(86);
        os2.dv.setUint16(0, 1);
        os2.dv.setInt16(2, 500);
        os2.dv.setUint16(4, 400);
        os2.dv.setUint16(6, 5);
        os2.dv.setUint16(8, 0);
        os2.dv.setInt16(10, 650);
        os2.dv.setInt16(12, 600);
        os2.dv.setInt16(16, 75);
        os2.dv.setInt16(18, 650);
        os2.dv.setInt16(20, 600);
        os2.dv.setInt16(24, 350);
        os2.dv.setInt16(26, 50);
        os2.dv.setInt16(28, 300);
        os2.dv.setUint32(42, 1);
        os2.u8[58] = 79; os2.u8[59] = 66; os2.u8[60] = 83; os2.u8[61] = 68; // OBSD
        os2.dv.setUint16(62, 0x0040);
        os2.dv.setUint16(64, 0x0020);
        os2.dv.setUint16(66, 0x0020);
        os2.dv.setInt16(68, 800);
        os2.dv.setInt16(70, -200);
        os2.dv.setUint16(74, 800);
        os2.dv.setUint16(76, 200);
        os2.dv.setUint32(78, 1);

        // hmtx (4 * numGlyphs bytes)
        const hmtx = mkBuf(4 * numGlyphs);
        for (let i = 0; i < numGlyphs; i++) {
            hmtx.dv.setUint16(i * 4, wArr[i]);
            hmtx.dv.setInt16(i * 4 + 2, 0);
        }

        // loca (short format, all 0 -> empty glyphs) & glyf (4 zero bytes)
        const loca = mkBuf(2 * (numGlyphs + 1));
        const glyf = mkBuf(4);

        // cmap (44 bytes, Platform 3 Encoding 1 Format 4 mapping U+0020 -> GID 1)
        const cmap = mkBuf(44);
        cmap.dv.setUint16(0, 0);
        cmap.dv.setUint16(2, 1);
        cmap.dv.setUint16(4, 3);
        cmap.dv.setUint16(6, 1);
        cmap.dv.setUint32(8, 12);
        cmap.dv.setUint16(12, 4);
        cmap.dv.setUint16(14, 32);
        cmap.dv.setUint16(18, 4);
        cmap.dv.setUint16(20, 4);
        cmap.dv.setUint16(22, 1);
        cmap.dv.setUint16(26, 0x0020);
        cmap.dv.setUint16(28, 0xFFFF);
        cmap.dv.setUint16(32, 0x0020);
        cmap.dv.setUint16(34, 0xFFFF);
        cmap.dv.setUint16(36, (1 - 0x0020) & 0xFFFF);
        cmap.dv.setUint16(38, 1);

        // name (Mac Roman + Windows Unicode BMP)
        const nameRecords: Array<{ pid: number; eid: number; lid: number; nid: number; bytes: Uint8Array }> = [];
        const addNameRec = (pid: number, eid: number, lid: number, nid: number, str: string) => {
            let bytes: Uint8Array;
            if (pid === 1) {
                bytes = new Uint8Array(str.length);
                for (let i = 0; i < str.length; i++) bytes[i] = str.charCodeAt(i) & 0x7F;
            } else {
                bytes = new Uint8Array(str.length * 2);
                for (let i = 0; i < str.length; i++) {
                    bytes[i * 2] = (str.charCodeAt(i) >> 8) & 0xFF;
                    bytes[i * 2 + 1] = str.charCodeAt(i) & 0xFF;
                }
            }
            nameRecords.push({ pid, eid, lid, nid, bytes });
        };
        const namePairs: Array<[number, string]> = [
            [1, 'GlyphLessUnicode'],
            [2, 'Regular'],
            [4, 'GlyphLessUnicode'],
            [6, 'GlyphLessUnicode']
        ];
        for (const [nid, str] of namePairs) addNameRec(1, 0, 0, nid, str);
        for (const [nid, str] of namePairs) addNameRec(3, 1, 0x0409, nid, str);
        const strStorageOff = 6 + nameRecords.length * 12;
        const totalStrBytes = nameRecords.reduce((acc, r) => acc + r.bytes.length, 0);
        const name = mkBuf(strStorageOff + totalStrBytes);
        name.dv.setUint16(2, nameRecords.length);
        name.dv.setUint16(4, strStorageOff);
        let strCursor = 0;
        for (let i = 0; i < nameRecords.length; i++) {
            const r = nameRecords[i];
            const off = 6 + i * 12;
            name.dv.setUint16(off, r.pid);
            name.dv.setUint16(off + 2, r.eid);
            name.dv.setUint16(off + 4, r.lid);
            name.dv.setUint16(off + 6, r.nid);
            name.dv.setUint16(off + 8, r.bytes.length);
            name.dv.setUint16(off + 10, strCursor);
            name.u8.set(r.bytes, strStorageOff + strCursor);
            strCursor += r.bytes.length;
        }

        // post (32 bytes, v3.0)
        const post = mkBuf(32);
        post.dv.setUint32(0, 0x00030000);
        post.dv.setInt16(8, -100);
        post.dv.setInt16(10, 50);

        const tables: Array<[string, Uint8Array]> = [
            ['OS/2', os2.u8],
            ['cmap', cmap.u8],
            ['glyf', glyf.u8],
            ['head', head.u8],
            ['hhea', hhea.u8],
            ['hmtx', hmtx.u8],
            ['loca', loca.u8],
            ['maxp', maxp.u8],
            ['name', name.u8],
            ['post', post.u8]
        ];
        tables.sort((a, b) => (a[0] < b[0] ? -1 : 1));

        const calcChecksum = (u8: Uint8Array): number => {
            let sum = 0;
            for (let i = 0; i < u8.length; i += 4) {
                const word = ((((u8[i] || 0) << 24) >>> 0) + ((u8[i + 1] || 0) << 16) + ((u8[i + 2] || 0) << 8) + (u8[i + 3] || 0)) >>> 0;
                sum = (sum + word) >>> 0;
            }
            return sum >>> 0;
        };

        const numTables = tables.length;
        let entrySelector = 0;
        let searchRange = 16;
        while (searchRange * 2 <= numTables * 16) {
            searchRange *= 2;
            entrySelector++;
        }

        let offset = 12 + numTables * 16;
        const placed = tables.map(([tag, u8]) => {
            const paddedLen = (u8.length + 3) & ~3;
            const entry = { tag, u8, offset, length: u8.length, checksum: calcChecksum(u8) };
            offset += paddedLen;
            return entry;
        });

        const out = mkBuf(offset);
        out.dv.setUint32(0, 0x00010000);
        out.dv.setUint16(4, numTables);
        out.dv.setUint16(6, searchRange);
        out.dv.setUint16(8, entrySelector);
        out.dv.setUint16(10, numTables * 16 - searchRange);

        let headOffset = 0;
        for (let i = 0; i < placed.length; i++) {
            const t = placed[i];
            const dirOff = 12 + i * 16;
            for (let c = 0; c < 4; c++) out.u8[dirOff + c] = t.tag.charCodeAt(c);
            out.dv.setUint32(dirOff + 4, t.checksum);
            out.dv.setUint32(dirOff + 8, t.offset);
            out.dv.setUint32(dirOff + 12, t.length);
            out.u8.set(t.u8, t.offset);
            if (t.tag === 'head') headOffset = t.offset;
        }

        const fullChecksum = calcChecksum(out.u8);
        out.dv.setUint32(headOffset + 8, (0xB1B0AFBA - fullChecksum) >>> 0);
        return out.u8;
    }

    private uint8ArrayToBinaryString(u8: Uint8Array): string {
        const chunks: string[] = [];
        const step = 8192;
        for (let i = 0; i < u8.length; i += step) {
            const slice = u8.subarray(i, Math.min(u8.length, i + step));
            let s = '';
            for (let j = 0; j < slice.length; j++) {
                s += String.fromCharCode(slice[j]);
            }
            chunks.push(s);
        }
        return chunks.join('');
    }

    private getOrAttachUnicodeTextLayer(doc: jsPDF): {
        fontId: string;
        charToCid: Map<string, number>;
        cidToChar: string[];
        cidWidths: number[];
    } | null {
        const existing = this.docUnicodeLayerMap.get(doc);
        if (existing) return existing;

        try {
            const state = {
                fontId: '',
                charToCid: new Map<string, number>(),
                cidToChar: [''],
                cidWidths: [500]
            };

            const vfsName = '__obsidian_uni_ocr__.ttf';
            const fontAlias = '__obsidian_uni_ocr__';
            const baseTtfBin = this.uint8ArrayToBinaryString(this.buildGlyphLessTrueTypeFont([500, 500]));
            doc.addFileToVFS(vfsName, baseTtfBin);
            doc.addFont(vfsName, fontAlias, 'normal', 'Identity-H');
            const docExt = doc as unknown as JsPdfExtended;
            const fontObj = docExt.getFont(fontAlias, 'normal');
            if (!fontObj || !fontObj.id) return null;

            state.fontId = fontObj.id;
            fontObj.metadata = { __obsidianGlyphLess: state };

            const docInternal = doc.internal as unknown as JsPdfInternalApi;
            docInternal.events.subscribe('putFont', (args: JsPdfPutFontEventArgs) => {
                const f = args?.font;
                if (!f || !f.metadata || f.metadata.__obsidianGlyphLess !== state) return;
                const { out, newObject, putStream } = args;

                const ttfBin = this.uint8ArrayToBinaryString(this.buildGlyphLessTrueTypeFont(state.cidWidths));
                const fontFileObj = newObject();
                putStream({ data: ttfBin, addLength1: true, objectId: fontFileObj });
                out('endobj');

                const cmapLines: string[] = [
                    '/CIDInit /ProcSet findresource begin',
                    '12 dict begin',
                    'begincmap',
                    '/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def',
                    '/CMapName /Adobe-Identity-UCS def',
                    '/CMapType 2 def',
                    '1 begincodespacerange',
                    '<0000> <FFFF>',
                    'endcodespacerange'
                ];
                const totalCids = state.cidToChar.length - 1;
                for (let start = 1; start <= totalCids; start += 100) {
                    const end = Math.min(totalCids, start + 99);
                    cmapLines.push(`${end - start + 1} beginbfchar`);
                    for (let cid = start; cid <= end; cid++) {
                        const ch = state.cidToChar[cid];
                        let uHex = '';
                        for (let k = 0; k < ch.length; k++) {
                            uHex += ch.charCodeAt(k).toString(16).toUpperCase().padStart(4, '0');
                        }
                        const cHex = cid.toString(16).toUpperCase().padStart(4, '0');
                        cmapLines.push(`<${cHex}> <${uHex}>`);
                    }
                    cmapLines.push('endbfchar');
                }
                cmapLines.push('endcmap', 'CMapName currentdict /CMap defineresource pop', 'end', 'end');

                const cmapObj = newObject();
                putStream({ data: cmapLines.join('\n'), addLength1: false, objectId: cmapObj });
                out('endobj');

                const pdfFontName = '/OBSDUN+GlyphLessUnicode';
                const descObj = newObject();
                out('<<');
                out('/Type /FontDescriptor');
                out(`/FontName ${pdfFontName}`);
                out('/Flags 4');
                out('/FontBBox [0 -200 1000 800]');
                out('/ItalicAngle 0');
                out('/Ascent 800');
                out('/Descent -200');
                out('/CapHeight 700');
                out('/StemV 0');
                out(`/FontFile2 ${fontFileObj} 0 R`);
                out('>>');
                out('endobj');

                const cidFontObj = newObject();
                const widthsStr = state.cidWidths.slice(1).join(' ');
                out('<<');
                out('/Type /Font');
                out('/Subtype /CIDFontType2');
                out(`/BaseFont ${pdfFontName}`);
                out('/CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >>');
                out(`/FontDescriptor ${descObj} 0 R`);
                out('/DW 500');
                if (widthsStr.length > 0) {
                    out(`/W [ 1 [ ${widthsStr} ] ]`);
                }
                out('/CIDToGIDMap /Identity');
                out('>>');
                out('endobj');

                f.objectNumber = newObject();
                out('<<');
                out('/Type /Font');
                out('/Subtype /Type0');
                out(`/BaseFont ${pdfFontName}`);
                out('/Encoding /Identity-H');
                out(`/DescendantFonts [${cidFontObj} 0 R]`);
                out(`/ToUnicode ${cmapObj} 0 R`);
                out('>>');
                out('endobj');
                f.isAlreadyPutted = true;
            });

            this.docUnicodeLayerMap.set(doc, state);
            return state;
        } catch (err) {
            console.warn('Could not initialize Unicode invisible text layer font:', err);
            return null;
        }
    }

    /**
     * Extracts visual text line boxes from a mounted page wrapper using fast binary search
     * over wrapped text nodes (O(lines * log(chars)) — ~0.5ms/page even on 18k-word notes).
     */
    private extractPageTextSpans(pageWrapper: HTMLElement): CachedPdfTextSpan[] {
        let pageRect = pageWrapper.getBoundingClientRect();
        if (pageRect.width <= 0 || pageRect.height <= 0) {
            const sizerFallback = pageWrapper.querySelector<HTMLElement>('.markdown-preview-sizer');
            const sizerRect = sizerFallback?.getBoundingClientRect();
            if (sizerRect && sizerRect.width > 0 && sizerRect.height > 0) {
                pageRect = sizerRect;
            } else if (pageWrapper.scrollWidth <= 0 || pageWrapper.scrollHeight <= 0) {
                return [];
            }
        }

        const docRef = pageWrapper.ownerDocument || activeDocument;
        const winRef = docRef.defaultView || window;
        interface SpanDomPiece {
            node: Text;
            rawStart: number;
            rawEnd: number;
            preserveWs: boolean;
            needsSpaceBefore?: boolean;
        }
        interface WorkingSpan extends CachedPdfTextSpan {
            blockRoot: HTMLElement | null;
            isCode: boolean;
            pieces: SpanDomPiece[];
            firstNode: Text;
            lastNode: Text;
        }
        const rawSpans: WorkingSpan[] = [];
        const range = docRef.createRange();
        const styleCache = new Map<HTMLElement, CSSStyleDeclaration>();
        const getStyle = (el: HTMLElement): CSSStyleDeclaration => {
            let cs = styleCache.get(el);
            if (!cs) {
                cs = winRef.getComputedStyle(el);
                styleCache.set(el, cs);
            }
            return cs;
        };
        const rootVisibility = getStyle(pageWrapper).visibility;

        const firstStrongDirInString = (str: string): 'ltr' | 'rtl' | null => {
            for (const ch of str) {
                if (PdfPlugin.RTL_CHAR_RE.test(ch)) return 'rtl';
                if (PdfPlugin.BIDI_LTR_RE.test(ch)) return 'ltr';
            }
            return null;
        };

        const BLOCK_ROOT_SELECTOR =
            'td, th, li, p, h1, h2, h3, h4, h5, h6, pre, blockquote, figcaption, caption, dt, dd, .callout-title, .pdf-frontmatter-key, .pdf-frontmatter-val';
        const OBSTACLE_SELECTOR = 'mjx-container, svg, img, canvas, input, br, hr';

        // Cache paragraph-level UAX #9 P2/P3 base direction for `unicode-bidi: plaintext` / `dir="auto"`
        // so soft-wrapped continuation lines inherit the paragraph's base direction instead of flipping
        // whenever a wrapped line happens to start with an RTL or LTR word.
        const blockPlaintextDirCache = new Map<HTMLElement, 'ltr' | 'rtl'>();
        const resolvePlaintextDir = (
            textNode: Text,
            parentEl: HTMLElement,
            preserveWs: boolean,
            raw: string,
            sliceStart: number
        ): 'ltr' | 'rtl' => {
            if (preserveWs) {
                const lineStart = raw.lastIndexOf('\n', Math.max(0, sliceStart - 1)) + 1;
                const lineEndIdx = raw.indexOf('\n', sliceStart);
                const lineEnd = lineEndIdx === -1 ? raw.length : lineEndIdx;
                return firstStrongDirInString(raw.slice(lineStart, lineEnd)) ?? 'ltr';
            }
            const blockEl = parentEl.closest<HTMLElement>(BLOCK_ROOT_SELECTOR);
            const scopeEl = blockEl && pageWrapper.contains(blockEl) ? blockEl : parentEl;
            if (!scopeEl.querySelector('br')) {
                const cached = blockPlaintextDirCache.get(scopeEl);
                if (cached) return cached;
                let detected: 'ltr' | 'rtl' | null = null;
                const bw = docRef.createTreeWalker(scopeEl, NodeFilter.SHOW_TEXT);
                let n: Node | null;
                while ((n = bw.nextNode())) {
                    const pe = (n as Text).parentElement;
                    if (pe && pe.closest('style, script, noscript, svg, mjx-container')) continue;
                    const d = firstStrongDirInString((n as Text).data);
                    if (d) {
                        detected = d;
                        break;
                    }
                }
                const resolved = detected ?? 'ltr';
                blockPlaintextDirCache.set(scopeEl, resolved);
                return resolved;
            }
            // Block contains <br> paragraph separators: resolve within the <br>-bounded segment containing textNode
            let segDir: 'ltr' | 'rtl' | null = null;
            let foundSelf = false;
            const bw = docRef.createTreeWalker(scopeEl, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
            let n: Node | null;
            while ((n = bw.nextNode())) {
                if (n.nodeType === Node.ELEMENT_NODE) {
                    if ((n as HTMLElement).tagName === 'BR') {
                        if (foundSelf) break;
                        segDir = null;
                    }
                } else if (n.nodeType === Node.TEXT_NODE) {
                    if (n === textNode) foundSelf = true;
                    if (!segDir) {
                        const pe = (n as Text).parentElement;
                        if (!pe || !pe.closest('style, script, noscript, svg, mjx-container')) {
                            segDir = firstStrongDirInString((n as Text).data);
                        }
                    }
                }
            }
            return segDir ?? 'ltr';
        };

        const trimWhitespaceOffsets = (str: string, start: number, end: number): { s: number; e: number } => {
            let s = start;
            let e = end;
            while (s < e && /\s/.test(str[s])) s++;
            while (e > s && /\s/.test(str[e - 1])) e--;
            return { s, e };
        };

        const walker = docRef.createTreeWalker(pageWrapper, NodeFilter.SHOW_TEXT);
        let currentNode: Node | null;
        while ((currentNode = walker.nextNode())) {
            const textNode = currentNode as Text;
            const raw = textNode.data;
            if (!raw || raw.trim().length === 0) continue;

            const parentEl = textNode.parentElement;
            if (!parentEl) continue;
            const skippedTagAncestor = parentEl.closest('style, script, noscript, svg, mjx-container');
            if (skippedTagAncestor && pageWrapper.contains(skippedTagAncestor)) continue;
            const excludedUiAncestor = parentEl.closest(PdfPlugin.PDF_EXCLUDED_UI_SELECTOR);
            if (excludedUiAncestor && pageWrapper.contains(excludedUiAncestor)) continue;

            const cs = getStyle(parentEl);
            if (cs.display === 'none' || parseFloat(cs.opacity) === 0) continue;
            if (cs.visibility === 'hidden' && rootVisibility !== 'hidden') continue;

            const fontSizePx = parseFloat(cs.fontSize) || 14;
            const isPlaintextBidi =
                cs.unicodeBidi === 'plaintext' ||
                parentEl.getAttribute('dir') === 'auto' ||
                Boolean(parentEl.closest('[dir="auto"]'));
            const preserveWs = cs.whiteSpace === 'pre' || cs.whiteSpace === 'pre-wrap' || cs.whiteSpace === 'break-spaces';
            const rawBlockRoot = parentEl.closest<HTMLElement>(BLOCK_ROOT_SELECTOR);
            const blockRoot = rawBlockRoot && pageWrapper.contains(rawBlockRoot) ? rawBlockRoot : null;
            const isCode = Boolean(parentEl.closest('code, kbd, samp, pre, tt'));

            const getLineDir = (sliceStart: number): 'ltr' | 'rtl' => {
                if (isPlaintextBidi) {
                    return resolvePlaintextDir(textNode, parentEl, preserveWs, raw, sliceStart);
                }
                return cs.direction === 'rtl' ? 'rtl' : 'ltr';
            };

            const trimmedFull = trimWhitespaceOffsets(raw, 0, raw.length);
            if (trimmedFull.e <= trimmedFull.s) continue;

            range.setStart(textNode, trimmedFull.s);
            range.setEnd(textNode, trimmedFull.e);
            const fullRects = range.getClientRects();

            // Collect non-empty rects from trimmed full node to check the single-line fast path
            let firstValid: DOMRect | null = null;
            let allSameLine = true;
            let minL = Infinity;
            let minT = Infinity;
            let maxR = -Infinity;
            let maxB = -Infinity;
            for (let i = 0; i < fullRects.length; i++) {
                const r = fullRects[i];
                if (r.width <= 0.1 || r.height <= 0.1) continue;
                if (!firstValid) {
                    firstValid = r;
                } else {
                    const mid0 = firstValid.top + firstValid.height * 0.5;
                    const midI = r.top + r.height * 0.5;
                    if (Math.abs(midI - mid0) > Math.max(3, firstValid.height * 0.45)) {
                        allSameLine = false;
                        break;
                    }
                }
                if (r.left < minL) minL = r.left;
                if (r.top < minT) minT = r.top;
                if (r.right > maxR) maxR = r.right;
                if (r.bottom > maxB) maxB = r.bottom;
            }

            // Fallback to parent element box if Range.getClientRects() returned empty on a visible node
            if (!firstValid) {
                const pr = parentEl.getBoundingClientRect();
                if (pr.width > 0.1 && pr.height > 0.1) {
                    firstValid = pr;
                    allSameLine = true;
                    minL = pr.left;
                    minT = pr.top;
                    maxR = pr.right;
                    maxB = pr.bottom;
                } else {
                    continue;
                }
            }

            if (allSameLine) {
                const sliceRaw = raw.slice(trimmedFull.s, trimmedFull.e);
                const normalized = preserveWs ? sliceRaw.replace(/[\r\n]+/g, '') : sliceRaw.replace(/[\r\n\t ]+/g, ' ');
                if (normalized.trim().length > 0 && maxR > minL) {
                    rawSpans.push({
                        text: normalized,
                        xPx: minL - pageRect.left,
                        topPx: minT - pageRect.top,
                        widthPx: maxR - minL,
                        heightPx: Math.max(1, maxB - minT),
                        fontSizePx,
                        dir: getLineDir(trimmedFull.s),
                        blockRoot,
                        isCode,
                        pieces: [{ node: textNode, rawStart: trimmedFull.s, rawEnd: trimmedFull.e, preserveWs }],
                        firstNode: textNode,
                        lastNode: textNode
                    });
                }
                continue;
            }

            // Multi-line wrapped Text node: split into visual lines via binary search on character offsets
            const len = raw.length;
            let pos = 0;
            while (pos < len) {
                // Skip collapsed leading whitespace/newlines that produce empty rects
                let startRect: DOMRect | null = null;
                while (pos < len) {
                    const chCode = raw.charCodeAt(pos);
                    const step = (chCode >= 0xD800 && chCode <= 0xDBFF && pos + 1 < len) ? 2 : 1;
                    if (raw[pos] === '\n' || raw[pos] === '\r') {
                        pos += step;
                        continue;
                    }
                    range.setStart(textNode, pos);
                    range.setEnd(textNode, pos + step);
                    const r = range.getBoundingClientRect();
                    if (r.width > 0.1 && r.height > 0.1) {
                        startRect = r;
                        break;
                    }
                    pos += step;
                }
                if (!startRect || pos >= len) break;

                const lineMidY = startRect.top + startRect.height * 0.5;
                const lineTol = Math.max(3, startRect.height * 0.45);

                const isSingleLineRange = (endIdx: number): boolean => {
                    range.setStart(textNode, pos);
                    range.setEnd(textNode, endIdx);
                    const rects = range.getClientRects();
                    for (let i = 0; i < rects.length; i++) {
                        const r = rects[i];
                        if (r.width <= 0.1 || r.height <= 0.1) continue;
                        if (Math.abs((r.top + r.height * 0.5) - lineMidY) > lineTol) {
                            return false;
                        }
                    }
                    return true;
                };

                let lo = pos + ((raw.charCodeAt(pos) >= 0xD800 && raw.charCodeAt(pos) <= 0xDBFF && pos + 1 < len) ? 2 : 1);
                let hi = len;
                if (isSingleLineRange(hi)) {
                    lo = hi;
                } else {
                    while (lo < hi) {
                        let mid = (lo + hi + 1) >> 1;
                        if (mid < len && raw.charCodeAt(mid - 1) >= 0xD800 && raw.charCodeAt(mid - 1) <= 0xDBFF) {
                            mid = mid < hi ? mid + 1 : mid - 1;
                        }
                        if (mid <= lo) break;
                        if (isSingleLineRange(mid)) {
                            lo = mid;
                        } else {
                            hi = mid - 1;
                        }
                    }
                }

                // Trim leading/trailing whitespace on this visual line BEFORE measuring so indented
                // code lines and wrapped prose align exactly with their first and last visible glyph.
                const trimmedLine = trimWhitespaceOffsets(raw, pos, lo);
                if (trimmedLine.e > trimmedLine.s) {
                    range.setStart(textNode, trimmedLine.s);
                    range.setEnd(textNode, trimmedLine.e);
                    const lineRects = range.getClientRects();
                    let lMin = Infinity;
                    let tMin = Infinity;
                    let rMax = -Infinity;
                    let bMax = -Infinity;
                    for (let i = 0; i < lineRects.length; i++) {
                        const r = lineRects[i];
                        if (r.width <= 0.1 || r.height <= 0.1) continue;
                        if (Math.abs((r.top + r.height * 0.5) - lineMidY) > lineTol) continue;
                        if (r.left < lMin) lMin = r.left;
                        if (r.top < tMin) tMin = r.top;
                        if (r.right > rMax) rMax = r.right;
                        if (r.bottom > bMax) bMax = r.bottom;
                    }

                    const sliceRaw = raw.slice(trimmedLine.s, trimmedLine.e);
                    const sliceNorm = preserveWs ? sliceRaw.replace(/[\r\n]+/g, '') : sliceRaw.replace(/[\r\n\t ]+/g, ' ');
                    if (sliceNorm.trim().length > 0 && rMax > lMin) {
                        rawSpans.push({
                            text: sliceNorm,
                            xPx: lMin - pageRect.left,
                            topPx: tMin - pageRect.top,
                            widthPx: rMax - lMin,
                            heightPx: Math.max(1, bMax - tMin),
                            fontSizePx,
                            dir: getLineDir(trimmedLine.s),
                            blockRoot,
                            isCode,
                            pieces: [{ node: textNode, rawStart: trimmedLine.s, rawEnd: trimmedLine.e, preserveWs }],
                            firstNode: textNode,
                            lastNode: textNode
                        });
                    }
                }

                pos = lo > pos ? lo : pos + 1;
            }
        }

        const hasInlineObstacleBetween = (prevNode: Text, currNode: Text, scope: HTMLElement): boolean => {
            if (prevNode === currNode) return false;
            let cur: Node | null = prevNode;
            let steps = 0;
            while (cur && steps < 48) {
                steps++;
                // Move to next node in document order without descending into prevNode
                let next: Node | null = null;
                if (cur !== prevNode && cur.firstChild) {
                    next = cur.firstChild;
                } else {
                    let anc: Node | null = cur;
                    while (anc && anc !== scope && !anc.nextSibling) {
                        anc = anc.parentNode;
                    }
                    if (!anc || anc === scope) return false;
                    next = anc.nextSibling;
                }
                if (!next) return false;
                if (next === currNode) return false;
                if (next.nodeType === Node.ELEMENT_NODE) {
                    const el = next as HTMLElement;
                    if (el.matches(OBSTACLE_SELECTOR)) {
                        const cs = getStyle(el);
                        if (cs.display !== 'none' && cs.visibility !== 'hidden') {
                            return true;
                        }
                    }
                }
                cur = next;
            }
            return false;
        };

        // Merge consecutive inline spans on the same visual line (e.g. bold/italic/links inside a sentence)
        // while keeping distant columns (table cells), inline formulas/icons, and differently-sized code/sub/sup
        // chips strictly separate so every selection box sits dead-on over its rendered glyphs.
        const mergedWorking: WorkingSpan[] = [];
        for (let i = 0; i < rawSpans.length; i++) {
            const curr = rawSpans[i];
            if (mergedWorking.length === 0) {
                mergedWorking.push({ ...curr, pieces: [...curr.pieces] });
                continue;
            }
            const prev = mergedWorking[mergedWorking.length - 1];
            const prevMidY = prev.topPx + prev.heightPx * 0.5;
            const currMidY = curr.topPx + curr.heightPx * 0.5;
            const sameLine = Math.abs(currMidY - prevMidY) <= Math.max(3, Math.min(prev.heightPx, curr.heightPx) * 0.45);
            const gapX = curr.xPx - (prev.xPx + prev.widthPx);
            const maxInlineGap = Math.max(prev.fontSizePx, curr.fontSizePx) * 0.85;
            const sameBlock = prev.blockRoot === curr.blockRoot;
            const sameDir = prev.dir === curr.dir;
            const similarSize = Math.abs(curr.fontSizePx - prev.fontSizePx) <= Math.max(prev.fontSizePx, curr.fontSizePx) * 0.08;
            const compatibleCode = prev.isCode === curr.isCode || gapX <= 2;

            if (
                sameLine &&
                sameBlock &&
                sameDir &&
                similarSize &&
                compatibleCode &&
                gapX >= -4 &&
                gapX <= maxInlineGap &&
                !hasInlineObstacleBetween(prev.lastNode, curr.firstNode, prev.blockRoot || pageWrapper)
            ) {
                const needsSpace =
                    gapX > prev.fontSizePx * 0.15 &&
                    !prev.text.endsWith(' ') &&
                    !curr.text.startsWith(' ');
                prev.text = needsSpace ? `${prev.text} ${curr.text}` : `${prev.text}${curr.text}`;
                const newRight = Math.max(prev.xPx + prev.widthPx, curr.xPx + curr.widthPx);
                const newBottom = Math.max(prev.topPx + prev.heightPx, curr.topPx + curr.heightPx);
                prev.xPx = Math.min(prev.xPx, curr.xPx);
                prev.topPx = Math.min(prev.topPx, curr.topPx);
                prev.widthPx = newRight - prev.xPx;
                prev.heightPx = newBottom - prev.topPx;
                const appendedPieces = curr.pieces.map((p, idx) => (idx === 0 && needsSpace ? { ...p, needsSpaceBefore: true } : p));
                prev.pieces.push(...appendedPieces);
                prev.lastNode = curr.lastNode;
            } else {
                mergedWorking.push({ ...curr, pieces: [...curr.pieces] });
            }
        }

        // For mixed LTR+RTL lines, measure exact visual DOM rects for each logical BiDi run directly
        // from the live Range API so every LTR & RTL selection box lands sub-pixel over its exact glyphs.
        const measureBidiRunRects = (
            span: WorkingSpan
        ): Array<{ xPx: number; widthPx: number }> | undefined => {
            if (!this.hasRtlChars(span.text)) return undefined;
            const cleaned = this.cleanTextForPdfLayer(span.text);
            if (!cleaned) return undefined;
            const { runs } = this.splitBidiRunsForPdf(cleaned, span.dir);
            if (runs.length <= 1) return undefined;

            // Build per-UTF16-index mapping from cleaned text back to DOM Text node offsets
            const charToDom: Array<{ node: Text; start: number; end: number } | null> = [];
            let builtStr = '';
            for (let pIdx = 0; pIdx < span.pieces.length; pIdx++) {
                const piece = span.pieces[pIdx];
                const rawStr = piece.node.data;
                if (piece.needsSpaceBefore) {
                    builtStr += ' ';
                    charToDom.push(null);
                }
                let idx = piece.rawStart;
                while (idx < piece.rawEnd) {
                    const ch = rawStr[idx];
                    if (piece.preserveWs && (ch === '\r' || ch === '\n')) {
                        idx++;
                        continue;
                    }
                    if (!piece.preserveWs && (ch === '\r' || ch === '\n' || ch === '\t' || ch === ' ')) {
                        const wsStart = idx;
                        while (idx < piece.rawEnd && (rawStr[idx] === '\r' || rawStr[idx] === '\n' || rawStr[idx] === '\t' || rawStr[idx] === ' ')) {
                            idx++;
                        }
                        builtStr += ' ';
                        charToDom.push({ node: piece.node, start: wsStart, end: idx });
                        continue;
                    }
                    const code = rawStr.charCodeAt(idx);
                    if (code === 0x200B || code === 0xFEFF || code <= 0x08 || code === 0x0B || code === 0x0C || (code >= 0x0E && code <= 0x1F) || code === 0x7F) {
                        idx++;
                        continue;
                    }
                    builtStr += ch;
                    charToDom.push({ node: piece.node, start: idx, end: idx + 1 });
                    idx++;
                }
            }

            // Trim leading/trailing spaces to mirror cleanTextForPdfLayer().trim()
            let trimS = 0;
            let trimE = builtStr.length;
            while (trimS < trimE && /\s/.test(builtStr[trimS])) trimS++;
            while (trimE > trimS && /\s/.test(builtStr[trimE - 1])) trimE--;
            const mappedClean = builtStr.slice(trimS, trimE);
            if (mappedClean.length !== cleaned.length) return undefined;
            const domMap = charToDom.slice(trimS, trimE);

            const spanMidY = pageRect.top + span.topPx + span.heightPx * 0.5;
            const spanTol = Math.max(4, span.heightPx * 0.6);

            const measureRangeForIndices = (sIdx: number, eIdx: number): { xPx: number; widthPx: number } | null => {
                let rMinL = Infinity;
                let rMaxR = -Infinity;
                let curNode: Text | null = null;
                let segMin = 0;
                let segMax = 0;

                const flushSeg = () => {
                    if (!curNode || segMax <= segMin) return;
                    range.setStart(curNode, segMin);
                    range.setEnd(curNode, segMax);
                    const rects = range.getClientRects();
                    for (let k = 0; k < rects.length; k++) {
                        const r = rects[k];
                        if (r.width <= 0.1 || r.height <= 0.1) continue;
                        if (Math.abs((r.top + r.height * 0.5) - spanMidY) > spanTol) continue;
                        if (r.left < rMinL) rMinL = r.left;
                        if (r.right > rMaxR) rMaxR = r.right;
                    }
                };

                for (let idx = sIdx; idx < eIdx; idx++) {
                    const entry = domMap[idx];
                    if (!entry) continue;
                    if (entry.node === curNode && entry.start === segMax) {
                        segMax = entry.end;
                    } else {
                        flushSeg();
                        curNode = entry.node;
                        segMin = entry.start;
                        segMax = entry.end;
                    }
                }
                flushSeg();
                if (!isFinite(rMinL) || rMaxR <= rMinL) return null;
                return { xPx: rMinL - pageRect.left, widthPx: rMaxR - rMinL };
            };

            const checkNoLargeOverlap = (boxes: Array<{ xPx: number; widthPx: number }>): boolean => {
                const sorted = [...boxes].sort((a, b) => a.xPx - b.xPx);
                for (let k = 1; k < sorted.length; k++) {
                    const prevRight = sorted[k - 1].xPx + sorted[k - 1].widthPx;
                    if (prevRight - sorted[k].xPx > 3.5) return false;
                }
                return true;
            };

            const fullBoxes: Array<{ xPx: number; widthPx: number }> = [];
            let allValid = true;
            for (let rIdx = 0; rIdx < runs.length; rIdx++) {
                const b = measureRangeForIndices(runs[rIdx].start, runs[rIdx].end);
                if (!b) {
                    allValid = false;
                    break;
                }
                fullBoxes.push(b);
            }
            if (allValid && checkNoLargeOverlap(fullBoxes)) {
                return fullBoxes;
            }

            // Retry with boundary spaces trimmed in case a BiDi boundary space bridged visually across runs
            const trimmedBoxes: Array<{ xPx: number; widthPx: number }> = [];
            let allTrimValid = true;
            for (let rIdx = 0; rIdx < runs.length; rIdx++) {
                let s = runs[rIdx].start;
                let e = runs[rIdx].end;
                while (s < e && cleaned[s] === ' ') s++;
                while (e > s && cleaned[e - 1] === ' ') e--;
                const b = e > s
                    ? measureRangeForIndices(s, e)
                    : measureRangeForIndices(runs[rIdx].start, runs[rIdx].end);
                if (!b) {
                    allTrimValid = false;
                    break;
                }
                trimmedBoxes.push(b);
            }
            if (allTrimValid && checkNoLargeOverlap(trimmedBoxes)) {
                return trimmedBoxes;
            }
            return undefined;
        };

        const finalSpans: CachedPdfTextSpan[] = [];
        for (let i = 0; i < mergedWorking.length; i++) {
            const ws = mergedWorking[i];
            const bidiRunRects = measureBidiRunRects(ws);
            const outSpan: CachedPdfTextSpan = {
                text: ws.text,
                xPx: ws.xPx,
                topPx: ws.topPx,
                widthPx: ws.widthPx,
                heightPx: ws.heightPx,
                fontSizePx: ws.fontSizePx,
                dir: ws.dir
            };
            if (bidiRunRects) {
                outSpan.bidiRunRects = bidiRunRects;
            }
            finalSpans.push(outSpan);
        }

        return finalSpans;
    }

    /**
     * Paints an invisible PDF text layer (PDF operator `3 Tr` + per-line `Tz` horizontal scaling)
     * directly over the rasterized page image so text is selectable & Ctrl+F searchable with
     * zero visual difference and negligible file size overhead (~0.9 KB/page compressed).
     */
    private drawInvisibleTextLayer(
        doc: jsPDF,
        textSpans: CachedPdfTextSpan[] | undefined,
        _activeJsPdfFont: string,
        _isCustomUnicodeFont: boolean,
        margin: number,
        topMargin: number,
        pageWidth: number,
        pageHeight: number,
        mmPerPx: number,
        sliceTopCssPx: number = 0,
        sliceBottomCssPx: number = Infinity
    ): void {
        if (!textSpans || textSpans.length === 0) return;

        doc.saveGraphicsState();
        doc.setFont('helvetica', 'normal');
        const ptPerMm = 72 / 25.4;
        let lastFontSizePt = -1;

        const shouldDefuseAutoLinks = !this.settings.enableClickableLinks;
        const defuseAutoLinks = (text: string, breaker: string): string =>
            text
                .replace(/([a-z][a-z0-9+.-]*):(\/\/)/gi, `$1:${breaker}$2`)
                .replace(/\b(www)\./gi, `$1${breaker}.`)
                .replace(/([a-z0-9._%+-])@([a-z0-9.-]+\.[a-z]{2,})/gi, `$1${breaker}@$2`);

        const docInternal = doc.internal as unknown as JsPdfInternalApi;

        for (let i = 0; i < textSpans.length; i++) {
            const span = textSpans[i];
            const midYPx = span.topPx + span.heightPx * 0.5;
            if (midYPx < sliceTopCssPx || midYPx > sliceBottomCssPx) continue;

            const cleanedRaw = this.cleanTextForPdfLayer(span.text);
            if (!cleanedRaw) continue;

            const fontSizePt = Math.max(4, Math.min(72, Math.round(span.fontSizePx * mmPerPx * ptPerMm * 10) / 10));
            const xMm = Math.max(0, Math.min(pageWidth - 1, margin + span.xPx * mmPerPx));
            const relTopPx = span.topPx - sliceTopCssPx;
            const yBaselineMm = Math.max(2, Math.min(pageHeight - 1, topMargin + (relTopPx + span.heightPx * 0.8) * mmPerPx));
            const targetWidthMm = span.widthPx * mmPerPx;

            if (this.needsUnicodeTextLayer(cleanedRaw)) {
                // Smart Unicode path: lazily attach a subsetted GlyphLess Type 0 font ONLY when
                // a span contains non-WinAnsi characters (Latin Extended, Greek, Cyrillic, CJK,
                // Arabic, Hebrew, Math, Emojis, or mixed-script lines).
                const uniState = this.getOrAttachUnicodeTextLayer(doc);
                if (uniState) {
                    const textForUnicode = shouldDefuseAutoLinks ? defuseAutoLinks(cleanedRaw, '\u200B') : cleanedRaw;
                    const encodeRunToHex = (runText: string, preserveBoundarySpaces: boolean = false): { hexCids: string; widthEm: number } => {
                        const glyphs = Array.from(runText);
                        if (preserveBoundarySpaces && glyphs.length >= 2) {
                            // Combine boundary ASCII spaces with the adjacent glyph in /ToUnicode so PDF.js
                            // does not strip inter-run spaces when X moves right-to-left on RTL base lines.
                            if (glyphs[0] === ' ' && glyphs[1] !== ' ') {
                                glyphs.splice(0, 2, ' ' + glyphs[1]);
                            }
                            if (glyphs.length >= 2 && glyphs[glyphs.length - 1] === ' ' && glyphs[glyphs.length - 2] !== ' ') {
                                glyphs.splice(glyphs.length - 2, 2, glyphs[glyphs.length - 2] + ' ');
                            }
                        }
                        let hexCids = '';
                        let widthEm = 0;
                        for (const token of glyphs) {
                            let cid = uniState.charToCid.get(token);
                            if (cid === undefined) {
                                if (uniState.cidToChar.length >= 65535) continue;
                                cid = uniState.cidToChar.length;
                                uniState.charToCid.set(token, cid);
                                uniState.cidToChar.push(token);
                                let tokenWidth = 0;
                                for (const ch of token) {
                                    tokenWidth += this.measureUnicodeCharWidthEm(ch);
                                }
                                uniState.cidWidths.push(tokenWidth || 500);
                            }
                            widthEm += (uniState.cidWidths[cid] ?? 500) / 1000;
                            hexCids += cid.toString(16).toUpperCase().padStart(4, '0');
                        }
                        return { hexCids, widthEm };
                    };

                    if (this.hasRtlChars(textForUnicode)) {
                        const { runs, visualOrder, baseDir } = this.splitBidiRunsForPdf(textForUnicode, span.dir);
                        const preserveBoundarySpaces = baseDir === 'rtl' && runs.length > 1;
                        const encodedRuns = runs.map((r) => encodeRunToHex(r.visualText, preserveBoundarySpaces));
                        const totalEm = encodedRuns.reduce((acc, er) => acc + Math.max(0.1, er.widthEm), 0);

                        // Compute exact left-to-right visual X placement for each run:
                        // prefer live DOM Range rects captured in extractPageTextSpans, falling back to
                        // glyph-width proportioning only if auto-link defusal or cache lacked exact rects.
                        const runXMm = new Array<number>(runs.length).fill(xMm);
                        const runWidthMm = new Array<number>(runs.length).fill(targetWidthMm);
                        const hasExactRunRects =
                            Array.isArray(span.bidiRunRects) &&
                            span.bidiRunRects.length === runs.length &&
                            span.bidiRunRects.every((b) => b && b.widthPx > 0.1);
                        if (hasExactRunRects && span.bidiRunRects) {
                            for (let rIdx = 0; rIdx < runs.length; rIdx++) {
                                runXMm[rIdx] = Math.max(0, Math.min(pageWidth - 1, margin + span.bidiRunRects[rIdx].xPx * mmPerPx));
                                runWidthMm[rIdx] = span.bidiRunRects[rIdx].widthPx * mmPerPx;
                            }
                        } else {
                            let cursorXPx = span.xPx;
                            for (let v = 0; v < visualOrder.length; v++) {
                                const rIdx = visualOrder[v];
                                const share = totalEm > 0 ? Math.max(0.1, encodedRuns[rIdx].widthEm) / totalEm : 1 / runs.length;
                                const wPx = span.widthPx * share;
                                runXMm[rIdx] = Math.max(0, Math.min(pageWidth - 1, margin + cursorXPx * mmPerPx));
                                runWidthMm[rIdx] = wPx * mmPerPx;
                                cursorXPx += wPx;
                            }
                        }

                        // Emit runs in logical stream order so one drag-select & copy yields exact logical text.
                        // On mixed LTR+RTL lines, offset RTL run fontSize by +0.01pt (imperceptible visually)
                        // so PDF.js flushes separate TextItems at every directional boundary instead of merging
                        // LTR+RTL runs into one chunk and letting its >=30% RTL heuristic flip the whole line.
                        const yPt = docInternal.getVerticalCoordinateString(yBaselineMm);
                        let emittedAny = false;
                        for (let rIdx = 0; rIdx < encodedRuns.length; rIdx++) {
                            const er = encodedRuns[rIdx];
                            if (!er.hexCids) continue;
                            const runFontSizePt = runs.length > 1 && runs[rIdx].isRtl
                                ? Math.round((fontSizePt + 0.01) * 100) / 100
                                : fontSizePt;
                            const naturalWidthMm = er.widthEm * (runFontSizePt / ptPerMm);
                            const hScalePercent = naturalWidthMm > 0.2 && runWidthMm[rIdx] > 0.2
                                ? Math.max(25, Math.min(400, (runWidthMm[rIdx] / naturalWidthMm) * 100))
                                : 100;
                            const xPt = docInternal.getCoordinateString(runXMm[rIdx]);
                            try {
                                docInternal.out(
                                    `q BT 3 Tr /${uniState.fontId} ${runFontSizePt} Tf ${hScalePercent.toFixed(2)} Tz 1 0 0 1 ${xPt} ${yPt} Tm <${er.hexCids}> Tj ET Q`
                                );
                                emittedAny = true;
                            } catch {
                                // Ignore safely without aborting PDF generation
                            }
                        }
                        if (emittedAny) continue;
                    } else {
                        const { hexCids, widthEm: totalWidthEm } = encodeRunToHex(textForUnicode);
                        if (hexCids.length > 0) {
                            const naturalWidthMm = totalWidthEm * (fontSizePt / ptPerMm);
                            const hScalePercent = naturalWidthMm > 0.2 && targetWidthMm > 0.2
                                ? Math.max(25, Math.min(400, (targetWidthMm / naturalWidthMm) * 100))
                                : 100;
                            const xPt = docInternal.getCoordinateString(xMm);
                            const yPt = docInternal.getVerticalCoordinateString(yBaselineMm);
                            try {
                                docInternal.out(
                                    `q BT 3 Tr /${uniState.fontId} ${fontSizePt} Tf ${hScalePercent.toFixed(2)} Tz 1 0 0 1 ${xPt} ${yPt} Tm <${hexCids}> Tj ET Q`
                                );
                            } catch {
                                // Ignore safely without aborting PDF generation
                            }
                            continue;
                        }
                    }
                }
            }

            // Fast WinAnsi path: pure ASCII / Western European spans use built-in Helvetica (zero font overhead)
            let encoded = this.encodeTextForWinAnsiLayer(cleanedRaw);
            if (!encoded) continue;
            if (shouldDefuseAutoLinks) {
                // Prevent PDF viewers (PDFium, Acrobat, PDF.js) from auto-converting bare URLs/emails in
                // the invisible text layer into clickable links when Clickable Links is turned off.
                encoded = defuseAutoLinks(encoded, '\u00AD');
            }

            if (fontSizePt !== lastFontSizePt) {
                doc.setFontSize(fontSizePt);
                lastFontSizePt = fontSizePt;
            }

            const naturalWidthMm = doc.getTextWidth(encoded);
            const hScale = naturalWidthMm > 0.2 && targetWidthMm > 0.2
                ? Math.max(0.25, Math.min(4.0, targetWidthMm / naturalWidthMm))
                : 1;

            try {
                doc.text(encoded, xMm, yBaselineMm, {
                    renderingMode: 'invisible',
                    horizontalScale: hScale
                });
            } catch {
                // Direct PDF operator fallback so invisible selectable text is never silently dropped
                try {
                    const xPt = docInternal.getCoordinateString(xMm);
                    const yPt = docInternal.getVerticalCoordinateString(yBaselineMm);
                    const escaped = docInternal.pdfEscape(encoded);
                    docInternal.out(
                        `q BT 3 Tr /F1 ${fontSizePt} Tf ${(hScale * 100).toFixed(2)} Tz 1 0 0 1 ${xPt} ${yPt} Tm (${escaped}) Tj ET Q`
                    );
                } catch {
                    // Ignore safely without aborting PDF generation
                }
            }
        }

        doc.restoreGraphicsState();
    }

    private normalizeAnchorKey(raw: string): string {
        let decoded = raw || '';
        try {
            decoded = decodeURIComponent(decoded);
        } catch {
            // keep raw string if malformed percent-encoding
        }
        return decoded
            .replace(/^#/, '')
            .replace(/(?:\u200B|\u200C|\u200D|\uFEFF)/g, '')
            .replace(/\s+/g, ' ')
            .trim()
            .toLowerCase();
    }

    private slugifyAnchorKey(raw: string): string {
        return this.normalizeAnchorKey(raw)
            .replace(/[^\p{L}\p{N}\s_-]+/gu, '')
            .replace(/[\s_]+/g, '-')
            .replace(/^-+|-+$/g, '');
    }

    private extractHeadingCleanText(el: HTMLElement): string {
        // Clone shallowly or read text nodes while excluding collapse indicators/UI buttons
        const parts: string[] = [];
        const walker = activeDocument.createTreeWalker(el, NodeFilter.SHOW_TEXT);
        let node: Node | null;
        while ((node = walker.nextNode())) {
            const parentEl = node.parentElement;
            if (parentEl && parentEl.closest('.heading-collapse-indicator, .collapse-indicator, .copy-code-button, .edit-block-button')) {
                continue;
            }
            const txt = node.textContent || '';
            if (txt) parts.push(txt);
        }
        const cleaned = parts.join('').replace(/(?:\u200B|\u200C|\u200D|\uFEFF)/g, '').replace(/\s+/g, ' ').trim();
        if (cleaned) return cleaned;
        return (el.getAttribute('data-heading') || el.textContent || '').replace(/(?:\u200B|\u200C|\u200D|\uFEFF)/g, '').replace(/\s+/g, ' ').trim();
    }

    /**
     * Builds a comprehensive lookup map for merged multi-note PDFs indexing each included note by:
     * exact path (with & without .md), basename, and frontmatter aliases.
     */
    private buildMergedNoteScopeMap(files: TFile[]): Map<string, string> {
        const mergedNoteScopeMap = new Map<string, string>();
        for (let i = 0; i < files.length; i++) {
            const scopeId = `n${i}`;
            const f = files[i];
            const fullPathLower = f.path.trim().toLowerCase();
            const pathNoExt = f.path.replace(/\.md$/i, '').trim().toLowerCase();
            const baseLower = f.basename.trim().toLowerCase();
            if (fullPathLower && !mergedNoteScopeMap.has(fullPathLower)) {
                mergedNoteScopeMap.set(fullPathLower, scopeId);
            }
            if (pathNoExt && !mergedNoteScopeMap.has(pathNoExt)) {
                mergedNoteScopeMap.set(pathNoExt, scopeId);
            }
            if (baseLower && !mergedNoteScopeMap.has(baseLower)) {
                mergedNoteScopeMap.set(baseLower, scopeId);
            }
            const fm = this.app.metadataCache.getFileCache(f)?.frontmatter;
            const rawAliases: unknown = fm?.aliases ?? fm?.alias;
            const aliasList: string[] = Array.isArray(rawAliases)
                ? rawAliases.map(a => (typeof a === 'string' || typeof a === 'number' ? String(a).trim().toLowerCase() : '')).filter(Boolean)
                : (typeof rawAliases === 'string'
                    ? rawAliases.split(',').map(a => a.trim().toLowerCase()).filter(Boolean)
                    : []);
            for (const alias of aliasList) {
                if (alias && !mergedNoteScopeMap.has(alias)) {
                    mergedNoteScopeMap.set(alias, scopeId);
                }
            }
        }
        return mergedNoteScopeMap;
    }

    /**
     * Stamps `data-pdf-block-ids` onto exact DOM target elements for every Obsidian block reference
     * (`^blockId`) in the note, combining Obsidian's metadataCache blocks with a raw Markdown fallback
     * scan so block-ID anchors survive pagination and list splits cleanly.
     */
    private annotateBlockIdsOnBlocks(blocks: BlockItem[], file: TFile, rawContent: string): void {
        const blockEntries = new Map<string, { id: string; startLine: number; endLine: number }>();

        // Source 1: Obsidian's authoritative metadataCache block index (0-based -> 1-based)
        const cachedBlocks = this.app.metadataCache.getFileCache(file)?.blocks;
        if (cachedBlocks) {
            for (const [rawKey, info] of Object.entries(cachedBlocks)) {
                const id = (info?.id || rawKey || '').trim().toLowerCase();
                if (!id || !info?.position) continue;
                const startLine = (info.position.start?.line ?? 0) + 1;
                const endLine = (info.position.end?.line ?? info.position.start?.line ?? 0) + 1;
                blockEntries.set(id, { id, startLine, endLine });
            }
        }

        // Source 2: Raw Markdown fallback scan (catches unsaved edits or uncached block IDs)
        const lines = rawContent.split(/\r?\n/);
        let inFrontmatter = lines.length > 0 && lines[0].trim() === '---';
        let activeFence: { ch: string; len: number } | null = null;
        let inComment = false;
        let prevNonEmptyLine = 0;

        for (let idx = 0; idx < lines.length; idx++) {
            const lineNum = idx + 1;
            const rawLine = lines[idx];
            const trimmed = rawLine.trim();

            if (inFrontmatter) {
                if (idx > 0 && (trimmed === '---' || trimmed === '...')) {
                    inFrontmatter = false;
                }
                continue;
            }

            const fenceMatch = rawLine.match(/^\s{0,3}(`{3,}|~{3,})/);
            if (fenceMatch) {
                const ch = fenceMatch[1][0];
                const len = fenceMatch[1].length;
                if (!activeFence) {
                    activeFence = { ch, len };
                } else if (activeFence.ch === ch && len >= activeFence.len && trimmed.replace(new RegExp(`\\${ch}`, 'g'), '') === '') {
                    activeFence = null;
                }
                continue;
            }
            if (activeFence) continue;

            if (trimmed.startsWith('%%') && !trimmed.slice(2).includes('%%')) {
                inComment = !inComment;
                continue;
            }
            if (inComment) {
                if (trimmed.includes('%%')) inComment = false;
                continue;
            }

            if (trimmed.length === 0) continue;

            const standaloneMatch = rawLine.match(/^\s*\^([A-Za-z0-9-]+)\s*$/);
            if (standaloneMatch) {
                const id = standaloneMatch[1].toLowerCase();
                if (!blockEntries.has(id)) {
                    const targetLine = prevNonEmptyLine > 0 ? prevNonEmptyLine : lineNum;
                    blockEntries.set(id, { id, startLine: targetLine, endLine: lineNum });
                }
                continue;
            }

            const inlineMatch = rawLine.match(/(?:^|\s)\^([A-Za-z0-9-]+)\s*$/);
            if (inlineMatch) {
                const id = inlineMatch[1].toLowerCase();
                if (!blockEntries.has(id)) {
                    blockEntries.set(id, { id, startLine: lineNum, endLine: lineNum });
                }
            }

            prevNonEmptyLine = lineNum;
        }

        if (blockEntries.size === 0) return;

        const lineToEls = new Map<number, HTMLElement[]>();
        const brLineToEls = new Map<number, HTMLElement[]>();

        const addToMap = (map: Map<number, HTMLElement[]>, line: number, el: HTMLElement) => {
            if (isNaN(line) || line <= 0) return;
            const arr = map.get(line);
            if (arr) {
                arr.push(el);
            } else {
                map.set(line, [el]);
            }
        };

        for (let i = 0; i < blocks.length; i++) {
            const blk = blocks[i];
            if (blk.isTitle) continue;
            const rootLine = parseInt(blk.el.getAttribute('data-pdf-line') || '', 10);
            if (!isNaN(rootLine) && rootLine > 0) {
                addToMap(lineToEls, rootLine, blk.el);
            } else if (blk.startLine > 0) {
                addToMap(lineToEls, blk.startLine, blk.el);
            }
            const tagged = blk.el.querySelectorAll<HTMLElement>('[data-pdf-line]');
            for (let k = 0; k < tagged.length; k++) {
                const ln = parseInt(tagged[k].getAttribute('data-pdf-line') || '', 10);
                addToMap(lineToEls, ln, tagged[k]);
            }
            const brTagged = blk.el.querySelectorAll<HTMLElement>('br[data-pdf-br-line]');
            for (let k = 0; k < brTagged.length; k++) {
                const ln = parseInt(brTagged[k].getAttribute('data-pdf-br-line') || '', 10);
                addToMap(brLineToEls, ln, brTagged[k]);
            }
        }

        const preferSpecificEl = (els: HTMLElement[] | undefined): HTMLElement | null => {
            if (!els || els.length === 0) return null;
            for (let i = els.length - 1; i >= 0; i--) {
                const tag = els[i].tagName;
                if (
                    tag === 'LI' ||
                    tag === 'P' ||
                    tag === 'TR' ||
                    tag === 'PRE' ||
                    tag === 'BLOCKQUOTE' ||
                    /^H[1-6]$/.test(tag) ||
                    els[i].classList.contains('callout')
                ) {
                    return els[i];
                }
            }
            return els[els.length - 1];
        };

        const stampBlockId = (el: HTMLElement, id: string) => {
            const existing = (el.getAttribute('data-pdf-block-ids') || '').trim();
            if (!existing) {
                el.setAttribute('data-pdf-block-ids', id);
                return;
            }
            const parts = existing.split(/\s+/);
            if (!parts.includes(id)) {
                el.setAttribute('data-pdf-block-ids', `${existing} ${id}`);
            }
        };

        for (const entry of blockEntries.values()) {
            let targetEl =
                preferSpecificEl(lineToEls.get(entry.startLine)) ||
                preferSpecificEl(lineToEls.get(entry.endLine));

            if (!targetEl) {
                const brEls = brLineToEls.get(entry.endLine) || brLineToEls.get(entry.startLine);
                if (brEls && brEls.length > 0) {
                    targetEl = brEls[brEls.length - 1];
                }
            }

            if (!targetEl) {
                // Find the enclosing BlockItem covering entry.startLine..entry.endLine and pick deepest matching line <= endLine
                let bestBlock: BlockItem | null = null;
                for (let i = 0; i < blocks.length; i++) {
                    const blk = blocks[i];
                    if (blk.isTitle) continue;
                    if (blk.startLine <= entry.endLine && entry.startLine <= blk.endLine) {
                        bestBlock = blk;
                        break;
                    }
                }
                if (bestBlock) {
                    let bestDesc: HTMLElement | null = null;
                    let bestDescLine = -1;
                    const descs = bestBlock.el.querySelectorAll<HTMLElement>('[data-pdf-line], br[data-pdf-br-line]');
                    for (let k = 0; k < descs.length; k++) {
                        const ln = parseInt(
                            descs[k].getAttribute('data-pdf-line') || descs[k].getAttribute('data-pdf-br-line') || '',
                            10
                        );
                        if (!isNaN(ln) && ln <= entry.endLine && ln >= bestDescLine) {
                            bestDescLine = ln;
                            bestDesc = descs[k];
                        }
                    }
                    targetEl = bestDesc || bestBlock.el;
                }
            }

            if (targetEl) {
                stampBlockId(targetEl, entry.id);
            }
        }
    }

    /**
     * Extracts headings (H1-H6 for PDF bookmarks/outline), internal anchor targets (IDs, footnotes,
     * and Obsidian ^blockId references), and clickable links (external URLs, internal same-note links,
     * and cross-note links in merged PDFs) with exact CSS pixel coordinates relative to `pageWrapper`.
     */
    private extractPageAnnotations(
        pageWrapper: HTMLElement,
        file: TFile,
        mergedNoteScopeMap?: Map<string, string>
    ): { headings: CachedPdfHeading[]; anchors: CachedPdfAnchor[]; links: CachedPdfLink[] } {
        const headings: CachedPdfHeading[] = [];
        const anchors: CachedPdfAnchor[] = [];
        const links: CachedPdfLink[] = [];

        let rootRect = pageWrapper.getBoundingClientRect();
        if (rootRect.width <= 0 || rootRect.height <= 0) {
            const sizerFallback = pageWrapper.querySelector<HTMLElement>('.markdown-preview-sizer');
            const sizerRect = sizerFallback?.getBoundingClientRect();
            if (sizerRect && sizerRect.width > 0 && sizerRect.height > 0) {
                rootRect = sizerRect;
            } else if (pageWrapper.scrollWidth <= 0 || pageWrapper.scrollHeight <= 0) {
                return { headings, anchors, links };
            }
        }

        const noteBasenameLower = (file.basename || '').trim().toLowerCase();
        const notePathLower = (file.path || '').trim().toLowerCase();
        const notePathNoExtLower = notePathLower.replace(/\.md$/i, '');

        const safeDecodeUri = (s: string): string => {
            try {
                return decodeURIComponent(s);
            } catch {
                return s;
            }
        };

        // 1. Collect headings (H1-H6)
        const headingEls = pageWrapper.querySelectorAll('h1, h2, h3, h4, h5, h6');
        for (let i = 0; i < headingEls.length; i++) {
            const hEl = headingEls[i] as HTMLElement;
            const cs = window.getComputedStyle(hEl);
            if (cs.display === 'none' || cs.visibility === 'hidden' || parseFloat(cs.opacity) === 0) continue;
            const rect = hEl.getBoundingClientRect();
            if (rect.height <= 0) continue;

            const level = parseInt(hEl.tagName.substring(1), 10);
            if (isNaN(level) || level < 1 || level > 6) continue;

            const title = this.extractHeadingCleanText(hEl);
            if (!title) continue;

            const keySet = new Set<string>();
            const addKeyVariants = (raw: string | null) => {
                if (!raw) return;
                const norm = this.normalizeAnchorKey(raw);
                if (norm) keySet.add(norm);
                const slug = this.slugifyAnchorKey(raw);
                if (slug) keySet.add(slug);
            };
            addKeyVariants(hEl.id);
            addKeyVariants(hEl.getAttribute('data-heading'));
            addKeyVariants(title);

            headings.push({
                level,
                title,
                topPx: Math.max(0, rect.top - rootRect.top),
                anchorKeys: Array.from(keySet)
            });
        }

        // 2. Collect non-heading anchor targets (explicit element IDs, numeric footnotes, Obsidian ^blockIds)
        // Obsidian appends a random hex hash to numeric footnote IDs (e.g. "fn-1-a1b2c3d4e5f6", "fnref-1-a1b2c3d4e5f6").
        // Register both the exact ID and the unhashed numeric base ID so explicit links like [text](#fn-1) / [text](#fnref-1) resolve.
        const idEls = pageWrapper.querySelectorAll('[id], [data-footnote-id], [data-pdf-block-ids], sup.footnote-ref');
        for (let i = 0; i < idEls.length; i++) {
            const aEl = idEls[i] as HTMLElement;
            const isHeading = /^H[1-6]$/.test(aEl.tagName);
            const blockIdsAttr = (aEl.getAttribute('data-pdf-block-ids') || '').trim();
            if (isHeading && !blockIdsAttr) continue;

            const cs = window.getComputedStyle(aEl);
            if (cs.display === 'none' || cs.visibility === 'hidden') continue;
            let rect = aEl.getBoundingClientRect();
            if (rect.height <= 0 && rect.width <= 0) {
                if (aEl.tagName === 'BR' && aEl.parentElement) {
                    const parentRect = aEl.parentElement.getBoundingClientRect();
                    if (parentRect.height > 0 || parentRect.width > 0) {
                        rect = parentRect;
                    } else {
                        continue;
                    }
                } else {
                    continue;
                }
            }

            const keySet = new Set<string>();
            const addKeyVariants = (raw: string | null) => {
                if (!raw) return;
                const norm = this.normalizeAnchorKey(raw);
                if (norm) {
                    keySet.add(norm);
                    const strippedHash = norm.replace(/^(fn(?:ref)?-\d+)-[0-9a-f]{6,}$/i, '$1');
                    if (strippedHash && strippedHash !== norm) {
                        keySet.add(strippedHash);
                    }
                }
                const slug = this.slugifyAnchorKey(raw);
                if (slug) {
                    keySet.add(slug);
                    const strippedSlug = slug.replace(/^(fn(?:ref)?-\d+)-[0-9a-f]{6,}$/i, '$1');
                    if (strippedSlug && strippedSlug !== slug) {
                        keySet.add(strippedSlug);
                    }
                }
            };

            if (!isHeading) {
                addKeyVariants(aEl.id);
                const fnId = aEl.getAttribute('data-footnote-id');
                if (fnId) {
                    const trimmedFnId = fnId.trim();
                    addKeyVariants(trimmedFnId);
                    if (/^\d+$/.test(trimmedFnId)) {
                        addKeyVariants(`fn-${trimmedFnId}`);
                    }
                }
                if (aEl.tagName === 'SUP' && aEl.classList.contains('footnote-ref')) {
                    const fnLink = aEl.querySelector<HTMLAnchorElement>('a[href], a[data-href]');
                    const targetRef = (fnLink?.getAttribute('href') || fnLink?.getAttribute('data-href') || '').replace(/^#/, '');
                    const numMatch = targetRef.match(/^fn-(\d+)(?:-[0-9a-f]{6,})?$/i);
                    if (numMatch && numMatch[1]) {
                        addKeyVariants(`fnref-${numMatch[1]}`);
                    }
                }
            }

            if (blockIdsAttr) {
                const ids = blockIdsAttr.split(/\s+/);
                for (let b = 0; b < ids.length; b++) {
                    const bid = ids[b].trim().toLowerCase().replace(/^\^+/, '');
                    if (!bid) continue;
                    keySet.add(`^${bid}`);
                    keySet.add(bid);
                }
            }

            if (keySet.size > 0) {
                anchors.push({
                    keys: Array.from(keySet),
                    topPx: Math.max(0, rect.top - rootRect.top)
                });
            }
        }

        // 3. Collect clickable links (external URLs + internal same-note & cross-note links)
        const anchorEls = pageWrapper.querySelectorAll('a[href], a[data-href]');
        for (let i = 0; i < anchorEls.length; i++) {
            const aEl = anchorEls[i] as HTMLAnchorElement;
            if (
                aEl.classList.contains('markdown-embed-link') ||
                aEl.classList.contains('file-embed-link')
            ) {
                continue;
            }
            const cs = window.getComputedStyle(aEl);
            if (cs.display === 'none' || cs.visibility === 'hidden' || parseFloat(cs.opacity) === 0) continue;

            const rawHref = (aEl.getAttribute('href') || '').trim();
            const rawDataHref = (aEl.getAttribute('data-href') || '').trim();
            const resolvedDomHref = (aEl.href || '').trim();

            let linkKind: 'external' | 'internal' | null = null;
            let resolvedUrl: string | undefined;
            let resolvedTargetKey: string | undefined;
            let resolvedTargetScope: string | undefined;

            const isExternalScheme = (u: string): boolean =>
                /^(https?:\/\/|mailto:|tel:|ftp:\/\/)/i.test(u);

            if (isExternalScheme(rawHref)) {
                linkKind = 'external';
                resolvedUrl = rawHref;
            } else if (isExternalScheme(rawDataHref)) {
                linkKind = 'external';
                resolvedUrl = rawDataHref;
            } else if (rawHref.startsWith('#') && rawHref.length > 1) {
                linkKind = 'internal';
                resolvedTargetKey = safeDecodeUri(rawHref.slice(1));
            } else if (rawDataHref.startsWith('#') && rawDataHref.length > 1) {
                linkKind = 'internal';
                resolvedTargetKey = safeDecodeUri(rawDataHref.slice(1));
            } else if (
                (aEl.classList.contains('internal-link') || (!isExternalScheme(rawHref) && !rawHref.startsWith('obsidian://'))) &&
                (rawDataHref || rawHref)
            ) {
                const candidate = rawDataHref || rawHref;
                const hashIdx = candidate.indexOf('#');
                const rawNotePart = hashIdx >= 0 ? candidate.slice(0, hashIdx) : candidate;
                const rawSubpath = hashIdx >= 0 ? candidate.slice(hashIdx + 1) : '';
                const decodedNotePart = safeDecodeUri(rawNotePart).trim();
                const decodedSubpath = safeDecodeUri(rawSubpath).trim();
                const noteLower = decodedNotePart.toLowerCase();
                const noteNoExtLower = noteLower.replace(/\.md$/i, '');

                if (decodedNotePart === '' && decodedSubpath.length > 0) {
                    linkKind = 'internal';
                    resolvedTargetKey = decodedSubpath;
                } else if (decodedNotePart.length > 0) {
                    const destFile = this.app.metadataCache.getFirstLinkpathDest(decodedNotePart, file.path);
                    const isSameNote =
                        (destFile !== null && destFile.path === file.path) ||
                        noteNoExtLower === noteBasenameLower ||
                        noteNoExtLower === notePathNoExtLower ||
                        noteLower === notePathLower;

                    if (isSameNote) {
                        linkKind = 'internal';
                        resolvedTargetKey = decodedSubpath || '__note_start__';
                    } else if (mergedNoteScopeMap) {
                        const destPathLower = destFile ? destFile.path.trim().toLowerCase() : '';
                        const destPathNoExt = destPathLower.replace(/\.md$/i, '');
                        const destBaseLower = destFile ? destFile.basename.trim().toLowerCase() : '';
                        const trailingSegment = noteNoExtLower.includes('/')
                            ? (noteNoExtLower.split('/').pop() || '').trim()
                            : '';

                        const crossScope =
                            (destPathLower ? mergedNoteScopeMap.get(destPathLower) : undefined) ||
                            (destPathNoExt ? mergedNoteScopeMap.get(destPathNoExt) : undefined) ||
                            (destBaseLower ? mergedNoteScopeMap.get(destBaseLower) : undefined) ||
                            mergedNoteScopeMap.get(noteLower) ||
                            mergedNoteScopeMap.get(noteNoExtLower) ||
                            (trailingSegment ? mergedNoteScopeMap.get(trailingSegment) : undefined);

                        if (crossScope) {
                            linkKind = 'internal';
                            resolvedTargetScope = crossScope;
                            resolvedTargetKey = decodedSubpath || '__note_start__';
                        }
                    }
                }
            } else if (isExternalScheme(resolvedDomHref)) {
                linkKind = 'external';
                resolvedUrl = resolvedDomHref;
            }

            if (!linkKind) continue;

            // Gather tight per-line rectangles using getClientRects() so wrapped links don't create giant boxes
            const clientRects = Array.from(aEl.getClientRects()).filter(r => r.width >= 1 && r.height >= 1);
            const fallbackRect = clientRects.length === 0 ? aEl.getBoundingClientRect() : null;
            const rawRects = clientRects.length > 0
                ? clientRects
                : (fallbackRect && fallbackRect.width >= 1 && fallbackRect.height >= 1 ? [fallbackRect] : []);
            if (rawRects.length === 0) continue;

            // Merge adjacent/overlapping rects on the same visual line
            const mergedRects: CachedPdfLinkRect[] = [];
            for (const r of rawRects) {
                const xPx = Math.max(0, r.left - rootRect.left);
                const topPx = Math.max(0, r.top - rootRect.top);
                const widthPx = Math.min(rootRect.width - xPx, r.width);
                const heightPx = r.height;
                if (widthPx < 1 || heightPx < 1) continue;

                const last = mergedRects.length > 0 ? mergedRects[mergedRects.length - 1] : null;
                if (
                    last &&
                    Math.abs((last.topPx + last.heightPx * 0.5) - (topPx + heightPx * 0.5)) <= Math.max(3, Math.min(last.heightPx, heightPx) * 0.5) &&
                    xPx <= last.xPx + last.widthPx + 3 &&
                    xPx + widthPx >= last.xPx - 3
                ) {
                    const right = Math.max(last.xPx + last.widthPx, xPx + widthPx);
                    const bottom = Math.max(last.topPx + last.heightPx, topPx + heightPx);
                    last.xPx = Math.min(last.xPx, xPx);
                    last.topPx = Math.min(last.topPx, topPx);
                    last.widthPx = right - last.xPx;
                    last.heightPx = bottom - last.topPx;
                } else {
                    mergedRects.push({ xPx, topPx, widthPx, heightPx });
                }
            }

            if (mergedRects.length > 0) {
                links.push({
                    kind: linkKind,
                    url: resolvedUrl,
                    targetKey: resolvedTargetKey,
                    targetScope: resolvedTargetScope,
                    rects: mergedRects
                });
            }
        }

        return { headings, anchors, links };
    }

    /**
     * Enhances a jsPDF instance's outline writer so bookmark titles support full UTF-16BE Unicode
     * (accented letters, Greek/math symbols, emojis) and jump to the exact heading Y coordinate.
     */
    private enhanceJsPdfOutline(doc: jsPDF): void {
        const outline = (doc as unknown as JsPdfExtended).outline;
        if (!outline || outline.__obsidianEnhanced) return;
        outline.__obsidianEnhanced = true;
        const fallbackInternal = doc.internal as unknown as JsPdfInternalApi;

        outline.makeString = (str: string): string => {
            const cleaned = (str || '').replace(/[\r\n\t]+/g, ' ').trim();
            if (/^[\x20-\x7e]*$/.test(cleaned)) {
                return `(${fallbackInternal.pdfEscape(cleaned)})`;
            }
            let hex = 'FEFF';
            for (let i = 0; i < cleaned.length; i++) {
                hex += cleaned.charCodeAt(i).toString(16).toUpperCase().padStart(4, '0');
            }
            return `<${hex}>`;
        };

        outline.renderItems = function (this: JsPdfOutlineApi, node: JsPdfOutlineItem) {
            const pdfInternal = this.ctx?.pdf?.internal || fallbackInternal;
            for (let idx = 0; idx < node.children.length; idx++) {
                const item = node.children[idx];
                this.objStart(item);
                const titleStr = this.makeString ? this.makeString(item.title) : `(${fallbackInternal.pdfEscape(item.title)})`;
                this.line('/Title ' + titleStr);
                this.line('/Parent ' + this.makeRef(node));
                if (idx > 0) this.line('/Prev ' + this.makeRef(node.children[idx - 1]));
                if (idx < node.children.length - 1) this.line('/Next ' + this.makeRef(node.children[idx + 1]));
                if (item.children.length > 0) {
                    this.line('/First ' + this.makeRef(item.children[0]));
                    this.line('/Last ' + this.makeRef(item.children[item.children.length - 1]));
                }
                const count = this.count_r({ count: 0 }, item);
                if (count > 0) this.line('/Count ' + count);
                if (item.options && item.options.pageNumber) {
                    const pageInfo = pdfInternal.getPageInfo(item.options.pageNumber);
                    if (pageInfo) {
                        const objId = pageInfo.objId || pageInfo.pageContext?.objId;
                        const topMm = typeof item.options.top === 'number' ? item.options.top : 0;
                        if (objId) {
                            this.line(`/Dest [${objId} 0 R /XYZ 0 ${pdfInternal.getVerticalCoordinateString(topMm)} 0]`);
                        }
                    }
                }
                this.objEnd();
            }
            for (let idx = 0; idx < node.children.length; idx++) {
                this.renderItems?.(node.children[idx]);
            }
        };
    }

    /**
     * Prepends a clickable, multi-page-capable Table of Contents starting on Page 1
     * (followed immediately by a fresh page for note content), shifting content page numbers
     * in `emittedSlices` and `deferredLineNumbers` so bookmarks, links, and line numbers stay aligned.
     */
    private prependTocPagesToDoc(
        doc: jsPDF,
        emittedSlices: EmittedPdfSliceMeta[],
        deferredLineNumbers: Array<{ pdfPageNum: number; markerOffsets: Array<{ line: number; offsetTopPx: number }>; singleSlice: boolean; mmPerPx?: number }>,
        activeJsPdfFont: string,
        isCustomUnicodeFont: boolean,
        margin: number,
        topMargin: number,
        pageWidth: number,
        pageHeight: number,
        contentWidthMm: number,
        contentWidthPx: number,
        maxPageContentPx: number,
        mmPerPx: number,
        captureScale: number,
        bgColor: number[],
        textColor: number[],
        bgHex: string,
        fontFamily: string,
        includeChapterLevel: boolean = false,
        pageFormat?: 'a4' | 'letter' | 'a5',
        baseOrientation?: 'p' | 'l'
    ): number {
        if (!this.settings.includeTocPage || !emittedSlices || emittedSlices.length === 0) return 0;
        const enabledLevels = new Set<number>(this.settings.bookmarkHeadingLevels);
        if (!includeChapterLevel && enabledLevels.size === 0) return 0;

        interface TocEntry {
            level: number;
            title: string;
            contentPageNum: number;
            topMm: number;
        }

        const entries: TocEntry[] = [];
        for (let i = 0; i < emittedSlices.length; i++) {
            const slice = emittedSlices[i];
            const sTop = slice.sliceTopCssPx;
            const sBot = slice.sliceBottomCssPx;
            const sPageHeight = slice.pageHeightMm ?? pageHeight;
            const sMmPerPx = slice.mmPerPx ?? mmPerPx;
            for (let hIdx = 0; hIdx < slice.headings.length; hIdx++) {
                const h = slice.headings[hIdx];
                if (h.topPx < sTop - 1 || h.topPx >= sBot) continue;
                const isChapter = includeChapterLevel && h.level === 0;
                if (!isChapter && !enabledLevels.has(h.level)) continue;
                const topMm = isChapter
                    ? Math.max(0, topMargin - 2)
                    : Math.max(0, Math.min(sPageHeight - 5, topMargin + (h.topPx - sTop) * sMmPerPx - 2));
                entries.push({
                    level: h.level,
                    title: h.title,
                    contentPageNum: slice.pdfPageNum,
                    topMm
                });
            }
        }
        if (entries.length === 0) return 0;

        const minLevel = entries.reduce((m, e) => Math.min(m, e.level), 6);
        const safeFont = fontFamily && fontFamily.trim() !== '' ? fontFamily : 'sans-serif';

        const measureCanvas = createEl('canvas');
        const mCtx = measureCanvas.getContext('2d');
        if (!mCtx) return 0;

        const wrapTextLines = (text: string, maxWidthPx: number, fontSpec: string): string[] => {
            mCtx.font = fontSpec;
            if (mCtx.measureText(text).width <= maxWidthPx) return [text];
            const words = text.split(/\s+/).filter(Boolean);
            const lines: string[] = [];
            let current = '';
            for (const word of words) {
                const candidate = current ? `${current} ${word}` : word;
                if (mCtx.measureText(candidate).width <= maxWidthPx) {
                    current = candidate;
                } else {
                    if (current) lines.push(current);
                    if (mCtx.measureText(word).width <= maxWidthPx) {
                        current = word;
                    } else {
                        let chunk = '';
                        for (const ch of word) {
                            if (mCtx.measureText(chunk + ch).width > maxWidthPx && chunk.length > 0) {
                                lines.push(chunk);
                                chunk = ch;
                            } else {
                                chunk += ch;
                            }
                        }
                        current = chunk;
                    }
                }
            }
            if (current) lines.push(current);
            return lines.length > 0 ? lines : [text];
        };

        interface MeasuredTocRow {
            entry: TocEntry;
            depth: number;
            indentPx: number;
            fontSizePx: number;
            fontSpec: string;
            lineHeightPx: number;
            lines: string[];
            lastLineWidthPx: number;
            yPx: number;
            rowHeightPx: number;
        }

        interface TocPagePlan {
            isFirstPage: boolean;
            rows: MeasuredTocRow[];
            usedHeightPx: number;
        }

        const pageNumColWidthPx = 46;
        const titleHeaderHeightPx = 54;
        const tocPages: TocPagePlan[] = [];
        let currentRows: MeasuredTocRow[] = [];
        let cursorY = titleHeaderHeightPx;
        let isFirstPage = true;

        for (let i = 0; i < entries.length; i++) {
            const entry = entries[i];
            const depth = Math.max(0, Math.min(5, entry.level - minLevel));
            const indentPx = depth * 18;
            const fontSizePx = depth === 0 ? 15 : depth === 1 ? 14 : 13;
            const fontWeight = depth === 0 ? '600' : '400';
            const fontSpec = `${fontWeight} ${fontSizePx}px ${safeFont}`;
            const lineHeightPx = Math.round(fontSizePx * 1.48);
            const gapAfterPx = depth === 0 ? 8 : 5;
            const availWidthPx = Math.max(120, contentWidthPx - indentPx - pageNumColWidthPx - 10);

            const wrapped = wrapTextLines(entry.title, availWidthPx, fontSpec);
            mCtx.font = fontSpec;
            const lastLineWidthPx = mCtx.measureText(wrapped[wrapped.length - 1]).width;
            const rowHeightPx = wrapped.length * lineHeightPx + gapAfterPx;

            if (currentRows.length > 0 && cursorY + rowHeightPx > maxPageContentPx) {
                tocPages.push({
                    isFirstPage,
                    rows: currentRows,
                    usedHeightPx: Math.min(maxPageContentPx, Math.ceil(cursorY + 6))
                });
                currentRows = [];
                isFirstPage = false;
                cursorY = 6;
            }

            currentRows.push({
                entry,
                depth,
                indentPx,
                fontSizePx,
                fontSpec,
                lineHeightPx,
                lines: wrapped,
                lastLineWidthPx,
                yPx: cursorY,
                rowHeightPx
            });
            cursorY += rowHeightPx;
        }

        if (currentRows.length > 0) {
            tocPages.push({
                isFirstPage,
                rows: currentRows,
                usedHeightPx: Math.min(maxPageContentPx, Math.ceil(cursorY + 6))
            });
        }

        const tocPageCount = tocPages.length;
        if (tocPageCount === 0) return 0;

        // Insert ToC pages at the start (pages 1..tocPageCount) in the document's base orientation
        // (using addPage + movePage instead of insertPage so a trailing Landscape page never flips ToC orientation)
        const tocOrientation: 'p' | 'l' = baseOrientation ?? (pageWidth > pageHeight ? 'l' : 'p');
        const tocFormat: 'a4' | 'letter' | 'a5' | [number, number] = pageFormat ?? [pageWidth, pageHeight];
        for (let p = 1; p <= tocPageCount; p++) {
            doc.addPage(tocFormat, tocOrientation);
            doc.movePage(doc.getNumberOfPages(), p);
        }
        for (let i = 0; i < emittedSlices.length; i++) {
            emittedSlices[i].pdfPageNum += tocPageCount;
        }
        for (let i = 0; i < deferredLineNumbers.length; i++) {
            deferredLineNumbers[i].pdfPageNum += tocPageCount;
        }

        const textRgb = `rgb(${textColor[0]}, ${textColor[1]}, ${textColor[2]})`;
        const mutedRgb = `rgba(${textColor[0]}, ${textColor[1]}, ${textColor[2]}, 0.72)`;
        const leaderRgb = `rgba(${textColor[0]}, ${textColor[1]}, ${textColor[2]}, 0.30)`;
        const ruleRgb = `rgba(${textColor[0]}, ${textColor[1]}, ${textColor[2]}, 0.22)`;

        for (let pIdx = 0; pIdx < tocPageCount; pIdx++) {
            const plan = tocPages[pIdx];
            const canvasCssH = Math.max(40, plan.usedHeightPx);
            const canvas = createEl('canvas');
            canvas.width = Math.max(1, Math.round(contentWidthPx * captureScale));
            canvas.height = Math.max(1, Math.round(canvasCssH * captureScale));
            const ctx = canvas.getContext('2d', { alpha: false });
            if (!ctx) continue;

            ctx.fillStyle = bgHex;
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            ctx.scale(captureScale, captureScale);
            ctx.textBaseline = 'alphabetic';

            const tocTextSpans: CachedPdfTextSpan[] = [];

            if (plan.isFirstPage) {
                const headingText = 'Table of Contents';
                ctx.font = `700 23px ${safeFont}`;
                ctx.fillStyle = textRgb;
                ctx.textAlign = 'left';
                ctx.fillText(headingText, 0, 26);
                const headingW = ctx.measureText(headingText).width;
                tocTextSpans.push({
                    text: headingText,
                    xPx: 0,
                    topPx: 3,
                    widthPx: headingW,
                    heightPx: 27,
                    fontSizePx: 23
                });

                ctx.strokeStyle = ruleRgb;
                ctx.lineWidth = 1;
                ctx.beginPath();
                ctx.moveTo(0, 38);
                ctx.lineTo(contentWidthPx, 38);
                ctx.stroke();
            }

            for (let rIdx = 0; rIdx < plan.rows.length; rIdx++) {
                const row = plan.rows[rIdx];
                const targetPageNum = row.entry.contentPageNum + tocPageCount;
                const pageNumStr = String(targetPageNum);

                ctx.font = row.fontSpec;
                ctx.fillStyle = textRgb;
                ctx.textAlign = 'left';

                for (let lIdx = 0; lIdx < row.lines.length; lIdx++) {
                    const lineText = row.lines[lIdx];
                    const lineTopPx = row.yPx + lIdx * row.lineHeightPx;
                    const baselinePx = lineTopPx + Math.round(row.fontSizePx * 0.92);
                    ctx.fillText(lineText, row.indentPx, baselinePx);
                    const lineW = ctx.measureText(lineText).width;
                    tocTextSpans.push({
                        text: lineText,
                        xPx: row.indentPx,
                        topPx: lineTopPx,
                        widthPx: lineW,
                        heightPx: row.lineHeightPx,
                        fontSizePx: row.fontSizePx
                    });
                }

                const lastLineIdx = row.lines.length - 1;
                const lastLineTopPx = row.yPx + lastLineIdx * row.lineHeightPx;
                const lastBaselinePx = lastLineTopPx + Math.round(row.fontSizePx * 0.92);

                ctx.font = `400 ${Math.max(12, row.fontSizePx - 1)}px ${safeFont}`;
                const pageNumWidth = ctx.measureText(pageNumStr).width;
                ctx.fillStyle = mutedRgb;
                ctx.textAlign = 'right';
                ctx.fillText(pageNumStr, contentWidthPx, lastBaselinePx);
                tocTextSpans.push({
                    text: pageNumStr,
                    xPx: Math.max(0, contentWidthPx - pageNumWidth),
                    topPx: lastLineTopPx,
                    widthPx: pageNumWidth,
                    heightPx: row.lineHeightPx,
                    fontSizePx: Math.max(12, row.fontSizePx - 1)
                });

                const leaderStartPx = row.indentPx + row.lastLineWidthPx + 8;
                const leaderEndPx = contentWidthPx - pageNumWidth - 8;
                if (leaderEndPx - leaderStartPx > 12) {
                    ctx.save();
                    ctx.strokeStyle = leaderRgb;
                    ctx.lineWidth = 1;
                    ctx.setLineDash([1.5, 4.5]);
                    ctx.beginPath();
                    ctx.moveTo(leaderStartPx, lastBaselinePx - 2);
                    ctx.lineTo(leaderEndPx, lastBaselinePx - 2);
                    ctx.stroke();
                    ctx.restore();
                }
            }

            const tocImgData = canvas.toDataURL('image/png');
            const tocHeightMm = canvasCssH * mmPerPx;
            canvas.width = 0;
            canvas.height = 0;

            doc.setPage(pIdx + 1);
            doc.setFillColor(bgColor[0], bgColor[1], bgColor[2]);
            doc.rect(0, 0, pageWidth, pageHeight, 'F');
            doc.addImage(tocImgData, 'PNG', margin, topMargin, contentWidthMm, tocHeightMm, undefined, 'FAST');

            this.drawInvisibleTextLayer(
                doc,
                tocTextSpans,
                activeJsPdfFont,
                isCustomUnicodeFont,
                margin,
                topMargin,
                pageWidth,
                pageHeight,
                mmPerPx,
                0,
                Infinity
            );

            for (let rIdx = 0; rIdx < plan.rows.length; rIdx++) {
                const row = plan.rows[rIdx];
                const targetPageNum = row.entry.contentPageNum + tocPageCount;
                const xMm = Math.max(0, margin + row.indentPx * mmPerPx);
                const yMm = Math.max(0, topMargin + row.yPx * mmPerPx);
                const wMm = Math.max(1, (contentWidthPx - row.indentPx) * mmPerPx);
                const hMm = Math.max(2, (row.lines.length * row.lineHeightPx) * mmPerPx);
                try {
                    doc.link(xMm, yMm, wMm, hMm, {
                        pageNumber: targetPageNum,
                        top: row.entry.topMm,
                        zoom: 0
                    });
                } catch {
                    // ignore safely
                }
            }
        }

        return tocPageCount;
    }

    /**
     * Attaches clickable PDF link annotations (external URLs and resolved same-note internal jumps)
     * and hierarchical PDF bookmarks (Outline / Table of Contents filtered by enabled H1-H6 levels).
     */
    private applyPdfLinksAndOutline(
        doc: jsPDF,
        emittedSlices: EmittedPdfSliceMeta[],
        margin: number,
        topMargin: number,
        pageWidth: number,
        pageHeight: number,
        mmPerPx: number,
        includeChapterLevel: boolean = false
    ): void {
        if (!emittedSlices || emittedSlices.length === 0) return;

        const wantBookmarks = this.settings.includeBookmarks && (includeChapterLevel || this.settings.bookmarkHeadingLevels.length > 0);
        const wantLinks = this.settings.enableClickableLinks;
        if (!wantBookmarks && !wantLinks) return;

        const enabledLevels = new Set<number>(this.settings.bookmarkHeadingLevels);
        const anchorDestinations = new Map<string, { pdfPageNum: number; topMm: number; pageHeightMm: number }>();
        const orderedBookmarks: Array<{ level: number; title: string; pdfPageNum: number; topMm: number }> = [];

        // Pass 1: Map every heading and anchor across all slices to its exact (pdfPageNum, topMm, pageHeightMm)
        for (let i = 0; i < emittedSlices.length; i++) {
            const slice = emittedSlices[i];
            const scopePrefix = slice.noteScope ? `${slice.noteScope}\0` : '';
            const sTop = slice.sliceTopCssPx;
            const sBot = slice.sliceBottomCssPx;
            const sPageHeight = slice.pageHeightMm ?? pageHeight;
            const sMmPerPx = slice.mmPerPx ?? mmPerPx;

            for (let hIdx = 0; hIdx < slice.headings.length; hIdx++) {
                const h = slice.headings[hIdx];
                if (h.topPx < sTop - 1 || h.topPx >= sBot) continue;
                const isChapter = includeChapterLevel && h.level === 0;
                const destTopMm = isChapter
                    ? Math.max(0, topMargin - 2)
                    : Math.max(0, Math.min(sPageHeight - 5, topMargin + (h.topPx - sTop) * sMmPerPx - 2));

                for (const key of h.anchorKeys) {
                    const scopedKey = key ? scopePrefix + key : '';
                    if (scopedKey && !anchorDestinations.has(scopedKey)) {
                        anchorDestinations.set(scopedKey, { pdfPageNum: slice.pdfPageNum, topMm: destTopMm, pageHeightMm: sPageHeight });
                    }
                }
                if (wantBookmarks && (isChapter || enabledLevels.has(h.level))) {
                    orderedBookmarks.push({
                        level: h.level,
                        title: h.title,
                        pdfPageNum: slice.pdfPageNum,
                        topMm: destTopMm
                    });
                }
            }

            if (wantLinks) {
                for (let aIdx = 0; aIdx < slice.anchors.length; aIdx++) {
                    const anc = slice.anchors[aIdx];
                    if (anc.topPx < sTop - 1 || anc.topPx >= sBot) continue;
                    const destTopMm = Math.max(0, Math.min(sPageHeight - 5, topMargin + (anc.topPx - sTop) * sMmPerPx - 2));
                    for (const key of anc.keys) {
                        const scopedKey = key ? scopePrefix + key : '';
                        if (scopedKey && !anchorDestinations.has(scopedKey)) {
                            anchorDestinations.set(scopedKey, { pdfPageNum: slice.pdfPageNum, topMm: destTopMm, pageHeightMm: sPageHeight });
                        }
                    }
                }
            }
        }

        // Pass 2: Build hierarchical PDF Outline (Bookmarks)
        const docOutline = (doc as unknown as JsPdfExtended).outline;
        if (wantBookmarks && orderedBookmarks.length > 0 && docOutline) {
            this.enhanceJsPdfOutline(doc);
            const stack: Array<{ level: number; node: JsPdfOutlineItem }> = [];
            for (const bm of orderedBookmarks) {
                while (stack.length > 0 && stack[stack.length - 1].level >= bm.level) {
                    stack.pop();
                }
                const parentNode = stack.length > 0 ? stack[stack.length - 1].node : null;
                const created = docOutline.add(parentNode, bm.title, {
                    pageNumber: bm.pdfPageNum,
                    top: bm.topMm
                });
                stack.push({ level: bm.level, node: created });
            }
        }

        // Pass 3: Attach clickable Link annotations per page
        if (wantLinks) {
            for (let i = 0; i < emittedSlices.length; i++) {
                const slice = emittedSlices[i];
                if (slice.links.length === 0) continue;
                const sliceScopePrefix = slice.noteScope ? `${slice.noteScope}\0` : '';
                const sTop = slice.sliceTopCssPx;
                const sBot = slice.sliceBottomCssPx;
                const sPageWidth = slice.pageWidthMm ?? pageWidth;
                const sPageHeight = slice.pageHeightMm ?? pageHeight;
                const sMmPerPx = slice.mmPerPx ?? mmPerPx;
                let pageSelected = false;

                for (let lIdx = 0; lIdx < slice.links.length; lIdx++) {
                    const link = slice.links[lIdx];
                    let linkOptions: { url?: string; pageNumber?: number; top?: number; zoom?: number } | null = null;

                    if (link.kind === 'external' && link.url) {
                        linkOptions = { url: link.url };
                    } else if (link.kind === 'internal' && link.targetKey) {
                        const lookupPrefix = link.targetScope !== undefined
                            ? (link.targetScope ? `${link.targetScope}\0` : '')
                            : sliceScopePrefix;
                        const rawKey = link.targetKey;
                        const rawLower = rawKey.toLowerCase();
                        const normKey = this.normalizeAnchorKey(rawKey);
                        const slugKey = this.slugifyAnchorKey(rawKey);
                        const strippedNorm = normKey.replace(/^(fn(?:ref)?-\d+)-[0-9a-f]{6,}$/i, '$1');
                        const strippedSlug = slugKey.replace(/^(fn(?:ref)?-\d+)-[0-9a-f]{6,}$/i, '$1');
                        const caretToggled = normKey.startsWith('^') ? normKey.slice(1) : `^${normKey}`;
                        const lastHashSegment = rawKey.includes('#') ? (rawKey.split('#').pop() || '').trim() : '';
                        const lastSegNorm = lastHashSegment ? this.normalizeAnchorKey(lastHashSegment) : '';
                        const lastSegSlug = lastHashSegment ? this.slugifyAnchorKey(lastHashSegment) : '';
                        const dest =
                            anchorDestinations.get(lookupPrefix + rawKey) ||
                            anchorDestinations.get(lookupPrefix + rawLower) ||
                            anchorDestinations.get(lookupPrefix + normKey) ||
                            anchorDestinations.get(lookupPrefix + slugKey) ||
                            anchorDestinations.get(lookupPrefix + strippedNorm) ||
                            anchorDestinations.get(lookupPrefix + strippedSlug) ||
                            anchorDestinations.get(lookupPrefix + caretToggled) ||
                            (lastSegNorm ? anchorDestinations.get(lookupPrefix + lastSegNorm) : undefined) ||
                            (lastSegSlug ? anchorDestinations.get(lookupPrefix + lastSegSlug) : undefined);
                        if (dest) {
                            // jsPDF converts link `options.top` using the source page's height; adjust when
                            // jumping between Portrait and Landscape pages so the PDF /XYZ Y lands accurately.
                            const adjustedTopMm = dest.pageHeightMm !== sPageHeight
                                ? dest.topMm + (sPageHeight - dest.pageHeightMm)
                                : dest.topMm;
                            linkOptions = {
                                pageNumber: dest.pdfPageNum,
                                top: adjustedTopMm,
                                zoom: 0
                            };
                        }
                    }

                    if (!linkOptions) continue;

                    for (let rIdx = 0; rIdx < link.rects.length; rIdx++) {
                        const rect = link.rects[rIdx];
                        const rTop = rect.topPx;
                        const rBot = rect.topPx + rect.heightPx;
                        if (rBot <= sTop || rTop >= sBot) continue;

                        const clippedTop = Math.max(rTop, sTop);
                        const clippedBot = Math.min(rBot, sBot);
                        const xMm = Math.max(0, Math.min(sPageWidth - 0.5, margin + rect.xPx * sMmPerPx));
                        const yMm = Math.max(0, Math.min(sPageHeight - 0.5, topMargin + (clippedTop - sTop) * sMmPerPx));
                        const wMm = Math.min(sPageWidth - xMm, rect.widthPx * sMmPerPx);
                        const hMm = Math.min(sPageHeight - yMm, (clippedBot - clippedTop) * sMmPerPx);
                        if (wMm < 0.5 || hMm < 0.5) continue;

                        if (!pageSelected) {
                            doc.setPage(slice.pdfPageNum);
                            pageSelected = true;
                        }
                        try {
                            doc.link(xMm, yMm, wMm, hMm, { ...linkOptions });
                        } catch {
                            // Ignore malformed URL/annotation safely
                        }
                    }
                }
            }
        }
    }

    public invalidateExportPdfCache(): void {
        this.cachedExportPdf = null;
    }

    /**
     * Triggers an optional callback when the user leaves a horizontal checkbox box
     * (via mouseleave, focusout, or tapping outside on mobile) ONLY if a checkbox inside changed.
     */
    private attachCheckboxBoxLeaveHook(
        box: HTMLElement,
        isDirty: () => boolean,
        clearDirty: () => void,
        onBoxLeave?: () => void
    ): (() => void) | null {
        if (!onBoxLeave) return null;
        const flushIfDirty = () => {
            if (!isDirty()) return;
            clearDirty();
            onBoxLeave();
        };
        box.addEventListener('mouseleave', flushIfDirty);
        box.addEventListener('focusout', (ev: FocusEvent) => {
            const nextTarget = ev.relatedTarget as Node | null;
            if (!nextTarget || !box.contains(nextTarget)) {
                flushIfDirty();
            }
        });
        const onDocPointerDown = (ev: PointerEvent) => {
            if (!isDirty()) return;
            const target = ev.target as Node | null;
            if (!target || !box.contains(target)) {
                flushIfDirty();
            }
        };
        activeDocument.addEventListener('pointerdown', onDocPointerDown, true);
        return () => {
            activeDocument.removeEventListener('pointerdown', onDocPointerDown, true);
        };
    }

    /**
     * Renders the horizontal checkbox box choosing between Document Outline (PDF structure)
     * and clickable Index on Page 1.
     */
    public renderTocModeControl(
        container: HTMLElement,
        onModeChanged: () => Promise<void> | void,
        onBoxLeave?: () => void,
        targetSettings?: PdfPluginSettings,
        persist: boolean = true
    ): (() => void) | null {
        const activeSettings = targetSettings ?? this.globalSettings;
        const setting = new Setting(container)
            .setName("Table of contents & bookmarks")
            .setDesc("Include headings in the PDF document structure and/or as a clickable index on page 1");
        setting.settingEl.addClass('pdf-bookmark-levels-setting');

        const box = setting.controlEl.createDiv({ cls: 'pdf-bookmark-levels-box pdf-toc-mode-box' });
        let dirty = false;

        const addOption = (labelText: string, checked: boolean, onToggle: (val: boolean) => void) => {
            const label = box.createEl('label', { cls: 'pdf-bookmark-level-item' });
            const cb = label.createEl('input', { type: 'checkbox' });
            cb.checked = checked;
            label.createSpan({ text: labelText });
            cb.addEventListener('change', () => {
                void (async () => {
                    onToggle(cb.checked);
                    dirty = true;
                    this.invalidateExportPdfCache();
                    if (persist) {
                        await this.saveSettings();
                    }
                    await onModeChanged();
                })();
            });
        };

        addOption('Document outline', activeSettings.includeBookmarks, (val) => {
            if (activeSettings === this.sidebarSettings) {
                this.updateSidebarSetting('includeBookmarks', val);
            } else {
                activeSettings.includeBookmarks = val;
            }
        });
        addOption('Index on page 1', activeSettings.includeTocPage, (val) => {
            if (activeSettings === this.sidebarSettings) {
                this.updateSidebarSetting('includeTocPage', val);
            } else {
                activeSettings.includeTocPage = val;
            }
        });

        return this.attachCheckboxBoxLeaveHook(box, () => dirty, () => { dirty = false; }, onBoxLeave);
    }

    /**
     * Renders the horizontal H1-H6 checkbox box used in both the PDF Sidebar and Plugin Settings Tab.
     */
    public renderBookmarkHeadingLevelsControl(
        container: HTMLElement,
        onLevelsChanged: () => Promise<void> | void,
        onBoxLeave?: () => void,
        targetSettings?: PdfPluginSettings,
        persist: boolean = true
    ): (() => void) | null {
        const activeSettings = targetSettings ?? this.globalSettings;
        const setting = new Setting(container)
            .setName("Heading levels (1–6)")
            .setDesc("Choose which heading levels appear in the PDF outline and page 1 index");
        setting.settingEl.addClass('pdf-bookmark-levels-setting');

        const box = setting.controlEl.createDiv({ cls: 'pdf-bookmark-levels-box' });
        let dirty = false;

        for (let level = 1; level <= 6; level++) {
            const label = box.createEl('label', { cls: 'pdf-bookmark-level-item' });
            const cb = label.createEl('input', { type: 'checkbox' });
            cb.checked = activeSettings.bookmarkHeadingLevels.includes(level);
            label.createSpan({ text: `H${level}` });

            cb.addEventListener('change', () => {
                void (async () => {
                    const current = new Set<number>(activeSettings.bookmarkHeadingLevels);
                    if (cb.checked) {
                        current.add(level);
                    } else {
                        current.delete(level);
                    }
                    const nextLevels = Array.from(current).sort((a, b) => a - b);
                    if (activeSettings === this.sidebarSettings) {
                        this.updateSidebarSetting('bookmarkHeadingLevels', nextLevels);
                    } else {
                        activeSettings.bookmarkHeadingLevels = nextLevels;
                    }
                    dirty = true;
                    this.invalidateExportPdfCache();
                    if (persist) {
                        await this.saveSettings();
                    }
                    await onLevelsChanged();
                })();
            });
        }

        return this.attachCheckboxBoxLeaveHook(box, () => dirty, () => { dirty = false; }, onBoxLeave);
    }

    private assemblePdfFromCachedPages(
        doc: jsPDF,
        file: TFile,
        cache: PreviewRenderCache,
        activeJsPdfFont: string,
        isCustomUnicodeFont: boolean,
        showLineNumbers: boolean,
        margin: number,
        topMargin: number,
        pageWidth: number,
        pageHeight: number,
        contentWidthMm: number,
        contentWidthPx: number,
        maxPageContentPx: number,
        mmPerPx: number,
        now: moment.Moment,
        shouldCancel?: () => boolean
    ): { buffer: ArrayBuffer; cleanBuffer: ArrayBuffer } | null {
        const { bgColor, textColor, bgHex, footerFontFamily, captureScale, pages } = cache;
        const baseLayout = this.getPdfPageLayout();
        const landscapeLayout = this.getPdfPageLayout('landscape');
        const deferredLineNumbers: Array<{ pdfPageNum: number; markerOffsets: Array<{ line: number; offsetTopPx: number }>; singleSlice: boolean; mmPerPx?: number }> = [];
        const emittedSlicesMeta: EmittedPdfSliceMeta[] = [];

        if (pages.length === 0) {
            doc.setFillColor(bgColor[0], bgColor[1], bgColor[2]);
            doc.rect(0, 0, pageWidth, pageHeight, 'F');
        } else {
            let emitted = 0;
            for (let pageIdx = 0; pageIdx < pages.length; pageIdx++) {
                if (shouldCancel?.()) return null;
                const cachedPage = pages[pageIdx];
                const pageLayout = cachedPage.contentScaleOverride !== undefined
                    ? this.getPdfPageLayout(cachedPage.isLandscape ? 'landscape' : undefined, cachedPage.contentScaleOverride)
                    : (cachedPage.isLandscape ? landscapeLayout : baseLayout);
                for (let sIdx = 0; sIdx < cachedPage.slices.length; sIdx++) {
                    this.ensurePdfPageOrientation(doc, emitted, pageLayout);
                    emitted++;
                    doc.setFillColor(bgColor[0], bgColor[1], bgColor[2]);
                    doc.rect(0, 0, pageLayout.pageWidth, pageLayout.pageHeight, 'F');
                    const slice = cachedPage.slices[sIdx];
                    const sliceTop = slice.sliceTopCssPx ?? 0;
                    const sliceBottom = slice.sliceBottomCssPx ?? Infinity;
                    const sliceX = slice.xMm ?? pageLayout.margin;
                    const sliceW = slice.widthMm ?? pageLayout.contentWidthMm;
                    const sliceMmPerPx = slice.mmPerPx ?? pageLayout.mmPerPx;
                    doc.addImage(slice.imgData, slice.format, sliceX, pageLayout.topMargin, sliceW, slice.heightMm, undefined, 'FAST');
                    this.drawInvisibleTextLayer(
                        doc,
                        cachedPage.textSpans,
                        activeJsPdfFont,
                        isCustomUnicodeFont,
                        sliceX,
                        pageLayout.topMargin,
                        pageLayout.pageWidth,
                        pageLayout.pageHeight,
                        sliceMmPerPx,
                        sliceTop,
                        sliceBottom
                    );
                    emittedSlicesMeta.push({
                        pdfPageNum: emitted,
                        sliceTopCssPx: sliceTop,
                        sliceBottomCssPx: sliceBottom,
                        pageWidthMm: pageLayout.pageWidth,
                        pageHeightMm: pageLayout.pageHeight,
                        mmPerPx: sliceMmPerPx,
                        headings: cachedPage.headings || [],
                        anchors: cachedPage.anchors || [],
                        links: cachedPage.links || []
                    });
                    if (showLineNumbers && sIdx === 0 && cachedPage.markerOffsets.length > 0) {
                        deferredLineNumbers.push({
                            pdfPageNum: emitted,
                            markerOffsets: cachedPage.markerOffsets,
                            singleSlice: cachedPage.slices.length > 1,
                            mmPerPx: pageLayout.mmPerPx
                        });
                    }
                }
            }
        }

        this.prependTocPagesToDoc(
            doc,
            emittedSlicesMeta,
            deferredLineNumbers,
            activeJsPdfFont,
            isCustomUnicodeFont,
            margin,
            topMargin,
            pageWidth,
            pageHeight,
            contentWidthMm,
            contentWidthPx,
            maxPageContentPx,
            mmPerPx,
            captureScale,
            bgColor,
            textColor,
            bgHex,
            footerFontFamily,
            false,
            baseLayout.format,
            baseLayout.orientation
        );

        this.applyPdfLinksAndOutline(doc, emittedSlicesMeta, margin, topMargin, pageWidth, pageHeight, mmPerPx);

        const bottomMargin = this.settings.showFootnote ? Math.max(margin, 12) + 3 : margin;
        const ok = this.appendFootnotesToDoc(
            doc,
            file,
            activeJsPdfFont,
            margin,
            pageHeight,
            bottomMargin,
            contentWidthMm,
            contentWidthPx,
            mmPerPx,
            captureScale,
            bgHex,
            textColor,
            footerFontFamily,
            now,
            shouldCancel
        );
        if (!ok) return null;

        // Snapshot clean export-ready PDF (no preview line numbers) BEFORE drawing preview-only line numbers
        const cleanBuffer = doc.output("arraybuffer");
        if (!showLineNumbers || deferredLineNumbers.length === 0) {
            return { buffer: cleanBuffer, cleanBuffer };
        }

        const lineNumX = Math.max(1.5, Math.min(5, margin * 0.3));
        for (const item of deferredLineNumbers) {
            doc.setPage(item.pdfPageNum);
            doc.saveGraphicsState();
            doc.setFont(activeJsPdfFont, 'normal');
            doc.setFontSize(8);
            doc.setTextColor(120, 120, 120);
            const itemMmPerPx = item.mmPerPx ?? mmPerPx;
            if (item.singleSlice) {
                doc.text(`${item.markerOffsets[0].line}`, lineNumX, topMargin + 3.5);
            } else {
                let lastY = -10;
                for (const m of item.markerOffsets) {
                    const targetY = topMargin + m.offsetTopPx * itemMmPerPx + 3.5;
                    if (targetY - lastY >= 2.4) {
                        doc.text(`${m.line}`, lineNumX, targetY);
                        lastY = targetY;
                    }
                }
            }
            doc.restoreGraphicsState();
        }

        return { buffer: doc.output("arraybuffer"), cleanBuffer };
    }

    async generatePdfData(
        file: TFile,
        showLineNumbers: boolean = false,
        options?: {
            isPreview?: boolean;
            shouldCancel?: () => boolean;
            ignorePageBreaks?: boolean;
            suppressFontNotice?: boolean;
            allowExportCacheReuse?: boolean;
            onProgress?: (current: number, total: number) => void;
            appendTarget?: MergedAppendTarget;
        }
    ): Promise<ArrayBuffer | null> {
        const appendTarget = options?.appendTarget;
        const isPreview = !appendTarget && !!options?.isPreview;
        const shouldCancel = options?.shouldCancel;
        const ignorePageBreaks = !!appendTarget || !!options?.ignorePageBreaks;
        const suppressFontNotice = !!appendTarget || !!options?.suppressFontNotice;
        const allowExportCacheReuse = !appendTarget && options?.allowExportCacheReuse !== false && !ignorePageBreaks;
        const onProgress = options?.onProgress;
        if (shouldCancel?.()) return null;

        const { content: rawContent, isUnsavedFromDisk } = await this.getLiveFileContent(file);
        if (shouldCancel?.()) return null;
        const { markdown: contentWithoutYaml, frontmatterLineCount } = this.stripYamlFrontmatter(rawContent);

        const perf = this.getDevicePerfProfile();
        // Unified export-grade scale & lossless PNG so clicking Generate after Preview is instant
        // with identical visual fidelity (no re-rendering from scratch).
        const captureScale = Platform.isMobile ? 1.75 : 2;
        const imgMime = 'image/png';
        const imgFormat: 'JPEG' | 'PNG' = 'PNG';
        const imgQuality: number | undefined = undefined;

        // Resolve theme early so cache keys can be checked before creating any DOM or jsPDF.
        // When part of a merged PDF export, reuse the locked theme captured at merge start.
        let themeClass: 'theme-light' | 'theme-dark' = 'theme-light';
        if (appendTarget?.lockedTheme) {
            themeClass = appendTarget.lockedTheme.themeClass;
        } else if (this.settings.pdfTheme === 'dark') {
            themeClass = 'theme-dark';
        } else if (this.settings.pdfTheme === 'css') {
            themeClass = activeDocument.body.classList.contains('theme-dark') ? 'theme-dark' : 'theme-light';
        }

        const inlineBreakLines = this.extractInlinePageBreakLines(rawContent, frontmatterLineCount);
        const sidebarBreakLines = ignorePageBreaks
            ? []
            : this.settings.pageBreaks
                .split(',')
                .map(s => parseInt(s.trim(), 10))
                .filter(n => !isNaN(n));
        const breakLines = Array.from(new Set([...inlineBreakLines, ...sidebarBreakLines])).sort((a, b) => a - b);

        const layout = appendTarget ? appendTarget.layout : this.getPdfPageLayout();
        const autoLandscapeEnabled = layout.orientation === 'p' && this.settings.autoLandscapeWidePages;
        const landscapeLayout = autoLandscapeEnabled ? this.getPdfPageLayout('landscape') : layout;

        const contentHash = this.computeFastHash(rawContent);
        const cacheDocKey = JSON.stringify([
            file.path,
            rawContent.length,
            contentHash,
            themeClass,
            layout.format,
            layout.orientation,
            autoLandscapeEnabled,
            layout.margin,
            layout.contentScale,
            this.settings.fontFamily,
            this.settings.customFontPath,
            this.settings.showTitle,
            this.settings.showFrontmatter,
            this.settings.showHeader,
            this.settings.headerTemplate,
            this.settings.headerDateFormat,
            this.settings.headerTimeFormat,
            this.settings.showFootnote,
            this.settings.footnoteTemplate,
            this.settings.footnoteDateFormat,
            this.settings.footnoteTimeFormat,
            this.settings.optimizeImages,
            this.settings.enableClickableLinks,
            captureScale
        ]);

        const levelsKey = this.settings.bookmarkHeadingLevels.join(',');
        const bookmarkKey = `${this.settings.includeBookmarks ? '1' : '0'}:${this.settings.includeTocPage ? '1' : '0'}:${levelsKey}`;
        const buildExportBufferKey = (tsMoment: moment.Moment) =>
            `${cacheDocKey}|breaks:${breakLines.join(',')}|bm:${bookmarkKey}|ts:${this.getFootnoteTimeStampKey(tsMoment)}`;

        const now = moment();
        const exportBufferKey = buildExportBufferKey(now);

        // Fast Path 1: Instant ready-to-save PDF ArrayBuffer reuse when clicking Generate after Preview
        // Works EVEN when Show Line Numbers (Preview) was enabled during preview!
        if (!appendTarget && !isPreview && !showLineNumbers && allowExportCacheReuse && this.cachedExportPdf && this.cachedExportPdf.key === exportBufferKey) {
            return this.cachedExportPdf.buffer.slice(0);
        }

        const doc = appendTarget
            ? appendTarget.doc
            : new jsPDF({ orientation: layout.orientation, unit: 'mm', format: layout.format, compress: true });
        const pageHeight = layout.pageHeight;
        const pageWidth = layout.pageWidth;
        const margin = layout.margin;
        const topMargin = layout.topMargin;
        const bottomMargin = layout.bottomMargin;
        const contentWidthMm = layout.contentWidthMm;
        const contentWidthPx = layout.contentWidthPx;
        const mmPerPx = layout.mmPerPx;
        const maxPageContentPx = layout.maxPageContentPx;

        const activeJsPdfFont = this.settings.fontFamily === 'custom' ? 'custom-font' : 'helvetica';

        // Load & cache custom font once (shared between jsPDF footnotes/line numbers and DOM @font-face CSS)
        let cachedFont: { fontFile: TFile; fontName: string; base64: string } | null = null;
        let isCustomUnicodeFont = false;
        let effectiveTextLayerFont = 'helvetica';
        if (appendTarget) {
            cachedFont = appendTarget.cachedFont;
            isCustomUnicodeFont = appendTarget.isCustomUnicodeFont;
            effectiveTextLayerFont = appendTarget.effectiveTextLayerFont;
        } else {
            if (this.settings.fontFamily === 'custom' && this.settings.customFontPath && this.settings.customFontPath.trim() !== '') {
                try {
                    cachedFont = await this.getCachedCustomFont();
                    if (cachedFont) {
                        doc.addFileToVFS(cachedFont.fontName, cachedFont.base64);
                        doc.addFont(cachedFont.fontName, activeJsPdfFont, 'normal', 'Identity-H');
                        doc.addFont(cachedFont.fontName, activeJsPdfFont, 'bold', 'Identity-H');
                        doc.addFont(cachedFont.fontName, activeJsPdfFont, 'italic', 'Identity-H');
                        doc.addFont(cachedFont.fontName, activeJsPdfFont, 'bolditalic', 'Identity-H');
                    } else if (!isPreview && !suppressFontNotice) {
                        new Notice("Custom font file not found at: " + this.settings.customFontPath);
                    }
                } catch (e) {
                    console.error("Error loading custom font:", e);
                    if (!isPreview && !suppressFontNotice) {
                        new Notice("Error loading custom font: " + e);
                    }
                }
            }
            isCustomUnicodeFont = !!cachedFont;
            effectiveTextLayerFont = isCustomUnicodeFont ? activeJsPdfFont : 'helvetica';
        }

        // Fast Path 2: Exact cached page-slice reuse (skips Reading Mode, pagination & capture completely!)
        // Triggers on: toggling Show Line Numbers in Preview, or when a {time} footnote ticked forward.
        if (
            !appendTarget &&
            allowExportCacheReuse &&
            this.previewRenderCache &&
            this.previewRenderCache.docKey === cacheDocKey &&
            this.previewRenderCache.breakLines.length === breakLines.length &&
            this.previewRenderCache.breakLines.every((b, idx) => b === breakLines[idx])
        ) {
            const footNow = moment();
            const assembled = this.assemblePdfFromCachedPages(
                doc,
                file,
                this.previewRenderCache,
                effectiveTextLayerFont,
                isCustomUnicodeFont,
                showLineNumbers,
                margin,
                topMargin,
                pageWidth,
                pageHeight,
                contentWidthMm,
                contentWidthPx,
                maxPageContentPx,
                mmPerPx,
                footNow,
                shouldCancel
            );
            if (!assembled) return null;
            this.cachedExportPdf = { key: buildExportBufferKey(footNow), buffer: assembled.cleanBuffer };
            if (isPreview) {
                this.lastReusedPreviewPages = this.previewRenderCache.pages.reduce((acc, p) => acc + p.slices.length, 0);
            }
            return assembled.buffer;
        }

        const { css: fontCss, cssFontFamily } = this.buildFontCssFromCached('ObsidianPdfCustomFont', cachedFont);
        await this.ensureCustomFontLoadedInDocument('ObsidianPdfCustomFont', cachedFont);

        // Extract frontmatter cssclasses/cssclass so note-level theme & snippet classes apply
        const fm = this.app.metadataCache.getFileCache(file)?.frontmatter;
        const rawCssClasses: unknown = fm?.cssclasses ?? fm?.cssclass;
        const noteCssClasses: string[] = Array.isArray(rawCssClasses)
            ? rawCssClasses
                .map((c: unknown) => (typeof c === 'string' || typeof c === 'number' ? String(c).trim() : ''))
                .filter(Boolean)
            : (typeof rawCssClasses === 'string'
                ? rawCssClasses.split(/[\s,]+/).map(c => c.trim()).filter(Boolean)
                : []);
        const previewViewCls = [
            'markdown-preview-view',
            'markdown-rendered',
            'node-insert-event',
            'show-indentation-guide',
            ...noteCssClasses
        ].join(' ');

        const createObsidianReadingHierarchy = (parent: HTMLElement) => {
            const leafEl = parent.createDiv({ cls: 'workspace-leaf' });
            const leafContentEl = leafEl.createDiv({ cls: 'workspace-leaf-content' });
            leafContentEl.setAttribute('data-type', 'markdown');
            leafContentEl.setAttribute('data-mode', 'preview');
            const viewContentEl = leafContentEl.createDiv({ cls: 'view-content' });
            const readingEl = viewContentEl.createDiv({ cls: 'markdown-reading-view' });
            const previewEl = readingEl.createDiv({ cls: previewViewCls });
            const sectionSizerEl = previewEl.createDiv({ cls: 'markdown-preview-sizer markdown-preview-section' });

            // Enforce layout & visibility inline so Obsidian mobile/theme rules cannot collapse
            // .workspace-leaf / .markdown-preview-view or hide text nodes during DOM measurement.
            const wrappers = [leafEl, leafContentEl, viewContentEl, readingEl, previewEl, sectionSizerEl];
            for (let i = 0; i < wrappers.length; i++) {
                const w = wrappers[i];
                w.style.setProperty('width', '100%', 'important');
                w.style.setProperty('max-width', '100%', 'important');
                w.style.setProperty('min-height', '0', 'important');
                w.style.setProperty('height', 'auto', 'important');
                w.style.setProperty('overflow', 'visible', 'important');
                w.style.setProperty('visibility', 'visible', 'important');
                w.style.setProperty('content-visibility', 'visible', 'important');
            }
            leafEl.style.setProperty('display', 'block', 'important');
            leafEl.style.setProperty('position', 'relative', 'important');
            leafEl.style.setProperty('contain', 'none', 'important');
            sectionSizerEl.style.setProperty('display', 'flow-root', 'important');

            return { leafEl, leafContentEl, readingEl, previewEl, sectionSizerEl };
        };

        // Snapshot & lock the active Obsidian theme variables once before rendering starts so
        // an OS/Obsidian theme flip mid-note or mid-merged-export can never alter text/background colors.
        const lockedTheme = appendTarget?.lockedTheme ?? this.captureExportThemeSnapshot(
            cssFontFamily,
            contentWidthPx,
            autoLandscapeEnabled ? landscapeLayout.contentWidthPx : undefined
        );

        // Create hidden Obsidian Reading View container inside viewport bounds (opacity: 0)
        // so IntersectionObserver, isShown(), and virtualized Reading Mode plugins execute natively.
        const renderRoot = activeDocument.body.createDiv({
            cls: `${lockedTheme.themeClass} pdf-export-root pdf-export-hidden-root`
        });
        this.applyExportRootStyles(
            renderRoot,
            lockedTheme.isDark,
            cssFontFamily,
            contentWidthPx,
            autoLandscapeEnabled ? landscapeLayout.contentWidthPx : undefined,
            lockedTheme
        );

        if (this.sessionColorCache.size > 600) this.sessionColorCache.clear();
        if (this.sessionFontCache.size > 200) this.sessionFontCache.clear();
        const colorCache = this.sessionColorCache;
        const fontCache = this.sessionFontCache;

        // Clean Obsidian's root CSS font variables once so descendants inherit valid font stacks
        this.sanitizeRootFontVariables(renderRoot, fontCache);

        const { readingEl, previewEl: previewViewEl, sectionSizerEl: sizerEl } = createObsidianReadingHierarchy(renderRoot);

        const renderComponent = new Component();
        renderComponent.load();
        const imageCanvasesById = new Map<string, HTMLCanvasElement>();
        let cleanupRealView: (() => void) | null = null;

        try {
            // Use the locked background, text color, and resolved footer font from the export theme snapshot
            const bgColor = lockedTheme.bgColor;
            const textColor = lockedTheme.textColor;
            const bgHex = lockedTheme.bgHex;
            const footerFontFamily = lockedTheme.footerFontFamily;

            let earliestChangedBreakLine = -1;
            if (isPreview && this.previewRenderCache && this.previewRenderCache.docKey === cacheDocKey) {
                const prevBreaks = this.previewRenderCache.breakLines;
                const maxLen = Math.max(prevBreaks.length, breakLines.length);
                earliestChangedBreakLine = Infinity;
                for (let idx = 0; idx < maxLen; idx++) {
                    if (prevBreaks[idx] !== breakLines[idx]) {
                        earliestChangedBreakLine = Math.min(
                            prevBreaks[idx] ?? Infinity,
                            breakLines[idx] ?? Infinity
                        );
                        break;
                    }
                }
            }

            const allRawBlocks: BlockItem[] = [];

            // Render optional title inside Obsidian Reading View's exact .mod-header > .inline-title hierarchy
            if (this.settings.showTitle) {
                const headerWrapper = sizerEl.createDiv({ cls: 'mod-header' });
                headerWrapper.createDiv({
                    cls: 'inline-title pdf-export-title',
                    text: file.basename || 'Untitled'
                });
                allRawBlocks.push({ el: headerWrapper, startLine: 1, endLine: 1, isTitle: true });
            }

            // Render optional YAML Frontmatter (Properties) neatly at the top of Page 1
            if (this.settings.showFrontmatter && frontmatterLineCount > 0) {
                const fmCard = this.buildFrontmatterElement(rawContent, sizerEl);
                if (fmCard) {
                    allRawBlocks.push({ el: fmCard, startLine: 1, endLine: Math.max(1, frontmatterLineCount), isTitle: true });
                }
            }

            // Tier 1 (Primary): render via a genuine MarkdownView in Reading Mode on an isolated WorkspaceLeaf
            const hasBody = contentWithoutYaml.trim().length > 0;
            let readingResult: { sizerEl: HTMLElement; blocks: BlockItem[] } | null = null;

            const realViewResult = await this.renderWithRealMarkdownView(
                file,
                rawContent,
                isUnsavedFromDisk,
                renderRoot,
                noteCssClasses,
                frontmatterLineCount,
                hasBody,
                renderComponent,
                shouldCancel
            );
            if (shouldCancel?.()) {
                realViewResult?.cleanup();
                return null;
            }
            if (realViewResult) {
                cleanupRealView = realViewResult.cleanup;
                readingResult = { sizerEl: realViewResult.sizerEl, blocks: realViewResult.blocks };
            }

            // Tier 2 (Fallback 1): Obsidian's embedRegistry Reading Mode renderer
            if (!readingResult) {
                readingResult = await this.renderWithObsidianEmbedView(
                    file,
                    rawContent,
                    isUnsavedFromDisk,
                    readingEl,
                    noteCssClasses,
                    frontmatterLineCount,
                    hasBody,
                    renderComponent,
                    shouldCancel
                );
                if (shouldCancel?.()) return null;
            }

            let hasAsyncWidgets = false;
            const landscapeMaxW = autoLandscapeEnabled ? landscapeLayout.contentWidthPx : undefined;
            if (readingResult) {
                hasAsyncWidgets = !!readingResult.sizerEl.querySelector(PdfPlugin.ASYNC_WIDGET_SELECTOR);
                await this.prepareImagesAndCaptions(readingResult.sizerEl, file.path, contentWidthPx, imageCanvasesById, perf.imageConcurrency, landscapeMaxW);
                if (shouldCancel?.()) return null;
                const blocksWithBreaks = this.applyPageBreaksToBlocks(readingResult.blocks, breakLines);
                allRawBlocks.push(...blocksWithBreaks);
            } else {
                // Tier 3 (Fallback 2): segment-based MarkdownRenderer.render
                const segments = this.splitMarkdownByPageBreaks(contentWithoutYaml, frontmatterLineCount, breakLines);
                for (const segment of segments) {
                    if (shouldCancel?.()) return null;
                    const segSizer = previewViewEl.createDiv({ cls: 'markdown-preview-sizer markdown-preview-section' });
                    await MarkdownRenderer.render(this.app, segment.markdown, segSizer, file.path, renderComponent);
                    await this.waitForAsyncRenderers(segSizer);
                    if (segSizer.querySelector(PdfPlugin.ASYNC_WIDGET_SELECTOR)) hasAsyncWidgets = true;
                    await this.prepareImagesAndCaptions(segSizer, file.path, contentWidthPx, imageCanvasesById, perf.imageConcurrency, landscapeMaxW);
                    const segBlocks = this.buildBlockItems(segSizer, file, segment);
                    allRawBlocks.push(...segBlocks);
                }
            }

            if (shouldCancel?.()) return null;

            // Stamp Obsidian ^blockId anchors onto exact DOM targets before pagination/splitting
            this.annotateBlockIdsOnBlocks(allRawBlocks, file, rawContent);

            // Deduplicate a manual <hr> immediately preceding a Markdown footnotes section that already renders its own <hr>
            const isStandaloneHrBlock = (el: HTMLElement): boolean =>
                el.tagName === 'HR' ||
                el.classList.contains('el-hr') ||
                (el.children.length === 1 && el.children[0].tagName === 'HR' && (el.textContent || '').trim() === '');
            for (let i = allRawBlocks.length - 2; i >= 0; i--) {
                const cur = allRawBlocks[i];
                const nxt = allRawBlocks[i + 1];
                if (!cur.isTitle && !nxt.forceBreakBefore && isStandaloneHrBlock(cur.el)) {
                    const isFootnotesNext = nxt.el.classList.contains('footnotes') || !!nxt.el.querySelector('section.footnotes, .footnotes');
                    if (isFootnotesNext && !!nxt.el.querySelector('hr')) {
                        cur.el.remove();
                        allRawBlocks.splice(i, 1);
                    }
                }
            }

            // Detect wide blocks against true Portrait width before moving them into pagination measureSizer
            if (autoLandscapeEnabled) {
                for (let i = 0; i < allRawBlocks.length; i++) {
                    const item = allRawBlocks[i];
                    if (!item.isTitle && this.isWideBlockForPortrait(item.el, contentWidthPx)) {
                        item.isWide = true;
                    }
                }
            }

            // Pre-measure approximate block heights in a single read-only pass (zero extra reflows)
            // so pagination only forces a live scrollHeight check near page boundaries.
            const blockEstHeights = new WeakMap<HTMLElement, number>();
            for (let i = 0; i < allRawBlocks.length; i++) {
                const el = allRawBlocks[i].el;
                const h = el.getBoundingClientRect().height;
                if (h > 0) blockEstHeights.set(el, h);
            }

            // Helpers to resolve & apply per-page orientation and optional auto scale-down
            const resolvePageLayout = (isLandscape?: boolean, contentScaleOverride?: number): PdfPageLayout => {
                if (contentScaleOverride !== undefined) {
                    return this.getPdfPageLayout(isLandscape ? 'landscape' : undefined, contentScaleOverride);
                }
                return isLandscape ? landscapeLayout : layout;
            };
            const setRootLayout = (targetLayout: PdfPageLayout) => {
                const isL = targetLayout.orientation === 'l';
                if (autoLandscapeEnabled) {
                    renderRoot.classList.toggle('pdf-root-landscape', isL);
                }
                renderRoot.setCssProps({ '--pdf-content-width': `${targetLayout.contentWidthPx}px` });
                renderRoot.style.width = `${targetLayout.contentWidthPx}px`;
            };

            // Group blocks into pages using a live measureSizer identical to pageSizer
            const pages: PageChunk[] = [];
            let currentPageIsLandscape = false;
            let currentPageScaleOverride: number | undefined = undefined;
            let currentPage: PageChunk = { elements: [], lineMarkers: [], startLine: Infinity, endLine: 0 };
            let currentPageItems: BlockItem[] = [];
            let runningEstH = 0;

            const { leafEl: measureWrapper, sectionSizerEl: measureSizer } = createObsidianReadingHierarchy(renderRoot);

            const activePageLayout = (): PdfPageLayout => resolvePageLayout(currentPageIsLandscape, currentPageScaleOverride);
            const activeMaxPageContentPx = () => activePageLayout().maxPageContentPx;

            const finalizeCurrentPage = (nextLandscape: boolean = false) => {
                if (currentPage.elements.length > 0) {
                    const hasVisiblePageContent = currentPage.elements.some(el => this.hasVisibleContent(el));
                    if (hasVisiblePageContent) {
                        if (currentPageIsLandscape) {
                            currentPage.isLandscape = true;
                        }
                        if (currentPageScaleOverride !== undefined) {
                            currentPage.contentScaleOverride = currentPageScaleOverride;
                        }
                        pages.push(currentPage);
                    }
                    currentPage = { elements: [], lineMarkers: [], startLine: Infinity, endLine: 0 };
                    currentPageItems = [];
                }
                runningEstH = 0;
                currentPageScaleOverride = undefined;
                while (measureSizer.firstChild) {
                    measureSizer.removeChild(measureSizer.firstChild);
                }
                const targetLandscape = autoLandscapeEnabled && nextLandscape;
                currentPageIsLandscape = targetLandscape;
                setRootLayout(activePageLayout());
                currentPage.isLandscape = currentPageIsLandscape || undefined;
            };

            const pushToCurrentPage = (item: BlockItem) => {
                currentPage.elements.push(item.el);
                currentPageItems.push(item);
                currentPage.startLine = Math.min(currentPage.startLine, item.startLine);
                currentPage.endLine = Math.max(currentPage.endLine, item.endLine);
                if (!item.isTitle) {
                    currentPage.lineMarkers.push({ line: item.startLine, el: item.el });
                }
            };

            const popLastFromCurrentPage = (): BlockItem | undefined => {
                const popped = currentPageItems.pop();
                if (!popped) return undefined;
                currentPage.elements.pop();
                if (!popped.isTitle && currentPage.lineMarkers.length > 0 && currentPage.lineMarkers[currentPage.lineMarkers.length - 1].el === popped.el) {
                    currentPage.lineMarkers.pop();
                }
                currentPage.startLine = Infinity;
                currentPage.endLine = 0;
                for (let k = 0; k < currentPageItems.length; k++) {
                    currentPage.startLine = Math.min(currentPage.startLine, currentPageItems[k].startLine);
                    currentPage.endLine = Math.max(currentPage.endLine, currentPageItems[k].endLine);
                }
                return popped;
            };

            const isShortIntroParagraph = (item: BlockItem): boolean => {
                if (item.isTitle || item.isWide) return false;
                const tag = item.el.tagName;
                const isPara = tag === 'P' || item.el.classList.contains('el-p');
                if (!isPara) return false;
                if (item.el.querySelector('table, svg, canvas, img, .pdf-image-slot, mjx-container[display="true"], pre')) return false;
                const h = item.el.getBoundingClientRect().height || blockEstHeights.get(item.el) || 0;
                return h > 0 && h <= 140;
            };

            // Pops 1–2 trailing headings (and optionally 1 short intro paragraph immediately below a heading)
            // so section headings stay attached to wide tables, diagrams, and multi-page tables.
            // Never empties the current page so pagination is guaranteed to make forward progress.
            const popTrailingHeadingGroup = (includeIntroPara: boolean): BlockItem[] => {
                let count = 0;
                let idx = currentPageItems.length - 1;
                if (includeIntroPara && idx >= 1 && isShortIntroParagraph(currentPageItems[idx])) {
                    if (!currentPageItems[idx - 1].isTitle && this.isHeadingBlock(currentPageItems[idx - 1].el)) {
                        count++;
                        idx--;
                    }
                }
                let headingCount = 0;
                while (
                    headingCount < 2 &&
                    idx >= 0 &&
                    !currentPageItems[idx].isTitle &&
                    this.isHeadingBlock(currentPageItems[idx].el)
                ) {
                    headingCount++;
                    count++;
                    idx--;
                }
                if (headingCount === 0 || count >= currentPageItems.length) return [];
                const carried: BlockItem[] = [];
                for (let k = 0; k < count; k++) {
                    const popped = popLastFromCurrentPage();
                    if (!popped) break;
                    popped.el.remove();
                    carried.unshift(popped);
                }
                return carried;
            };

            // O(1) cursor + pushback stack instead of O(N^2) Array.shift()
            let rawIdx = 0;
            const pushbackStack: BlockItem[] = [];
            const nextBlock = (): BlockItem | undefined => {
                if (pushbackStack.length > 0) return pushbackStack.pop();
                if (rawIdx < allRawBlocks.length) return allRawBlocks[rawIdx++];
                return undefined;
            };

            const verifyCurrentPageBeforeBreak = () => {
                if (currentPage.allowMultiPageSlice || currentPage.elements.length <= 1) return;
                const pageMaxPx = activeMaxPageContentPx();
                while (currentPage.elements.length > 1 && measureSizer.scrollHeight > pageMaxPx) {
                    const popped = popLastFromCurrentPage();
                    if (!popped) break;
                    popped.el.remove();
                    pushbackStack.push(popped);
                }
            };

            let block: BlockItem | undefined;
            while ((block = nextBlock()) !== undefined) {
                if (block.forceBreakBefore && currentPage.elements.length > 0) {
                    if (currentPage.elements.length > 1 && measureSizer.scrollHeight > activeMaxPageContentPx()) {
                        // Push the forced-break block onto pushbackStack FIRST so any overflowing blocks
                        // unwound by verifyCurrentPageBeforeBreak() stay strictly BEFORE it in reading order.
                        pushbackStack.push(block);
                        verifyCurrentPageBeforeBreak();
                        finalizeCurrentPage(false);
                        continue;
                    }
                    finalizeCurrentPage(false);
                    currentPage.startsWithForcedBreak = true;
                }

                if (autoLandscapeEnabled) {
                    const wantLandscape = !!block.isWide;

                    if (wantLandscape && !currentPageIsLandscape) {
                        if (currentPage.elements.length === 0) {
                            currentPageIsLandscape = true;
                            currentPage.isLandscape = true;
                            setRootLayout(activePageLayout());
                            runningEstH = 0;
                        } else if (
                            currentPageItems.every(it => !it.isTitle && (this.isHeadingBlock(it.el) || isShortIntroParagraph(it))) &&
                            currentPageItems.some(it => this.isHeadingBlock(it.el))
                        ) {
                            currentPageIsLandscape = true;
                            currentPage.isLandscape = true;
                            setRootLayout(activePageLayout());
                            runningEstH = measureSizer.scrollHeight;
                        } else {
                            // Try promoting the current page to Landscape IN PLACE when existing blocks
                            // (e.g. Page 1 Title + Callout) and the incoming wide block fit together cleanly
                            // on one Landscape page — avoiding a near-empty Portrait page before a wide table.
                            verifyCurrentPageBeforeBreak();
                            let promotedInPlace = false;
                            if (currentPage.elements.length > 0) {
                                let trialLayout = landscapeLayout;
                                let trialScaleOverride: number | undefined = undefined;
                                setRootLayout(trialLayout);
                                for (const prevEl of currentPage.elements) {
                                    this.resizeImageSlotsForWidth(prevEl, trialLayout.contentWidthPx);
                                }
                                this.resizeImageSlotsForWidth(block.el, trialLayout.contentWidthPx);
                                measureSizer.appendChild(block.el);

                                const overflowW = this.measureBlockOverflowWidthPx(block.el);
                                if (overflowW > trialLayout.contentWidthPx + 2) {
                                    for (let candScale = trialLayout.contentScale - 5; candScale >= 35; candScale -= 5) {
                                        const candLayout = this.getPdfPageLayout('landscape', candScale);
                                        setRootLayout(candLayout);
                                        this.resizeImageSlotsForWidth(block.el, candLayout.contentWidthPx);
                                        const candOverflow = this.measureBlockOverflowWidthPx(block.el);
                                        trialLayout = candLayout;
                                        trialScaleOverride = candScale;
                                        if (candOverflow <= candLayout.contentWidthPx + 2) {
                                            break;
                                        }
                                    }
                                    for (const prevEl of currentPage.elements) {
                                        this.resizeImageSlotsForWidth(prevEl, trialLayout.contentWidthPx);
                                    }
                                }

                                const combinedHeight = measureSizer.scrollHeight;
                                block.el.remove();

                                if (combinedHeight <= trialLayout.maxPageContentPx) {
                                    currentPageIsLandscape = true;
                                    currentPage.isLandscape = true;
                                    if (trialScaleOverride !== undefined) {
                                        currentPageScaleOverride = trialScaleOverride;
                                        currentPage.contentScaleOverride = trialScaleOverride;
                                    }
                                    setRootLayout(trialLayout);
                                    runningEstH = measureSizer.scrollHeight;
                                    promotedInPlace = true;
                                } else {
                                    // Revert back to Portrait before starting a fresh Landscape page
                                    setRootLayout(layout);
                                    for (const prevEl of currentPage.elements) {
                                        this.resizeImageSlotsForWidth(prevEl, contentWidthPx);
                                    }
                                }
                            }

                            if (!promotedInPlace) {
                                const carriedHeadings = popTrailingHeadingGroup(true);
                                finalizeCurrentPage(true);
                                for (const hItem of carriedHeadings) {
                                    measureSizer.appendChild(hItem.el);
                                    pushToCurrentPage(hItem);
                                }
                                runningEstH = measureSizer.scrollHeight;
                            }
                        }
                    } else if (!wantLandscape && currentPageIsLandscape && currentPage.elements.length === 0) {
                        // Empty landscape page receiving a normal block: switch back to Portrait immediately
                        currentPageIsLandscape = false;
                        currentPage.isLandscape = undefined;
                        currentPageScaleOverride = undefined;
                        setRootLayout(activePageLayout());
                        runningEstH = 0;
                    }
                    // Note: When currentPageIsLandscape is true and already has content (e.g. a 2-row wide table),
                    // we intentionally let subsequent normal blocks pack onto the remaining vertical space of this
                    // Landscape page instead of forcing an early page break; the next page returns to Portrait automatically.

                    if (currentPageIsLandscape) {
                        this.resizeImageSlotsForWidth(block.el, activePageLayout().contentWidthPx);
                    }
                }

                measureSizer.appendChild(block.el);

                // If content on a Landscape page STILL overflows horizontally (e.g. very wide multi-column table
                // or diagram), automatically step Content Scale down by 5% at a time until it fits completely,
                // stopping immediately so it stays as large and readable as possible.
                if (currentPageIsLandscape || layout.orientation === 'l') {
                    const curLayout = activePageLayout();
                    const overflowW = this.measureBlockOverflowWidthPx(block.el);
                    if (overflowW > curLayout.contentWidthPx + 2) {
                        const startScale = currentPageScaleOverride ?? curLayout.contentScale;
                        let chosenScale = startScale;
                        let chosenLayout = curLayout;
                        for (let candScale = startScale - 5; candScale >= 35; candScale -= 5) {
                            const candLayout = this.getPdfPageLayout(currentPageIsLandscape ? 'landscape' : undefined, candScale);
                            setRootLayout(candLayout);
                            this.resizeImageSlotsForWidth(block.el, candLayout.contentWidthPx);
                            const candOverflow = this.measureBlockOverflowWidthPx(block.el);
                            chosenScale = candScale;
                            chosenLayout = candLayout;
                            if (candOverflow <= candLayout.contentWidthPx + 2) {
                                break;
                            }
                        }
                        if (chosenScale < curLayout.contentScale) {
                            currentPageScaleOverride = chosenScale;
                            currentPage.contentScaleOverride = chosenScale;
                            setRootLayout(chosenLayout);
                            for (const prevEl of currentPage.elements) {
                                this.resizeImageSlotsForWidth(prevEl, chosenLayout.contentWidthPx);
                            }
                            runningEstH = measureSizer.scrollHeight;
                        }
                    }
                }

                const pageMaxPx = activeMaxPageContentPx();

                const estH = (!currentPageIsLandscape && currentPageScaleOverride === undefined) ? blockEstHeights.get(block.el) : undefined;
                if (estH !== undefined && estH > 0 && estH < 100 && runningEstH + estH < pageMaxPx - 160) {
                    runningEstH += estH + 16; // conservative margin buffer
                    pushToCurrentPage(block);
                } else {
                    const actualH = measureSizer.scrollHeight;
                    runningEstH = actualH;

                    if (actualH <= pageMaxPx) {
                        pushToCurrentPage(block);
                    } else {
                        // If previous conservatively-batched blocks already pushed past pageMaxPx,
                        // unwind them back onto pushbackStack before handling the true overflowing block.
                        const sizerTop = measureSizer.getBoundingClientRect().top;
                        if (currentPage.elements.length > 0 && block.el.getBoundingClientRect().top - sizerTop >= pageMaxPx - 4) {
                            block.el.remove();
                            pushbackStack.push(block);
                            verifyCurrentPageBeforeBreak();
                            const carriedHeadings = popTrailingHeadingGroup(false);
                            for (let k = carriedHeadings.length - 1; k >= 0; k--) {
                                pushbackStack.push(carriedHeadings[k]);
                            }
                            finalizeCurrentPage(!!block.isWide);
                            continue;
                        }

                        // Avoid splitting a non-wide multi-page table across a Landscape -> Portrait boundary;
                        // start it cleanly (with its section heading/intro) on a fresh Portrait page instead.
                        const { target: overflowTarget } = this.unwrapSplittableContainer(block.el);
                        if (
                            autoLandscapeEnabled &&
                            currentPageIsLandscape &&
                            !block.isWide &&
                            overflowTarget.tagName === 'TABLE' &&
                            currentPage.elements.length > 0
                        ) {
                            block.el.remove();
                            const carried = popTrailingHeadingGroup(true);
                            finalizeCurrentPage(false);
                            for (const cItem of carried) {
                                measureSizer.appendChild(cItem.el);
                                pushToCurrentPage(cItem);
                            }
                            runningEstH = measureSizer.scrollHeight;
                            pushbackStack.push(block);
                            continue;
                        }

                        // Overflow: measure block in place inside measureSizer and split it if possible
                        const splitRes = this.splitBlockToFitHeight(block, sizerTop + pageMaxPx);
                        if (splitRes) {
                            if (block.isWide) {
                                splitRes.head.isWide = true;
                                const { target: tailTarget } = this.unwrapSplittableContainer(splitRes.tail.el);
                                // Tables keep full column width across split pages; for other blocks re-check if tail is still wide
                                splitRes.tail.isWide = tailTarget.tagName === 'TABLE'
                                    ? true
                                    : this.isWideBlockForPortrait(splitRes.tail.el, contentWidthPx);
                            }
                            block.el.replaceWith(splitRes.head.el);
                            pushToCurrentPage(splitRes.head);
                            finalizeCurrentPage(!!splitRes.tail.isWide);
                            pushbackStack.push(splitRes.tail);
                            continue;
                        }

                        // Could not split into remaining space
                        const onlyHeadingsOnPage =
                            currentPage.elements.length > 0 &&
                            currentPageItems.every(it => !it.isTitle && this.isHeadingBlock(it.el));
                        const canFitSinglePage = this.canBlockFitOnSinglePage(block.el, pageMaxPx, 0.45);

                        if (currentPage.elements.length === 0 || onlyHeadingsOnPage) {
                            // Fresh page (alone or directly below its carried heading(s)):
                            // if this is a tall image or Mermaid/SVG diagram that fits on ONE page
                            // (down to 45% floor, or 40% when keeping a carried heading attached),
                            // scale it proportionally so heading + diagram stay intact on one page.
                            const minScaleForPage = onlyHeadingsOnPage ? 0.40 : 0.45;
                            if (this.fitTallMediaBlockToPageHeight(block.el, measureSizer, pageMaxPx, minScaleForPage)) {
                                runningEstH = measureSizer.scrollHeight;
                                pushToCurrentPage(block);
                            } else {
                                // Before falling back to multi-page slicing on an empty page, if this block is a
                                // multi-item list whose first item alone exceeded the page, peel off item[0] so
                                // subsequent list items flow normally onto the next page alongside following headings.
                                if (currentPage.elements.length === 0) {
                                    const forcedSplit = this.splitBlockToFitHeight(block, sizerTop + pageMaxPx, 0, true);
                                    if (forcedSplit) {
                                        if (block.isWide) {
                                            forcedSplit.head.isWide = true;
                                            forcedSplit.tail.isWide = this.isWideBlockForPortrait(forcedSplit.tail.el, contentWidthPx);
                                        }
                                        block.el.replaceWith(forcedSplit.head.el);
                                        if (measureSizer.scrollHeight > pageMaxPx) {
                                            currentPage.allowMultiPageSlice = true;
                                        }
                                        pushToCurrentPage(forcedSplit.head);
                                        finalizeCurrentPage(!!forcedSplit.tail.isWide);
                                        pushbackStack.push(forcedSplit.tail);
                                        continue;
                                    }
                                }
                                // Ultra-tall (>2.2x page height) unbreakable block: keep full readable width
                                // together with any carried heading(s) and slice seamlessly across pages
                                // (never finalize an orphan heading-only blank page).
                                currentPage.allowMultiPageSlice = true;
                                pushToCurrentPage(block);
                                finalizeCurrentPage(false);
                            }
                        } else if (!canFitSinglePage) {
                            // Ultra-tall unbreakable block (e.g. a multi-page vertical Mermaid flowchart) that
                            // CANNOT fit on a single fresh page even alone: since it will be sliced across
                            // multiple pages anyway, let it start directly below its heading and existing content
                            // whenever meaningful vertical space remains on the current page.
                            const blockTopOnPagePx = Math.max(0, block.el.getBoundingClientRect().top - sizerTop);
                            const remainingOnPagePx = pageMaxPx - blockTopOnPagePx;
                            const minStartSpacePx = Math.max(180, pageMaxPx * 0.20);
                            if (remainingOnPagePx >= minStartSpacePx) {
                                currentPage.allowMultiPageSlice = true;
                                pushToCurrentPage(block);
                                finalizeCurrentPage(false);
                            } else {
                                block.el.remove();
                                const carriedHeadings = popTrailingHeadingGroup(false);
                                finalizeCurrentPage(!!block.isWide);
                                for (const cItem of carriedHeadings) {
                                    measureSizer.appendChild(cItem.el);
                                    pushToCurrentPage(cItem);
                                }
                                runningEstH = measureSizer.scrollHeight;
                                pushbackStack.push(block);
                                continue;
                            }
                        } else {
                            // Short/medium block that CAN fit intact on a fresh page: move block + any
                            // preceding heading(s) to a fresh page so heading + full diagram stay together.
                            block.el.remove();
                            const carriedHeadings = popTrailingHeadingGroup(false);
                            finalizeCurrentPage(!!block.isWide);
                            for (const cItem of carriedHeadings) {
                                measureSizer.appendChild(cItem.el);
                                pushToCurrentPage(cItem);
                            }
                            runningEstH = measureSizer.scrollHeight;
                            pushbackStack.push(block);
                            continue;
                        }
                    }
                }

                // When the final block is placed, verify the trailing page so any unwound items re-enter the main loop
                if (pushbackStack.length === 0 && rawIdx >= allRawBlocks.length && currentPage.elements.length > 0) {
                    const beforeUnwind = pushbackStack.length;
                    verifyCurrentPageBeforeBreak();
                    if (pushbackStack.length > beforeUnwind) {
                        // Re-enter loop so unwound splittable blocks (e.g. lists) fill remaining space cleanly
                        runningEstH = measureSizer.scrollHeight;
                        continue;
                    }
                    finalizeCurrentPage(false);
                }
            }
            if (currentPage.elements.length > 0) {
                finalizeCurrentPage(false);
            }
            setRootLayout(layout);
            measureWrapper.remove();

            // Keep cleanupRealView alive until the finally block after all pages are captured:
            // unloading MarkdownView early triggers MarkdownRenderChild.onunload() (e.g. Svelte/React
            // community plugins like obsidian-image-layouts), which would destroy their DOM out of
            // pages[i].elements before page capture runs.

            // Ensure at least 1 blank page if note is completely empty
            if (pages.length === 0) {
                doc.setFillColor(bgColor[0], bgColor[1], bgColor[2]);
                doc.rect(0, 0, pageWidth, pageHeight, 'F');
            }

            const computePageSignature = (page: PageChunk): string => {
                return `${page.isLandscape ? 'L' : 'P'}:${page.contentScaleOverride ?? ''}::` + page.elements
                    .map(el => `${el.tagName}:${el.textContent?.length ?? 0}:${el.innerHTML}`)
                    .join('|');
            };

            const deferredLineNumbers: Array<{ pdfPageNum: number; markerOffsets: Array<{ line: number; offsetTopPx: number }>; singleSlice: boolean; mmPerPx?: number }> = [];

            const lineNumX = Math.max(1.5, Math.min(5, margin * 0.3));
            const drawLineNumbersOnPage = (markerOffsets: Array<{ line: number; offsetTopPx: number }>, singleSlice: boolean = false, pageMmPerPx: number = mmPerPx) => {
                if (!showLineNumbers || markerOffsets.length === 0) return;
                doc.saveGraphicsState();
                doc.setFont(activeJsPdfFont, 'normal');
                doc.setFontSize(8);
                doc.setTextColor(120, 120, 120);
                if (singleSlice) {
                    doc.text(`${markerOffsets[0].line}`, lineNumX, topMargin + 3.5);
                } else {
                    let lastY = -10;
                    for (const m of markerOffsets) {
                        const targetY = topMargin + m.offsetTopPx * pageMmPerPx + 3.5;
                        if (targetY - lastY >= 2.4) {
                            doc.text(`${m.line}`, lineNumX, targetY);
                            lastY = targetY;
                        }
                    }
                }
                doc.restoreGraphicsState();
            };

            const shouldCacheSlices = !appendTarget && (isPreview || allowExportCacheReuse);
            const maxCachedSliceChars = perf.tier === 'low' ? 35_000_000 : 120_000_000;
            let cachedSliceChars = 0;
            let sliceCacheOverflowed = false;

            const newCachedPages: CachedPdfPage[] = [];
            const emittedSlicesMeta: EmittedPdfSliceMeta[] = appendTarget ? appendTarget.emittedSlicesMeta : [];
            let canReusePrefix = !appendTarget && isPreview && earliestChangedBreakLine >= 0 && !!this.previewRenderCache;
            let reusedPrefixPages = 0;
            const startingPdfPages = appendTarget ? appendTarget.existingPdfPages : 0;
            let emittedPdfPages = startingPdfPages;
            let chapterHeadingInjected = false;
            let singleNoteStartAnchorInjected = false;

            const recordEmittedSlice = (
                pdfPageNum: number,
                sliceTopCssPx: number,
                sliceBottomCssPx: number,
                annotations: { headings: CachedPdfHeading[]; anchors: CachedPdfAnchor[]; links: CachedPdfLink[] },
                pageLayout: PdfPageLayout = layout
            ) => {
                let sliceHeadings = annotations.headings;
                let sliceAnchors = annotations.anchors;
                if (appendTarget && !chapterHeadingInjected) {
                    chapterHeadingInjected = true;
                    const chapterHeading: CachedPdfHeading = {
                        level: 0,
                        title: file.basename || 'Untitled',
                        topPx: sliceTopCssPx,
                        anchorKeys: ['__note_start__']
                    };
                    sliceHeadings = [chapterHeading, ...annotations.headings];
                } else if (!appendTarget && !singleNoteStartAnchorInjected) {
                    singleNoteStartAnchorInjected = true;
                    sliceAnchors = [{ keys: ['__note_start__'], topPx: sliceTopCssPx }, ...annotations.anchors];
                }
                if (appendTarget) {
                    appendTarget.pageTitlesByPage[pdfPageNum] = file.basename || 'Untitled';
                }
                emittedSlicesMeta.push({
                    pdfPageNum,
                    sliceTopCssPx,
                    sliceBottomCssPx,
                    pageWidthMm: pageLayout.pageWidth,
                    pageHeightMm: pageLayout.pageHeight,
                    mmPerPx: pageLayout.mmPerPx,
                    noteScope: appendTarget?.noteScopeId,
                    headings: sliceHeadings,
                    anchors: sliceAnchors,
                    links: annotations.links
                });
            };

            const encodePageCanvasForPdf = async (
                canvas: HTMLCanvasElement,
                hasEmbeddedImages: boolean
            ): Promise<{ data: string; format: 'PNG' | 'JPEG' }> => {
                const pngData = canvas.toDataURL(imgMime, imgQuality);
                if (!this.settings.optimizeImages) {
                    return { data: pngData, format: imgFormat };
                }

                // Step 1: For pages with <= 256 unique colors (typical text/heading/table/code pages),
                // encode as 100% lossless 8-bit Indexed-Palette PNG (often 2x–3x smaller with zero blur).
                let bestPng = pngData;
                if (!hasEmbeddedImages) {
                    const indexedPng = await this.tryEncodeIndexedPngDataUrl(canvas);
                    if (indexedPng && indexedPng.length < bestPng.length) {
                        bestPng = indexedPng;
                    }
                }

                // Step 2: Compare against high-fidelity 93% JPEG (at 2x HiDPI text and graphics stay razor-sharp
                // while complex photo/Mermaid/callout/emoji pages shrink substantially). Always pick the
                // strictly smaller stream with a safety preference for lossless PNG on crisp text/vector pages.
                try {
                    const jpegData = canvas.toDataURL('image/jpeg', 0.93);
                    const threshold = hasEmbeddedImages ? 0.78 : 0.65;
                    if (jpegData.startsWith('data:image/jpeg') && jpegData.length < bestPng.length * threshold) {
                        return { data: jpegData, format: 'JPEG' };
                    }
                } catch {
                    // Fall back to best lossless PNG
                }
                return { data: bestPng, format: imgFormat };
            };

            const emitPageCanvasToPdf = async (
                pageCanvas: HTMLCanvasElement,
                page: PageChunk,
                markerOffsets: Array<{ line: number; offsetTopPx: number }>,
                textSpans: CachedPdfTextSpan[],
                annotations: { headings: CachedPdfHeading[]; anchors: CachedPdfAnchor[]; links: CachedPdfLink[] },
                unbreakableRanges: Array<{ topCssPx: number; bottomCssPx: number }> = []
            ): Promise<boolean> => {
                const pageLayout = resolvePageLayout(page.isLandscape, page.contentScaleOverride);
                const canvasCssHeight = pageCanvas.height / captureScale;
                const totalHeightMm = canvasCssHeight * pageLayout.mmPerPx;
                const generatedSlices: CachedPdfSlice[] = [];
                const pageHasEmbeddedImages = page.elements.some(
                    el => el.classList.contains('pdf-image-slot') || !!el.querySelector('.pdf-image-slot, img, canvas')
                );

                if (totalHeightMm <= pageLayout.maxContentHeightMm + 1) {
                    this.ensurePdfPageOrientation(doc, emittedPdfPages, pageLayout);
                    emittedPdfPages++;
                    doc.setFillColor(bgColor[0], bgColor[1], bgColor[2]);
                    doc.rect(0, 0, pageLayout.pageWidth, pageLayout.pageHeight, 'F');

                    const encoded = await encodePageCanvasForPdf(pageCanvas, pageHasEmbeddedImages);
                    doc.addImage(encoded.data, encoded.format, pageLayout.margin, pageLayout.topMargin, pageLayout.contentWidthMm, totalHeightMm, undefined, 'FAST');
                    this.drawInvisibleTextLayer(
                        doc,
                        textSpans,
                        effectiveTextLayerFont,
                        isCustomUnicodeFont,
                        pageLayout.margin,
                        pageLayout.topMargin,
                        pageLayout.pageWidth,
                        pageLayout.pageHeight,
                        pageLayout.mmPerPx,
                        0,
                        Infinity
                    );
                    recordEmittedSlice(emittedPdfPages, 0, Infinity, annotations, pageLayout);
                    if (shouldCacheSlices && !sliceCacheOverflowed) {
                        cachedSliceChars += encoded.data.length;
                        if (cachedSliceChars <= maxCachedSliceChars) {
                            generatedSlices.push({ imgData: encoded.data, format: encoded.format, heightMm: totalHeightMm, sliceTopCssPx: 0, sliceBottomCssPx: Infinity });
                        } else {
                            sliceCacheOverflowed = true;
                        }
                    }
                    if (showLineNumbers && markerOffsets.length > 0) {
                        deferredLineNumbers.push({ pdfPageNum: emittedPdfPages, markerOffsets, singleSlice: false, mmPerPx: pageLayout.mmPerPx });
                    }
                } else {
                    // Oversized single block: slice across multiple PDF pages cleanly while avoiding
                    // cutting through small/medium images or diagram boxes whenever shifting the cut keeps them intact.
                    const sliceHeightPx = Math.floor(pageLayout.maxPageContentPx * captureScale);
                    const minSlicePx = Math.floor(pageLayout.maxPageContentPx * 0.25 * captureScale);
                    const maxAbsorbOverPx = Math.round(56 * captureScale);
                    let offsetPx = 0;
                    let sliceIndex = 0;

                    while (offsetPx < pageCanvas.height) {
                        if (shouldCancel?.()) return false;
                        const remainingPx = pageCanvas.height - offsetPx;
                        if (sliceIndex > 0 && remainingPx < Math.max(4, Math.round(4 * captureScale))) {
                            break;
                        }

                        // If the remaining tail overhangs a single page by only a small sliver (e.g. the
                        // bottom border/stroke or SVG padding of the final Mermaid box), absorb it into
                        // this slice and proportionally fit it to maxContentHeightMm instead of spawning
                        // an almost-empty trailing page.
                        let currentSliceH: number;
                        if (remainingPx > sliceHeightPx && remainingPx <= sliceHeightPx + maxAbsorbOverPx) {
                            currentSliceH = remainingPx;
                        } else {
                            currentSliceH = Math.min(sliceHeightPx, remainingPx);
                            if (offsetPx + currentSliceH < pageCanvas.height && unbreakableRanges.length > 0) {
                                const sliceTopCss = offsetPx / captureScale;
                                for (let pass = 0; pass < 4; pass++) {
                                    const proposedBotCss = (offsetPx + currentSliceH) / captureScale;
                                    let earliestStraddleTop: number | null = null;
                                    for (let u = 0; u < unbreakableRanges.length; u++) {
                                        const r = unbreakableRanges[u];
                                        if (r.topCssPx >= proposedBotCss) break;
                                        if (r.topCssPx > sliceTopCss + 4 && r.bottomCssPx > proposedBotCss) {
                                            earliestStraddleTop = r.topCssPx;
                                            break;
                                        }
                                    }
                                    if (earliestStraddleTop === null) break;
                                    const adjustedH = Math.floor((earliestStraddleTop - 3) * captureScale) - offsetPx;
                                    if (adjustedH >= minSlicePx && adjustedH < currentSliceH) {
                                        currentSliceH = adjustedH;
                                    } else {
                                        break;
                                    }
                                }
                            }
                        }

                        const sliceTopCssPx = offsetPx / captureScale;
                        const sliceBottomCssPx = (offsetPx + currentSliceH) / captureScale;
                        const sliceCanvas = createEl('canvas');
                        sliceCanvas.width = pageCanvas.width;
                        sliceCanvas.height = currentSliceH;
                        const sCtx = sliceCanvas.getContext('2d', { alpha: false });
                        if (sCtx) {
                            sCtx.fillStyle = bgHex;
                            sCtx.fillRect(0, 0, sliceCanvas.width, sliceCanvas.height);
                            sCtx.drawImage(pageCanvas, 0, offsetPx, pageCanvas.width, currentSliceH, 0, 0, pageCanvas.width, currentSliceH);

                            // Skip emitting a trailing slice that contains only uniform background padding
                            if (sliceIndex > 0) {
                                let hasInk = this.canvasHasNonBgPixels(sCtx, sliceCanvas.width, sliceCanvas.height, bgColor);
                                if (!hasInk) {
                                    const edgeRows = [0, 1, 2, sliceCanvas.height - 1];
                                    for (let eIdx = 0; eIdx < edgeRows.length && !hasInk; eIdx++) {
                                        const ey = edgeRows[eIdx];
                                        if (ey < 0 || ey >= sliceCanvas.height) continue;
                                        const rowData = sCtx.getImageData(0, ey, sliceCanvas.width, 1).data;
                                        for (let px = 0; px < rowData.length; px += 8) {
                                            if (
                                                Math.abs(rowData[px] - bgColor[0]) > 6 ||
                                                Math.abs(rowData[px + 1] - bgColor[1]) > 6 ||
                                                Math.abs(rowData[px + 2] - bgColor[2]) > 6
                                            ) {
                                                hasInk = true;
                                                break;
                                            }
                                        }
                                    }
                                }
                                if (!hasInk) {
                                    sliceCanvas.width = 0;
                                    sliceCanvas.height = 0;
                                    break;
                                }
                            }

                            this.ensurePdfPageOrientation(doc, emittedPdfPages, pageLayout);
                            emittedPdfPages++;
                            doc.setFillColor(bgColor[0], bgColor[1], bgColor[2]);
                            doc.rect(0, 0, pageLayout.pageWidth, pageLayout.pageHeight, 'F');

                            const sliceEncoded = await encodePageCanvasForPdf(sliceCanvas, pageHasEmbeddedImages);
                            const rawSliceHeightMm = (currentSliceH / captureScale) * pageLayout.mmPerPx;
                            let drawW = pageLayout.contentWidthMm;
                            let drawH = rawSliceHeightMm;
                            let drawX = pageLayout.margin;
                            let drawMmPerPx = pageLayout.mmPerPx;
                            if (rawSliceHeightMm > pageLayout.maxContentHeightMm) {
                                const fitScale = pageLayout.maxContentHeightMm / rawSliceHeightMm;
                                drawH = pageLayout.maxContentHeightMm;
                                drawW = pageLayout.contentWidthMm * fitScale;
                                drawX = pageLayout.margin + (pageLayout.contentWidthMm - drawW) / 2;
                                drawMmPerPx = pageLayout.mmPerPx * fitScale;
                            }
                            doc.addImage(sliceEncoded.data, sliceEncoded.format, drawX, pageLayout.topMargin, drawW, drawH, undefined, 'FAST');
                            this.drawInvisibleTextLayer(
                                doc,
                                textSpans,
                                effectiveTextLayerFont,
                                isCustomUnicodeFont,
                                drawX,
                                pageLayout.topMargin,
                                pageLayout.pageWidth,
                                pageLayout.pageHeight,
                                drawMmPerPx,
                                sliceTopCssPx,
                                sliceBottomCssPx
                            );
                            if (shouldCacheSlices && !sliceCacheOverflowed) {
                                cachedSliceChars += sliceEncoded.data.length;
                                if (cachedSliceChars <= maxCachedSliceChars) {
                                    generatedSlices.push({
                                        imgData: sliceEncoded.data,
                                        format: sliceEncoded.format,
                                        heightMm: drawH,
                                        xMm: drawX !== pageLayout.margin ? drawX : undefined,
                                        widthMm: drawW !== pageLayout.contentWidthMm ? drawW : undefined,
                                        mmPerPx: drawMmPerPx !== pageLayout.mmPerPx ? drawMmPerPx : undefined,
                                        sliceTopCssPx,
                                        sliceBottomCssPx
                                    });
                                } else {
                                    sliceCacheOverflowed = true;
                                }
                            }
                            const sliceMetaLayout = drawMmPerPx !== pageLayout.mmPerPx
                                ? { ...pageLayout, mmPerPx: drawMmPerPx }
                                : pageLayout;
                            recordEmittedSlice(emittedPdfPages, sliceTopCssPx, sliceBottomCssPx, annotations, sliceMetaLayout);
                            if (showLineNumbers && sliceIndex === 0 && markerOffsets.length > 0) {
                                deferredLineNumbers.push({ pdfPageNum: emittedPdfPages, markerOffsets, singleSlice: true, mmPerPx: drawMmPerPx });
                            }
                        }
                        sliceCanvas.width = 0;
                        sliceCanvas.height = 0;

                        offsetPx += currentSliceH;
                        sliceIndex++;
                    }
                }

                if (shouldCacheSlices && !sliceCacheOverflowed) {
                    newCachedPages.push({
                        startLine: page.startLine,
                        endLine: page.endLine,
                        htmlSignature: isPreview ? computePageSignature(page) : '',
                        isLandscape: page.isLandscape || undefined,
                        contentScaleOverride: page.contentScaleOverride,
                        slices: generatedSlices,
                        markerOffsets,
                        textSpans,
                        headings: annotations.headings,
                        anchors: annotations.anchors,
                        links: annotations.links
                    });
                }
                return true;
            };

            const mountAndStabilizePage = async (
                parent: HTMLElement,
                pageIdx: number
            ): Promise<{
                page: PageChunk;
                pageLayout: PdfPageLayout;
                pageWrapper: HTMLElement;
                pageSizer: HTMLElement;
                markerOffsets: Array<{ line: number; offsetTopPx: number }>;
                textSpans: CachedPdfTextSpan[];
                annotations: { headings: CachedPdfHeading[]; anchors: CachedPdfAnchor[]; links: CachedPdfLink[] };
                unbreakableRanges: Array<{ topCssPx: number; bottomCssPx: number }>;
            }> => {
                const page = pages[pageIdx];
                const pageLayout = resolvePageLayout(page.isLandscape, page.contentScaleOverride);
                setRootLayout(pageLayout);
                const { leafEl: pageWrapper, sectionSizerEl: pageSizer } = createObsidianReadingHierarchy(parent);
                pageWrapper.style.backgroundColor = bgHex;

                for (const el of page.elements) {
                    el.style.setProperty('content-visibility', 'visible', 'important');
                    pageSizer.appendChild(el);
                }

                if (hasAsyncWidgets) {
                    await this.yieldFrameSafe(20);
                }

                // Auto-fit display MathJax blocks that still overflow the current page width
                // (e.g. when Auto-Landscape is disabled or an equation exceeds even Landscape width).
                const displayMathEls = Array.from(
                    pageSizer.querySelectorAll<HTMLElement>('mjx-container[display="true"], .math-block')
                );
                const availMathW = Math.max(80, pageSizer.clientWidth || pageLayout.contentWidthPx);
                for (const mathEl of displayMathEls) {
                    const mathInner =
                        mathEl.querySelector<HTMLElement>('mjx-math') ||
                        mathEl.querySelector<SVGSVGElement>('svg');
                    const innerRectW = mathInner ? mathInner.getBoundingClientRect().width : 0;
                    const innerScrollW = mathInner && 'scrollWidth' in mathInner ? (mathInner as HTMLElement).scrollWidth : 0;
                    const naturalW = Math.max(mathEl.scrollWidth, innerRectW, innerScrollW);
                    if (naturalW > availMathW + 2) {
                        const fitRatio = Math.max(0.4, (availMathW - 4) / naturalW);
                        if (mathInner && mathInner.tagName.toLowerCase() === 'svg') {
                            mathInner.style.maxWidth = '100%';
                            mathInner.style.height = 'auto';
                        } else {
                            const baseFontPx = parseFloat(window.getComputedStyle(mathEl).fontSize) || 16;
                            mathEl.style.fontSize = `${Math.max(7, baseFontPx * fitRatio)}px`;
                            mathEl.style.maxWidth = '100%';
                        }
                    }
                }

                // Safety overflow check: if margin/font differences pushed the last item over 1 page,
                // try splitting that overflowing block cleanly into the remaining space before pushing it whole!
                // Skip when the page intentionally holds an ultra-tall multi-page sliced block with its heading/context.
                while (!page.allowMultiPageSlice && page.elements.length > 1 && pageSizer.scrollHeight > pageLayout.maxPageContentPx + 10) {
                    const lastEl = page.elements[page.elements.length - 1];
                    const lastMarkerIdx = page.lineMarkers.findIndex(m => m.el === lastEl);
                    const lastLine = lastMarkerIdx !== -1 ? page.lineMarkers[lastMarkerIdx].line : page.endLine;
                    const sizerTopPx = pageSizer.getBoundingClientRect().top;

                    const splitRes = this.splitBlockToFitHeight(
                        { el: lastEl, startLine: lastLine, endLine: page.endLine },
                        sizerTopPx + pageLayout.maxPageContentPx
                    );
                    if (splitRes) {
                        lastEl.replaceWith(splitRes.head.el);
                        page.elements[page.elements.length - 1] = splitRes.head.el;
                        if (lastMarkerIdx !== -1) {
                            page.lineMarkers[lastMarkerIdx] = { line: splitRes.head.startLine, el: splitRes.head.el };
                        }
                        const tailMarker = { line: splitRes.tail.startLine, el: splitRes.tail.el };
                        const nextPage = pageIdx + 1 < pages.length ? pages[pageIdx + 1] : null;
                        if (nextPage && !nextPage.startsWithForcedBreak && !!nextPage.isLandscape === !!page.isLandscape && nextPage.contentScaleOverride === page.contentScaleOverride) {
                            nextPage.elements.unshift(splitRes.tail.el);
                            nextPage.lineMarkers.unshift(tailMarker);
                        } else if (nextPage) {
                            pages.splice(pageIdx + 1, 0, {
                                elements: [splitRes.tail.el],
                                lineMarkers: [tailMarker],
                                startLine: splitRes.tail.startLine,
                                endLine: splitRes.tail.endLine,
                                startsWithForcedBreak: false,
                                isLandscape: page.isLandscape,
                                contentScaleOverride: page.contentScaleOverride
                            });
                        } else {
                            pages.push({
                                elements: [splitRes.tail.el],
                                lineMarkers: [tailMarker],
                                startLine: splitRes.tail.startLine,
                                endLine: splitRes.tail.endLine,
                                startsWithForcedBreak: false,
                                isLandscape: page.isLandscape,
                                contentScaleOverride: page.contentScaleOverride
                            });
                        }
                        break;
                    }

                    const overflowEl = page.elements.pop();
                    if (!overflowEl) break;
                    const overflowMarkerIdx = page.lineMarkers.findIndex(m => m.el === overflowEl);
                    let overflowMarker: { line: number; el: HTMLElement } | undefined;
                    if (overflowMarkerIdx !== -1) {
                        overflowMarker = page.lineMarkers.splice(overflowMarkerIdx, 1)[0];
                    }

                    overflowEl.remove();
                    const fallbackLine = overflowMarker?.line ?? page.endLine;
                    const nextPage = pageIdx + 1 < pages.length ? pages[pageIdx + 1] : null;
                    if (nextPage && !nextPage.startsWithForcedBreak && !!nextPage.isLandscape === !!page.isLandscape && nextPage.contentScaleOverride === page.contentScaleOverride) {
                        nextPage.elements.unshift(overflowEl);
                        if (overflowMarker) nextPage.lineMarkers.unshift(overflowMarker);
                    } else if (nextPage) {
                        pages.splice(pageIdx + 1, 0, {
                            elements: [overflowEl],
                            lineMarkers: overflowMarker ? [overflowMarker] : [],
                            startLine: fallbackLine,
                            endLine: page.endLine,
                            startsWithForcedBreak: false,
                            isLandscape: page.isLandscape,
                            contentScaleOverride: page.contentScaleOverride
                        });
                    } else {
                        pages.push({
                            elements: [overflowEl],
                            lineMarkers: overflowMarker ? [overflowMarker] : [],
                            startLine: fallbackLine,
                            endLine: page.endLine,
                            startsWithForcedBreak: false,
                            isLandscape: page.isLandscape,
                            contentScaleOverride: page.contentScaleOverride
                        });
                    }
                }

                // Prevent top-level task list checkboxes from protruding past x=0 (Obsidian uses negative
                // margin-inline-start on checkboxes, causing <foreignObject> overflow:hidden to clip their left border).
                const wrapperLeft = pageWrapper.getBoundingClientRect().left;
                const allPageCbs = Array.from(pageSizer.querySelectorAll<HTMLElement>('input[type="checkbox"]'));
                if (allPageCbs.length > 0) {
                    const listMinLeft = new Map<HTMLElement, number>();
                    for (let cIdx = 0; cIdx < allPageCbs.length; cIdx++) {
                        const cb = allPageCbs[cIdx];
                        const cbRect = cb.getBoundingClientRect();
                        if (cbRect.width <= 0 || cbRect.height <= 0) continue;
                        let outerList: HTMLElement | null = null;
                        let cur: HTMLElement | null = cb.parentElement;
                        while (cur && cur !== pageSizer) {
                            if (cur.tagName === 'UL' || cur.tagName === 'OL') {
                                outerList = cur;
                            }
                            cur = cur.parentElement;
                        }
                        if (outerList) {
                            const prev = listMinLeft.get(outerList);
                            if (prev === undefined || cbRect.left < prev) {
                                listMinLeft.set(outerList, cbRect.left);
                            }
                        } else if (cbRect.left < wrapperLeft + 2) {
                            const shiftPx = Math.ceil(wrapperLeft + 2 - cbRect.left);
                            const curML = parseFloat(window.getComputedStyle(cb).marginLeft) || 0;
                            cb.style.marginLeft = `${curML + shiftPx}px`;
                        }
                    }
                    const safeLeft = wrapperLeft + 2;
                    for (const [listEl, minLeft] of listMinLeft.entries()) {
                        if (minLeft < safeLeft) {
                            const shiftPx = Math.ceil(safeLeft - minLeft);
                            const curPadLeft = parseFloat(window.getComputedStyle(listEl).paddingLeft) || 0;
                            listEl.style.paddingLeft = `${curPadLeft + shiftPx}px`;
                        }
                    }
                }

                const sizerRect = pageSizer.getBoundingClientRect();
                const wrapperTop = pageWrapper.getBoundingClientRect().top;
                const markerOffsets: Array<{ line: number; offsetTopPx: number }> = [];
                const seenLines = new Set<number>();
                for (let mIdx = 0; mIdx < page.lineMarkers.length; mIdx++) {
                    const m = page.lineMarkers[mIdx];
                    this.extractBlockLineMarkerOffsets(m.el, m.line, sizerRect.top, seenLines, markerOffsets);
                }
                markerOffsets.sort((a, b) => a.offsetTopPx - b.offsetTopPx);
                const textSpans = this.extractPageTextSpans(pageWrapper);
                const annotations = this.extractPageAnnotations(pageWrapper, file, appendTarget?.mergedNoteScopeMap);

                const unbreakableRanges: Array<{ topCssPx: number; bottomCssPx: number }> = [];
                const maxAtomicH = pageLayout.maxPageContentPx * 0.75;
                const mediaEls = pageWrapper.querySelectorAll<HTMLElement>('figure, .pdf-image-slot, img, canvas');
                for (let uIdx = 0; uIdx < mediaEls.length; uIdx++) {
                    const mEl = mediaEls[uIdx];
                    if (mEl.tagName !== 'FIGURE' && mEl.closest('figure')) continue;
                    const mr = mEl.getBoundingClientRect();
                    if (mr.height > 4 && mr.height <= maxAtomicH) {
                        unbreakableRanges.push({
                            topCssPx: Math.max(0, mr.top - wrapperTop),
                            bottomCssPx: Math.max(0, mr.bottom - wrapperTop)
                        });
                    }
                }
                // Also protect individual Mermaid/SVG diagram node boxes and arrow labels (including
                // their outer strokes/borders) when slicing tall diagrams across pages.
                const maxSvgNodeH = Math.min(260, maxAtomicH);
                const svgNodeEls = pageWrapper.querySelectorAll<SVGGElement>(
                    'svg g.node, svg g.actor, svg g.cluster-label, svg g.statediagram-state, svg g.edgeLabel'
                );
                for (let sIdx = 0; sIdx < svgNodeEls.length; sIdx++) {
                    const nodeEl = svgNodeEls[sIdx];
                    if (nodeEl.closest('mjx-container, .math, .callout-icon, .pdf-vector-checkbox')) continue;
                    const nr = nodeEl.getBoundingClientRect();
                    if (nr.height > 6 && nr.height <= maxSvgNodeH && nr.width > 4) {
                        unbreakableRanges.push({
                            topCssPx: Math.max(0, nr.top - wrapperTop - 3),
                            bottomCssPx: Math.max(0, nr.bottom - wrapperTop + 4)
                        });
                    }
                }
                unbreakableRanges.sort((a, b) => a.topCssPx - b.topCssPx);

                return { page, pageLayout, pageWrapper, pageSizer, markerOffsets, textSpans, annotations, unbreakableRanges };
            };

            // Step 1: Reuse any untouched prefix pages from incremental preview cache
            let nextUncachedIdx = 0;
            while (nextUncachedIdx < pages.length && canReusePrefix) {
                if (shouldCancel?.()) return null;
                const page = pages[nextUncachedIdx];
                const cachedPage = this.previewRenderCache?.pages[nextUncachedIdx];
                const pageSignature = (cachedPage && page.endLine < earliestChangedBreakLine && cachedPage.startLine === page.startLine)
                    ? computePageSignature(page)
                    : '';

                if (
                    cachedPage &&
                    page.endLine < earliestChangedBreakLine &&
                    cachedPage.startLine === page.startLine &&
                    !!cachedPage.isLandscape === !!page.isLandscape &&
                    cachedPage.contentScaleOverride === page.contentScaleOverride &&
                    cachedPage.htmlSignature === pageSignature &&
                    cachedPage.slices.length > 0
                ) {
                    const cachedLayout = resolvePageLayout(cachedPage.isLandscape, cachedPage.contentScaleOverride);
                    for (let sIdx = 0; sIdx < cachedPage.slices.length; sIdx++) {
                        this.ensurePdfPageOrientation(doc, emittedPdfPages, cachedLayout);
                        emittedPdfPages++;
                        doc.setFillColor(bgColor[0], bgColor[1], bgColor[2]);
                        doc.rect(0, 0, cachedLayout.pageWidth, cachedLayout.pageHeight, 'F');
                        const slice = cachedPage.slices[sIdx];
                        const sliceX = slice.xMm ?? cachedLayout.margin;
                        const sliceW = slice.widthMm ?? cachedLayout.contentWidthMm;
                        const sliceMmPerPx = slice.mmPerPx ?? cachedLayout.mmPerPx;
                        doc.addImage(slice.imgData, slice.format, sliceX, cachedLayout.topMargin, sliceW, slice.heightMm, undefined, 'FAST');
                        this.drawInvisibleTextLayer(
                            doc,
                            cachedPage.textSpans,
                            effectiveTextLayerFont,
                            isCustomUnicodeFont,
                            sliceX,
                            cachedLayout.topMargin,
                            cachedLayout.pageWidth,
                            cachedLayout.pageHeight,
                            sliceMmPerPx,
                            slice.sliceTopCssPx ?? 0,
                            slice.sliceBottomCssPx ?? Infinity
                        );
                        emittedSlicesMeta.push({
                            pdfPageNum: emittedPdfPages,
                            sliceTopCssPx: slice.sliceTopCssPx ?? 0,
                            sliceBottomCssPx: slice.sliceBottomCssPx ?? Infinity,
                            pageWidthMm: cachedLayout.pageWidth,
                            pageHeightMm: cachedLayout.pageHeight,
                            mmPerPx: sliceMmPerPx,
                            headings: cachedPage.headings || [],
                            anchors: cachedPage.anchors || [],
                            links: cachedPage.links || []
                        });
                        if (showLineNumbers && sIdx === 0 && cachedPage.markerOffsets.length > 0) {
                            deferredLineNumbers.push({
                                pdfPageNum: emittedPdfPages,
                                markerOffsets: cachedPage.markerOffsets,
                                singleSlice: cachedPage.slices.length > 1,
                                mmPerPx: sliceMmPerPx
                            });
                        }
                    }
                    newCachedPages.push(cachedPage);
                    reusedPrefixPages += cachedPage.slices.length;
                    nextUncachedIdx++;
                    onProgress?.(nextUncachedIdx, pages.length);
                } else {
                    canReusePrefix = false;
                }
            }

            // Step 2: Capture remaining pages.
            // Primary path: per-page Native SVG <foreignObject> rasterizer (~20x-50x faster than html2canvas,
            // tiny ~11MB peak canvas RAM, opaque RGB PNG for ~100x faster jsPDF embedding).
            // Automatic fallback: memory-safe batched html2canvas (<= 3 pages/batch) if a page has
            // incompatible elements or if the platform WebView does not support untainted <foreignObject>.
            interface MountedBatchPage {
                pageIdx: number;
                page: PageChunk;
                pageWrapper: HTMLElement;
                pageSizer: HTMLElement;
                markerOffsets: Array<{ line: number; offsetTopPx: number }>;
                textSpans: CachedPdfTextSpan[];
                annotations: { headings: CachedPdfHeading[]; anchors: CachedPdfAnchor[]; links: CachedPdfLink[] };
                unbreakableRanges: Array<{ topCssPx: number; bottomCssPx: number }>;
            }

            const batchGapCssPx = 12;
            let cursorIdx = nextUncachedIdx;

            while (cursorIdx < pages.length) {
                if (shouldCancel?.()) return null;

                if (this.foreignObjectSupported !== false) {
                    // Native <foreignObject> path: 1 page at a time (ultra-low peak RAM & native C++ speed)
                    setRootLayout(resolvePageLayout(pages[cursorIdx].isLandscape, pages[cursorIdx].contentScaleOverride));
                    const batchWrapper = renderRoot.createDiv({ cls: 'pdf-batch-wrapper' });
                    batchWrapper.style.backgroundColor = bgHex;
                    const mounted = await mountAndStabilizePage(batchWrapper, cursorIdx);
                    if (shouldCancel?.()) {
                        batchWrapper.remove();
                        return null;
                    }
                    const pageContentWidthPx = mounted.pageLayout.contentWidthPx;

                    let pageCanvas = await this.captureElementViaForeignObject(
                        mounted.pageWrapper,
                        pageContentWidthPx,
                        bgHex,
                        bgColor,
                        captureScale,
                        fontCss,
                        colorCache,
                        imageCanvasesById,
                        mounted.pageLayout.maxPageContentPx
                    );

                    if (!pageCanvas) {
                        // Seamless fallback to html2canvas for this page (and remaining pages if platform unsupported)
                        let rawCanvas = await this.captureElementToCanvas(
                            batchWrapper,
                            renderRoot,
                            bgHex,
                            captureScale,
                            pageContentWidthPx,
                            colorCache,
                            fontCache,
                            imageCanvasesById
                        );
                        pageCanvas = this.toOpaqueCanvas(rawCanvas, bgHex);
                        rawCanvas.width = 0;
                        rawCanvas.height = 0;

                        // Defensive blank-page guard on html2canvas fallback (retries once if WebView dropped a frame)
                        const fallbackHasText = (mounted.pageWrapper.textContent || '').trim().length > 0;
                        const fallbackCtx = pageCanvas.getContext('2d');
                        if (fallbackHasText && fallbackCtx && !this.canvasHasNonBgPixels(fallbackCtx, pageCanvas.width, pageCanvas.height, bgColor)) {
                            await new Promise<void>(r => window.setTimeout(r, 60));
                            await this.yieldFrameSafe(32);
                            pageCanvas.width = 0;
                            pageCanvas.height = 0;
                            rawCanvas = await this.captureElementToCanvas(
                                batchWrapper,
                                renderRoot,
                                bgHex,
                                captureScale,
                                pageContentWidthPx,
                                colorCache,
                                fontCache,
                                imageCanvasesById
                            );
                            pageCanvas = this.toOpaqueCanvas(rawCanvas, bgHex);
                            rawCanvas.width = 0;
                            rawCanvas.height = 0;
                        }
                    }

                    if (shouldCancel?.()) {
                        pageCanvas.width = 0;
                        pageCanvas.height = 0;
                        batchWrapper.remove();
                        return null;
                    }

                    const ok = await emitPageCanvasToPdf(
                        pageCanvas,
                        mounted.page,
                        mounted.markerOffsets,
                        mounted.textSpans,
                        mounted.annotations,
                        mounted.unbreakableRanges
                    );
                    pageCanvas.width = 0;
                    pageCanvas.height = 0;
                    batchWrapper.remove();
                    if (!ok) return null;

                    cursorIdx++;
                    onProgress?.(cursorIdx, pages.length);

                    // Background-safe yield so Obsidian UI stays responsive and never stalls when occluded
                    if (cursorIdx < pages.length) {
                        if (perf.pageYieldMs > 0) {
                            await new Promise(r => window.setTimeout(r, perf.pageYieldMs));
                        } else {
                            await this.yieldFrameSafe(16);
                        }
                    }
                    continue;
                }

                // Fallback path: memory-safe batched html2canvas (used only when platform lacks <foreignObject>)
                // Keep each batch uniform in orientation and content scale so CSS widths never collide.
                const batchIsLandscape = !!pages[cursorIdx].isLandscape;
                const batchScaleOverride = pages[cursorIdx].contentScaleOverride;
                const batchLayout = resolvePageLayout(batchIsLandscape, batchScaleOverride);
                setRootLayout(batchLayout);
                const batchWrapper = renderRoot.createDiv({ cls: 'pdf-batch-wrapper' });
                batchWrapper.style.backgroundColor = bgHex;
                const mountedBatch: MountedBatchPage[] = [];
                let batchCssHeight = 0;

                while (cursorIdx < pages.length && mountedBatch.length < perf.maxBatchPages) {
                    if (shouldCancel?.()) {
                        batchWrapper.remove();
                        return null;
                    }
                    if (
                        mountedBatch.length > 0 &&
                        (!!pages[cursorIdx].isLandscape !== batchIsLandscape || pages[cursorIdx].contentScaleOverride !== batchScaleOverride)
                    ) {
                        break;
                    }

                    const mounted = await mountAndStabilizePage(batchWrapper, cursorIdx);
                    const pageCssH = Math.max(1, Math.ceil(mounted.pageWrapper.getBoundingClientRect().height));
                    const projectedCanvasH = Math.ceil((batchCssHeight + (mountedBatch.length > 0 ? batchGapCssPx : 0) + pageCssH) * captureScale);

                    if (mountedBatch.length > 0 && projectedCanvasH > perf.maxBatchCanvasHeightPx) {
                        mounted.pageWrapper.remove();
                        break;
                    }

                    batchCssHeight += (mountedBatch.length > 0 ? batchGapCssPx : 0) + pageCssH;
                    mountedBatch.push({
                        pageIdx: cursorIdx,
                        page: mounted.page,
                        pageWrapper: mounted.pageWrapper,
                        pageSizer: mounted.pageSizer,
                        markerOffsets: mounted.markerOffsets,
                        textSpans: mounted.textSpans,
                        annotations: mounted.annotations,
                        unbreakableRanges: mounted.unbreakableRanges
                    });
                    cursorIdx++;
                }

                if (mountedBatch.length === 0) {
                    batchWrapper.remove();
                    break;
                }

                if (!hasAsyncWidgets) {
                    await this.yieldFrameSafe(20);
                }

                const batchRect = batchWrapper.getBoundingClientRect();
                const pageSliceRects = mountedBatch.map((item) => {
                    const r = item.pageWrapper.getBoundingClientRect();
                    return {
                        sy: Math.max(0, Math.round((r.top - batchRect.top) * captureScale)),
                        sh: Math.max(1, Math.round(r.height * captureScale))
                    };
                });

                const batchCanvas = await this.captureElementToCanvas(
                    batchWrapper,
                    renderRoot,
                    bgHex,
                    captureScale,
                    batchLayout.contentWidthPx,
                    colorCache,
                    fontCache,
                    mountedBatch.length === 1 ? imageCanvasesById : undefined
                );

                if (shouldCancel?.()) {
                    batchCanvas.width = 0;
                    batchCanvas.height = 0;
                    batchWrapper.remove();
                    return null;
                }

                if (mountedBatch.length === 1) {
                    const opaqueCanvas = this.toOpaqueCanvas(batchCanvas, bgHex);
                    batchCanvas.width = 0;
                    batchCanvas.height = 0;
                    const ok = await emitPageCanvasToPdf(
                        opaqueCanvas,
                        mountedBatch[0].page,
                        mountedBatch[0].markerOffsets,
                        mountedBatch[0].textSpans,
                        mountedBatch[0].annotations,
                        mountedBatch[0].unbreakableRanges
                    );
                    opaqueCanvas.width = 0;
                    opaqueCanvas.height = 0;
                    batchWrapper.remove();
                    if (!ok) return null;
                    onProgress?.(cursorIdx, pages.length);
                } else {
                    for (let bIdx = 0; bIdx < mountedBatch.length; bIdx++) {
                        if (shouldCancel?.()) {
                            batchCanvas.width = 0;
                            batchCanvas.height = 0;
                            batchWrapper.remove();
                            return null;
                        }
                        const item = mountedBatch[bIdx];
                        const rectInfo = pageSliceRects[bIdx];
                        const sy = Math.min(Math.max(0, batchCanvas.height - 1), rectInfo.sy);
                        const sh = Math.max(1, Math.min(batchCanvas.height - sy, rectInfo.sh));

                        const pageCanvas = createEl('canvas');
                        pageCanvas.width = batchCanvas.width;
                        pageCanvas.height = sh;
                        const pCtx = pageCanvas.getContext('2d', { alpha: false });
                        if (pCtx) {
                            pCtx.fillStyle = bgHex;
                            pCtx.fillRect(0, 0, pageCanvas.width, pageCanvas.height);
                            pCtx.drawImage(batchCanvas, 0, sy, batchCanvas.width, sh, 0, 0, pageCanvas.width, sh);
                        }
                        if (imageCanvasesById.size > 0) {
                            this.compositeImagesOntoCanvas(pageCanvas, item.pageWrapper, captureScale, imageCanvasesById);
                        }
                        const ok = await emitPageCanvasToPdf(
                            pageCanvas,
                            item.page,
                            item.markerOffsets,
                            item.textSpans,
                            item.annotations,
                            item.unbreakableRanges
                        );
                        pageCanvas.width = 0;
                        pageCanvas.height = 0;
                        if (!ok) {
                            batchCanvas.width = 0;
                            batchCanvas.height = 0;
                            batchWrapper.remove();
                            return null;
                        }
                        onProgress?.(item.pageIdx + 1, pages.length);
                    }

                    batchCanvas.width = 0;
                    batchCanvas.height = 0;
                    batchWrapper.remove();
                }

                if (cursorIdx < pages.length) {
                    if (perf.pageYieldMs > 0) {
                        await new Promise(r => window.setTimeout(r, perf.pageYieldMs));
                    } else {
                        await this.yieldFrameSafe(20);
                    }
                }
            }

            if (appendTarget) {
                // Ensure even a completely blank note gets its own page & chapter marker in a merged PDF
                if (emittedPdfPages === startingPdfPages) {
                    this.ensurePdfPageOrientation(doc, emittedPdfPages, layout);
                    emittedPdfPages++;
                    doc.setFillColor(bgColor[0], bgColor[1], bgColor[2]);
                    doc.rect(0, 0, pageWidth, pageHeight, 'F');
                    recordEmittedSlice(emittedPdfPages, 0, Infinity, { headings: [], anchors: [], links: [] }, layout);
                }
                appendTarget.outTheme = { bgColor, textColor, bgHex, footerFontFamily };
                appendTarget.outEmittedPages = emittedPdfPages;
                return new ArrayBuffer(0);
            }

            if (shouldCacheSlices && !sliceCacheOverflowed) {
                this.previewRenderCache = {
                    docKey: cacheDocKey,
                    breakLines,
                    pages: newCachedPages,
                    bgColor,
                    textColor,
                    bgHex,
                    footerFontFamily,
                    captureScale
                };
            }
            if (isPreview) {
                this.lastReusedPreviewPages = reusedPrefixPages;
            }

            this.prependTocPagesToDoc(
                doc,
                emittedSlicesMeta,
                deferredLineNumbers,
                effectiveTextLayerFont,
                isCustomUnicodeFont,
                margin,
                topMargin,
                pageWidth,
                pageHeight,
                contentWidthMm,
                contentWidthPx,
                maxPageContentPx,
                mmPerPx,
                captureScale,
                bgColor,
                textColor,
                bgHex,
                footerFontFamily,
                false,
                layout.format,
                layout.orientation
            );

            this.applyPdfLinksAndOutline(
                doc,
                emittedSlicesMeta,
                margin,
                topMargin,
                pageWidth,
                pageHeight,
                mmPerPx
            );

            // Stamp footnotes with a fresh finish timestamp so clicking Generate immediately after
            // preview hits the ready-to-save export cache even if a minute rolled over mid-render.
            const footNow = moment();
            const footOk = this.appendFootnotesToDoc(
                doc,
                file,
                activeJsPdfFont,
                margin,
                pageHeight,
                bottomMargin,
                contentWidthMm,
                contentWidthPx,
                mmPerPx,
                captureScale,
                bgHex,
                textColor,
                footerFontFamily,
                footNow,
                shouldCancel
            );
            if (!footOk) return null;

            // ALWAYS cache the clean export-ready PDF (without preview line numbers) BEFORE adding
            // preview-only line numbers, so clicking Generate after Preview is always instant!
            const cleanBuffer = doc.output("arraybuffer");
            if (allowExportCacheReuse) {
                this.cachedExportPdf = { key: buildExportBufferKey(footNow), buffer: cleanBuffer };
            }

            if (!showLineNumbers || deferredLineNumbers.length === 0) {
                return cleanBuffer;
            }

            for (const item of deferredLineNumbers) {
                doc.setPage(item.pdfPageNum);
                drawLineNumbersOnPage(item.markerOffsets, item.singleSlice, item.mmPerPx ?? mmPerPx);
            }
            return doc.output("arraybuffer");
        } finally {
            imageCanvasesById.forEach(c => {
                c.width = 0;
                c.height = 0;
            });
            imageCanvasesById.clear();
            try { cleanupRealView?.(); } catch { /* ignore */ }
            renderComponent.unload();
            renderRoot.remove();
        }
    }

    async exportToPdf(settingsOverride?: PdfPluginSettings) {
        const file = this.getTargetMarkdownFile();
        if (!file) {
            new Notice('Please open a Markdown note to export.');
            return;
        }
        const effectiveSettings = settingsOverride
            ? this.cloneSettings(settingsOverride)
            : this.cloneSettings(this.globalSettings);
        const defaultExportPathSnapshot = effectiveSettings.defaultExportPath || '';

        const { promise } = this.enqueueWorkJob({
            kind: 'note',
            label: `Note "${file.basename}"`,
            notifyIfQueued: true,
            run: async (ctrl) => {
                const progress = this.createBatchProgressNotice(
                    `Exporting "${file.basename}"`,
                    1,
                    () => ctrl.cancel()
                );
                try {
                    progress.update(0, 'Generating PDF...', 'Starting...');
                    const pdfOutput = await this.runWithSettings(effectiveSettings, async () =>
                        await this.generatePdfData(file, false, {
                            isPreview: false,
                            allowExportCacheReuse: true,
                            shouldCancel: () => ctrl.isCancelled(),
                            onProgress: (current, total) => {
                                if (!ctrl.isCancelled()) {
                                    const frac = total > 0 ? current / total : 0;
                                    progress.update(frac, `Rendering page ${current}/${total}...`, `Page ${current} / ${total}`);
                                }
                            }
                        })
                    );
                    const elapsedMs = progress.getElapsedMs();
                    if (ctrl.isCancelled()) {
                        progress.hide();
                        new Notice(`PDF export stopped (${this.formatDurationShort(elapsedMs)}).`);
                        return;
                    }
                    if (!pdfOutput) return;

                    let folderPath = file.parent ? file.parent.path : "";
                    if (defaultExportPathSnapshot && defaultExportPathSnapshot.trim() !== '') {
                        folderPath = defaultExportPathSnapshot.trim().replace(/^\/+|\/+$/g, '');

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
                    progress.hide();
                    new Notice(`Saved to ${pdfPath}`);
                    let pdfTFile = this.app.vault.getAbstractFileByPath(pdfPath);
                    for (let attempt = 0; !pdfTFile && attempt < 10; attempt++) {
                        await new Promise(r => window.setTimeout(r, 50));
                        pdfTFile = this.app.vault.getAbstractFileByPath(pdfPath);
                    }
                    if (pdfTFile instanceof TFile) {
                        await this.app.workspace.getLeaf(true).openFile(pdfTFile);
                    }
                } catch (e) {
                    progress.hide();
                    if (!ctrl.isCancelled()) {
                        console.error('Error saving PDF:', e);
                        new Notice('Error saving PDF: ' + e);
                    }
                } finally {
                    progress.hide();
                }
            }
        });
        await promise;
    }

    syncSidebarFromGlobalSettings(changedKeys?: Array<keyof PdfPluginSettings>): void {
        this.clearRenderCache();
        const keysToSync = changedKeys ?? SHARED_SIDEBAR_SETTING_KEYS;
        let sidebarMutated = false;
        for (const key of keysToSync) {
            if (!SHARED_SIDEBAR_SETTING_KEYS.includes(key)) continue;
            if (!this.sidebarOverriddenKeys.has(key)) {
                if (!this.areSettingValuesEqual(key, this.sidebarSettings, this.globalSettings)) {
                    const val = this.globalSettings[key];
                    (this.sidebarSettings as unknown as Record<string, unknown>)[key] = Array.isArray(val) ? [...val] : val;
                    sidebarMutated = true;
                }
            } else if (this.areSettingValuesEqual(key, this.sidebarSettings, this.globalSettings)) {
                this.sidebarOverriddenKeys.delete(key);
            }
        }
        const sidebarView = this.getSidebarView();
        if (sidebarView) {
            if (sidebarMutated) {
                void sidebarView.display(this.globalSettings.autoRegeneratePreview);
            } else {
                sidebarView.updateOverrideBanner();
            }
        }
    }

    private normalizeFuzzyPathText(text: string): string {
        return text
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .toLowerCase();
    }

    /**
     * Scores an ordered fuzzy subsequence match of `needle` inside `haystack` (e.g. "ananotes"
     * matching "anatomia notes", or "anamic" matching "anatomia notes/anatomia microscopica.md").
     * Lower return value = better match; returns null if not all characters appear in order.
     */
    private scoreFuzzySubsequence(haystack: string, needle: string): number | null {
        if (!needle) return 0;
        if (needle.length > haystack.length) return null;

        const isBoundary = (idx: number): boolean => {
            if (idx === 0) return true;
            const prev = haystack.charCodeAt(idx - 1);
            // '/', ' ', '-', '_', '.', '(', '[', '+'
            return prev === 47 || prev === 32 || prev === 45 || prev === 95 || prev === 46 || prev === 40 || prev === 91 || prev === 43;
        };

        // Greedy-with-boundary-preference search: for each character of needle, try to keep
        // consecutive runs or land on word/path boundaries, ensuring a valid tail match exists.
        const matchIndices: number[] = [];
        let searchFrom = 0;
        for (let i = 0; i < needle.length; i++) {
            const ch = needle[i];
            const firstPos = haystack.indexOf(ch, searchFrom);
            if (firstPos === -1) return null;

            let chosen = firstPos;
            // If previous char was matched immediately before firstPos, keep the contiguous run
            const isContiguous = i > 0 && firstPos === matchIndices[i - 1] + 1;
            if (!isContiguous && !isBoundary(firstPos)) {
                // Look ahead for a word-boundary match of `ch` that still leaves room for the rest of needle
                let probe = haystack.indexOf(ch, firstPos + 1);
                while (probe !== -1 && haystack.length - probe >= needle.length - i) {
                    if (isBoundary(probe)) {
                        // Verify remaining chars still match in order from probe + 1
                        let tailPos = probe + 1;
                        let tailOk = true;
                        for (let j = i + 1; j < needle.length; j++) {
                            const nextPos = haystack.indexOf(needle[j], tailPos);
                            if (nextPos === -1) {
                                tailOk = false;
                                break;
                            }
                            tailPos = nextPos + 1;
                        }
                        if (tailOk) {
                            chosen = probe;
                            break;
                        }
                        break;
                    }
                    probe = haystack.indexOf(ch, probe + 1);
                }
            }

            matchIndices.push(chosen);
            searchFrom = chosen + 1;
        }

        let gaps = 0;
        let boundaryHits = 0;
        let consecutiveHits = 0;
        for (let i = 0; i < matchIndices.length; i++) {
            const pos = matchIndices[i];
            if (isBoundary(pos)) boundaryHits++;
            if (i > 0) {
                const diff = pos - matchIndices[i - 1] - 1;
                if (diff === 0) {
                    consecutiveHits++;
                } else {
                    gaps += diff;
                }
            }
        }

        const span = matchIndices[matchIndices.length - 1] - matchIndices[0] + 1;
        const startOffset = matchIndices[0];
        // Normalize into a small fractional penalty [0..4) so fuzzy matches sort cleanly after exact/token hits
        const penalty =
            Math.min(1.5, gaps * 0.04) +
            Math.min(1.0, (span - needle.length) * 0.025) +
            Math.min(0.6, startOffset * 0.01) -
            Math.min(0.5, boundaryHits * 0.08) -
            Math.min(0.4, consecutiveHits * 0.05);
        return Math.max(0, 1 + penalty);
    }

    scoreTokenPathMatch(pathLower: string, cleanedQuery: string, tokens: string[]): number | null {
        if (tokens.length === 0) return 1;

        const normPath = this.normalizeFuzzyPathText(pathLower);
        const normQuery = this.normalizeFuzzyPathText(cleanedQuery);
        const normTokens = tokens.map(t => this.normalizeFuzzyPathText(t)).filter(Boolean);
        if (normTokens.length === 0) return 1;

        const lastSlash = normPath.lastIndexOf('/');
        const leafLower = lastSlash >= 0 ? normPath.slice(lastSlash + 1) : normPath;

        if (normTokens.every(t => normPath.includes(t))) {
            if (normPath.startsWith(normQuery)) return 0;
            if (normTokens.length === 1 && (leafLower.startsWith(normTokens[0]) || normPath.includes('/' + normTokens[0]))) {
                return 1;
            }
            if (normPath.includes(normQuery)) return 2;

            // Check if tokens appear sequentially in the path (e.g. "99 pdf" in "99 - Plugins/Output/PDF")
            let searchFrom = 0;
            let ordered = true;
            for (const t of normTokens) {
                const foundAt = normPath.indexOf(t, searchFrom);
                if (foundAt === -1) {
                    ordered = false;
                    break;
                }
                searchFrom = foundAt + t.length;
            }
            return ordered ? 3 : 4;
        }

        // Non-exact fuzzy matching: supports compact queries like "ananotes" -> "Anatomia NOTES"
        // as well as multi-token fuzzy queries like "ana mic" -> "Anatomia NOTES/ANATOMIA MICROSCOPICA".
        const compactQuery = normQuery.replace(/[\s/\\_-]+/g, '');
        if (!compactQuery) return null;

        // 1. Prefer fuzzy subsequence match directly inside the leaf name (folder/note name)
        const leafScore = this.scoreFuzzySubsequence(leafLower, compactQuery);
        if (leafScore !== null) {
            return 5 + leafScore * 0.25;
        }

        // 2. Fuzzy subsequence match across the full vault path (ordered)
        const fullScore = this.scoreFuzzySubsequence(normPath, compactQuery);
        if (fullScore !== null) {
            return 6 + fullScore * 0.25;
        }

        // 3. Unordered multi-token fuzzy fallback (every token fuzzy-matches somewhere in the path)
        if (normTokens.length > 1) {
            let tokenSum = 0;
            for (const t of normTokens) {
                const tc = t.replace(/[\s/\\_-]+/g, '');
                if (!tc) continue;
                const ts = this.scoreFuzzySubsequence(normPath, tc);
                if (ts === null) return null;
                tokenSum += ts;
            }
            return 7 + Math.min(2, tokenSum * 0.15);
        }

        return null;
    }

    getMatchingFolderSuggestions(queryRaw: string, maxResults: number = 30): Array<{ value: string; label: string }> {
        const folders = this.app.vault
            .getAllLoadedFiles()
            .filter((f): f is TFolder => f instanceof TFolder && !f.isRoot() && f.path !== '/' && f.path !== '')
            .map(f => f.path)
            .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));

        const trimmed = queryRaw.trim();
        const cleaned = trimmed.replace(/^\/+/, '').toLowerCase();
        const tokens = cleaned.split(/\s+/).filter(Boolean);

        const candidates: Array<{ value: string; label: string; rank: number }> = [];
        if (trimmed === '' || trimmed === '/' || tokens.length === 0) {
            candidates.push({ value: '/', label: '/ (Vault root)', rank: 0 });
        }

        for (const path of folders) {
            const rank = this.scoreTokenPathMatch(path.toLowerCase(), cleaned, tokens);
            if (rank !== null) {
                candidates.push({ value: path, label: path, rank });
            }
        }

        candidates.sort((a, b) => a.rank - b.rank || a.label.localeCompare(b.label, undefined, { sensitivity: 'base' }));
        return candidates.slice(0, maxResults).map(({ value, label }) => ({ value, label }));
    }

    getMatchingTtfSuggestions(queryRaw: string): Array<{ value: string; label: string }> {
        const cleaned = queryRaw.trim().replace(/^\/+/, '').toLowerCase();
        const tokens = cleaned.split(/\s+/).filter(Boolean);
        const ttfFiles = this.app.vault
            .getFiles()
            .filter(f => f.extension.toLowerCase() === 'ttf' || f.name.toLowerCase().endsWith('.ttf'))
            .map(f => f.path)
            .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));

        const candidates: Array<{ value: string; label: string; rank: number }> = [];
        for (const path of ttfFiles) {
            const rank = this.scoreTokenPathMatch(path.toLowerCase(), cleaned, tokens);
            if (rank !== null) {
                candidates.push({ value: path, label: path, rank: tokens.length === 0 ? 0 : rank });
            }
        }
        candidates.sort((a, b) => a.rank - b.rank || a.label.localeCompare(b.label, undefined, { sensitivity: 'base' }));
        return candidates.slice(0, 25).map(({ value, label }) => ({ value, label }));
    }

    attachPathAutocompleteToElement(
        anchorEl: HTMLElement,
        inputEl: HTMLInputElement,
        getSuggestions: (query: string) => Array<{ value: string; label: string }>,
        onSelect: (value: string) => void | Promise<void>,
        emptyHint?: string
    ) {
        const suggestList = createDiv({ cls: 'pdf-autocomplete-list pdf-path-suggest-list' });
        anchorEl.insertAdjacentElement('afterend', suggestList);

        let currentItems: Array<{ value: string; label: string }> = [];
        let activeIdx = -1;
        let blurCloseTimer: number | null = null;

        const hideList = () => {
            suggestList.removeClass('is-visible');
            suggestList.empty();
            currentItems = [];
            activeIdx = -1;
        };

        const highlightRow = (idx: number) => {
            const rows = Array.from(suggestList.children).filter((c): c is HTMLElement => c.instanceOf(HTMLElement));
            rows.forEach((row, i) => {
                row.toggleClass('is-active', i === idx);
            });
            if (idx >= 0 && rows[idx]) {
                rows[idx].scrollIntoView({ block: 'nearest' });
            }
        };

        const renderSuggestions = () => {
            if (blurCloseTimer !== null) {
                window.clearTimeout(blurCloseTimer);
                blurCloseTimer = null;
            }
            const items = getSuggestions(inputEl.value);
            currentItems = items;
            activeIdx = -1;
            suggestList.empty();

            if (items.length === 0) {
                if (emptyHint) {
                    suggestList.createDiv({ cls: 'pdf-path-suggest-hint', text: emptyHint });
                    suggestList.addClass('is-visible');
                    return;
                }
                hideList();
                return;
            }

            items.forEach((item, idx) => {
                const row = suggestList.createDiv({ cls: 'pdf-path-suggest-row', text: item.label });

                row.addEventListener('mouseenter', () => {
                    activeIdx = idx;
                    highlightRow(idx);
                });

                const pick = (e: Event) => {
                    e.preventDefault();
                    e.stopPropagation();
                    if (blurCloseTimer !== null) {
                        window.clearTimeout(blurCloseTimer);
                        blurCloseTimer = null;
                    }
                    inputEl.value = item.value;
                    void (async () => {
                        await onSelect(item.value);
                        hideList();
                    })();
                };

                row.addEventListener('mousedown', pick);
                row.addEventListener('pointerdown', (e) => {
                    if (e.pointerType !== 'mouse') {
                        pick(e);
                    }
                });
            });

            suggestList.addClass('is-visible');
        };

        inputEl.addEventListener('focus', renderSuggestions);
        inputEl.addEventListener('click', renderSuggestions);
        inputEl.addEventListener('input', renderSuggestions);
        inputEl.addEventListener('keydown', (e) => {
            if (!suggestList.hasClass('is-visible') || currentItems.length === 0) return;
            if (e.key === 'ArrowDown') {
                e.preventDefault();
                activeIdx = (activeIdx + 1) % currentItems.length;
                highlightRow(activeIdx);
            } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                activeIdx = activeIdx <= 0 ? currentItems.length - 1 : activeIdx - 1;
                highlightRow(activeIdx);
            } else if (e.key === 'Enter' && activeIdx >= 0 && currentItems[activeIdx]) {
                e.preventDefault();
                const chosen = currentItems[activeIdx];
                inputEl.value = chosen.value;
                void (async () => {
                    await onSelect(chosen.value);
                    hideList();
                })();
            } else if (e.key === 'Escape') {
                hideList();
            }
        });
        inputEl.addEventListener('blur', () => {
            blurCloseTimer = window.setTimeout(hideList, 180);
        });
    }

    attachPathAutocomplete(
        setting: Setting,
        inputEl: HTMLInputElement,
        getSuggestions: (query: string) => Array<{ value: string; label: string }>,
        onSelect: (value: string) => void | Promise<void>,
        emptyHint?: string
    ) {
        this.attachPathAutocompleteToElement(setting.settingEl, inputEl, getSuggestions, onSelect, emptyHint);
    }

    private async ensureFolderPath(folderPath: string): Promise<void> {
        const cleaned = folderPath.trim().replace(/^\/+|\/+$/g, '');
        if (!cleaned) return;
        const parts = cleaned.split('/').filter(Boolean);
        let current = '';
        for (const part of parts) {
            current = current ? `${current}/${part}` : part;
            const exists = await this.app.vault.adapter.exists(current);
            if (!exists) {
                try {
                    await this.app.vault.createFolder(current);
                } catch (e) {
                    // Ignore race condition if folder was created concurrently
                    const existsNow = await this.app.vault.adapter.exists(current);
                    if (!existsNow) throw e;
                }
            }
        }
    }

    private resolveFolderOutputRoot(sourceFolder: TFolder): string {
        const isRoot = sourceFolder.isRoot() || sourceFolder.path === '' || sourceFolder.path === '/';
        const configuredRaw = (this.settings.folderExportPath || '').trim();
        const vaultLabel = `${this.app.vault.getName() || 'Vault'} (PDF)`;

        if (configuredRaw !== '') {
            const baseExport = configuredRaw.replace(/^\/+|\/+$/g, '');
            const rootName = isRoot ? vaultLabel : sourceFolder.name;
            const candidate = baseExport === '' ? rootName : `${baseExport}/${rootName}`;
            if (!isRoot && candidate.toLowerCase() === sourceFolder.path.toLowerCase()) {
                return `${candidate} (PDF)`;
            }
            return candidate;
        }

        // Empty folderExportPath: create a sibling folder "<FolderName> (PDF)"
        if (isRoot) {
            return vaultLabel;
        }
        const parentPath = sourceFolder.parent && !sourceFolder.parent.isRoot() ? sourceFolder.parent.path : '';
        const siblingName = `${sourceFolder.name} (PDF)`;
        return parentPath ? `${parentPath}/${siblingName}` : siblingName;
    }

    private collectMarkdownFilesRecursive(folder: TFolder, skipFolderPath?: string): TFile[] {
        const skipLower = skipFolderPath ? skipFolderPath.replace(/^\/+|\/+$/g, '').toLowerCase() : '';
        const results: TFile[] = [];

        const walk = (dir: TFolder) => {
            const children = [...dir.children].sort((a, b) =>
                a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
            );
            for (const child of children) {
                if (child instanceof TFolder) {
                    const childLower = child.path.replace(/^\/+|\/+$/g, '').toLowerCase();
                    if (skipLower && (childLower === skipLower || childLower.startsWith(skipLower + '/'))) {
                        continue;
                    }
                    walk(child);
                } else if (child instanceof TFile && child.extension.toLowerCase() === 'md') {
                    results.push(child);
                }
            }
        };

        walk(folder);
        return results;
    }

    private formatDurationShort(ms: number): string {
        const totalSec = Math.max(0, ms / 1000);
        if (totalSec >= 60) {
            const mins = Math.floor(totalSec / 60);
            const secs = Math.floor(totalSec % 60);
            return `${mins}m ${String(secs).padStart(2, '0')}s`;
        }
        return `${totalSec.toFixed(1)}s`;
    }

    /**
     * Creates a non-blocking interactive progress Notice with a progress bar, elapsed timer,
     * live note/page status, and a Stop button that works cleanly on both Desktop and Mobile.
     */
    private createBatchProgressNotice(
        title: string,
        totalSteps: number,
        onStop: () => void
    ): {
        update: (completedSteps: number, detail: string, subStatus?: string) => void;
        setTitle: (newTitle: string) => void;
        setTotal: (newTotal: number) => void;
        getElapsedMs: () => number;
        hide: () => void;
    } {
        const startMs = performance.now();
        let currentTotalSteps = Math.max(1, totalSteps);
        const frag = activeDocument.createDocumentFragment();
        const root = createDiv({ cls: 'pdf-batch-notice-root' });

        const header = root.createDiv({ cls: 'pdf-batch-notice-header' });
        const titleEl = header.createEl('strong', { cls: 'pdf-batch-notice-title', text: title });
        const timerEl = header.createSpan({ cls: 'pdf-batch-notice-timer', text: '0.0s' });

        const barTrack = root.createDiv({ cls: 'pdf-batch-notice-track' });
        const barFill = barTrack.createDiv({ cls: 'pdf-batch-notice-fill' });

        const detailEl = root.createDiv({
            cls: 'pdf-batch-notice-detail',
            text: `Preparing (0/${currentTotalSteps})...`
        });

        const footer = root.createDiv({ cls: 'pdf-batch-notice-footer' });
        const subStatusEl = footer.createSpan({
            cls: 'pdf-batch-notice-substatus',
            text: `0 / ${currentTotalSteps}`
        });

        const stopBtn = footer.createEl('button', {
            cls: 'mod-warning pdf-batch-notice-stop-btn',
            attr: { type: 'button' }
        });
        const stopIcon = stopBtn.createSpan({ cls: 'pdf-batch-notice-icon' });
        setIcon(stopIcon, 'square');
        const stopLabel = stopBtn.createSpan({ text: 'Stop' });
        stopBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            stopBtn.disabled = true;
            stopLabel.textContent = 'Stopping...';
            onStop();
        });

        // Live queue indicator row (only shown when additional exports/previews are waiting in the queue)
        const queueRow = root.createDiv({ cls: 'pdf-batch-notice-queue-row' });
        const queueTextEl = queueRow.createSpan({ cls: 'pdf-batch-notice-queue-text' });
        const clearQueueBtn = queueRow.createEl('button', {
            cls: 'pdf-batch-notice-clear-btn',
            text: 'Clear',
            attr: { type: 'button', title: 'Clear waiting jobs from the queue' }
        });
        clearQueueBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            const cleared = this.clearWorkQueue(false);
            if (cleared > 0) {
                new Notice(`Cleared ${cleared} queued PDF job${cleared === 1 ? '' : 's'}.`);
            }
        });

        const refreshQueueRow = () => {
            const pendingCount = this.workQueue.length;
            if (pendingCount > 0) {
                const nextLabel = this.workQueue[0].label;
                queueTextEl.textContent = `Queue (${pendingCount}): Next → ${nextLabel}`;
                queueTextEl.title = this.workQueue.map((item, idx) => `${idx + 1}. ${item.label}`).join('\n');
                queueRow.addClass('is-visible');
            } else {
                queueRow.removeClass('is-visible');
            }
        };
        refreshQueueRow();
        const unsubscribeQueue = this.onQueueStateChange(refreshQueueRow);

        frag.appendChild(root);

        const notice = new Notice(frag, 0);
        const timerInterval = window.setInterval(() => {
            timerEl.textContent = this.formatDurationShort(performance.now() - startMs);
        }, 250);

        let hidden = false;
        return {
            update: (completedSteps: number, detail: string, subStatus?: string) => {
                const pct = currentTotalSteps > 0 ? Math.max(0, Math.min(100, (completedSteps / currentTotalSteps) * 100)) : 0;
                barFill.style.width = `${pct.toFixed(1)}%`;
                detailEl.textContent = detail;
                if (subStatus !== undefined) {
                    subStatusEl.textContent = subStatus;
                }
            },
            setTitle: (newTitle: string) => {
                titleEl.textContent = newTitle;
            },
            setTotal: (newTotal: number) => {
                currentTotalSteps = Math.max(1, newTotal);
            },
            getElapsedMs: () => performance.now() - startMs,
            hide: () => {
                if (hidden) return;
                hidden = true;
                unsubscribeQueue();
                window.clearInterval(timerInterval);
                notice.hide();
            }
        };
    }

    async exportFolderToPdfs(sourceFolder: TFolder): Promise<void> {
        const isRoot = sourceFolder.isRoot() || sourceFolder.path === '' || sourceFolder.path === '/';
        const folderName = isRoot ? (this.app.vault.getName() || 'Vault') : sourceFolder.name;
        const sourcePrefix = isRoot ? '' : sourceFolder.path.replace(/^\/+|\/+$/g, '');
        const outputRoot = this.resolveFolderOutputRoot(sourceFolder);
        const initialMarkdownFiles = this.collectMarkdownFilesRecursive(sourceFolder, outputRoot);

        if (initialMarkdownFiles.length === 0) {
            new Notice(`No Markdown files found in "${isRoot ? '/' : sourceFolder.path}".`);
            return;
        }

        const { promise } = this.enqueueWorkJob({
            kind: 'folder',
            label: `Folder "${folderName}" (${initialMarkdownFiles.length})`,
            notifyIfQueued: true,
            run: async (ctrl) => {
                // Re-verify files still exist when this queued job begins
                const markdownFiles = initialMarkdownFiles.filter(f => !!this.app.vault.getAbstractFileByPath(f.path));
                if (markdownFiles.length === 0) {
                    new Notice(`No Markdown files found in "${isRoot ? '/' : sourceFolder.path}".`);
                    return;
                }

                // Validate custom font once up front so batch export never spams repeated notices
                if (this.settings.fontFamily === 'custom' && this.settings.customFontPath && this.settings.customFontPath.trim() !== '') {
                    if (!this.resolveVaultFontFile(this.settings.customFontPath)) {
                        new Notice('Custom font file not found at: ' + this.settings.customFontPath);
                    }
                }

                const perf = this.getDevicePerfProfile();
                const total = markdownFiles.length;
                let successCount = 0;
                const failedFiles: string[] = [];

                const progress = this.createBatchProgressNotice(
                    `Exporting "${folderName}" to PDF files`,
                    total,
                    () => ctrl.cancel()
                );

                let elapsedMs: number;
                try {
                    for (let i = 0; i < total; i++) {
                        if (ctrl.isCancelled()) break;
                        const mdFile = markdownFiles[i];
                        const relPath = sourcePrefix && mdFile.path.startsWith(sourcePrefix + '/')
                            ? mdFile.path.slice(sourcePrefix.length + 1)
                            : mdFile.path;
                        const lastSlash = relPath.lastIndexOf('/');
                        const relDir = lastSlash >= 0 ? relPath.slice(0, lastSlash) : '';
                        const targetDir = relDir ? `${outputRoot}/${relDir}` : outputRoot;

                        const buildSubStatus = () =>
                            `Saved: ${successCount}${failedFiles.length > 0 ? ` · Failed: ${failedFiles.length}` : ''} / ${total}`;

                        progress.update(i, `${i + 1}/${total}: ${relPath}`, buildSubStatus());
                        const noteStartMs = performance.now();

                        try {
                            const pdfOutput = await this.generatePdfData(mdFile, false, {
                                isPreview: false,
                                ignorePageBreaks: true,
                                suppressFontNotice: true,
                                shouldCancel: () => ctrl.isCancelled(),
                                onProgress: (curPage, totPages) => {
                                    if (!ctrl.isCancelled()) {
                                        const frac = totPages > 0 ? i + (curPage / totPages) : i;
                                        progress.update(
                                            frac,
                                            `${i + 1}/${total}: ${relPath} (page ${curPage}/${totPages})`,
                                            buildSubStatus()
                                        );
                                    }
                                }
                            });
                            if (ctrl.isCancelled()) break;
                            if (!pdfOutput) {
                                failedFiles.push(mdFile.path);
                                continue;
                            }
                            await this.ensureFolderPath(targetDir);
                            const pdfPath = `${targetDir}/${mdFile.basename}.pdf`;
                            await this.app.vault.adapter.writeBinary(pdfPath, pdfOutput);
                            successCount++;
                            progress.update(i + 1, `${i + 1}/${total}: Saved ${mdFile.basename}.pdf`, buildSubStatus());
                        } catch (fileErr) {
                            if (ctrl.isCancelled()) break;
                            console.error(`Error exporting "${mdFile.path}" to PDF:`, fileErr);
                            failedFiles.push(mdFile.path);
                        }

                        // Adaptive cooldown between notes based on device tier & how heavy the note was,
                        // keeping mobile / low-power devices responsive and preventing WebView OOM spikes.
                        if (i + 1 < total && !ctrl.isCancelled()) {
                            const noteElapsedMs = performance.now() - noteStartMs;
                            const adaptiveCooldownMs = Math.min(
                                perf.batchYieldMaxMs,
                                Math.max(perf.batchYieldBaseMs, Math.round(noteElapsedMs * 0.05))
                            );
                            await new Promise(r => window.setTimeout(r, adaptiveCooldownMs));
                        }
                    }
                    elapsedMs = progress.getElapsedMs();
                } finally {
                    progress.hide();
                }

                const timeText = this.formatDurationShort(elapsedMs);
                if (ctrl.isCancelled()) {
                    const skipped = Math.max(0, total - successCount - failedFiles.length);
                    new Notice(
                        `Folder export stopped (${timeText}): ${successCount}/${total} PDF${successCount === 1 ? '' : 's'} saved to ${outputRoot} (${skipped} skipped${failedFiles.length > 0 ? `, ${failedFiles.length} failed` : ''})`,
                        9000
                    );
                } else if (failedFiles.length === 0) {
                    new Notice(`Exported ${successCount} PDF${successCount === 1 ? '' : 's'} to ${outputRoot} (${timeText})`, 6000);
                } else {
                    new Notice(
                        `Exported ${successCount}/${total} PDFs to ${outputRoot} (${failedFiles.length} failed — see console, ${timeText})`,
                        8000
                    );
                }
            }
        });
        await promise;
    }

    private sanitizeOutputFilename(rawName: string, fallback: string = 'Merged Notes'): string {
        const cleaned = (rawName || '')
            .replace(/\.pdf$/i, '')
            .replace(/[\\/:*?"<>|]/g, '-')
            .replace(/\s+/g, ' ')
            .trim();
        return cleaned || fallback;
    }

    async exportFolderAsMergedPdf(sourceFolder: TFolder): Promise<void> {
        const isRoot = sourceFolder.isRoot() || sourceFolder.path === '' || sourceFolder.path === '/';
        const folderName = isRoot ? (this.app.vault.getName() || 'Vault') : sourceFolder.name;
        const markdownFiles = this.collectMarkdownFilesRecursive(sourceFolder);

        if (markdownFiles.length === 0) {
            new Notice(`No Markdown files found in "${isRoot ? '/' : sourceFolder.path}".`);
            return;
        }

        const configured = (this.settings.folderExportPath || '').trim();
        let outputDir = '';
        if (configured === '/' || configured === '.') {
            outputDir = '';
        } else if (configured !== '') {
            outputDir = configured.replace(/^\/+|\/+$/g, '');
        } else if (!isRoot) {
            outputDir = sourceFolder.parent && !sourceFolder.parent.isRoot()
                ? sourceFolder.parent.path.replace(/^\/+|\/+$/g, '')
                : '';
        }

        new MultiNoteMergeModal(this.app, this, {
            initialFiles: markdownFiles,
            defaultOutputName: folderName,
            defaultOutputDir: outputDir,
            title: `Merge "${folderName}" into a single PDF`,
            folderScopeMode: true
        }).open();
    }

    /**
     * Merges multiple Markdown notes into a single PDF document with automatic page breaks
     * between notes, each note as a top-level chapter in the PDF Document Outline and Page 1 Index,
     * unified page numbering, per-note footnote `{title}`, and cross-note clickable links.
     */
    async exportMergedPdf(files: TFile[], outputTitle: string, outputDir: string): Promise<void> {
        if (!files || files.length === 0) {
            new Notice('Please select at least one Markdown note to merge.');
            return;
        }

        const fileList = [...files];
        const safeBaseName = this.sanitizeOutputFilename(outputTitle, 'Merged Notes');
        const normalizedDir = (outputDir || '').trim().replace(/^\/+|\/+$/g, '');

        const { promise } = this.enqueueWorkJob({
            kind: 'merged',
            label: `Merged "${safeBaseName}" (${fileList.length})`,
            notifyIfQueued: true,
            run: async (ctrl) => {
                const activeFiles = fileList.filter(f => !!this.app.vault.getAbstractFileByPath(f.path));
                if (activeFiles.length === 0) {
                    new Notice('Merged PDF export failed: none of the selected notes still exist.');
                    return;
                }
                const layout = this.getPdfPageLayout();
                const captureScale = Platform.isMobile ? 1.75 : 2;
                const perf = this.getDevicePerfProfile();
                const total = activeFiles.length;

                const progress = this.createBatchProgressNotice(
                    `Merging "${safeBaseName}" (${total} note${total === 1 ? '' : 's'})`,
                    total,
                    () => ctrl.cancel()
                );

                let completedNotes = 0;
                const failedNotes: string[] = [];
                let savedPath: string | null = null;
                let finalPageCount = 0;
                let elapsedMs = 0;

                try {
                    const doc = new jsPDF({
                        orientation: layout.orientation,
                        unit: 'mm',
                        format: layout.format,
                        compress: true
                    });
                    const activeJsPdfFont = this.settings.fontFamily === 'custom' ? 'custom-font' : 'helvetica';
                    let cachedFont: { fontFile: TFile; fontName: string; base64: string } | null = null;
                    if (this.settings.fontFamily === 'custom' && this.settings.customFontPath && this.settings.customFontPath.trim() !== '') {
                        try {
                            cachedFont = await this.getCachedCustomFont();
                            if (cachedFont) {
                                doc.addFileToVFS(cachedFont.fontName, cachedFont.base64);
                                doc.addFont(cachedFont.fontName, activeJsPdfFont, 'normal', 'Identity-H');
                                doc.addFont(cachedFont.fontName, activeJsPdfFont, 'bold', 'Identity-H');
                                doc.addFont(cachedFont.fontName, activeJsPdfFont, 'italic', 'Identity-H');
                                doc.addFont(cachedFont.fontName, activeJsPdfFont, 'bolditalic', 'Identity-H');
                            } else {
                                new Notice('Custom font file not found at: ' + this.settings.customFontPath);
                            }
                        } catch (e) {
                            console.error('Error loading custom font:', e);
                            new Notice('Error loading custom font: ' + e);
                        }
                    }
                    const isCustomUnicodeFont = !!cachedFont;
                    const effectiveTextLayerFont = isCustomUnicodeFont ? activeJsPdfFont : 'helvetica';

                    // Build cross-note lookup map (paths, basenames, and frontmatter aliases)
                    const mergedNoteScopeMap = this.buildMergedNoteScopeMap(activeFiles);

                    const allEmittedSlices: EmittedPdfSliceMeta[] = [];
                    const pageTitlesByPage: string[] = [];
                    let existingPdfPages = 0;
                    const { cssFontFamily: mergedCssFontFamily } = this.buildFontCssFromCached('ObsidianPdfCustomFont', cachedFont);
                    const autoLandscapeEnabled = layout.orientation === 'p' && this.settings.autoLandscapeWidePages;
                    const landscapeLayout = autoLandscapeEnabled ? this.getPdfPageLayout('landscape') : layout;
                    const lockedTheme = this.captureExportThemeSnapshot(
                        mergedCssFontFamily,
                        layout.contentWidthPx,
                        autoLandscapeEnabled ? landscapeLayout.contentWidthPx : undefined
                    );
                    let themeSnapshot: { bgColor: number[]; textColor: number[]; bgHex: string; footerFontFamily: string } | null = {
                        bgColor: lockedTheme.bgColor,
                        textColor: lockedTheme.textColor,
                        bgHex: lockedTheme.bgHex,
                        footerFontFamily: lockedTheme.footerFontFamily
                    };

                    for (let i = 0; i < total; i++) {
                        if (ctrl.isCancelled()) break;
                        const mdFile = activeFiles[i];
                        const buildSubStatus = () =>
                            `Merged: ${completedNotes}/${total} · ${existingPdfPages} page${existingPdfPages === 1 ? '' : 's'}`;

                        progress.update(i, `${i + 1}/${total}: ${mdFile.basename}`, buildSubStatus());
                        const noteStartMs = performance.now();

                        try {
                            const appendTarget: MergedAppendTarget = {
                                doc,
                                layout,
                                existingPdfPages,
                                emittedSlicesMeta: allEmittedSlices,
                                noteScopeId: `n${i}`,
                                mergedNoteScopeMap,
                                pageTitlesByPage,
                                cachedFont,
                                isCustomUnicodeFont,
                                effectiveTextLayerFont,
                                lockedTheme
                            };
                            const res = await this.generatePdfData(mdFile, false, {
                                isPreview: false,
                                ignorePageBreaks: true,
                                suppressFontNotice: true,
                                allowExportCacheReuse: false,
                                shouldCancel: () => ctrl.isCancelled(),
                                appendTarget,
                                onProgress: (curPage, totPages) => {
                                    if (!ctrl.isCancelled()) {
                                        const frac = totPages > 0 ? i + (curPage / totPages) : i;
                                        progress.update(
                                            frac,
                                            `${i + 1}/${total}: ${mdFile.basename} (page ${curPage}/${totPages})`,
                                            buildSubStatus()
                                        );
                                    }
                                }
                            });
                            if (ctrl.isCancelled()) break;
                            if (!res) {
                                failedNotes.push(mdFile.path);
                                continue;
                            }
                            if (appendTarget.outEmittedPages !== undefined) {
                                existingPdfPages = appendTarget.outEmittedPages;
                            }
                            if (!themeSnapshot && appendTarget.outTheme) {
                                themeSnapshot = appendTarget.outTheme;
                            }
                            completedNotes++;
                            progress.update(i + 1, `${i + 1}/${total}: Added ${mdFile.basename}`, buildSubStatus());
                        } catch (noteErr) {
                            if (ctrl.isCancelled()) break;
                            console.error(`Error adding "${mdFile.path}" to merged PDF:`, noteErr);
                            failedNotes.push(mdFile.path);
                        }

                        if (i + 1 < total && !ctrl.isCancelled()) {
                            const noteElapsedMs = performance.now() - noteStartMs;
                            const adaptiveCooldownMs = Math.min(
                                perf.batchYieldMaxMs,
                                Math.max(perf.batchYieldBaseMs, Math.round(noteElapsedMs * 0.05))
                            );
                            await new Promise(r => window.setTimeout(r, adaptiveCooldownMs));
                        }
                    }

                    if (!ctrl.isCancelled() && completedNotes > 0 && themeSnapshot) {
                        progress.update(total, 'Finalizing table of contents, bookmarks, and footnotes...', `Writing ${safeBaseName}.pdf...`);

                        const tocPageCount = this.prependTocPagesToDoc(
                            doc,
                            allEmittedSlices,
                            [],
                            effectiveTextLayerFont,
                            isCustomUnicodeFont,
                            layout.margin,
                            layout.topMargin,
                            layout.pageWidth,
                            layout.pageHeight,
                            layout.contentWidthMm,
                            layout.contentWidthPx,
                            layout.maxPageContentPx,
                            layout.mmPerPx,
                            captureScale,
                            themeSnapshot.bgColor,
                            themeSnapshot.textColor,
                            themeSnapshot.bgHex,
                            themeSnapshot.footerFontFamily,
                            true,
                            layout.format,
                            layout.orientation
                        );

                        this.applyPdfLinksAndOutline(
                            doc,
                            allEmittedSlices,
                            layout.margin,
                            layout.topMargin,
                            layout.pageWidth,
                            layout.pageHeight,
                            layout.mmPerPx,
                            true
                        );

                        const footNow = moment();
                        const footOk = this.appendFootnotesToDoc(
                            doc,
                            null,
                            activeJsPdfFont,
                            layout.margin,
                            layout.pageHeight,
                            layout.bottomMargin,
                            layout.contentWidthMm,
                            layout.contentWidthPx,
                            layout.mmPerPx,
                            captureScale,
                            themeSnapshot.bgHex,
                            themeSnapshot.textColor,
                            themeSnapshot.footerFontFamily,
                            footNow,
                            () => ctrl.isCancelled(),
                            (pageNum: number) => {
                                if (pageNum <= tocPageCount) return safeBaseName;
                                return pageTitlesByPage[pageNum - tocPageCount] || safeBaseName;
                            }
                        );

                        if (footOk && !ctrl.isCancelled()) {
                            const mergedBuffer = doc.output('arraybuffer');
                            finalPageCount = doc.getNumberOfPages();
                            if (normalizedDir !== '') {
                                await this.ensureFolderPath(normalizedDir);
                            }
                            savedPath = normalizedDir ? `${normalizedDir}/${safeBaseName}.pdf` : `${safeBaseName}.pdf`;
                            await this.app.vault.adapter.writeBinary(savedPath, mergedBuffer);
                        }
                    }
                    elapsedMs = progress.getElapsedMs();
                } catch (err) {
                    console.error('Error creating merged PDF:', err);
                    new Notice('Error creating merged PDF: ' + err);
                } finally {
                    progress.hide();
                }

                const timeText = this.formatDurationShort(elapsedMs);
                if (ctrl.isCancelled()) {
                    new Notice(`Merged PDF export stopped (${timeText}). No partial file was written.`, 6000);
                } else if (savedPath) {
                    const failPart = failedNotes.length > 0 ? ` (${failedNotes.length} failed — see console)` : '';
                    new Notice(
                        `Merged ${completedNotes} note${completedNotes === 1 ? '' : 's'} (${finalPageCount} pages) into ${savedPath}${failPart} (${timeText})`,
                        7000
                    );
                    let pdfTFile = this.app.vault.getAbstractFileByPath(savedPath);
                    for (let attempt = 0; !pdfTFile && attempt < 10; attempt++) {
                        await new Promise(r => window.setTimeout(r, 50));
                        pdfTFile = this.app.vault.getAbstractFileByPath(savedPath);
                    }
                    if (pdfTFile instanceof TFile) {
                        await this.app.workspace.getLeaf(true).openFile(pdfTFile);
                    }
                } else if (completedNotes === 0) {
                    new Notice('Merged PDF export failed: no notes could be rendered.', 6000);
                }
            }
        });
        await promise;
    }

    // -------------------------------------------------------------------------
    // CLI / Protocol / AI Agent Automation Engine
    // -------------------------------------------------------------------------

    private getAutomationFilePaths(): { pluginDir: string; jobPath: string; resultPath: string } {
        const pluginDir = (this.manifest?.dir || `${this.app.vault.configDir}/plugins/markdown-to-pdf-mobile`).replace(/^\/+|\/+$/g, '');
        return {
            pluginDir,
            jobPath: `${pluginDir}/export-job.json`,
            resultPath: `${pluginDir}/export-result.json`
        };
    }

    private sanitizeAutomationVaultPath(rawPath: string | undefined, allowRoot: boolean = false): string | null {
        if (typeof rawPath !== 'string') return null;
        const trimmed = rawPath.trim();
        if (!trimmed) return allowRoot ? '' : null;
        if (allowRoot && (trimmed === '/' || trimmed === '.')) return '';
        if (/^[a-zA-Z]:[\\/]/.test(trimmed) || trimmed.includes('\0')) return null;
        const parts = trimmed.replace(/\\/g, '/').split('/');
        if (parts.some(p => p === '..')) return null;
        const normalized = normalizePath(trimmed).replace(/^\/+|\/+$/g, '');
        if (!normalized && !allowRoot) return null;
        return normalized;
    }

    private resolveAutomationNoteFile(rawPath: string | undefined): TFile | null {
        const safe = this.sanitizeAutomationVaultPath(rawPath, false);
        if (!safe) return null;
        const direct = this.app.vault.getAbstractFileByPath(safe);
        if (direct instanceof TFile && direct.extension === 'md') return direct;
        if (!safe.toLowerCase().endsWith('.md')) {
            const withExt = this.app.vault.getAbstractFileByPath(`${safe}.md`);
            if (withExt instanceof TFile && withExt.extension === 'md') return withExt;
        }
        return null;
    }

    private resolveAutomationFolder(rawPath: string | undefined): TFolder | null {
        const safe = this.sanitizeAutomationVaultPath(rawPath, true);
        if (safe === null) return null;
        if (safe === '') return this.app.vault.getRoot();
        const f = this.app.vault.getAbstractFileByPath(safe);
        return f instanceof TFolder ? f : null;
    }

    private applyTemporaryAutomationOptions(overrides?: Partial<PdfPluginSettings>): PdfPluginSettings {
        const backup: PdfPluginSettings = {
            ...this.settings,
            bookmarkHeadingLevels: [...this.settings.bookmarkHeadingLevels]
        };
        if (!overrides || typeof overrides !== 'object') return backup;

        const next: PdfPluginSettings = {
            ...this.settings,
            bookmarkHeadingLevels: [...this.settings.bookmarkHeadingLevels]
        };

        if (overrides.pdfTheme && ['light', 'dark', 'css'].includes(overrides.pdfTheme)) next.pdfTheme = overrides.pdfTheme;
        if (overrides.pageSize && ['a4', 'letter', 'a5'].includes(overrides.pageSize)) next.pageSize = overrides.pageSize;
        if (overrides.pageOrientation && ['portrait', 'landscape'].includes(overrides.pageOrientation)) next.pageOrientation = overrides.pageOrientation;
        if (typeof overrides.autoLandscapeWidePages === 'boolean') next.autoLandscapeWidePages = overrides.autoLandscapeWidePages;
        if (overrides.marginPreset && ['narrow', 'normal', 'wide', 'custom'].includes(overrides.marginPreset)) next.marginPreset = overrides.marginPreset;
        if (typeof overrides.customMarginMm === 'number' && Number.isFinite(overrides.customMarginMm)) {
            next.customMarginMm = Math.max(5, Math.min(45, Math.round(overrides.customMarginMm)));
        }
        if (typeof overrides.contentScale === 'number' && Number.isFinite(overrides.contentScale)) {
            next.contentScale = Math.max(80, Math.min(120, Math.round(overrides.contentScale / 5) * 5));
        }
        if (overrides.fontFamily === 'obsidian' || overrides.fontFamily === 'custom') next.fontFamily = overrides.fontFamily;
        if (typeof overrides.customFontPath === 'string') next.customFontPath = overrides.customFontPath;
        if (typeof overrides.showTitle === 'boolean') next.showTitle = overrides.showTitle;
        if (typeof overrides.showFrontmatter === 'boolean') next.showFrontmatter = overrides.showFrontmatter;
        if (typeof overrides.showHeader === 'boolean') next.showHeader = overrides.showHeader;
        if (typeof overrides.headerTemplate === 'string') next.headerTemplate = overrides.headerTemplate;
        if (typeof overrides.headerDateFormat === 'string') next.headerDateFormat = overrides.headerDateFormat;
        if (typeof overrides.headerTimeFormat === 'string') next.headerTimeFormat = overrides.headerTimeFormat;
        if (typeof overrides.showFootnote === 'boolean') next.showFootnote = overrides.showFootnote;
        if (typeof overrides.footnoteTemplate === 'string') next.footnoteTemplate = overrides.footnoteTemplate;
        if (typeof overrides.footnoteDateFormat === 'string') next.footnoteDateFormat = overrides.footnoteDateFormat;
        if (typeof overrides.footnoteTimeFormat === 'string') next.footnoteTimeFormat = overrides.footnoteTimeFormat;
        if (typeof overrides.optimizeImages === 'boolean') next.optimizeImages = overrides.optimizeImages;
        if (typeof overrides.includeBookmarks === 'boolean') next.includeBookmarks = overrides.includeBookmarks;
        if (typeof overrides.includeTocPage === 'boolean') next.includeTocPage = overrides.includeTocPage;
        if (Array.isArray(overrides.bookmarkHeadingLevels)) {
            next.bookmarkHeadingLevels = Array.from(new Set(
                overrides.bookmarkHeadingLevels.map(n => Number(n)).filter(n => Number.isInteger(n) && n >= 1 && n <= 6)
            )).sort((a, b) => a - b);
        }
        if (typeof overrides.enableClickableLinks === 'boolean') next.enableClickableLinks = overrides.enableClickableLinks;

        this.settings = next;
        this.clearRenderCache();
        return backup;
    }

    private parseProtocolBool(val: string | undefined): boolean | undefined {
        if (val === undefined) return undefined;
        const low = val.trim().toLowerCase();
        if (low === '1' || low === 'true' || low === 'yes' || low === 'on') return true;
        if (low === '0' || low === 'false' || low === 'no' || low === 'off') return false;
        return undefined;
    }

    private async checkAndRunQueuedAutomationJob(): Promise<void> {
        const { jobPath, resultPath } = this.getAutomationFilePaths();
        try {
            const exists = await this.app.vault.adapter.exists(jobPath);
            if (!exists) return;
            const rawJob = await this.app.vault.adapter.read(jobPath);
            const parsedJob = JSON.parse(rawJob) as AutomationJobSpec;
            const jobId = parsedJob?.jobId || '';
            if (jobId && await this.app.vault.adapter.exists(resultPath)) {
                try {
                    const prevResult = JSON.parse(await this.app.vault.adapter.read(resultPath)) as AutomationJobResult;
                    if (prevResult?.jobId === jobId && prevResult.status === 'completed') {
                        return;
                    }
                } catch {
                    // ignore corrupt previous result
                }
            }
            await this.runAutomationJob(jobPath);
        } catch (err) {
            console.warn('Queued automation job check skipped:', err);
        }
    }

    async handleAutomationProtocol(params: Record<string, string>): Promise<void> {
        // Explicit job JSON file path (or default export-job.json when called with ?job=default or no target params)
        const rawJobParam = (params.job || '').trim();
        if (rawJobParam && rawJobParam !== 'default' && rawJobParam !== '1' && rawJobParam !== 'true') {
            const safeJobPath = this.sanitizeAutomationVaultPath(rawJobParam, false);
            if (!safeJobPath) {
                new Notice('Automation export rejected: invalid job path.');
                return;
            }
            await this.runAutomationJob(safeJobPath);
            return;
        }

        const hasDirectTarget = !!(params.note || params.folder || params.notes);
        if (!hasDirectTarget) {
            await this.runAutomationJob();
            return;
        }

        const overrides: Partial<PdfPluginSettings> = {};
        if (params.theme === 'light' || params.theme === 'dark' || params.theme === 'css') overrides.pdfTheme = params.theme;
        if (params.pageSize === 'a4' || params.pageSize === 'letter' || params.pageSize === 'a5') overrides.pageSize = params.pageSize;
        if (params.orientation === 'portrait' || params.orientation === 'landscape') overrides.pageOrientation = params.orientation;
        const autoLand = this.parseProtocolBool(params.autoLandscape);
        if (autoLand !== undefined) overrides.autoLandscapeWidePages = autoLand;
        if (params.scale) {
            const parsedScale = parseInt(params.scale, 10);
            if (!isNaN(parsedScale)) overrides.contentScale = parsedScale;
        }
        const showTitle = this.parseProtocolBool(params.title);
        if (showTitle !== undefined) overrides.showTitle = showTitle;
        const showFm = this.parseProtocolBool(params.frontmatter);
        if (showFm !== undefined) overrides.showFrontmatter = showFm;
        const showHeader = this.parseProtocolBool(params.header);
        if (showHeader !== undefined) overrides.showHeader = showHeader;
        if (params.headerTemplate !== undefined) overrides.headerTemplate = params.headerTemplate;
        const showFoot = this.parseProtocolBool(params.footnote);
        if (showFoot !== undefined) overrides.showFootnote = showFoot;
        if (params.footnoteTemplate !== undefined) overrides.footnoteTemplate = params.footnoteTemplate;
        const optImg = this.parseProtocolBool(params.optimizeImages);
        if (optImg !== undefined) overrides.optimizeImages = optImg;
        const toc = this.parseProtocolBool(params.toc);
        if (toc !== undefined) overrides.includeTocPage = toc;
        const bookmarks = this.parseProtocolBool(params.bookmarks);
        if (bookmarks !== undefined) overrides.includeBookmarks = bookmarks;

        const tasks: AutomationJobTask[] = [];
        if (params.notes) {
            const noteList = params.notes.split(',').map(s => s.trim()).filter(Boolean);
            tasks.push({
                type: 'merge',
                notes: noteList,
                outputDir: params.out,
                outputName: params.name || 'Merged Notes'
            });
        } else if (params.folder !== undefined) {
            const mergedFlag = this.parseProtocolBool(params.merge);
            tasks.push({
                type: 'folder',
                folderPath: params.folder,
                mode: (params.mode === 'merged' || mergedFlag) ? 'merged' : 'separate',
                outputDir: params.out,
                outputName: params.name
            });
        } else if (params.note) {
            tasks.push({
                type: 'note',
                notePath: params.note,
                outputDir: params.out,
                outputName: params.name
            });
        }

        const spec: AutomationJobSpec = {
            jobId: params.jobId || `uri-${Date.now()}`,
            options: Object.keys(overrides).length > 0 ? overrides : undefined,
            openResult: this.parseProtocolBool(params.open) ?? false,
            tasks
        };
        await this.runAutomationJob(undefined, spec);
    }

    private async buildMergedPdfBufferHeadless(
        files: TFile[],
        outputTitle: string,
        shouldCancel?: () => boolean,
        onProgress?: (completedSteps: number, detail: string, subStatus?: string) => void
    ): Promise<{ buffer: ArrayBuffer | null; completedNotes: number; failedNotes: string[]; pageCount: number }> {
        const safeBaseName = this.sanitizeOutputFilename(outputTitle, 'Merged Notes');
        const layout = this.getPdfPageLayout();
        const captureScale = Platform.isMobile ? 1.75 : 2;
        const perf = this.getDevicePerfProfile();
        const total = files.length;

        const doc = new jsPDF({
            orientation: layout.orientation,
            unit: 'mm',
            format: layout.format,
            compress: true
        });
        const activeJsPdfFont = this.settings.fontFamily === 'custom' ? 'custom-font' : 'helvetica';
        let cachedFont: { fontFile: TFile; fontName: string; base64: string } | null = null;
        if (this.settings.fontFamily === 'custom' && this.settings.customFontPath && this.settings.customFontPath.trim() !== '') {
            try {
                cachedFont = await this.getCachedCustomFont();
                if (cachedFont) {
                    doc.addFileToVFS(cachedFont.fontName, cachedFont.base64);
                    doc.addFont(cachedFont.fontName, activeJsPdfFont, 'normal', 'Identity-H');
                    doc.addFont(cachedFont.fontName, activeJsPdfFont, 'bold', 'Identity-H');
                    doc.addFont(cachedFont.fontName, activeJsPdfFont, 'italic', 'Identity-H');
                    doc.addFont(cachedFont.fontName, activeJsPdfFont, 'bolditalic', 'Identity-H');
                }
            } catch {
                // proceed with fallback font
            }
        }
        const isCustomUnicodeFont = !!cachedFont;
        const effectiveTextLayerFont = isCustomUnicodeFont ? activeJsPdfFont : 'helvetica';

        const mergedNoteScopeMap = this.buildMergedNoteScopeMap(files);

        const allEmittedSlices: EmittedPdfSliceMeta[] = [];
        const pageTitlesByPage: string[] = [];
        let existingPdfPages = 0;
        let completedNotes = 0;
        const failedNotes: string[] = [];
        const { cssFontFamily: mergedCssFontFamily } = this.buildFontCssFromCached('ObsidianPdfCustomFont', cachedFont);
        const autoLandscapeEnabled = layout.orientation === 'p' && this.settings.autoLandscapeWidePages;
        const landscapeLayout = autoLandscapeEnabled ? this.getPdfPageLayout('landscape') : layout;
        const lockedTheme = this.captureExportThemeSnapshot(
            mergedCssFontFamily,
            layout.contentWidthPx,
            autoLandscapeEnabled ? landscapeLayout.contentWidthPx : undefined
        );
        let themeSnapshot: { bgColor: number[]; textColor: number[]; bgHex: string; footerFontFamily: string } | null = {
            bgColor: lockedTheme.bgColor,
            textColor: lockedTheme.textColor,
            bgHex: lockedTheme.bgHex,
            footerFontFamily: lockedTheme.footerFontFamily
        };

        const buildSubStatus = () =>
            `Merged: ${completedNotes}/${total} · ${existingPdfPages} page${existingPdfPages === 1 ? '' : 's'}${failedNotes.length > 0 ? ` · Failed: ${failedNotes.length}` : ''}`;

        for (let i = 0; i < files.length; i++) {
            if (shouldCancel?.()) return { buffer: null, completedNotes, failedNotes, pageCount: 0 };
            const mdFile = files[i];
            onProgress?.(i, `${i + 1}/${total}: ${mdFile.basename}`, buildSubStatus());
            try {
                const appendTarget: MergedAppendTarget = {
                    doc,
                    layout,
                    existingPdfPages,
                    emittedSlicesMeta: allEmittedSlices,
                    noteScopeId: `n${i}`,
                    mergedNoteScopeMap,
                    pageTitlesByPage,
                    cachedFont,
                    isCustomUnicodeFont,
                    effectiveTextLayerFont,
                    lockedTheme
                };
                const res = await this.generatePdfData(mdFile, false, {
                    isPreview: false,
                    ignorePageBreaks: true,
                    suppressFontNotice: true,
                    allowExportCacheReuse: false,
                    shouldCancel,
                    appendTarget,
                    onProgress: (curPage, totPages) => {
                        if (!shouldCancel?.()) {
                            const frac = totPages > 0 ? i + (curPage / totPages) : i;
                            onProgress?.(
                                frac,
                                `${i + 1}/${total}: ${mdFile.basename} (page ${curPage}/${totPages})`,
                                buildSubStatus()
                            );
                        }
                    }
                });
                if (!res) {
                    failedNotes.push(mdFile.path);
                    continue;
                }
                if (appendTarget.outEmittedPages !== undefined) existingPdfPages = appendTarget.outEmittedPages;
                if (!themeSnapshot && appendTarget.outTheme) themeSnapshot = appendTarget.outTheme;
                completedNotes++;
                onProgress?.(i + 1, `${i + 1}/${total}: Added ${mdFile.basename}`, buildSubStatus());
            } catch (err) {
                console.error(`Automation merge error on "${mdFile.path}":`, err);
                failedNotes.push(mdFile.path);
            }
            if (i + 1 < files.length) {
                await this.yieldFrameSafe(perf.batchYieldBaseMs);
            }
        }

        if (completedNotes === 0 || !themeSnapshot) {
            return { buffer: null, completedNotes, failedNotes, pageCount: 0 };
        }

        onProgress?.(total, 'Finalizing table of contents, bookmarks, and footnotes...', `Writing ${safeBaseName}.pdf...`);

        const tocPageCount = this.prependTocPagesToDoc(
            doc,
            allEmittedSlices,
            [],
            effectiveTextLayerFont,
            isCustomUnicodeFont,
            layout.margin,
            layout.topMargin,
            layout.pageWidth,
            layout.pageHeight,
            layout.contentWidthMm,
            layout.contentWidthPx,
            layout.maxPageContentPx,
            layout.mmPerPx,
            captureScale,
            themeSnapshot.bgColor,
            themeSnapshot.textColor,
            themeSnapshot.bgHex,
            themeSnapshot.footerFontFamily,
            true,
            layout.format,
            layout.orientation
        );

        this.applyPdfLinksAndOutline(
            doc,
            allEmittedSlices,
            layout.margin,
            layout.topMargin,
            layout.pageWidth,
            layout.pageHeight,
            layout.mmPerPx,
            true
        );

        const footOk = this.appendFootnotesToDoc(
            doc,
            null,
            activeJsPdfFont,
            layout.margin,
            layout.pageHeight,
            layout.bottomMargin,
            layout.contentWidthMm,
            layout.contentWidthPx,
            layout.mmPerPx,
            captureScale,
            themeSnapshot.bgHex,
            themeSnapshot.textColor,
            themeSnapshot.footerFontFamily,
            moment(),
            shouldCancel,
            (pageNum: number) => {
                if (pageNum <= tocPageCount) return safeBaseName;
                return pageTitlesByPage[pageNum - tocPageCount] || safeBaseName;
            }
        );
        if (!footOk) return { buffer: null, completedNotes, failedNotes, pageCount: 0 };
        return { buffer: doc.output('arraybuffer'), completedNotes, failedNotes, pageCount: doc.getNumberOfPages() };
    }

    /**
     * Executes a queued automation export job (`export-job.json` or inline protocol spec),
     * writing incremental progress to `export-result.json` after every task with automatic resume.
     */
    async runAutomationJob(customJobPath?: string, inlineSpec?: AutomationJobSpec): Promise<AutomationJobResult | null> {
        const jobLabel = inlineSpec?.jobId ? `Automation "${inlineSpec.jobId}"` : 'Automation export job';
        const { promise } = this.enqueueWorkJob<AutomationJobResult | null>({
            kind: 'automation',
            label: jobLabel,
            notifyIfQueued: true,
            run: async (ctrl) => {
                const { pluginDir, jobPath: defaultJobPath, resultPath } = this.getAutomationFilePaths();
                const activeJobPath = customJobPath || defaultJobPath;
                const writeResult = async (res: AutomationJobResult) => {
                    res.updatedAt = new Date().toISOString();
                    await this.ensureFolderPath(pluginDir);
                    await this.app.vault.adapter.write(resultPath, JSON.stringify(res, null, 2));
                };

                let spec: AutomationJobSpec | null = inlineSpec || null;
                if (!spec) {
                    const exists = await this.app.vault.adapter.exists(activeJobPath);
                    if (!exists) {
                        new Notice(`No automation job found at ${activeJobPath}`);
                        return null;
                    }
                    try {
                        spec = JSON.parse(await this.app.vault.adapter.read(activeJobPath)) as AutomationJobSpec;
                    } catch (err) {
                        const failRes: AutomationJobResult = {
                            jobId: `invalid-${Date.now()}`,
                            status: 'failed',
                            startedAt: new Date().toISOString(),
                            updatedAt: new Date().toISOString(),
                            finishedAt: new Date().toISOString(),
                            totalTasks: 0,
                            completedTaskIndices: [],
                            tasks: [],
                            error: `Failed to parse ${activeJobPath}: ${err}`
                        };
                        await writeResult(failRes);
                        new Notice(`Automation job parse error: ${err}`);
                        return failRes;
                    }
                }

                if (!spec || !Array.isArray(spec.tasks) || spec.tasks.length === 0) {
                    const emptyRes: AutomationJobResult = {
                        jobId: spec?.jobId || `empty-${Date.now()}`,
                        status: 'failed',
                        startedAt: new Date().toISOString(),
                        updatedAt: new Date().toISOString(),
                        finishedAt: new Date().toISOString(),
                        totalTasks: 0,
                        completedTaskIndices: [],
                        tasks: [],
                        error: 'Automation job contains no tasks.'
                    };
                    await writeResult(emptyRes);
                    return emptyRes;
                }

                const jobId = (spec.jobId && String(spec.jobId).trim()) || `job-${Date.now()}`;
                const startedAt = new Date().toISOString();
                let result: AutomationJobResult = {
                    jobId,
                    status: 'running',
                    startedAt,
                    updatedAt: startedAt,
                    totalTasks: spec.tasks.length,
                    completedTaskIndices: [],
                    tasks: []
                };

                // Resume support: if an unfinished result exists for the exact same jobId, keep completed tasks
                if (await this.app.vault.adapter.exists(resultPath)) {
                    try {
                        const prev = JSON.parse(await this.app.vault.adapter.read(resultPath)) as AutomationJobResult;
                        if (prev && prev.jobId === jobId && prev.status !== 'completed' && Array.isArray(prev.completedTaskIndices)) {
                            result = {
                                ...prev,
                                status: 'running',
                                totalTasks: spec.tasks.length,
                                tasks: Array.isArray(prev.tasks) ? prev.tasks : []
                            };
                        }
                    } catch {
                        // start fresh if previous result was corrupted
                    }
                }

                const isMultiTask = spec.tasks.length > 1;
                const progress = this.createBatchProgressNotice(
                    'Automation PDF export',
                    spec.tasks.length,
                    () => ctrl.cancel()
                );
                const globalBackup = this.applyTemporaryAutomationOptions(spec.options);
                const perf = this.getDevicePerfProfile();

                try {
                    await writeResult(result);

                    for (let idx = 0; idx < spec.tasks.length; idx++) {
                        if (ctrl.isCancelled()) break;
                        const taskPrefix = isMultiTask ? `[Task ${idx + 1}/${spec.tasks.length}] ` : '';
                        if (result.completedTaskIndices.includes(idx)) {
                            progress.setTitle('Automation PDF export');
                            progress.setTotal(spec.tasks.length);
                            progress.update(idx + 1, `Resuming: skipping task ${idx + 1}/${spec.tasks.length}`, `Task ${idx + 1} / ${spec.tasks.length}`);
                            continue;
                        }

                        const task = spec.tasks[idx];
                        const taskStart = performance.now();
                        const taskBackup = task.options ? this.applyTemporaryAutomationOptions(task.options) : null;
                        const taskResult: AutomationTaskResult = {
                            index: idx,
                            type: task.type,
                            status: 'completed',
                            outputs: [],
                            durationMs: 0
                        };

                        try {
                            if (task.type === 'note') {
                                const mdFile = this.resolveAutomationNoteFile(task.notePath);
                                if (!mdFile) {
                                    throw new Error(`Note not found: ${task.notePath || '(empty)'}`);
                                }
                                progress.setTitle(`${taskPrefix}Exporting "${mdFile.basename}"`);
                                progress.setTotal(1);
                                progress.update(0, `1/1: ${mdFile.path}`, 'Saved: 0 / 1');
                                const pdfBuf = await this.generatePdfData(mdFile, false, {
                                    isPreview: false,
                                    allowExportCacheReuse: false,
                                    suppressFontNotice: true,
                                    shouldCancel: () => ctrl.isCancelled(),
                                    onProgress: (curPage, totPages) => {
                                        if (!ctrl.isCancelled()) {
                                            const frac = totPages > 0 ? curPage / totPages : 0;
                                            progress.update(
                                                frac,
                                                `1/1: ${mdFile.basename} (page ${curPage}/${totPages})`,
                                                `Page ${curPage} / ${totPages}`
                                            );
                                        }
                                    }
                                });
                                if (ctrl.isCancelled()) break;
                                if (!pdfBuf) throw new Error(`Failed to render PDF for ${mdFile.path}`);

                                let outDir = '';
                                if (task.outputDir !== undefined) {
                                    const safeDir = this.sanitizeAutomationVaultPath(task.outputDir, true);
                                    if (safeDir === null) throw new Error(`Invalid outputDir: ${task.outputDir}`);
                                    outDir = safeDir;
                                } else if (this.settings.defaultExportPath && this.settings.defaultExportPath.trim() !== '') {
                                    outDir = this.settings.defaultExportPath.trim().replace(/^\/+|\/+$/g, '');
                                } else if (mdFile.parent && !mdFile.parent.isRoot()) {
                                    outDir = mdFile.parent.path;
                                }

                                if (outDir) await this.ensureFolderPath(outDir);
                                const baseName = this.sanitizeOutputFilename(task.outputName || mdFile.basename, mdFile.basename);
                                const pdfPath = outDir ? `${outDir}/${baseName}.pdf` : `${baseName}.pdf`;
                                await this.app.vault.adapter.writeBinary(pdfPath, pdfBuf);
                                taskResult.outputs.push(pdfPath);
                                progress.update(1, `1/1: Saved ${baseName}.pdf`, 'Saved: 1 / 1');
                            } else if (task.type === 'folder') {
                                const folder = this.resolveAutomationFolder(task.folderPath ?? '/');
                                if (!folder) {
                                    throw new Error(`Folder not found: ${task.folderPath || '(empty)'}`);
                                }
                                const isRoot = folder.isRoot() || folder.path === '' || folder.path === '/';
                                const sourcePrefix = isRoot ? '' : folder.path.replace(/^\/+|\/+$/g, '');
                                const folderName = isRoot ? (this.app.vault.getName() || 'Vault') : folder.name;

                                if (task.mode === 'merged') {
                                    const mdFiles = this.collectMarkdownFilesRecursive(folder);
                                    if (mdFiles.length === 0) throw new Error(`No Markdown notes in folder: ${folder.path || '/'}`);
                                    const safeOutDir = task.outputDir !== undefined
                                        ? this.sanitizeAutomationVaultPath(task.outputDir, true)
                                        : (folder.parent && !folder.parent.isRoot() ? folder.parent.path : '');
                                    if (safeOutDir === null) throw new Error(`Invalid outputDir: ${task.outputDir}`);

                                    const outTitle = this.sanitizeOutputFilename(task.outputName || folderName, folderName);
                                    progress.setTitle(`${taskPrefix}Merging "${outTitle}" (${mdFiles.length} note${mdFiles.length === 1 ? '' : 's'})`);
                                    progress.setTotal(mdFiles.length);
                                    progress.update(0, `Preparing (0/${mdFiles.length})...`, `Merged: 0/${mdFiles.length} · 0 pages`);

                                    const merged = await this.buildMergedPdfBufferHeadless(
                                        mdFiles,
                                        outTitle,
                                        () => ctrl.isCancelled(),
                                        (step, detail, sub) => progress.update(step, detail, sub)
                                    );
                                    if (ctrl.isCancelled()) break;
                                    if (!merged.buffer) throw new Error(`Failed to merge folder "${folder.path || '/'}"`);
                                    if (safeOutDir) await this.ensureFolderPath(safeOutDir);
                                    const savedPath = safeOutDir ? `${safeOutDir}/${outTitle}.pdf` : `${outTitle}.pdf`;
                                    await this.app.vault.adapter.writeBinary(savedPath, merged.buffer);
                                    taskResult.outputs.push(savedPath);
                                    if (merged.failedNotes.length > 0) taskResult.failedFiles = merged.failedNotes;
                                    progress.update(
                                        mdFiles.length,
                                        `Saved ${outTitle}.pdf`,
                                        `Merged: ${merged.completedNotes}/${mdFiles.length} · ${merged.pageCount} page${merged.pageCount === 1 ? '' : 's'}`
                                    );
                                } else {
                                    let outputRoot = this.resolveFolderOutputRoot(folder);
                                    if (task.outputDir !== undefined) {
                                        const safeDir = this.sanitizeAutomationVaultPath(task.outputDir, true);
                                        if (safeDir === null) throw new Error(`Invalid outputDir: ${task.outputDir}`);
                                        outputRoot = safeDir ? `${safeDir}/${folderName}` : folderName;
                                    }
                                    const mdFiles = this.collectMarkdownFilesRecursive(folder, outputRoot);
                                    if (mdFiles.length === 0) throw new Error(`No Markdown notes in folder: ${folder.path || '/'}`);
                                    const totalNotes = mdFiles.length;
                                    let successCount = 0;
                                    const failed: string[] = [];
                                    const buildSubStatus = () =>
                                        `Saved: ${successCount}${failed.length > 0 ? ` · Failed: ${failed.length}` : ''} / ${totalNotes}`;

                                    progress.setTitle(`${taskPrefix}Exporting "${folderName}" to PDF files`);
                                    progress.setTotal(totalNotes);
                                    progress.update(0, `Preparing (0/${totalNotes})...`, buildSubStatus());

                                    for (let fi = 0; fi < totalNotes; fi++) {
                                        if (ctrl.isCancelled()) break;
                                        const mdFile = mdFiles[fi];
                                        const relPath = sourcePrefix && mdFile.path.startsWith(sourcePrefix + '/')
                                            ? mdFile.path.slice(sourcePrefix.length + 1)
                                            : mdFile.path;
                                        const lastSlash = relPath.lastIndexOf('/');
                                        const relDir = lastSlash >= 0 ? relPath.slice(0, lastSlash) : '';
                                        const targetDir = relDir ? `${outputRoot}/${relDir}` : outputRoot;
                                        progress.update(fi, `${fi + 1}/${totalNotes}: ${relPath}`, buildSubStatus());
                                        const noteStartMs = performance.now();
                                        try {
                                            const buf = await this.generatePdfData(mdFile, false, {
                                                isPreview: false,
                                                ignorePageBreaks: true,
                                                suppressFontNotice: true,
                                                allowExportCacheReuse: false,
                                                shouldCancel: () => ctrl.isCancelled(),
                                                onProgress: (curPage, totPages) => {
                                                    if (!ctrl.isCancelled()) {
                                                        const frac = totPages > 0 ? fi + (curPage / totPages) : fi;
                                                        progress.update(
                                                            frac,
                                                            `${fi + 1}/${totalNotes}: ${relPath} (page ${curPage}/${totPages})`,
                                                            buildSubStatus()
                                                        );
                                                    }
                                                }
                                            });
                                            if (ctrl.isCancelled()) break;
                                            if (!buf) {
                                                failed.push(mdFile.path);
                                                continue;
                                            }
                                            await this.ensureFolderPath(targetDir);
                                            const pdfPath = `${targetDir}/${mdFile.basename}.pdf`;
                                            await this.app.vault.adapter.writeBinary(pdfPath, buf);
                                            taskResult.outputs.push(pdfPath);
                                            successCount++;
                                            progress.update(fi + 1, `${fi + 1}/${totalNotes}: Saved ${mdFile.basename}.pdf`, buildSubStatus());
                                        } catch (e) {
                                            console.error(`Automation folder export error on "${mdFile.path}":`, e);
                                            failed.push(mdFile.path);
                                        }
                                        if (fi + 1 < totalNotes && !ctrl.isCancelled()) {
                                            const noteElapsedMs = performance.now() - noteStartMs;
                                            const adaptiveCooldownMs = Math.min(
                                                perf.batchYieldMaxMs,
                                                Math.max(perf.batchYieldBaseMs, Math.round(noteElapsedMs * 0.05))
                                            );
                                            await this.yieldFrameSafe(adaptiveCooldownMs);
                                        }
                                    }
                                    if (failed.length > 0) taskResult.failedFiles = failed;
                                    if (taskResult.outputs.length === 0 && !ctrl.isCancelled()) {
                                        throw new Error(`All ${totalNotes} notes failed in folder "${folder.path || '/'}"`);
                                    }
                                }
                            } else if (task.type === 'merge') {
                                const rawNotes = Array.isArray(task.notes) ? task.notes : [];
                                const resolvedFiles: TFile[] = [];
                                const missing: string[] = [];
                                for (const p of rawNotes) {
                                    const f = this.resolveAutomationNoteFile(p);
                                    if (f) resolvedFiles.push(f);
                                    else missing.push(p);
                                }
                                if (resolvedFiles.length === 0) {
                                    throw new Error(`No valid notes found to merge (${missing.join(', ')})`);
                                }
                                const safeOutDir = task.outputDir !== undefined
                                    ? this.sanitizeAutomationVaultPath(task.outputDir, true)
                                    : '';
                                if (safeOutDir === null) throw new Error(`Invalid outputDir: ${task.outputDir}`);
                                const outTitle = this.sanitizeOutputFilename(task.outputName || 'Merged Notes', 'Merged Notes');
                                progress.setTitle(`${taskPrefix}Merging "${outTitle}" (${resolvedFiles.length} note${resolvedFiles.length === 1 ? '' : 's'})`);
                                progress.setTotal(resolvedFiles.length);
                                progress.update(0, `Preparing (0/${resolvedFiles.length})...`, `Merged: 0/${resolvedFiles.length} · 0 pages`);

                                const merged = await this.buildMergedPdfBufferHeadless(
                                    resolvedFiles,
                                    outTitle,
                                    () => ctrl.isCancelled(),
                                    (step, detail, sub) => progress.update(step, detail, sub)
                                );
                                if (ctrl.isCancelled()) break;
                                if (!merged.buffer) throw new Error('Failed to build merged PDF.');
                                if (safeOutDir) await this.ensureFolderPath(safeOutDir);
                                const savedPath = safeOutDir ? `${safeOutDir}/${outTitle}.pdf` : `${outTitle}.pdf`;
                                await this.app.vault.adapter.writeBinary(savedPath, merged.buffer);
                                taskResult.outputs.push(savedPath);
                                const allFailed = [...missing, ...merged.failedNotes];
                                if (allFailed.length > 0) taskResult.failedFiles = allFailed;
                                progress.update(
                                    resolvedFiles.length,
                                    `Saved ${outTitle}.pdf`,
                                    `Merged: ${merged.completedNotes}/${resolvedFiles.length} · ${merged.pageCount} page${merged.pageCount === 1 ? '' : 's'}`
                                );
                            } else {
                                throw new Error(`Unsupported automation task type: ${(task as { type?: string }).type}`);
                            }
                        } catch (err) {
                            taskResult.status = 'failed';
                            taskResult.error = String(err);
                        } finally {
                            if (taskBackup) {
                                this.settings = taskBackup;
                                this.clearRenderCache();
                            }
                        }

                        if (ctrl.isCancelled()) break;
                        taskResult.durationMs = Math.round(performance.now() - taskStart);
                        const existingIdx = result.tasks.findIndex(t => t.index === idx);
                        if (existingIdx >= 0) result.tasks[existingIdx] = taskResult;
                        else result.tasks.push(taskResult);
                        if (!result.completedTaskIndices.includes(idx)) {
                            result.completedTaskIndices.push(idx);
                        }
                        if (isMultiTask) {
                            progress.setTitle('Automation PDF export');
                            progress.setTotal(spec.tasks.length);
                            progress.update(idx + 1, `Completed task ${idx + 1}/${spec.tasks.length}`, `Task ${idx + 1} / ${spec.tasks.length}`);
                        }
                        await writeResult(result);
                    }

                    const failedTasks = result.tasks.filter(t => t.status === 'failed').length;
                    if (ctrl.isCancelled()) {
                        result.status = 'partial';
                        result.error = 'Cancelled by user';
                    } else if (failedTasks === 0) {
                        result.status = 'completed';
                    } else if (failedTasks < spec.tasks.length) {
                        result.status = 'partial';
                    } else {
                        result.status = 'failed';
                    }
                    result.finishedAt = new Date().toISOString();
                    await writeResult(result);

                    // Remove finished file-based automation job so manual "Run queued job" or restart won't re-run it
                    if (!inlineSpec && !ctrl.isCancelled()) {
                        try {
                            if (await this.app.vault.adapter.exists(activeJobPath)) {
                                let shouldDeleteJobFile = true;
                                if (spec.jobId) {
                                    try {
                                        const latestRaw = await this.app.vault.adapter.read(activeJobPath);
                                        const latestSpec = JSON.parse(latestRaw) as Partial<AutomationJobSpec>;
                                        if (latestSpec?.jobId && latestSpec.jobId !== spec.jobId) {
                                            shouldDeleteJobFile = false;
                                        }
                                    } catch {
                                        // If unreadable/corrupt, leave delete enabled for this finished file
                                    }
                                }
                                if (shouldDeleteJobFile) {
                                    await this.app.vault.adapter.remove(activeJobPath);
                                }
                            }
                        } catch (cleanupErr) {
                            console.warn(`Failed to remove completed automation job file "${activeJobPath}":`, cleanupErr);
                        }
                    }

                    const totalOutputs = result.tasks.reduce((sum, t) => sum + t.outputs.length, 0);
                    const totalFailedFiles = result.tasks.reduce((sum, t) => sum + (t.failedFiles?.length || 0), 0);
                    const failedSuffix = totalFailedFiles > 0 ? `, ${totalFailedFiles} failed` : '';
                    new Notice(
                        `Automation PDF export ${result.status}: ${totalOutputs} PDF file${totalOutputs === 1 ? '' : 's'} generated${failedSuffix} (${this.formatDurationShort(progress.getElapsedMs())})`,
                        7000
                    );

                    if (spec.openResult && totalOutputs > 0) {
                        const firstOut = result.tasks.find(t => t.outputs.length > 0)?.outputs[0];
                        if (firstOut) {
                            let pdfTFile = this.app.vault.getAbstractFileByPath(firstOut);
                            for (let attempt = 0; !pdfTFile && attempt < 10; attempt++) {
                                await new Promise(r => window.setTimeout(r, 50));
                                pdfTFile = this.app.vault.getAbstractFileByPath(firstOut);
                            }
                            if (pdfTFile instanceof TFile) {
                                await this.app.workspace.getLeaf(true).openFile(pdfTFile);
                            }
                        }
                    }
                } finally {
                    this.settings = globalBackup;
                    this.clearRenderCache();
                    progress.hide();
                }

                return result;
            }
        });
        return (await promise) ?? null;
    }
}

class PdfSidebarView extends ItemView {
    plugin: PdfPlugin;
    previewContainer: HTMLElement;
    zoomWrapper: HTMLElement;
    debounceTimer: number | null = null;
    private lastDist = 0;
    private zoomLevel = 1.0;
    private pageBreakArea: TextAreaComponent | null = null;
    private exportPathInput: TextComponent | null = null;
    private previewRenderVersion = 0;
    private previewTimerEl: HTMLElement | null = null;
    private previewTimerInterval: number | null = null;
    private zoomResetBtnEl: HTMLButtonElement | null = null;
    private reloadBtnEl: HTMLButtonElement | null = null;
    private stopPreviewBtnEl: HTMLButtonElement | null = null;
    private fontPathBlurTimer: number | null = null;
    private lastValidatedFontPath = '';
    private pageBreakBlurTimer: number | null = null;
    private lastRenderedPageBreaks = '';
    private activePreviewTask: Promise<void> | null = null;
    private queuedPreviewJobId: number | null = null;
    private isClosed = false;
    private lastRenderedDocKey: string | null = null;
    private pendingPreviewRefresh = false;
    private activePreviewPdf: PdfJsDocument | null = null;
    private pageObserver: IntersectionObserver | null = null;
    private previewProgressLabel: string = '';
    private boxOutsideCleanupFns: Array<() => void> = [];
    private defaultsBarEl: HTMLElement | null = null;
    private defaultsStatusEl: HTMLElement | null = null;
    private resetDefaultsBtnEl: HTMLButtonElement | null = null;
    private saveDefaultsBtnEl: HTMLButtonElement | null = null;

    public updateOverrideBanner(): void {
        if (!this.defaultsBarEl || !this.defaultsStatusEl) return;
        const count = this.plugin.getSidebarOverrideCount();
        const hasOverrides = count > 0;
        this.defaultsBarEl.toggleClass('has-overrides', hasOverrides);
        if (hasOverrides) {
            this.defaultsStatusEl.textContent = `Temporary overrides active (${count} changed) — won't affect folder or merge exports`;
        } else {
            this.defaultsStatusEl.textContent = 'Using global defaults (changes here are temporary for this session)';
        }
        if (this.resetDefaultsBtnEl) {
            this.resetDefaultsBtnEl.disabled = !hasOverrides;
        }
        if (this.saveDefaultsBtnEl) {
            this.saveDefaultsBtnEl.disabled = !hasOverrides;
            this.saveDefaultsBtnEl.toggleClass('mod-cta', hasOverrides);
        }
    }

    private cleanupBoxLeaveListeners(): void {
        for (const fn of this.boxOutsideCleanupFns) {
            try { fn(); } catch { /* ignore */ }
        }
        this.boxOutsideCleanupFns = [];
    }

    private maybeTriggerAutoPreview(immediate: boolean = false): void {
        if (!this.plugin.globalSettings.autoRegeneratePreview) return;
        if (immediate) {
            if (this.debounceTimer !== null) {
                window.clearTimeout(this.debounceTimer);
                this.debounceTimer = null;
            }
            void this.updatePreview();
        } else {
            this.triggerPreview();
        }
    }

    private setPreviewCancelButtonVisible(visible: boolean): void {
        if (this.stopPreviewBtnEl) {
            this.stopPreviewBtnEl.toggleClass('is-visible', visible);
        }
    }

    public isPreviewRunning(): boolean {
        return this.activePreviewTask !== null || this.queuedPreviewJobId !== null;
    }

    public async cancelInFlightPreview(showCancelledMessage: boolean = false): Promise<void> {
        const elapsedText = this.previewTimerEl?.textContent || '';
        this.previewRenderVersion++;
        if (this.queuedPreviewJobId !== null) {
            const jobId = this.queuedPreviewJobId;
            this.queuedPreviewJobId = null;
            this.plugin.cancelWorkJob(jobId);
        }
        if (this.debounceTimer !== null) {
            window.clearTimeout(this.debounceTimer);
            this.debounceTimer = null;
        }
        this.stopPreviewTimer();
        this.setPreviewCancelButtonVisible(false);
        if (showCancelledMessage) {
            if (this.previewTimerEl) {
                this.previewTimerEl.textContent = elapsedText && !elapsedText.startsWith('Queued')
                    ? `Cancelled (${elapsedText})`
                    : 'Cancelled';
                this.previewTimerEl.removeClass('is-running', 'is-error');
            }
            if (this.zoomWrapper && this.zoomWrapper.querySelector('.pdf-loading')) {
                this.zoomWrapper.empty();
                this.zoomWrapper.createDiv({
                    text: 'Preview generation cancelled. Click reload to generate again.',
                    cls: 'pdf-no-file'
                });
            }
        }
        if (this.activePreviewTask !== null) {
            try {
                await this.activePreviewTask;
            } catch {
                // ignore cancelled preview error
            }
        }
    }

    private disposePreviewPdf() {
        if (this.pageObserver) {
            this.pageObserver.disconnect();
            this.pageObserver = null;
        }
        if (this.activePreviewPdf) {
            const oldPdf = this.activePreviewPdf;
            this.activePreviewPdf = null;
            if (typeof oldPdf.destroy === 'function') {
                void oldPdf.destroy().catch(() => {});
            }
        }
    }

    constructor(leaf: WorkspaceLeaf, plugin: PdfPlugin) {
        super(leaf);
        this.plugin = plugin;
    }

    getViewType() { return PDF_SIDEBAR_VIEW; }
    getDisplayText() { return "PDF settings"; }
    getIcon() { return "file-down"; }

    isSidebarVisible(): boolean {
        if (this.isClosed || !this.previewContainer?.isConnected || !this.containerEl?.isConnected) {
            return false;
        }
        // Check collapsed state on parent splits / mobile drawers
        const leafInternal = this.leaf as unknown as ObsidianWorkspaceItemInternal;
        let node: ObsidianWorkspaceItemInternal | null | undefined = leafInternal;
        while (node) {
            if (node.collapsed === true) return false;
            node = node.parent;
        }
        const root = typeof leafInternal.getRoot === 'function' ? leafInternal.getRoot() : null;
        if (root && root.collapsed === true) return false;

        // Check if this leaf is hidden behind another tab in a tabbed sidebar container
        const parent = leafInternal.parent;
        if (parent && Array.isArray(parent.children) && typeof parent.currentTab === 'number') {
            if (parent.children[parent.currentTab] !== this.leaf) {
                return false;
            }
        }

        // Check actual layout visibility & viewport bounds (catches mobile off-screen drawers)
        const cs = window.getComputedStyle(this.containerEl);
        if (cs.display === 'none' || cs.visibility === 'hidden') return false;
        const rect = this.containerEl.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) return false;
        if (typeof window.innerWidth === 'number' && window.innerWidth > 0) {
            if (rect.right <= 0 || rect.left >= window.innerWidth) return false;
        }
        return true;
    }

    markPendingRefresh(): void {
        this.pendingPreviewRefresh = true;
        this.previewRenderVersion++;
        if (this.debounceTimer !== null) {
            window.clearTimeout(this.debounceTimer);
            this.debounceTimer = null;
        }
        this.stopPreviewTimer();
    }

    refreshIfVisible(): void {
        if (this.pendingPreviewRefresh && this.isSidebarVisible()) {
            this.pendingPreviewRefresh = false;
            if (this.plugin.globalSettings.autoRegeneratePreview) {
                this.triggerPreview();
            }
        }
    }

    refreshSettings() {
        if (this.pageBreakArea) {
            this.pageBreakArea.setValue(this.plugin.sidebarSettings.pageBreaks);
        }
        if (this.exportPathInput) {
            this.exportPathInput.setValue(this.plugin.sidebarSettings.defaultExportPath);
        }
        this.updateOverrideBanner();
    }

    private attachPathAutocomplete(
        setting: Setting,
        inputEl: HTMLInputElement,
        getSuggestions: (query: string) => Array<{ value: string; label: string }>,
        onSelect: (value: string) => void | Promise<void>,
        emptyHint?: string
    ) {
        this.plugin.attachPathAutocomplete(setting, inputEl, getSuggestions, onSelect, emptyHint);
    }

    private getMatchingFolderSuggestions(queryRaw: string): Array<{ value: string; label: string }> {
        return this.plugin.getMatchingFolderSuggestions(queryRaw);
    }

    private getMatchingTtfSuggestions(queryRaw: string): Array<{ value: string; label: string }> {
        return this.plugin.getMatchingTtfSuggestions(queryRaw);
    }

    private setZoomLevel(newZoom: number) {
        const clamped = Math.max(0.5, Math.min(3.0, Math.round(newZoom * 100) / 100));
        const ratio = clamped / this.zoomLevel;
        this.zoomLevel = clamped;
        if (this.zoomWrapper) {
            this.zoomWrapper.style.width = `${100 * this.zoomLevel}%`;
        }
        if (this.previewContainer && ratio !== 1) {
            this.previewContainer.scrollTop *= ratio;
            this.previewContainer.scrollLeft *= ratio;
        }
        if (this.zoomResetBtnEl) {
            this.zoomResetBtnEl.textContent = `${Math.round(this.zoomLevel * 100)}%`;
        }
    }

    private formatElapsedTime(ms: number): string {
        if (ms >= 60000) {
            const mins = Math.floor(ms / 60000);
            const secs = (ms % 60000) / 1000;
            return `${mins}m ${secs.toFixed(1).padStart(4, '0')}s`;
        }
        return `${(ms / 1000).toFixed(2)}s`;
    }

    private startPreviewTimer(): number {
        this.stopPreviewTimer();
        this.previewProgressLabel = '';
        const start = performance.now();
        if (this.previewTimerEl) {
            this.previewTimerEl.textContent = '0.00s';
            this.previewTimerEl.removeClass('is-error');
            this.previewTimerEl.addClass('is-running');
        }
        this.previewTimerInterval = window.setInterval(() => {
            if (this.previewTimerEl) {
                const elapsed = this.formatElapsedTime(performance.now() - start);
                this.previewTimerEl.textContent = this.previewProgressLabel
                    ? `${this.previewProgressLabel} · ${elapsed}`
                    : elapsed;
            }
        }, 50);
        return start;
    }

    private stopPreviewTimer(finalStartMs?: number, failed: boolean = false) {
        if (this.previewTimerInterval !== null) {
            window.clearInterval(this.previewTimerInterval);
            this.previewTimerInterval = null;
        }
        this.previewProgressLabel = '';
        if (this.previewTimerEl && finalStartMs !== undefined) {
            this.previewTimerEl.textContent = this.formatElapsedTime(performance.now() - finalStartMs);
            this.previewTimerEl.removeClass('is-running');
            this.previewTimerEl.toggleClass('is-error', failed);
        }
    }

    async onOpen() {
        this.isClosed = false;
        await this.display(this.plugin.globalSettings.autoRegeneratePreview);
    }

    async onClose() {
        this.isClosed = true;
        this.previewRenderVersion++;
        if (this.queuedPreviewJobId !== null) {
            const jobId = this.queuedPreviewJobId;
            this.queuedPreviewJobId = null;
            this.plugin.cancelWorkJob(jobId);
        }
        this.cleanupBoxLeaveListeners();
        if (this.debounceTimer !== null) {
            window.clearTimeout(this.debounceTimer);
            this.debounceTimer = null;
        }
        if (this.fontPathBlurTimer !== null) {
            window.clearTimeout(this.fontPathBlurTimer);
            this.fontPathBlurTimer = null;
        }
        if (this.pageBreakBlurTimer !== null) {
            window.clearTimeout(this.pageBreakBlurTimer);
            this.pageBreakBlurTimer = null;
        }
        this.stopPreviewTimer();
        this.disposePreviewPdf();
        this.plugin.clearRenderCache();
    }

    display(shouldTriggerPreview: boolean = this.plugin.globalSettings.autoRegeneratePreview): Promise<void> {
        this.cleanupBoxLeaveListeners();
        this.stopPreviewTimer();
        this.disposePreviewPdf();
        this.stopPreviewBtnEl = null;
        this.defaultsBarEl = null;
        this.defaultsStatusEl = null;
        this.resetDefaultsBtnEl = null;
        this.saveDefaultsBtnEl = null;
        this.lastRenderedDocKey = null;
        const draft = this.plugin.sidebarSettings;
        this.lastValidatedFontPath = (draft.customFontPath || '').trim();
        const container = this.contentEl;
        container.empty();
        container.addClass('pdf-sidebar-root');

        // Session overrides / global defaults status & action bar
        this.defaultsBarEl = container.createDiv({ cls: 'pdf-defaults-bar' });
        this.defaultsStatusEl = this.defaultsBarEl.createDiv({ cls: 'pdf-defaults-status' });
        const defaultsActions = this.defaultsBarEl.createDiv({ cls: 'pdf-defaults-actions' });

        this.resetDefaultsBtnEl = defaultsActions.createEl('button', { text: 'Reset to defaults' });
        this.resetDefaultsBtnEl.type = 'button';
        this.resetDefaultsBtnEl.addEventListener('click', () => {
            this.plugin.resetSidebarToGlobalDefaults();
        });

        this.saveDefaultsBtnEl = defaultsActions.createEl('button', { text: 'Save as defaults' });
        this.saveDefaultsBtnEl.type = 'button';
        this.saveDefaultsBtnEl.addEventListener('click', () => {
            void this.plugin.saveSidebarAsGlobalDefaults();
        });

        this.updateOverrideBanner();

        const createCard = (title: string, desc?: string): HTMLElement => {
            const card = container.createDiv({ cls: 'pdf-settings-card' });
            const header = card.createDiv({ cls: 'pdf-settings-card-header' });
            header.createDiv({ cls: 'pdf-settings-card-title', text: title });
            if (desc) {
                header.createDiv({ cls: 'pdf-settings-card-desc', text: desc });
            }
            return card.createDiv({ cls: 'pdf-settings-card-body' });
        };

        // 1. Page & layout
        const pageLayoutCard = createCard("Page & layout");

        new Setting(pageLayoutCard)
            .setName("Page size")
            .setDesc("Paper size for the exported PDF")
            .addDropdown(d => {
                d.addOption("a4", "A4 (210 × 297 mm)")
                    .addOption("letter", "Letter (215.9 × 279.4 mm)")
                    .addOption("a5", "A5 (148 × 210 mm)")
                    .setValue(draft.pageSize)
                    .onChange(v => {
                        this.plugin.updateSidebarSetting('pageSize', v as 'a4' | 'letter' | 'a5');
                        this.plugin.clearRenderCache();
                        this.maybeTriggerAutoPreview();
                    });
            });

        let autoLandscapeWrap: HTMLDivElement | null = null;
        new Setting(pageLayoutCard)
            .setName("Orientation")
            .setDesc("Portrait (vertical) or landscape (horizontal, ideal for wide tables & diagrams)")
            .addDropdown(d => {
                d.addOption("portrait", "Portrait")
                    .addOption("landscape", "Landscape")
                    .setValue(draft.pageOrientation)
                    .onChange(v => {
                        this.plugin.updateSidebarSetting('pageOrientation', v as 'portrait' | 'landscape');
                        if (autoLandscapeWrap) {
                            autoLandscapeWrap.toggleClass('pdf-hidden', v !== 'portrait');
                        }
                        this.plugin.clearRenderCache();
                        this.maybeTriggerAutoPreview();
                    });
            });

        autoLandscapeWrap = pageLayoutCard.createDiv();
        autoLandscapeWrap.toggleClass('pdf-hidden', draft.pageOrientation !== 'portrait');
        new Setting(autoLandscapeWrap)
            .setName("Auto-landscape wide pages")
            .setDesc("Automatically switch individual pages to landscape when wide tables, diagrams, equations, or panoramic images are detected")
            .addToggle(t => t
                .setValue(draft.autoLandscapeWidePages)
                .onChange(v => {
                    this.plugin.updateSidebarSetting('autoLandscapeWidePages', v);
                    this.plugin.clearRenderCache();
                    this.maybeTriggerAutoPreview();
                })
            );

        let customMarginWrap: HTMLDivElement | null = null;
        new Setting(pageLayoutCard)
            .setName("Margins")
            .setDesc("Page margins preset or custom value in mm")
            .addDropdown(d => {
                d.addOption("narrow", "Narrow (10 mm)")
                    .addOption("normal", "Normal (15 mm)")
                    .addOption("wide", "Wide (25 mm)")
                    .addOption("custom", "Custom (mm)")
                    .setValue(draft.marginPreset)
                    .onChange(v => {
                        this.plugin.updateSidebarSetting('marginPreset', v as 'narrow' | 'normal' | 'wide' | 'custom');
                        if (customMarginWrap) {
                            customMarginWrap.toggleClass('pdf-hidden', v !== 'custom');
                        }
                        this.plugin.clearRenderCache();
                        this.maybeTriggerAutoPreview();
                    });
            });

        customMarginWrap = pageLayoutCard.createDiv();
        customMarginWrap.toggleClass('pdf-hidden', draft.marginPreset !== 'custom');
        new Setting(customMarginWrap)
            .setName("Custom margin (mm)")
            .setDesc("Page margin on all sides (5–45 mm)")
            .addText(t => {
                t.inputEl.type = 'number';
                t.inputEl.min = '5';
                t.inputEl.max = '45';
                t.inputEl.step = '1';
                t.setValue(String(draft.customMarginMm))
                    .onChange(v => {
                        const parsed = parseInt(v, 10);
                        if (!isNaN(parsed)) {
                            const clamped = Math.max(5, Math.min(45, parsed));
                            this.plugin.updateSidebarSetting('customMarginMm', clamped);
                            this.plugin.clearRenderCache();
                            this.maybeTriggerAutoPreview();
                        }
                    });
                t.inputEl.addEventListener('blur', () => {
                    const parsed = parseInt(t.getValue(), 10);
                    const clamped = isNaN(parsed) ? 15 : Math.max(5, Math.min(45, parsed));
                    if (String(clamped) !== t.getValue()) {
                        t.setValue(String(clamped));
                    }
                    if (this.plugin.sidebarSettings.customMarginMm !== clamped) {
                        this.plugin.updateSidebarSetting('customMarginMm', clamped);
                        this.plugin.clearRenderCache();
                        this.maybeTriggerAutoPreview();
                    }
                });
            });

        const scaleSetting = new Setting(pageLayoutCard)
            .setName("Content scale")
            .setDesc("Adjust text and content density (80%–120%)");
        const scaleValueLabel = scaleSetting.controlEl.createSpan({
            cls: 'pdf-scale-value-label',
            text: `${draft.contentScale}%`
        });
        scaleSetting.addSlider(s => {
            s.setLimits(80, 120, 5)
                .setValue(draft.contentScale)
                .onChange(v => {
                    const clamped = Math.max(80, Math.min(120, Math.round(v / 5) * 5));
                    scaleValueLabel.textContent = `${clamped}%`;
                    this.plugin.updateSidebarSetting('contentScale', clamped);
                    this.plugin.clearRenderCache();
                    this.maybeTriggerAutoPreview();
                });
        });

        // 2. Appearance & typography
        const appearanceCard = createCard("Appearance & typography");

        const themeSetting = new Setting(appearanceCard)
            .setName("Page theme")
            .setDesc("Page background: match Obsidian, white, or black");
        themeSetting.addDropdown(d => {
            d.addOption("css", "Match Obsidian (default)")
                .addOption("light", "White (light)")
                .addOption("dark", "Black (dark)")
                .setValue(draft.pdfTheme)
                .onChange(v => {
                    this.plugin.updateSidebarSetting('pdfTheme', v as 'light' | 'dark' | 'css');
                    this.maybeTriggerAutoPreview();
                });
        });

        let fontPathWrap: HTMLDivElement | null = null;
        const fontFamilySetting = new Setting(appearanceCard)
            .setName("Font family")
            .setDesc("Use Obsidian's font or a custom .ttf from your vault");
        fontFamilySetting.addDropdown(d => {
            d.addOption("obsidian", "Obsidian default (theme font)")
                .addOption("custom", "Custom (.ttf from vault)")
                .setValue(draft.fontFamily)
                .onChange(v => {
                    this.plugin.updateSidebarSetting('fontFamily', v);
                    if (fontPathWrap) {
                        fontPathWrap.toggleClass('pdf-hidden', v !== 'custom');
                    }
                    this.maybeTriggerAutoPreview();
                });
        });

        // Show path field if 'custom' is selected (with live multi-token .ttf autocomplete and blur validation)
        fontPathWrap = appearanceCard.createDiv();
        fontPathWrap.toggleClass('pdf-hidden', draft.fontFamily !== 'custom');
        const fontPathSetting = new Setting(fontPathWrap)
            .setName("Font path (.ttf)")
            .setDesc("Select or type path to a .ttf file in your vault (checked when leaving field)");
        fontPathSetting.addText(t => {
            t.setPlaceholder("Fonts/MyFont.ttf")
                .setValue(draft.customFontPath)
                .onChange(v => {
                    this.plugin.updateSidebarSetting('customFontPath', v);
                });
            this.attachPathAutocomplete(
                fontPathSetting,
                t.inputEl,
                (q) => this.getMatchingTtfSuggestions(q),
                (selected) => {
                    if (this.fontPathBlurTimer !== null) {
                        window.clearTimeout(this.fontPathBlurTimer);
                        this.fontPathBlurTimer = null;
                    }
                    this.plugin.updateSidebarSetting('customFontPath', selected);
                    this.lastValidatedFontPath = selected.trim();
                    this.maybeTriggerAutoPreview(true);
                },
                "No .ttf files found in vault (place .ttf files in a vault folder)"
            );
            t.inputEl.addEventListener('blur', (ev: FocusEvent) => {
                if (ev.relatedTarget && ev.relatedTarget === this.reloadBtnEl) return;
                if (this.fontPathBlurTimer !== null) window.clearTimeout(this.fontPathBlurTimer);
                this.fontPathBlurTimer = window.setTimeout(() => {
                    if (this.isClosed) return;
                    const currentPath = (this.plugin.sidebarSettings.customFontPath || '').trim();
                    if (currentPath === this.lastValidatedFontPath) return;

                    if (currentPath === '') {
                        this.lastValidatedFontPath = '';
                        this.maybeTriggerAutoPreview(true);
                        return;
                    }

                    const fontFile = this.plugin.resolveVaultFontFile(currentPath);
                    if (!fontFile) {
                        this.lastValidatedFontPath = currentPath;
                        new Notice("Custom font file not found at: " + currentPath);
                        return;
                    }

                    if (fontFile.path !== this.plugin.sidebarSettings.customFontPath) {
                        this.plugin.updateSidebarSetting('customFontPath', fontFile.path);
                        t.setValue(fontFile.path);
                    }
                    this.lastValidatedFontPath = fontFile.path;
                    this.maybeTriggerAutoPreview(true);
                }, 210);
            });
        });

        // 3. Document content
        const contentCard = createCard("Document content");

        new Setting(contentCard)
            .setName("Show note title")
            .setDesc("Include the note title at the top of the PDF")
            .addToggle(t => t.setValue(draft.showTitle).onChange(v => {
                this.plugin.updateSidebarSetting('showTitle', v);
                this.maybeTriggerAutoPreview();
            }));

        new Setting(contentCard)
            .setName("Show properties (frontmatter)")
            .setDesc("Include YAML frontmatter properties neatly at the top of page 1")
            .addToggle(t => t.setValue(draft.showFrontmatter).onChange(v => {
                this.plugin.updateSidebarSetting('showFrontmatter', v);
                this.plugin.clearRenderCache();
                this.maybeTriggerAutoPreview();
            }));

        // 4. Header & footnote
        const headerFootnoteCard = createCard("Header & footnote");

        const sampleNow = moment();
        let headerSubWrap: HTMLDivElement | null = null;
        let footnoteSubWrap: HTMLDivElement | null = null;

        new Setting(headerFootnoteCard)
            .setName("Show header")
            .setDesc("Include a customizable header on every page")
            .addToggle(t => t.setValue(draft.showHeader).onChange(v => {
                this.plugin.updateSidebarSetting('showHeader', v);
                this.plugin.clearRenderCache();
                if (headerSubWrap) headerSubWrap.toggleClass('pdf-hidden', !v);
                this.maybeTriggerAutoPreview();
            }));

        headerSubWrap = headerFootnoteCard.createDiv();
        headerSubWrap.toggleClass('pdf-hidden', !draft.showHeader);
        new Setting(headerSubWrap)
            .setName("Header template")
            .setDesc("Tokens: {title}, {date}, {time}, {page}, {total}, {date:FMT}, {time:FMT}")
            .addText(t => {
                t.setPlaceholder("{title}")
                    .setValue(draft.headerTemplate)
                    .onChange(v => {
                        this.plugin.updateSidebarSetting('headerTemplate', v);
                        this.maybeTriggerAutoPreview();
                    });
            });

        new Setting(headerSubWrap)
            .setName("Header date format")
            .setDesc("Format used by {date} in the header")
            .addDropdown(d => {
                for (const val of FOOTNOTE_DATE_FORMATS) {
                    d.addOption(val, `${val} (${sampleNow.format(val)})`);
                }
                const current = draft.headerDateFormat || 'YYYY-MM-DD';
                if (!FOOTNOTE_DATE_FORMATS.includes(current)) {
                    d.addOption(current, `${current} (${sampleNow.format(current)})`);
                }
                d.setValue(current).onChange(v => {
                    this.plugin.updateSidebarSetting('headerDateFormat', v);
                    this.maybeTriggerAutoPreview();
                });
            });

        new Setting(headerSubWrap)
            .setName("Header time format")
            .setDesc("Format used by {time} in the header")
            .addDropdown(d => {
                for (const val of FOOTNOTE_TIME_FORMATS) {
                    d.addOption(val, `${val} (${sampleNow.format(val)})`);
                }
                const current = draft.headerTimeFormat || 'HH:mm';
                if (!FOOTNOTE_TIME_FORMATS.includes(current)) {
                    d.addOption(current, `${current} (${sampleNow.format(current)})`);
                }
                d.setValue(current).onChange(v => {
                    this.plugin.updateSidebarSetting('headerTimeFormat', v);
                    this.maybeTriggerAutoPreview();
                });
            });

        new Setting(headerFootnoteCard)
            .setName("Show footnote")
            .setDesc("Include a footnote on every page")
            .addToggle(t => t.setValue(draft.showFootnote).onChange(v => {
                this.plugin.updateSidebarSetting('showFootnote', v);
                if (footnoteSubWrap) {
                    footnoteSubWrap.toggleClass('pdf-hidden', !v);
                }
                this.maybeTriggerAutoPreview();
            }));

        footnoteSubWrap = headerFootnoteCard.createDiv();
        footnoteSubWrap.toggleClass('pdf-hidden', !draft.showFootnote);
        const templateSetting = new Setting(footnoteSubWrap)
            .setName("Footnote template")
            .setDesc("Tokens: {title}, {date}, {time}, {page}, {total}, {date:FMT}, {time:FMT}");
        templateSetting.addText(t => {
            t.setValue(draft.footnoteTemplate)
                .onChange(v => {
                    this.plugin.updateSidebarSetting('footnoteTemplate', v);
                    this.maybeTriggerAutoPreview();
                });
        });

        const dateFormatSetting = new Setting(footnoteSubWrap)
            .setName("Footnote date format")
            .setDesc("Format used by {date} in the footnote");
        dateFormatSetting.addDropdown(d => {
            for (const val of FOOTNOTE_DATE_FORMATS) {
                d.addOption(val, `${val} (${sampleNow.format(val)})`);
            }
            const current = draft.footnoteDateFormat || 'YYYY-MM-DD';
            if (!FOOTNOTE_DATE_FORMATS.includes(current)) {
                d.addOption(current, `${current} (${sampleNow.format(current)})`);
            }
            d.setValue(current).onChange(v => {
                this.plugin.updateSidebarSetting('footnoteDateFormat', v);
                this.maybeTriggerAutoPreview();
            });
        });

        const timeFormatSetting = new Setting(footnoteSubWrap)
            .setName("Footnote time format")
            .setDesc("Format used by {time} in the footnote");
        timeFormatSetting.addDropdown(d => {
            for (const val of FOOTNOTE_TIME_FORMATS) {
                d.addOption(val, `${val} (${sampleNow.format(val)})`);
            }
            const current = draft.footnoteTimeFormat || 'HH:mm';
            if (!FOOTNOTE_TIME_FORMATS.includes(current)) {
                d.addOption(current, `${current} (${sampleNow.format(current)})`);
            }
            d.setValue(current).onChange(v => {
                this.plugin.updateSidebarSetting('footnoteTimeFormat', v);
                this.maybeTriggerAutoPreview();
            });
        });

        // 5. Navigation & links
        const navigationCard = createCard("Navigation & links");

        let bookmarkLevelsWrap: HTMLDivElement | null = null;
        const tocModeCleanup = this.plugin.renderTocModeControl(
            navigationCard,
            () => {
                if (bookmarkLevelsWrap) {
                    const showLevels = this.plugin.sidebarSettings.includeBookmarks || this.plugin.sidebarSettings.includeTocPage;
                    bookmarkLevelsWrap.toggleClass('pdf-hidden', !showLevels);
                }
            },
            () => {
                this.maybeTriggerAutoPreview();
            },
            this.plugin.sidebarSettings,
            false
        );
        if (tocModeCleanup) this.boxOutsideCleanupFns.push(tocModeCleanup);

        bookmarkLevelsWrap = navigationCard.createDiv();
        bookmarkLevelsWrap.toggleClass('pdf-hidden', !(draft.includeBookmarks || draft.includeTocPage));
        const levelsCleanup = this.plugin.renderBookmarkHeadingLevelsControl(
            bookmarkLevelsWrap,
            () => {},
            () => {
                this.maybeTriggerAutoPreview();
            },
            this.plugin.sidebarSettings,
            false
        );
        if (levelsCleanup) this.boxOutsideCleanupFns.push(levelsCleanup);

        new Setting(navigationCard)
            .setName("Clickable links")
            .setDesc("Keep external web links and internal links (headings, block references, footnotes, and cross-note links in merged PDF files) clickable")
            .addToggle(t => t.setValue(draft.enableClickableLinks).onChange(v => {
                this.plugin.updateSidebarSetting('enableClickableLinks', v);
                this.plugin.invalidateExportPdfCache();
                this.maybeTriggerAutoPreview();
            }));

        // 6. Output & compression
        const outputCard = createCard("Output & compression");

        new Setting(outputCard)
            .setName("Optimize PDF size (smart compression)")
            .setDesc("Optimizes embedded images (webp 99%, skips already-webp & keeps original if larger) and compresses pages using lossless 8-bit indexed PNG for text pages or crisp 93% JPEG when smaller")
            .addToggle(t => t.setValue(draft.optimizeImages).onChange(v => {
                this.plugin.updateSidebarSetting('optimizeImages', v);
                this.plugin.clearRenderCache();
                this.maybeTriggerAutoPreview();
            }));

        const exportPathSetting = new Setting(outputCard)
            .setName("Export path")
            .setDesc("Destination folder for this note's PDF ('/' = vault root, empty = note folder)");
        exportPathSetting.addText(t => {
            this.exportPathInput = t;
            t.setPlaceholder("PDFs/Exports")
                .setValue(draft.defaultExportPath)
                .onChange(v => {
                    this.plugin.updateSidebarSetting('defaultExportPath', v);
                });
            this.attachPathAutocomplete(
                exportPathSetting,
                t.inputEl,
                (q) => this.getMatchingFolderSuggestions(q),
                (selected) => {
                    this.plugin.updateSidebarSetting('defaultExportPath', selected);
                }
            );
        });

        // 7. Preview & page breaks
        const previewCard = createCard("Preview & page breaks");

        new Setting(previewCard)
            .setName("Show line numbers (preview)")
            .setDesc("Show line numbers in the sidebar preview")
            .addToggle(t => t.setValue(this.plugin.globalSettings.showLineNumbersInPreview).onChange(async v => {
                this.plugin.globalSettings.showLineNumbersInPreview = v;
                this.plugin.sidebarSettings.showLineNumbersInPreview = v;
                await this.plugin.saveSettings();
                this.maybeTriggerAutoPreview();
            }));

        const pageBreaksSetting = new Setting(previewCard)
            .setName("Page breaks")
            .setDesc("Comma-separated line numbers (temporary for current note)");
        pageBreaksSetting.addTextArea(t => {
            this.pageBreakArea = t;
            t.inputEl.rows = 2;
            t.setPlaceholder("10, 25").setValue(draft.pageBreaks).onChange(v => {
                this.plugin.sidebarSettings.pageBreaks = v;
            });
            t.inputEl.addEventListener('blur', (ev: FocusEvent) => {
                if (ev.relatedTarget && ev.relatedTarget === this.reloadBtnEl) return;
                if (this.pageBreakBlurTimer !== null) window.clearTimeout(this.pageBreakBlurTimer);
                this.pageBreakBlurTimer = window.setTimeout(() => {
                    if (this.isClosed) return;
                    const currentBreaks = (this.plugin.sidebarSettings.pageBreaks || '').trim();
                    if (currentBreaks !== (this.lastRenderedPageBreaks || '').trim()) {
                        this.maybeTriggerAutoPreview(true);
                    }
                }, 80);
            });
        });

        container.createDiv({ cls: 'pdf-sidebar-divider' });
        const previewHeader = container.createDiv({ cls: 'pdf-preview-header' });
        const previewTitleGroup = previewHeader.createDiv({ cls: 'pdf-preview-title-group' });
        previewTitleGroup.createEl("h3", { text: "Preview", cls: "pdf-preview-heading" });
        this.previewTimerEl = previewTitleGroup.createSpan({ text: "", cls: "pdf-preview-timer" });

        const previewControls = previewHeader.createDiv({ cls: 'pdf-preview-controls' });

        const zoomOutBtn = previewControls.createEl("button", { text: "-", cls: "pdf-preview-zoom-btn" });
        zoomOutBtn.type = "button";
        zoomOutBtn.setAttribute("aria-label", "Zoom out preview");
        zoomOutBtn.addEventListener("click", () => this.setZoomLevel(this.zoomLevel - 0.25));

        this.zoomResetBtnEl = previewControls.createEl("button", { text: "100%", cls: "pdf-preview-zoom-reset-btn" });
        this.zoomResetBtnEl.type = "button";
        this.zoomResetBtnEl.setAttribute("aria-label", "Reset preview zoom");
        this.zoomResetBtnEl.addEventListener("click", () => this.setZoomLevel(1.0));

        const zoomInBtn = previewControls.createEl("button", { text: "+", cls: "pdf-preview-zoom-btn" });
        zoomInBtn.type = "button";
        zoomInBtn.setAttribute("aria-label", "Zoom in preview");
        zoomInBtn.addEventListener("click", () => this.setZoomLevel(this.zoomLevel + 0.25));

        this.stopPreviewBtnEl = previewControls.createEl("button", { cls: "mod-warning pdf-preview-stop-btn" });
        this.stopPreviewBtnEl.type = "button";
        this.stopPreviewBtnEl.setAttribute("aria-label", "Stop preview generation");
        const stopIconEl = this.stopPreviewBtnEl.createSpan({ cls: "pdf-preview-btn-icon" });
        setIcon(stopIconEl, "square");
        this.stopPreviewBtnEl.createSpan({ text: "Stop" });
        this.stopPreviewBtnEl.addEventListener("click", () => {
            void this.cancelInFlightPreview(true);
        });

        this.reloadBtnEl = previewControls.createEl("button", { cls: "pdf-preview-reload-btn" });
        this.reloadBtnEl.type = "button";
        this.reloadBtnEl.setAttribute("aria-label", "Reload preview");
        const reloadIconEl = this.reloadBtnEl.createSpan({ cls: "pdf-preview-btn-icon" });
        setIcon(reloadIconEl, "refresh-cw");
        this.reloadBtnEl.createSpan({ text: "Reload" });
        this.reloadBtnEl.addEventListener("click", () => {
            if (this.fontPathBlurTimer !== null) {
                window.clearTimeout(this.fontPathBlurTimer);
                this.fontPathBlurTimer = null;
            }
            if (this.pageBreakBlurTimer !== null) {
                window.clearTimeout(this.pageBreakBlurTimer);
                this.pageBreakBlurTimer = null;
            }
            if (this.debounceTimer !== null) {
                window.clearTimeout(this.debounceTimer);
                this.debounceTimer = null;
            }
            if (this.plugin.sidebarSettings.fontFamily === 'custom') {
                const currentFontPath = (this.plugin.sidebarSettings.customFontPath || '').trim();
                this.lastValidatedFontPath = currentFontPath;
                if (currentFontPath && !this.plugin.resolveVaultFontFile(currentFontPath)) {
                    new Notice("Custom font file not found at: " + currentFontPath);
                }
            }
            this.plugin.clearRenderCache();
            this.lastRenderedDocKey = null;
            void this.updatePreview();
        });

        this.previewContainer = container.createDiv({ cls: "pdf-preview-container" });
        this.zoomWrapper = this.previewContainer.createDiv({ cls: "pdf-preview-zoom-wrapper" });

        container.createDiv({ cls: "pdf-sidebar-divider-spaced" });

        const generateWrap = container.createDiv({ cls: "pdf-generate-wrap" });
        const generateBtn = generateWrap.createEl("button", { text: "Generate", cls: "mod-cta pdf-generate-btn" });
        generateBtn.type = "button";
        generateBtn.addEventListener("click", () => {
            void this.plugin.exportToPdf(this.plugin.cloneSettings(this.plugin.sidebarSettings));
        });

        this.previewContainer.addEventListener('wheel', (e) => {
            if (e.ctrlKey || e.metaKey) {
                e.preventDefault();
                const delta = e.deltaY < 0 ? 0.15 : -0.15;
                this.setZoomLevel(this.zoomLevel + delta);
            }
        }, { passive: false });

        this.previewContainer.addEventListener('touchstart', (e) => {
            if (e.touches.length === 2) {
                this.lastDist = Math.hypot(e.touches[0].pageX - e.touches[1].pageX, e.touches[0].pageY - e.touches[1].pageY);
            }
        }, { passive: false });

        this.previewContainer.addEventListener('touchmove', (e) => {
            if (e.touches.length === 2) {
                e.preventDefault();
                const dist = Math.hypot(e.touches[0].pageX - e.touches[1].pageX, e.touches[0].pageY - e.touches[1].pageY);
                if (this.lastDist > 0) {
                    const oldZoom = this.zoomLevel;
                    this.zoomLevel = Math.max(1.0, Math.min(3.0, this.zoomLevel * (1 + (dist / this.lastDist - 1) * 0.4)));
                    const ratio = this.zoomLevel / oldZoom;
                    const top = this.previewContainer.scrollTop;
                    const left = this.previewContainer.scrollLeft;
                    this.zoomWrapper.style.width = `${100 * this.zoomLevel}%`;
                    this.previewContainer.scrollTop = top * ratio;
                    this.previewContainer.scrollLeft = left * ratio;
                    if (this.zoomResetBtnEl) {
                        this.zoomResetBtnEl.textContent = `${Math.round(this.zoomLevel * 100)}%`;
                    }
                }
                this.lastDist = dist;
            }
        }, { passive: false });

        if (shouldTriggerPreview) {
            if (this.isSidebarVisible()) {
                this.triggerPreview();
            } else {
                this.pendingPreviewRefresh = true;
            }
        } else {
            this.zoomWrapper.createDiv({
                text: "Auto-regenerate preview is off. Click reload to generate a preview.",
                cls: "pdf-no-file"
            });
        }
        return Promise.resolve();
    }

    triggerPreview() {
        if (this.isClosed) return;
        if (!this.isSidebarVisible()) {
            this.markPendingRefresh();
            return;
        }
        this.pendingPreviewRefresh = false;
        if (this.debounceTimer !== null) {
            window.clearTimeout(this.debounceTimer);
        }
        this.debounceTimer = window.setTimeout(() => {
            void this.updatePreview();
        }, 400);
    }

    async updatePreview() {
        if (this.isClosed || !this.previewContainer?.isConnected) return;
        if (!this.isSidebarVisible()) {
            this.pendingPreviewRefresh = true;
            return;
        }
        this.pendingPreviewRefresh = false;

        const initialTargetFile = this.plugin.getTargetMarkdownFile();
        if (!initialTargetFile) {
            this.previewRenderVersion++;
            if (this.queuedPreviewJobId !== null) {
                const prevId = this.queuedPreviewJobId;
                this.queuedPreviewJobId = null;
                this.plugin.cancelWorkJob(prevId);
            }
            this.lastRenderedDocKey = null;
            this.zoomWrapper.empty();
            this.setZoomLevel(1.0);
            this.stopPreviewTimer();
            this.setPreviewCancelButtonVisible(false);
            if (this.previewTimerEl) this.previewTimerEl.textContent = "";
            this.zoomWrapper.createDiv({ text: "Please open a Markdown note to export.", cls: "pdf-no-file" });
            return;
        }

        const version = ++this.previewRenderVersion;

        const buildDocKey = (file: TFile, s: PdfPluginSettings): string => JSON.stringify([
            file.path,
            file.stat.mtime,
            s.pdfTheme,
            s.pageSize,
            s.pageOrientation,
            s.autoLandscapeWidePages,
            s.marginPreset,
            s.customMarginMm,
            s.contentScale,
            s.fontFamily,
            s.customFontPath,
            s.showTitle,
            s.showFrontmatter,
            s.showHeader,
            s.headerTemplate,
            s.headerDateFormat,
            s.headerTimeFormat,
            s.showFootnote,
            s.footnoteTemplate,
            s.footnoteDateFormat,
            s.footnoteTimeFormat,
            s.optimizeImages,
            s.includeBookmarks,
            s.includeTocPage,
            s.bookmarkHeadingLevels,
            s.enableClickableLinks,
            s.showLineNumbersInPreview
        ]);

        const showQueuedUi = (pos: number) => {
            if (this.isClosed || version !== this.previewRenderVersion) return;
            this.stopPreviewTimer();
            if (this.previewTimerEl) {
                this.previewTimerEl.textContent = `Queued (#${pos})...`;
                this.previewTimerEl.removeClass('is-running', 'is-error');
            }
            this.setPreviewCancelButtonVisible(true);
            const existingPages = this.zoomWrapper.querySelectorAll('.pdf-preview-page');
            const isInc = this.lastRenderedDocKey === buildDocKey(initialTargetFile, this.plugin.sidebarSettings) && existingPages.length > 0;
            if (!isInc) {
                const existingLoading = this.zoomWrapper.querySelector<HTMLElement>('.pdf-loading');
                if (existingLoading) {
                    existingLoading.textContent = `Queued (#${pos}) — waiting for active export...`;
                } else {
                    this.zoomWrapper.empty();
                    this.setZoomLevel(1.0);
                    this.zoomWrapper.createDiv({
                        text: `Queued (#${pos}) — waiting for active export...`,
                        cls: "pdf-loading"
                    });
                }
            }
        };

        let myJobId = 0;
        const { id, position, promise } = this.plugin.enqueueWorkJob<void>({
            kind: 'preview',
            label: `Preview "${initialTargetFile.basename}"`,
            dedupePendingPreview: true,
            notifyIfQueued: false,
            onCancel: () => {
                if (version === this.previewRenderVersion) {
                    this.previewRenderVersion++;
                }
            },
            onQueueChanged: (newPos) => {
                showQueuedUi(newPos);
            },
            onCancelledWhileQueued: () => {
                if (this.queuedPreviewJobId === myJobId) {
                    this.queuedPreviewJobId = null;
                }
                if (this.isClosed || version !== this.previewRenderVersion) return;
                this.stopPreviewTimer();
                this.setPreviewCancelButtonVisible(false);
                if (this.previewTimerEl) {
                    this.previewTimerEl.textContent = 'Cancelled';
                    this.previewTimerEl.removeClass('is-running', 'is-error');
                }
                if (this.zoomWrapper && this.zoomWrapper.querySelector('.pdf-loading')) {
                    this.zoomWrapper.empty();
                    this.zoomWrapper.createDiv({
                        text: 'Preview generation cancelled. Click reload to generate again.',
                        cls: 'pdf-no-file'
                    });
                }
            },
            run: async (ctrl) => {
                if (this.queuedPreviewJobId === myJobId) {
                    this.queuedPreviewJobId = null;
                }
                if (this.isClosed || version !== this.previewRenderVersion || ctrl.isCancelled()) return;
                if (!this.isSidebarVisible()) {
                    this.pendingPreviewRefresh = true;
                    this.stopPreviewTimer();
                    this.setPreviewCancelButtonVisible(false);
                    return;
                }

                const runTask = async () => {
                    const file = this.plugin.getTargetMarkdownFile();
                    if (!file) {
                        this.lastRenderedDocKey = null;
                        this.zoomWrapper.empty();
                        this.setZoomLevel(1.0);
                        this.stopPreviewTimer();
                        this.setPreviewCancelButtonVisible(false);
                        if (this.previewTimerEl) this.previewTimerEl.textContent = "";
                        this.zoomWrapper.createDiv({ text: "Please open a Markdown note to export.", cls: "pdf-no-file" });
                        return;
                    }

                    const previewSettings = this.plugin.cloneSettings(this.plugin.sidebarSettings);
                    const activeBreaksSnapshot = previewSettings.pageBreaks || '';
                    const currentDocKey = buildDocKey(file, previewSettings);
                    const existingPageWrappers = Array.from(this.zoomWrapper.querySelectorAll<HTMLElement>('.pdf-preview-page'));
                    const isIncrementalCandidate = this.lastRenderedDocKey === currentDocKey && existingPageWrappers.length > 0;

                    if (!isIncrementalCandidate) {
                        this.zoomWrapper.empty();
                        this.setZoomLevel(1.0);
                        this.zoomWrapper.createDiv({ text: "Generating...", cls: "pdf-loading" });
                    }

                    const startTime = this.startPreviewTimer();
                    this.setPreviewCancelButtonVisible(true);
                    let pdf: PdfJsDocument | null = null;
                    try {
                        const { buffer, previewBaseLayout } = await this.plugin.runWithSettings(previewSettings, async () => {
                            const buf = await this.plugin.generatePdfData(
                                file,
                                previewSettings.showLineNumbersInPreview,
                                {
                                    isPreview: true,
                                    shouldCancel: () => this.isClosed || version !== this.previewRenderVersion || ctrl.isCancelled(),
                                    onProgress: (current, total) => {
                                        if (!this.isClosed && version === this.previewRenderVersion && !ctrl.isCancelled()) {
                                            this.previewProgressLabel = `${current}/${total}`;
                                        }
                                    }
                                }
                            );
                            return { buffer: buf, previewBaseLayout: this.plugin.getPdfPageLayout() };
                        });
                        if (!buffer || this.isClosed || version !== this.previewRenderVersion || ctrl.isCancelled()) return;

                        const pdfjsLib = (await loadPdfJs()) as PdfJsLib;
                        pdf = await pdfjsLib.getDocument({ data: buffer.slice(0) }).promise;
                        if (this.isClosed || version !== this.previewRenderVersion || ctrl.isCancelled()) {
                            if (typeof pdf.destroy === 'function') await pdf.destroy().catch(() => {});
                            return;
                        }

                        // Swap active pdf.js handle (kept alive so IntersectionObserver renders offscreen pages on scroll)
                        this.disposePreviewPdf();
                        this.activePreviewPdf = pdf;

                        const footnoteHasTotal = (previewSettings.showFootnote && previewSettings.footnoteTemplate.includes('{total}'))
                            || (previewSettings.showHeader && previewSettings.headerTemplate.includes('{total}'));
                        const canKeepExistingCanvases = !footnoteHasTotal || existingPageWrappers.length === pdf.numPages;
                        const reusedCount = (isIncrementalCandidate && canKeepExistingCanvases)
                            ? Math.min(this.plugin.lastReusedPreviewPages, existingPageWrappers.length, pdf.numPages)
                            : 0;

                        if (reusedCount > 0) {
                            for (let idx = existingPageWrappers.length - 1; idx >= reusedCount; idx--) {
                                existingPageWrappers[idx].remove();
                            }
                            for (let idx = 0; idx < reusedCount; idx++) {
                                const labelEl = existingPageWrappers[idx].querySelector('.pdf-preview-page-label');
                                if (labelEl) {
                                    labelEl.textContent = `Page ${idx + 1} / ${pdf.numPages}`;
                                }
                            }
                        } else {
                            this.zoomWrapper.empty();
                        }

                        const renderedPages = new Set<number>();
                        const renderPreviewPage = async (pageNum: number, canvas: HTMLCanvasElement) => {
                            if (!pdf || renderedPages.has(pageNum) || this.isClosed || version !== this.previewRenderVersion || this.activePreviewPdf !== pdf) {
                                return;
                            }
                            renderedPages.add(pageNum);
                            try {
                                const page = await pdf.getPage(pageNum);
                                if (this.isClosed || version !== this.previewRenderVersion || this.activePreviewPdf !== pdf) return;
                                const viewport = page.getViewport({ scale: 1.5 });
                                const context = canvas.getContext('2d', { alpha: false });
                                if (!context) return;
                                canvas.height = viewport.height;
                                canvas.width = viewport.width;
                                canvas.style.aspectRatio = '';
                                await page.render({ canvasContext: context, viewport }).promise;
                            } catch {
                                renderedPages.delete(pageNum);
                            }
                        };

                        const pendingLazy: Array<{ pageNum: number; wrapper: HTMLElement; canvas: HTMLCanvasElement }> = [];
                        const eagerEnd = Math.min(pdf.numPages, reusedCount + 3);

                        const defaultAspectRatio = `${previewBaseLayout.pageWidth} / ${previewBaseLayout.pageHeight}`;
                        for (let i = reusedCount + 1; i <= pdf.numPages; i++) {
                            if (this.isClosed || version !== this.previewRenderVersion || ctrl.isCancelled()) return;
                            const wrapper = this.zoomWrapper.createDiv({ cls: "pdf-preview-page" });
                            const canvas = wrapper.createEl("canvas");
                            canvas.style.aspectRatio = defaultAspectRatio;
                            wrapper.createDiv({
                                text: `Page ${i} / ${pdf.numPages}`,
                                cls: "setting-item-description pdf-preview-page-label"
                            });

                            if (i <= eagerEnd) {
                                await renderPreviewPage(i, canvas);
                            } else {
                                pendingLazy.push({ pageNum: i, wrapper, canvas });
                            }
                        }

                        if (pendingLazy.length > 0 && !this.isClosed && version === this.previewRenderVersion && !ctrl.isCancelled()) {
                            if (typeof IntersectionObserver !== 'undefined') {
                                const lookup = new Map<Element, { pageNum: number; canvas: HTMLCanvasElement }>();
                                const observer = new IntersectionObserver((entries) => {
                                    for (const entry of entries) {
                                        if (!entry.isIntersecting) continue;
                                        const info = lookup.get(entry.target);
                                        if (!info) continue;
                                        observer.unobserve(entry.target);
                                        lookup.delete(entry.target);
                                        void renderPreviewPage(info.pageNum, info.canvas);
                                    }
                                }, {
                                    root: this.previewContainer,
                                    rootMargin: '700px 0px'
                                });
                                this.pageObserver = observer;
                                for (const item of pendingLazy) {
                                    lookup.set(item.wrapper, { pageNum: item.pageNum, canvas: item.canvas });
                                    observer.observe(item.wrapper);
                                }
                            } else {
                                for (const item of pendingLazy) {
                                    if (this.isClosed || version !== this.previewRenderVersion || ctrl.isCancelled()) break;
                                    await renderPreviewPage(item.pageNum, item.canvas);
                                }
                            }
                        }

                        this.lastRenderedDocKey = currentDocKey;
                        this.lastRenderedPageBreaks = activeBreaksSnapshot;
                        if (version === this.previewRenderVersion && !this.isClosed) {
                            this.stopPreviewTimer(startTime, false);
                        }
                    } catch (e) {
                        if (this.isClosed || version !== this.previewRenderVersion) return;
                        this.disposePreviewPdf();
                        this.lastRenderedDocKey = null;
                        this.stopPreviewTimer(startTime, true);
                        this.zoomWrapper.empty();
                        this.zoomWrapper.createDiv({ text: "Error: " + e });
                    } finally {
                        if (version === this.previewRenderVersion && !this.isClosed) {
                            this.setPreviewCancelButtonVisible(false);
                        }
                    }
                };

                const taskPromise = runTask();
                this.activePreviewTask = taskPromise;
                try {
                    await taskPromise;
                } finally {
                    if (this.activePreviewTask === taskPromise) {
                        this.activePreviewTask = null;
                    }
                }
            }
        });

        myJobId = id;
        if (position > 0) {
            this.queuedPreviewJobId = id;
            showQueuedUi(position);
        }
        await promise;
    }
}

class PdfPluginSettingTab extends PluginSettingTab {
    plugin: PdfPlugin;
    private fontPathBlurTimer: number | null = null;
    private lastValidatedFontPath = '';

    constructor(app: App, plugin: PdfPlugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    hide(): void {
        if (this.fontPathBlurTimer !== null) {
            window.clearTimeout(this.fontPathBlurTimer);
            this.fontPathBlurTimer = null;
        }
    }

    display(): void {
        const { containerEl } = this;
        containerEl.empty();
        containerEl.addClass('pdf-settings-tab-root');
        if (Platform.isMobile) {
            containerEl.addClass('pdf-settings-tab-mobile');
        }
        const gs = this.plugin.globalSettings;
        this.lastValidatedFontPath = (gs.customFontPath || '').trim();

        const createCard = (title: string, desc?: string): HTMLElement => {
            const card = containerEl.createDiv({ cls: 'pdf-settings-card' });
            const header = card.createDiv({ cls: 'pdf-settings-card-header' });
            header.createDiv({ cls: 'pdf-settings-card-title', text: title });
            if (desc) {
                header.createDiv({ cls: 'pdf-settings-card-desc', text: desc });
            }
            return card.createDiv({ cls: 'pdf-settings-card-body' });
        };

        // 1. Page & layout
        const pageLayoutCard = createCard(
            "Page & layout",
            "Global default settings used by folder exports, merged PDF files, quick commands, CLI automation, and as the starting profile for the PDF sidebar. Temporary tweaks in the PDF sidebar do not change these defaults unless you save them as defaults."
        );

        new Setting(pageLayoutCard)
            .setName("Page size")
            .setDesc("Paper size for exported PDF files")
            .addDropdown(d => {
                d.addOption("a4", "A4 (210 × 297 mm)")
                    .addOption("letter", "Letter (215.9 × 279.4 mm)")
                    .addOption("a5", "A5 (148 × 210 mm)")
                    .setValue(gs.pageSize)
                    .onChange(async v => {
                        gs.pageSize = v as 'a4' | 'letter' | 'a5';
                        await this.plugin.saveSettings();
                        this.plugin.syncSidebarFromGlobalSettings(['pageSize']);
                    });
            });

        new Setting(pageLayoutCard)
            .setName("Orientation")
            .setDesc("Portrait (vertical) or landscape (horizontal, ideal for wide tables & diagrams)")
            .addDropdown(d => {
                d.addOption("portrait", "Portrait")
                    .addOption("landscape", "Landscape")
                    .setValue(gs.pageOrientation)
                    .onChange(async v => {
                        gs.pageOrientation = v as 'portrait' | 'landscape';
                        await this.plugin.saveSettings();
                        this.plugin.syncSidebarFromGlobalSettings(['pageOrientation']);
                        this.display();
                    });
            });

        if (gs.pageOrientation === 'portrait') {
            new Setting(pageLayoutCard)
                .setName("Auto-landscape wide pages")
                .setDesc("Automatically switch individual pages to landscape when wide tables, diagrams, equations, or panoramic images are detected")
                .addToggle(t => t
                    .setValue(gs.autoLandscapeWidePages)
                    .onChange(async v => {
                        gs.autoLandscapeWidePages = v;
                        await this.plugin.saveSettings();
                        this.plugin.syncSidebarFromGlobalSettings(['autoLandscapeWidePages']);
                    })
                );
        }

        new Setting(pageLayoutCard)
            .setName("Margins")
            .setDesc("Page margins preset or custom value in mm")
            .addDropdown(d => {
                d.addOption("narrow", "Narrow (10 mm)")
                    .addOption("normal", "Normal (15 mm)")
                    .addOption("wide", "Wide (25 mm)")
                    .addOption("custom", "Custom (mm)")
                    .setValue(gs.marginPreset)
                    .onChange(async v => {
                        gs.marginPreset = v as 'narrow' | 'normal' | 'wide' | 'custom';
                        await this.plugin.saveSettings();
                        this.plugin.syncSidebarFromGlobalSettings(['marginPreset']);
                        this.display();
                    });
            });

        if (gs.marginPreset === 'custom') {
            new Setting(pageLayoutCard)
                .setName("Custom margin (mm)")
                .setDesc("Page margin on all sides (5–45 mm)")
                .addText(t => {
                    t.inputEl.type = 'number';
                    t.inputEl.min = '5';
                    t.inputEl.max = '45';
                    t.inputEl.step = '1';
                    t.setValue(String(gs.customMarginMm))
                        .onChange(async v => {
                            const parsed = parseInt(v, 10);
                            if (!isNaN(parsed)) {
                                gs.customMarginMm = Math.max(5, Math.min(45, parsed));
                                await this.plugin.saveSettings();
                                this.plugin.syncSidebarFromGlobalSettings(['customMarginMm']);
                            }
                        });
                    t.inputEl.addEventListener('blur', () => {
                        void (async () => {
                            const parsed = parseInt(t.getValue(), 10);
                            const clamped = isNaN(parsed) ? 15 : Math.max(5, Math.min(45, parsed));
                            t.setValue(String(clamped));
                            if (gs.customMarginMm !== clamped) {
                                gs.customMarginMm = clamped;
                                await this.plugin.saveSettings();
                                this.plugin.syncSidebarFromGlobalSettings(['customMarginMm']);
                            }
                        })();
                    });
                });
        }

        const tabScaleSetting = new Setting(pageLayoutCard)
            .setName("Content scale")
            .setDesc("Adjust text and content density on the page (80%–120%)");
        const tabScaleLabel = tabScaleSetting.controlEl.createSpan({
            cls: 'pdf-scale-value-label',
            text: `${gs.contentScale}%`
        });
        tabScaleSetting.addSlider(s => {
            s.setLimits(80, 120, 5)
                .setValue(gs.contentScale)
                .onChange(async v => {
                    const clamped = Math.max(80, Math.min(120, Math.round(v / 5) * 5));
                    tabScaleLabel.textContent = `${clamped}%`;
                    gs.contentScale = clamped;
                    await this.plugin.saveSettings();
                    this.plugin.syncSidebarFromGlobalSettings(['contentScale']);
                });
        });

        // 2. Appearance & typography
        const appearanceCard = createCard(
            "Appearance & typography",
            "Page background theme and document font settings."
        );

        new Setting(appearanceCard)
            .setName("Page theme")
            .setDesc("Page background: match Obsidian, white, or black")
            .addDropdown(d => {
                d.addOption("css", "Match Obsidian (default)")
                    .addOption("light", "White (light)")
                    .addOption("dark", "Black (dark)")
                    .setValue(gs.pdfTheme)
                    .onChange(async v => {
                        gs.pdfTheme = v as 'light' | 'dark' | 'css';
                        await this.plugin.saveSettings();
                        this.plugin.syncSidebarFromGlobalSettings(['pdfTheme']);
                    });
            });

        new Setting(appearanceCard)
            .setName("Font family")
            .setDesc("Use Obsidian's font or a custom .ttf from your vault")
            .addDropdown(d => {
                d.addOption("obsidian", "Obsidian default (theme font)")
                    .addOption("custom", "Custom (.ttf from vault)")
                    .setValue(gs.fontFamily)
                    .onChange(async v => {
                        gs.fontFamily = v;
                        await this.plugin.saveSettings();
                        this.plugin.syncSidebarFromGlobalSettings(['fontFamily']);
                        this.display();
                    });
            });

        if (gs.fontFamily === 'custom') {
            const fontPathSetting = new Setting(appearanceCard)
                .setName("Font path (.ttf)")
                .setDesc("Select or type path to a .ttf file in your vault");
            fontPathSetting.addText(t => {
                t.setPlaceholder("Fonts/MyFont.ttf")
                    .setValue(gs.customFontPath)
                    .onChange(async v => {
                        gs.customFontPath = v;
                        await this.plugin.saveSettings();
                    });
                this.plugin.attachPathAutocomplete(
                    fontPathSetting,
                    t.inputEl,
                    (q) => this.plugin.getMatchingTtfSuggestions(q),
                    async (selected) => {
                        if (this.fontPathBlurTimer !== null) {
                            window.clearTimeout(this.fontPathBlurTimer);
                            this.fontPathBlurTimer = null;
                        }
                        gs.customFontPath = selected;
                        await this.plugin.saveSettings();
                        this.lastValidatedFontPath = selected.trim();
                        this.plugin.syncSidebarFromGlobalSettings(['customFontPath']);
                    },
                    "No .ttf files found in vault (place .ttf files in a vault folder)"
                );
                t.inputEl.addEventListener('blur', () => {
                    if (this.fontPathBlurTimer !== null) window.clearTimeout(this.fontPathBlurTimer);
                    this.fontPathBlurTimer = window.setTimeout(() => {
                        void (async () => {
                            const currentPath = (gs.customFontPath || '').trim();
                            if (currentPath === this.lastValidatedFontPath) return;

                            if (currentPath === '') {
                                this.lastValidatedFontPath = '';
                                this.plugin.syncSidebarFromGlobalSettings(['customFontPath']);
                                return;
                            }

                            const fontFile = this.plugin.resolveVaultFontFile(currentPath);
                            if (!fontFile) {
                                this.lastValidatedFontPath = currentPath;
                                new Notice("Custom font file not found at: " + currentPath);
                                return;
                            }

                            if (fontFile.path !== gs.customFontPath) {
                                gs.customFontPath = fontFile.path;
                                t.setValue(fontFile.path);
                                await this.plugin.saveSettings();
                            }
                            this.lastValidatedFontPath = fontFile.path;
                            this.plugin.syncSidebarFromGlobalSettings(['customFontPath']);
                        })();
                    }, 210);
                });
            });
        }

        // 3. Document content
        const contentCard = createCard(
            "Document content",
            "Control whether the note title and YAML properties appear at the start of the PDF."
        );

        new Setting(contentCard)
            .setName("Show note title")
            .setDesc("Include the note title at the top of the PDF")
            .addToggle(t => t.setValue(gs.showTitle).onChange(async v => {
                gs.showTitle = v;
                await this.plugin.saveSettings();
                this.plugin.syncSidebarFromGlobalSettings(['showTitle']);
            }));

        new Setting(contentCard)
            .setName("Show properties (frontmatter)")
            .setDesc("Include YAML frontmatter properties neatly at the top of page 1")
            .addToggle(t => t.setValue(gs.showFrontmatter).onChange(async v => {
                gs.showFrontmatter = v;
                await this.plugin.saveSettings();
                this.plugin.syncSidebarFromGlobalSettings(['showFrontmatter']);
            }));

        // 4. Header & footnote
        const headerFootnoteCard = createCard(
            "Header & footnote",
            "Running header and footnote templates with independent date and time formats."
        );

        const sampleNow = moment();

        new Setting(headerFootnoteCard)
            .setName("Show header")
            .setDesc("Include a customizable header on every page")
            .addToggle(t => t.setValue(gs.showHeader).onChange(async v => {
                gs.showHeader = v;
                await this.plugin.saveSettings();
                this.plugin.syncSidebarFromGlobalSettings(['showHeader']);
                this.display();
            }));

        if (gs.showHeader) {
            new Setting(headerFootnoteCard)
                .setName("Header template")
                .setDesc("Tokens: {title}, {date}, {time}, {page}, {total}, {date:FMT}, {time:FMT}")
                .addText(t => {
                    t.setPlaceholder("{title}")
                        .setValue(gs.headerTemplate)
                        .onChange(async v => {
                            gs.headerTemplate = v;
                            await this.plugin.saveSettings();
                            this.plugin.syncSidebarFromGlobalSettings(['headerTemplate']);
                        });
                });

            new Setting(headerFootnoteCard)
                .setName("Header date format")
                .setDesc("Format used by {date} in the header")
                .addDropdown(d => {
                    for (const val of FOOTNOTE_DATE_FORMATS) {
                        d.addOption(val, `${val} (${sampleNow.format(val)})`);
                    }
                    const current = gs.headerDateFormat || 'YYYY-MM-DD';
                    if (!FOOTNOTE_DATE_FORMATS.includes(current)) {
                        d.addOption(current, `${current} (${sampleNow.format(current)})`);
                    }
                    d.setValue(current).onChange(async v => {
                        gs.headerDateFormat = v;
                        await this.plugin.saveSettings();
                        this.plugin.syncSidebarFromGlobalSettings(['headerDateFormat']);
                    });
                });

            new Setting(headerFootnoteCard)
                .setName("Header time format")
                .setDesc("Format used by {time} in the header")
                .addDropdown(d => {
                    for (const val of FOOTNOTE_TIME_FORMATS) {
                        d.addOption(val, `${val} (${sampleNow.format(val)})`);
                    }
                    const current = gs.headerTimeFormat || 'HH:mm';
                    if (!FOOTNOTE_TIME_FORMATS.includes(current)) {
                        d.addOption(current, `${current} (${sampleNow.format(current)})`);
                    }
                    d.setValue(current).onChange(async v => {
                        gs.headerTimeFormat = v;
                        await this.plugin.saveSettings();
                        this.plugin.syncSidebarFromGlobalSettings(['headerTimeFormat']);
                    });
                });
        }

        new Setting(headerFootnoteCard)
            .setName("Show footnote")
            .setDesc("Include a footnote on every page")
            .addToggle(t => t.setValue(gs.showFootnote).onChange(async v => {
                gs.showFootnote = v;
                await this.plugin.saveSettings();
                this.plugin.syncSidebarFromGlobalSettings(['showFootnote']);
                this.display();
            }));

        if (gs.showFootnote) {
            new Setting(headerFootnoteCard)
                .setName("Footnote template")
                .setDesc("Tokens: {title}, {date}, {time}, {page}, {total}, {date:FMT}, {time:FMT}")
                .addText(t => {
                    t.setValue(gs.footnoteTemplate)
                        .onChange(async v => {
                            gs.footnoteTemplate = v;
                            await this.plugin.saveSettings();
                            this.plugin.syncSidebarFromGlobalSettings(['footnoteTemplate']);
                        });
                });

            new Setting(headerFootnoteCard)
                .setName("Footnote date format")
                .setDesc("Format used by {date} in the footnote")
                .addDropdown(d => {
                    for (const val of FOOTNOTE_DATE_FORMATS) {
                        d.addOption(val, `${val} (${sampleNow.format(val)})`);
                    }
                    const current = gs.footnoteDateFormat || 'YYYY-MM-DD';
                    if (!FOOTNOTE_DATE_FORMATS.includes(current)) {
                        d.addOption(current, `${current} (${sampleNow.format(current)})`);
                    }
                    d.setValue(current).onChange(async v => {
                        gs.footnoteDateFormat = v;
                        await this.plugin.saveSettings();
                        this.plugin.syncSidebarFromGlobalSettings(['footnoteDateFormat']);
                    });
                });

            new Setting(headerFootnoteCard)
                .setName("Footnote time format")
                .setDesc("Format used by {time} in the footnote")
                .addDropdown(d => {
                    for (const val of FOOTNOTE_TIME_FORMATS) {
                        d.addOption(val, `${val} (${sampleNow.format(val)})`);
                    }
                    const current = gs.footnoteTimeFormat || 'HH:mm';
                    if (!FOOTNOTE_TIME_FORMATS.includes(current)) {
                        d.addOption(current, `${current} (${sampleNow.format(current)})`);
                    }
                    d.setValue(current).onChange(async v => {
                        gs.footnoteTimeFormat = v;
                        await this.plugin.saveSettings();
                        this.plugin.syncSidebarFromGlobalSettings(['footnoteTimeFormat']);
                    });
                });
        }

        // 5. Navigation & links
        const navigationCard = createCard(
            "Navigation & links",
            "PDF bookmarks, page 1 index, heading levels, and clickable link annotations."
        );

        this.plugin.renderTocModeControl(
            navigationCard,
            () => {
                this.plugin.syncSidebarFromGlobalSettings(['includeBookmarks', 'includeTocPage']);
                this.display();
            },
            undefined,
            gs,
            true
        );

        if (gs.includeBookmarks || gs.includeTocPage) {
            this.plugin.renderBookmarkHeadingLevelsControl(
                navigationCard,
                () => {
                    this.plugin.syncSidebarFromGlobalSettings(['bookmarkHeadingLevels']);
                },
                undefined,
                gs,
                true
            );
        }

        new Setting(navigationCard)
            .setName("Clickable links")
            .setDesc("Keep external web links and internal links (headings, block references, footnotes, and cross-note links in merged PDF files) clickable")
            .addToggle(t => t.setValue(gs.enableClickableLinks).onChange(async v => {
                gs.enableClickableLinks = v;
                this.plugin.invalidateExportPdfCache();
                await this.plugin.saveSettings();
                this.plugin.syncSidebarFromGlobalSettings(['enableClickableLinks']);
            }));

        // 6. Output & compression
        const outputCard = createCard(
            "Output & compression",
            "File size optimization and default vault folders for single-note and recursive folder exports."
        );

        new Setting(outputCard)
            .setName("Optimize PDF size (smart compression)")
            .setDesc("Optimizes embedded images (webp 99%, skips already-webp & keeps original if larger) and compresses pages using lossless 8-bit indexed PNG for text pages or crisp 93% JPEG when smaller")
            .addToggle(t => t.setValue(gs.optimizeImages).onChange(async v => {
                gs.optimizeImages = v;
                await this.plugin.saveSettings();
                this.plugin.syncSidebarFromGlobalSettings(['optimizeImages']);
            }));

        const defaultExportPathSetting = new Setting(outputCard)
            .setName("Default export path")
            .setDesc("Destination folder for single-note PDF exports ('/' = vault root, empty = note folder)");
        defaultExportPathSetting.addText(t => {
            t.setPlaceholder("PDFs/Exports")
                .setValue(gs.defaultExportPath)
                .onChange(async v => {
                    gs.defaultExportPath = v;
                    await this.plugin.saveSettings();
                    this.plugin.syncSidebarFromGlobalSettings(['defaultExportPath']);
                });
            this.plugin.attachPathAutocomplete(
                defaultExportPathSetting,
                t.inputEl,
                (q) => this.plugin.getMatchingFolderSuggestions(q),
                async (selected) => {
                    gs.defaultExportPath = selected;
                    await this.plugin.saveSettings();
                    this.plugin.syncSidebarFromGlobalSettings(['defaultExportPath']);
                }
            );
        });

        const folderExportPathSetting = new Setting(outputCard)
            .setName("Folder export path")
            .setDesc("Base destination folder where a subfolder with the same name as the exported folder will be created ('/' = vault root, empty = sibling '<Folder> (PDF)')");
        folderExportPathSetting.addText(t => {
            t.setPlaceholder("PDFs/Exports")
                .setValue(gs.folderExportPath)
                .onChange(async v => {
                    gs.folderExportPath = v;
                    await this.plugin.saveSettings();
                });
            this.plugin.attachPathAutocomplete(
                folderExportPathSetting,
                t.inputEl,
                (q) => this.plugin.getMatchingFolderSuggestions(q),
                async (selected) => {
                    gs.folderExportPath = selected;
                    await this.plugin.saveSettings();
                }
            );
        });

        // 7. Preview
        const previewCard = createCard(
            "Preview",
            "Control how the PDF settings sidebar refreshes previews."
        );

        new Setting(previewCard)
            .setName("Auto-regenerate preview")
            .setDesc("Automatically generate and refresh the sidebar preview when opening the PDF sidebar, changing sidebar settings, or switching to another Markdown note")
            .addToggle(t => t.setValue(gs.autoRegeneratePreview).onChange(async v => {
                gs.autoRegeneratePreview = v;
                await this.plugin.saveSettings();
            }));

        // 8. CLI & AI agent automation
        const automationCard = createCard(
            "CLI & AI agent automation",
            "Trigger exports via obsidian://mobile-pdf-export URI or queued export-job.json (PC, Termux, iOS Shortcuts, AI agents)."
        );

        new Setting(automationCard)
            .setName("Auto-run queued export job on startup")
            .setDesc(`Automatically execute or resume ${this.app.vault.configDir}/plugins/markdown-to-pdf-mobile/export-job.json when Obsidian launches (disabled by default)`)
            .addToggle(t => t.setValue(gs.autoRunAutomationJob).onChange(async v => {
                gs.autoRunAutomationJob = v;
                await this.plugin.saveSettings();
            }));

        new Setting(automationCard)
            .setName("Run queued automation job now")
            .setDesc("Manually process export-job.json and write progress to export-result.json")
            .addButton(b => b
                .setButtonText("Run job")
                .onClick(() => {
                    void this.plugin.runAutomationJob();
                })
            );
    }
}

class FolderExportModal extends Modal {
    private plugin: PdfPlugin;
    private mode: 'separate' | 'merged';
    private currentItems: Array<{ value: string; label: string }> = [];
    private activeIdx = 0;

    constructor(app: App, plugin: PdfPlugin, mode: 'separate' | 'merged' = 'separate') {
        super(app);
        this.plugin = plugin;
        this.mode = mode;
    }

    onOpen(): void {
        const { contentEl } = this;
        contentEl.empty();

        const isMerged = this.mode === 'merged';
        contentEl.createEl('h3', {
            cls: 'pdf-modal-heading',
            text: isMerged ? 'Export folder as a single merged PDF' : 'Export folder to separate PDF files'
        });

        contentEl.createDiv({
            text: isMerged
                ? 'Select a folder to merge all Markdown notes (recursively) into a single PDF with chapter bookmarks:'
                : 'Select a folder to recursively export all Markdown notes to separate PDF files:',
            cls: 'setting-item-description pdf-modal-desc'
        });

        const inputEl = contentEl.createEl('input', { type: 'text', cls: 'pdf-modal-search-input' });
        inputEl.placeholder = 'Type to search folder paths...';

        const listEl = contentEl.createDiv({ cls: 'pdf-folder-modal-list' });

        const highlightRow = (idx: number) => {
            const rows = Array.from(listEl.children).filter((c): c is HTMLElement => c.instanceOf(HTMLElement));
            rows.forEach((row, i) => {
                row.toggleClass('is-active', i === idx);
            });
            if (idx >= 0 && rows[idx]) {
                rows[idx].scrollIntoView({ block: 'nearest' });
            }
        };

        const choosePath = (folderPath: string) => {
            const folder = folderPath === '/' || folderPath === ''
                ? this.app.vault.getRoot()
                : this.app.vault.getAbstractFileByPath(folderPath);
            if (!(folder instanceof TFolder)) {
                new Notice(`Folder not found: ${folderPath}`);
                return;
            }
            this.close();
            if (this.mode === 'merged') {
                void this.plugin.exportFolderAsMergedPdf(folder);
            } else {
                void this.plugin.exportFolderToPdfs(folder);
            }
        };

        const renderList = () => {
            this.currentItems = this.plugin.getMatchingFolderSuggestions(inputEl.value, 100);
            this.activeIdx = this.currentItems.length > 0 ? 0 : -1;
            listEl.empty();

            if (this.currentItems.length === 0) {
                listEl.createDiv({ cls: 'pdf-modal-empty-row', text: 'No matching folders found.' });
                return;
            }

            this.currentItems.forEach((item, idx) => {
                const row = listEl.createDiv({ cls: 'pdf-folder-modal-row' });

                const iconSpan = row.createSpan({ cls: 'pdf-folder-modal-icon' });
                setIcon(iconSpan, 'folder');
                row.createSpan({ text: item.label });

                row.addEventListener('mouseenter', () => {
                    this.activeIdx = idx;
                    highlightRow(idx);
                });

                row.addEventListener('click', (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    choosePath(item.value);
                });
            });

            highlightRow(this.activeIdx);
        };

        inputEl.addEventListener('input', renderList);
        inputEl.addEventListener('keydown', (e) => {
            if (this.currentItems.length === 0) return;
            if (e.key === 'ArrowDown') {
                e.preventDefault();
                this.activeIdx = (this.activeIdx + 1) % this.currentItems.length;
                highlightRow(this.activeIdx);
            } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                this.activeIdx = this.activeIdx <= 0 ? this.currentItems.length - 1 : this.activeIdx - 1;
                highlightRow(this.activeIdx);
            } else if (e.key === 'Enter' && this.activeIdx >= 0 && this.currentItems[this.activeIdx]) {
                e.preventDefault();
                choosePath(this.currentItems[this.activeIdx].value);
            }
        });

        renderList();
        window.setTimeout(() => inputEl.focus(), 20);
    }

    onClose(): void {
        this.contentEl.empty();
    }
}

interface MultiNoteMergeModalOptions {
    initialFiles?: TFile[];
    defaultOutputName?: string;
    defaultOutputDir?: string;
    title?: string;
    folderScopeMode?: boolean;
}

class MultiNoteMergeModal extends Modal {
    private plugin: PdfPlugin;
    private modalOptions: MultiNoteMergeModalOptions;
    private allFiles: TFile[] = [];
    private selectedPaths: string[] = [];
    private fileByPath = new Map<string, TFile>();
    private activeDragCleanupFn: (() => void) | null = null;

    constructor(app: App, plugin: PdfPlugin, options?: MultiNoteMergeModalOptions) {
        super(app);
        this.plugin = plugin;
        this.modalOptions = options || {};
    }

    onOpen(): void {
        const { contentEl } = this;
        contentEl.empty();

        this.allFiles = this.app.vault
            .getMarkdownFiles()
            .sort((a, b) => a.path.localeCompare(b.path, undefined, { sensitivity: 'base' }));
        this.fileByPath.clear();
        for (const f of this.allFiles) {
            this.fileByPath.set(f.path, f);
        }

        const activeFile = this.plugin.getTargetMarkdownFile();
        if (this.modalOptions.initialFiles && this.modalOptions.initialFiles.length > 0) {
            this.selectedPaths = this.modalOptions.initialFiles.map(f => f.path);
            for (const f of this.modalOptions.initialFiles) {
                this.fileByPath.set(f.path, f);
            }
        } else {
            this.selectedPaths = activeFile ? [activeFile.path] : [];
        }

        const isFolderMode = !!this.modalOptions.folderScopeMode;

        contentEl.createEl('h3', {
            cls: 'pdf-modal-heading',
            text: this.modalOptions.title || 'Merge multiple notes into a single PDF'
        });

        contentEl.createDiv({
            text: 'Reorder notes using the ↑ / ↓ arrows or by dragging the ≡ menu handle. Each note starts on a new page and becomes a chapter in the PDF outline.',
            cls: 'setting-item-description pdf-modal-desc'
        });

        // Output filename & destination folder inputs (stack vertically on mobile)
        const metaGrid = contentEl.createDiv({ cls: Platform.isMobile ? 'pdf-merge-meta-grid is-mobile' : 'pdf-merge-meta-grid' });

        const nameCol = metaGrid.createDiv();
        nameCol.createEl('label', { cls: 'pdf-merge-field-label', text: 'Output PDF name' });
        const nameInput = nameCol.createEl('input', { type: 'text', cls: 'pdf-merge-full-input' });
        nameInput.value = this.modalOptions.defaultOutputName
            || (activeFile ? `${activeFile.basename} (Merged)` : 'Merged Notes');
        nameInput.placeholder = 'Course notes';

        const dirCol = metaGrid.createDiv({ cls: 'pdf-merge-dir-col' });
        dirCol.createEl('label', { cls: 'pdf-merge-field-label', text: 'Destination folder' });
        const dirInput = dirCol.createEl('input', { type: 'text', cls: 'pdf-merge-full-input' });
        const defaultDir = this.modalOptions.defaultOutputDir !== undefined
            ? this.modalOptions.defaultOutputDir
            : ((this.plugin.globalSettings.defaultExportPath || '').trim() ||
                (activeFile?.parent && !activeFile.parent.isRoot() ? activeFile.parent.path : ''));
        dirInput.value = defaultDir;
        dirInput.placeholder = 'Empty = vault root';
        this.plugin.attachPathAutocompleteToElement(
            dirInput,
            dirInput,
            (q) => this.plugin.getMatchingFolderSuggestions(q),
            (selected) => {
                dirInput.value = selected === '/' ? '' : selected;
            }
        );

        // Available notes picker container (always visible in multi-note mode, collapsible in folder mode)
        const pickerSection = contentEl.createDiv();
        let pickerBody = pickerSection;
        let pickerToggleBtn: HTMLButtonElement | null = null;

        if (isFolderMode) {
            pickerSection.addClass('pdf-merge-picker-section');
            pickerToggleBtn = pickerSection.createEl('button', {
                cls: 'pdf-merge-picker-toggle',
                text: '+ Add more notes from vault'
            });
            pickerToggleBtn.type = 'button';
            pickerBody = pickerSection.createDiv({ cls: 'pdf-merge-picker-body is-collapsed' });
            pickerToggleBtn.addEventListener('click', () => {
                const open = !pickerBody.hasClass('is-collapsed');
                pickerBody.toggleClass('is-collapsed', open);
                if (pickerToggleBtn) {
                    pickerToggleBtn.textContent = open ? '+ Add more notes from vault' : '− Hide vault notes picker';
                }
                if (!open) {
                    window.setTimeout(() => searchInput.focus(), 20);
                }
            });
        }

        // Search bar + quick select buttons
        const searchRow = pickerBody.createDiv({ cls: 'pdf-merge-search-row' });

        const searchInput = searchRow.createEl('input', { type: 'text', cls: 'pdf-merge-search-input' });
        searchInput.placeholder = 'Search notes by name or folder...';

        const selectVisibleBtn = searchRow.createEl('button', {
            cls: 'pdf-merge-action-btn',
            text: 'Select visible'
        });
        selectVisibleBtn.type = 'button';

        const clearSelBtn = searchRow.createEl('button', {
            cls: 'pdf-merge-action-btn',
            text: 'Clear'
        });
        clearSelBtn.type = 'button';

        // Available notes checklist
        const listEl = pickerBody.createDiv({ cls: 'pdf-merge-available-list' });

        // Selected notes order section (placed ABOVE collapsible picker when in folder mode)
        const orderSection = contentEl.createDiv();
        if (isFolderMode) {
            contentEl.insertBefore(orderSection, pickerSection);
        }

        const orderHeaderRow = orderSection.createDiv({ cls: 'pdf-merge-order-header-row' });
        const orderHeader = orderHeaderRow.createDiv({ cls: 'pdf-merge-order-header' });
        const sortControls = orderHeaderRow.createDiv({ cls: 'pdf-merge-sort-controls' });

        const sortAscBtn = sortControls.createEl('button', { cls: 'pdf-merge-sort-btn', text: 'Asc' });
        sortAscBtn.type = 'button';
        sortAscBtn.title = 'Sort chapters alphabetically (A to Z)';

        const sortDescBtn = sortControls.createEl('button', { cls: 'pdf-merge-sort-btn', text: 'Desc' });
        sortDescBtn.type = 'button';
        sortDescBtn.title = 'Sort chapters reverse alphabetically (Z to A)';

        const orderListEl = orderSection.createDiv({
            cls: isFolderMode ? 'pdf-merge-order-list is-folder-mode' : 'pdf-merge-order-list'
        });

        // Footer buttons
        const footerRow = contentEl.createDiv({ cls: 'pdf-merge-footer-row' });

        const cancelBtn = footerRow.createEl('button', { text: 'Cancel' });
        cancelBtn.type = 'button';
        cancelBtn.addEventListener('click', () => this.close());

        const exportBtn = footerRow.createEl('button', { text: 'Export merged PDF', cls: 'mod-cta' });
        exportBtn.type = 'button';

        let currentVisibleFiles: TFile[] = [];

        const getFilteredFiles = (): TFile[] => {
            const cleaned = searchInput.value.trim().replace(/^\/+/, '').toLowerCase();
            const tokens = cleaned.split(/\s+/).filter(Boolean);
            if (tokens.length === 0) return this.allFiles.slice(0, 150);
            const scored: Array<{ file: TFile; rank: number }> = [];
            for (const f of this.allFiles) {
                const rank = this.plugin.scoreTokenPathMatch(f.path.toLowerCase(), cleaned, tokens);
                if (rank !== null) {
                    scored.push({ file: f, rank });
                }
            }
            scored.sort((a, b) => a.rank - b.rank || a.file.path.localeCompare(b.file.path, undefined, { sensitivity: 'base' }));
            return scored.slice(0, 150).map(item => item.file);
        };

        const getNoteDisplayName = (path: string): string => {
            const f = this.fileByPath.get(path);
            if (f && f.basename) return f.basename;
            const leaf = path.split('/').pop() || path;
            return leaf.replace(/\.md$/i, '');
        };

        let activeDragCleanup: (() => void) | null = null;
        this.activeDragCleanupFn = () => {
            if (activeDragCleanup) {
                activeDragCleanup();
                activeDragCleanup = null;
            }
        };

        const updateFooterAndOrder = () => {
            const count = this.selectedPaths.length;
            orderHeader.textContent = `Chapter order (${count} selected)`;
            exportBtn.textContent = count > 0 ? `Export merged PDF (${count})` : 'Export merged PDF';
            exportBtn.disabled = count === 0;
            sortAscBtn.disabled = count < 2;
            sortDescBtn.disabled = count < 2;

            orderListEl.empty();
            if (count === 0) {
                orderListEl.createDiv({ cls: 'pdf-modal-empty-compact', text: 'No notes selected yet.' });
                return;
            }

            this.selectedPaths.forEach((path, idx) => {
                const f = this.fileByPath.get(path);
                if (!f) return;
                const row = orderListEl.createDiv({ cls: 'pdf-merge-order-row' });
                row.setAttribute('data-note-path', path);

                const labelWrap = row.createDiv({ cls: 'pdf-merge-row-label-wrap' });
                labelWrap.createSpan({ text: `${idx + 1}.`, cls: 'pdf-merge-row-num' });
                const nameSpan = labelWrap.createSpan({ text: f.basename, cls: 'pdf-merge-row-name' });
                nameSpan.title = f.path;

                const controls = row.createDiv({ cls: 'pdf-merge-row-controls' });

                // 1. FIRST: Up / Down arrow buttons
                const upBtn = controls.createEl('button', { text: '↑', cls: 'pdf-merge-up-btn pdf-merge-row-btn' });
                upBtn.type = 'button';
                upBtn.title = 'Move up';
                upBtn.setAttribute('aria-label', 'Move up');
                upBtn.disabled = idx === 0;
                upBtn.addEventListener('click', () => {
                    const curIdx = this.selectedPaths.indexOf(path);
                    if (curIdx > 0) {
                        const tmp = this.selectedPaths[curIdx - 1];
                        this.selectedPaths[curIdx - 1] = this.selectedPaths[curIdx];
                        this.selectedPaths[curIdx] = tmp;
                        updateFooterAndOrder();
                    }
                });

                const downBtn = controls.createEl('button', { text: '↓', cls: 'pdf-merge-down-btn pdf-merge-row-btn' });
                downBtn.type = 'button';
                downBtn.title = 'Move down';
                downBtn.setAttribute('aria-label', 'Move down');
                downBtn.disabled = idx === count - 1;
                downBtn.addEventListener('click', () => {
                    const curIdx = this.selectedPaths.indexOf(path);
                    if (curIdx !== -1 && curIdx < this.selectedPaths.length - 1) {
                        const tmp = this.selectedPaths[curIdx + 1];
                        this.selectedPaths[curIdx + 1] = this.selectedPaths[curIdx];
                        this.selectedPaths[curIdx] = tmp;
                        updateFooterAndOrder();
                    }
                });

                // 2. SECOND: Hamburger menu drag handle (smooth animated drag for both Desktop mouse & Mobile touch)
                const dragHandle = controls.createEl('button', { cls: 'pdf-merge-drag-handle' });
                dragHandle.type = 'button';
                dragHandle.title = 'Drag to reorder';
                dragHandle.setAttribute('aria-label', 'Drag to reorder');
                setIcon(dragHandle, 'menu');
                if (!dragHandle.querySelector('svg')) {
                    dragHandle.textContent = '≡';
                }

                dragHandle.addEventListener('pointerdown', (ev: PointerEvent) => {
                    if (this.selectedPaths.length < 2) return;
                    if (ev.pointerType === 'mouse' && ev.button !== 0) return;
                    ev.preventDefault();
                    ev.stopPropagation();

                    if (activeDragCleanup) {
                        activeDragCleanup();
                        activeDragCleanup = null;
                    }

                    const pointerId = ev.pointerId;
                    let currentDragIdx = this.selectedPaths.indexOf(path);
                    if (currentDragIdx === -1) return;

                    const rowRect = row.getBoundingClientRect();
                    const grabOffsetY = ev.clientY - rowRect.top;
                    let lastClientY = ev.clientY;
                    let finished = false;
                    let scrollRafId: number | null = null;

                    // Create dashed drop placeholder in the exact slot of the dragged row
                    const placeholder = createDiv({ cls: 'pdf-merge-drop-placeholder' });
                    placeholder.style.height = `${Math.max(28, Math.round(rowRect.height))}px`;
                    orderListEl.insertBefore(placeholder, row);

                    // Float dragged row smoothly above the modal in activeDocument.body (immune to modal CSS transforms
                    // and never drops pointer events because listeners are attached to window)
                    activeDocument.body.appendChild(row);
                    row.addClass('is-dragging');
                    row.style.left = `${rowRect.left}px`;
                    row.style.top = `${rowRect.top}px`;
                    row.style.width = `${rowRect.width}px`;
                    row.style.height = `${rowRect.height}px`;
                    activeDocument.body.addClass('pdf-merge-dragging-active');

                    const getSiblingRows = (): HTMLElement[] =>
                        Array.from(orderListEl.children).filter(
                            (c): c is HTMLElement => c.instanceOf(HTMLElement) && c.classList.contains('pdf-merge-order-row')
                        );

                    const updateLiveNumbers = () => {
                        const siblings = getSiblingRows();
                        let num = 1;
                        let sPos = 0;
                        const total = siblings.length + 1;
                        for (let slot = 0; slot < total; slot++) {
                            if (slot === currentDragIdx) {
                                const dragNum = row.querySelector<HTMLElement>('.pdf-merge-row-num');
                                if (dragNum) dragNum.textContent = `${num}.`;
                            } else if (sPos < siblings.length) {
                                const sibNum = siblings[sPos].querySelector<HTMLElement>('.pdf-merge-row-num');
                                if (sibNum) sibNum.textContent = `${num}.`;
                                sPos++;
                            }
                            num++;
                        }
                    };

                    const repositionFromClientY = (clientY: number) => {
                        const listRect = orderListEl.getBoundingClientRect();
                        const minTop = Math.min(listRect.top - 12, rowRect.top);
                        const maxTop = Math.max(listRect.bottom - rowRect.height + 12, rowRect.top);
                        const clampedTop = Math.max(minTop, Math.min(maxTop, clientY - grabOffsetY));
                        row.style.top = `${clampedTop}px`;

                        const dragCenterY = clampedTop + rowRect.height * 0.5;
                        const siblings = getSiblingRows();
                        let targetIdx = 0;
                        for (let i = 0; i < siblings.length; i++) {
                            const r = siblings[i].getBoundingClientRect();
                            if (dragCenterY > r.top + r.height * 0.5) {
                                targetIdx = i + 1;
                            } else {
                                break;
                            }
                        }

                        if (targetIdx !== currentDragIdx) {
                            // Capture sibling Y positions before DOM move for smooth FLIP slide animation
                            const beforeTops = new Map<HTMLElement, number>();
                            for (const sib of siblings) {
                                beforeTops.set(sib, sib.getBoundingClientRect().top);
                            }

                            const [movedPath] = this.selectedPaths.splice(currentDragIdx, 1);
                            this.selectedPaths.splice(targetIdx, 0, movedPath);

                            const refSibling = siblings[targetIdx] ?? null;
                            orderListEl.insertBefore(placeholder, refSibling);
                            currentDragIdx = targetIdx;
                            updateLiveNumbers();

                            // FLIP animate shifted siblings smoothly into their new slots
                            for (const sib of siblings) {
                                const prevTop = beforeTops.get(sib);
                                if (prevTop === undefined) continue;
                                const newTop = sib.getBoundingClientRect().top;
                                const dy = prevTop - newTop;
                                if (Math.abs(dy) >= 1) {
                                    sib.removeClass('is-flip-animate');
                                    sib.addClass('is-flip-reset');
                                    sib.style.transform = `translateY(${dy}px)`;
                                    void sib.offsetHeight;
                                    sib.removeClass('is-flip-reset');
                                    sib.addClass('is-flip-animate');
                                    sib.style.transform = '';
                                }
                            }
                        }
                    };

                    const autoScrollStep = () => {
                        if (finished) return;
                        const listRect = orderListEl.getBoundingClientRect();
                        const edgePx = 34;
                        let scrolled = false;
                        if (lastClientY < listRect.top + edgePx && orderListEl.scrollTop > 0) {
                            const ratio = Math.min(1, (listRect.top + edgePx - lastClientY) / edgePx);
                            orderListEl.scrollTop -= Math.max(3, Math.round(10 * ratio));
                            scrolled = true;
                        } else if (
                            lastClientY > listRect.bottom - edgePx &&
                            orderListEl.scrollTop + orderListEl.clientHeight < orderListEl.scrollHeight
                        ) {
                            const ratio = Math.min(1, (lastClientY - (listRect.bottom - edgePx)) / edgePx);
                            orderListEl.scrollTop += Math.max(3, Math.round(10 * ratio));
                            scrolled = true;
                        }
                        if (scrolled) {
                            repositionFromClientY(lastClientY);
                        }
                        scrollRafId = window.requestAnimationFrame(autoScrollStep);
                    };
                    scrollRafId = window.requestAnimationFrame(autoScrollStep);

                    const onPointerMove = (moveEv: PointerEvent) => {
                        if (finished || moveEv.pointerId !== pointerId) return;
                        moveEv.preventDefault();
                        lastClientY = moveEv.clientY;
                        repositionFromClientY(lastClientY);
                    };

                    const finishDrag = (endEv?: PointerEvent) => {
                        if (finished) return;
                        if (endEv && endEv.pointerId !== pointerId) return;
                        finished = true;
                        if (scrollRafId !== null) {
                            window.cancelAnimationFrame(scrollRafId);
                            scrollRafId = null;
                        }
                        window.removeEventListener('pointermove', onPointerMove);
                        window.removeEventListener('pointerup', finishDrag);
                        window.removeEventListener('pointercancel', finishDrag);
                        window.removeEventListener('blur', onWindowBlur);
                        activeDocument.body.removeClass('pdf-merge-dragging-active');
                        row.removeClass('is-dragging');

                        if (placeholder.parentElement === orderListEl) {
                            orderListEl.insertBefore(row, placeholder);
                            placeholder.remove();
                        } else if (row.parentElement === activeDocument.body) {
                            row.remove();
                        }

                        activeDragCleanup = null;
                        updateFooterAndOrder();
                    };

                    const onWindowBlur = () => finishDrag();

                    activeDragCleanup = () => finishDrag();
                    window.addEventListener('pointermove', onPointerMove, { passive: false });
                    window.addEventListener('pointerup', finishDrag);
                    window.addEventListener('pointercancel', finishDrag);
                    window.addEventListener('blur', onWindowBlur);
                });

                // 3. Remove button
                const rmBtn = controls.createEl('button', { text: '×', cls: 'pdf-merge-row-btn' });
                rmBtn.type = 'button';
                rmBtn.title = 'Remove from merge';
                rmBtn.setAttribute('aria-label', 'Remove from merge');
                rmBtn.addEventListener('click', () => {
                    const curIdx = this.selectedPaths.indexOf(path);
                    if (curIdx !== -1) {
                        this.selectedPaths.splice(curIdx, 1);
                        renderAvailableList();
                        updateFooterAndOrder();
                    }
                });
            });
        };

        const renderAvailableList = () => {
            currentVisibleFiles = getFilteredFiles();
            const selectedSet = new Set(this.selectedPaths);
            listEl.empty();

            if (currentVisibleFiles.length === 0) {
                listEl.createDiv({ cls: 'pdf-modal-empty-row', text: 'No matching Markdown notes found.' });
                return;
            }

            currentVisibleFiles.forEach((f) => {
                const row = listEl.createEl('label', { cls: 'pdf-merge-available-row' });

                const cb = row.createEl('input', { type: 'checkbox', cls: 'pdf-merge-available-cb' });
                cb.checked = selectedSet.has(f.path);

                const textWrap = row.createDiv({ cls: 'pdf-merge-available-text' });
                const titleSpan = textWrap.createSpan({ text: f.basename, cls: 'pdf-merge-available-title' });
                titleSpan.title = f.path;
                const parentPath = f.parent && !f.parent.isRoot() ? f.parent.path : '';
                if (parentPath) {
                    textWrap.createSpan({ text: parentPath, cls: 'pdf-merge-available-folder' });
                }

                cb.addEventListener('change', () => {
                    const existingIdx = this.selectedPaths.indexOf(f.path);
                    if (cb.checked && existingIdx === -1) {
                        this.selectedPaths.push(f.path);
                    } else if (!cb.checked && existingIdx !== -1) {
                        this.selectedPaths.splice(existingIdx, 1);
                    }
                    updateFooterAndOrder();
                });
            });
        };

        sortAscBtn.addEventListener('click', () => {
            this.selectedPaths.sort((a, b) => getNoteDisplayName(a).localeCompare(getNoteDisplayName(b), undefined, { sensitivity: 'base' }));
            updateFooterAndOrder();
        });

        sortDescBtn.addEventListener('click', () => {
            this.selectedPaths.sort((a, b) => getNoteDisplayName(b).localeCompare(getNoteDisplayName(a), undefined, { sensitivity: 'base' }));
            updateFooterAndOrder();
        });

        searchInput.addEventListener('input', renderAvailableList);

        selectVisibleBtn.addEventListener('click', () => {
            const selectedSet = new Set(this.selectedPaths);
            for (const f of currentVisibleFiles) {
                if (!selectedSet.has(f.path)) {
                    this.selectedPaths.push(f.path);
                    selectedSet.add(f.path);
                }
            }
            renderAvailableList();
            updateFooterAndOrder();
        });

        clearSelBtn.addEventListener('click', () => {
            this.selectedPaths = [];
            renderAvailableList();
            updateFooterAndOrder();
        });

        exportBtn.addEventListener('click', () => {
            const chosenFiles = this.selectedPaths
                .map(p => this.fileByPath.get(p))
                .filter((f): f is TFile => !!f);
            if (chosenFiles.length === 0) {
                new Notice('Please select at least one note to merge.');
                return;
            }
            const outName = nameInput.value.trim() || 'Merged Notes';
            const outDir = dirInput.value.trim();
            this.close();
            void this.plugin.exportMergedPdf(chosenFiles, outName, outDir);
        });

        renderAvailableList();
        updateFooterAndOrder();
        if (!isFolderMode) {
            window.setTimeout(() => searchInput.focus(), 20);
        }
    }

    onClose(): void {
        if (this.activeDragCleanupFn) {
            this.activeDragCleanupFn();
            this.activeDragCleanupFn = null;
        }
        this.contentEl.empty();
    }
}

