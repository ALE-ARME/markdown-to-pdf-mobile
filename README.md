# Markdown to PDF (Mobile) for Obsidian

A powerful Obsidian plugin specifically designed to export your notes to high-quality PDF files directly from your mobile device.

## Features

- **Mobile First:** Optimized for Android (and maybe iOS devices too) where native PDF export is often limited.
- **Theme Support:** Choose between **Light** and **Dark** themes for your PDF output.
- **Live Preview Sidebar:** Adjust settings and see an instant preview of your PDF before generating it.
- **Advanced Formatting:**
  - **Headings & Styling:** Maintains font sizes, bold, italic, underline, and strikethrough.
  - **Images & Captions:** Supports embedded images `![[image.png]]` with custom widths and **automatic captions** using the `![[image.png|Description|dimensions(optional)]]` syntax.
  - **Tables:** Renders Markdown tables beautifully using `jspdf-autotable`.
  - **Callouts & Blockquotes:** Accurately renders Obsidian callouts and blockquotes.
  - **LaTeX Math:** Supports both inline ($...$) and block ($$...$$) math expressions.
- **Customization:**
  - **Custom Fonts:** Use your own `.ttf` fonts from your vault. See [Tested Fonts and Language support](https://github.com/ALE-ARME/markdown-to-pdf-mobile/issues/1).
  - **CSS Snippets:** Optionally inherit colors and styles from your active Obsidian CSS snippets.
  - **Page Breaks:** Manually specify line numbers for page breaks.
  - **Line Numbers:** Toggle line numbers in the preview for precise layout control.

## Technical Details: PDF Generation on Mobile

Generating complex PDFs with high-fidelity formatting on mobile platforms presents unique challenges due to limited system resources and restricted API access. This plugin overcomes these hurdles using a hybrid rendering approach:

### 1. Core Engine: jsPDF
The plugin uses **jsPDF** as the primary document orchestrator. It manually calculates layouts, manages coordinate systems (A4 format), and handles standard text rendering to ensure performance and reliability on mobile hardware.

### 2. Hybrid Rendering with html2canvas
For elements that are difficult to reproduce using standard PDF drawing commands—such as complex **Callouts**, **Blockquotes**, and **LaTeX Math** —the plugin employs a "render-to-image" strategy:
- The content is first rendered into a hidden HTML container using Obsidian's internal `MarkdownRenderer`.
- **html2canvas** then captures this rendered HTML and converts it into a high-resolution PNG image.
- This image is then precisely positioned and embedded into the PDF document by jsPDF.

### 3. CSS Style Injection
To maintain visual consistency with your Obsidian workspace, the plugin parses your enabled **CSS snippets**. It extracts color variables (like `--h1-color`) and styles by creating a temporary, invisible DOM element, allowing it to "sniff" the computed styles and apply them directly to the PDF elements.

### 4. Native Preview
The sidebar preview utilizes Obsidian's built-in **pdf.js** integration. Instead of saving a file to disk every time you change a setting, the plugin generates the PDF in-memory as an `ArrayBuffer` and renders it directly onto an HTML5 Canvas, providing a smooth and responsive configuration experience.

## Usage

1. Open the note you want to export.
2. Open the **PDF Settings Sidebar** via the ribbon icon (dice) or the command palette.
3. Adjust your desired settings (Theme, Font, etc.).
4. Click **Generate** to save the PDF in the same folder as your note.

## Development

To build the plugin locally:

```bash
npm install
npm run build
```

This will generate the `main.js` file required for Obsidian to load the plugin.

## Disclaimer
The plugin was entirely made by Gemini 3 Pro and Flash models