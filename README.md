# Markdown to PDF (Mobile) for Obsidian

An Obsidian plugin designed to export individual notes or entire folders of Markdown notes into PDF files directly on mobile and desktop devices.

## Features

- **Mobile & Desktop Support:** Built to work fully on-device on Android, iOS, and desktop without relying on desktop-only print APIs.
- **Live Preview Sidebar:** Adjust styling options, zoom (`-` / `100%` / `+`, `Ctrl + scroll`, or pinch-to-zoom), track live page/time progress, stop an in-flight preview render, and reload the PDF preview before generating.
- **Single-Note, Recursive Folder & Merged PDF Export:**
  - Export the currently active note from the sidebar or Command Palette.
  - Export an entire folder (including all nested subfolders) recursively as separate PDFs with live progress, elapsed timer, and a **Stop** button (safely keeping all already-saved PDFs if cancelled).
  - Merge an entire folder or a custom ordered selection of multiple notes into a **single PDF** via an interactive chapter-order dialog (supporting simultaneous reordering with `↑` / `↓` arrow buttons and a `≡` hamburger drag-and-drop handle on both desktop and mobile touch, quick `Asc` / `Desc` alphabetical sorting, automatic page breaks between notes, each note as a top-level chapter in the PDF outline and Page 1 index, unified page numbering, per-note footnote `{title}`, and clickable cross-note links).
- **Automatic Export & Preview Queue:**
  - All single-note exports, recursive folder exports, merged PDF exports, automation jobs, and sidebar previews share a single sequential FIFO queue.
  - Trigger multiple folder or note exports back-to-back: the first starts immediately and subsequent jobs automatically queue and start in order as soon as the previous job finishes (including waiting cleanly behind an in-flight sidebar preview, or queuing a preview while an export is running).
  - The active progress notice displays live queue status (`Queue (N): Next → ...`) with a one-click **Clear** button (and a **Clear queued PDF exports** command in the Command Palette), while **Stop** cancels only the active job and advances to the next queued job.
- **Page Layout, Theme & Font Customization:**
  - Configure **Page Size** (`A4`, `Letter`, `A5`), **Orientation** (`Portrait` / `Landscape`), **Auto-Landscape Wide Pages** (enabled by default in Portrait mode: automatically promotes the current page to Landscape in place when existing content and a wide block fit together cleanly—or starts a fresh Landscape page when needed—packs following content onto any remaining vertical space on that Landscape page, hides horizontal scrollbars, and automatically steps Content Scale down in 5% increments if ultra-wide content still overflows Landscape width before returning to Portrait on the next page), **Margins** (`Narrow 10 mm`, `Normal 15 mm`, `Wide 25 mm`, or `Custom 5–45 mm`), and **Content Scale** (`80%`–`120%`).
  - **Global Defaults + Temporary Sidebar Overrides:** Plugin Settings define your persistent **Global Defaults** used by recursive folder exports, merged PDFs, quick Command Palette exports, CLI automation, and as the starting profile for the PDF Sidebar. Any adjustments you make in the **PDF Sidebar** act as temporary session overrides (so experimenting on a single note never overwrites your folder/merge defaults), with one-click **Reset to Defaults** and **Save as Defaults** buttons right at the top of the sidebar.
  - Choose **Match Obsidian (Default)**, **White (Light)**, or **Black (Dark)** page backgrounds while keeping your active theme and CSS snippets.
  - Use **Obsidian Default (Theme Font)** or load a **Custom (`.ttf`)** font directly from your vault (with live multi-word `.ttf` path autocomplete).
  - **Mobile-Friendly Sectioned Settings Layout:** Both Global Settings and the PDF Sidebar organize all options into clear logical sections (**Page & Layout**, **Appearance & Typography**, **Document Content**, **Header & Footnote**, **Navigation & Links**, **Output & Compression**, **Preview & Page Breaks**, and **CLI & AI Agent Automation**), stacking labels above controls with generous horizontal margins on mobile so text never wraps vertically or touches the screen edges.
- **Header, Footnote & Frontmatter Properties:**
  - Optionally display a clean, theme-aware **Properties (YAML Frontmatter)** card at the top of Page 1 (`Show Properties (Frontmatter)`).
  - Configure both a customizable **Header** (`Show Header`, `Header Template`, `Header Date Format`, `Header Time Format`) and **Footnote** (`Show Footnote`, `Footnote Template`, `Footnote Date Format`, `Footnote Time Format`) independently on every page using `{title}`, `{page}`, `{total}`, `{date}`, `{time}`, `{date:FMT}`, and `{time:FMT}` tokens with full Unicode/emoji support.
- **Smart PDF Size Optimization (Adaptive Whole-Page Compression):**
  - Enabled by default (`Optimize PDF Size (Smart Compression)`):
    - Optimizes embedded raster images in memory via WebP at 99% quality (automatically skipping images that are already `.webp` and keeping the original whenever WebP would be larger).
    - Because the PDF standard (ISO 32000) natively embeds `/FlateDecode` (PNG) and `/DCTDecode` (JPEG) rather than WebP, every rendered page canvas is automatically encoded with the smallest sharp PDF-native format: **100% lossless 8-bit Indexed-Palette PNG** (`colorType = 3`, 1 byte/pixel, ~2×–3× smaller with zero blur) for text/heading/table pages with ≤256 colors, and **high-fidelity 93% JPEG at 2× HiDPI** whenever it yields substantial savings on photos, Mermaid diagrams, callouts, or colorful/emoji pages—guaranteed never larger than standard 24-bit PNG while preserving the full selectable text layer.
- **CLI & AI Agent Automation:**
  - Trigger single-note, recursive folder (separate or merged), and custom multi-note merge exports from scripts, terminals, or AI agents via the `obsidian://mobile-pdf-export` URI handler, queued `export-job.json` files (with incremental `export-result.json` checkpointing and automatic resume), the cross-platform Python agent skill (`scripts/export.py`), and the included zero-dependency `obsidian-pdf-cli.mjs` CLI wrapper.
- **Rich Markdown Support:**
  - **Headings, Callouts & Blockquotes:** Preserves Obsidian Reading Mode styling, themes, CSS snippets, and `cssclasses`.
  - **Images, Carousels & Captions:** Supports embedded images (`![[image.png]]`) with custom widths, preserves captions rendered by your active theme, CSS snippets, or caption plugins, cleanly exports community image carousels (hiding interactive left/right navigation arrows while preserving bottom slide indicator pills), and automatically scales very tall images proportionally (down to a 45% legibility floor) to fit cleanly on a single page instead of slicing them in half.
  - **Tables & Lists:** Keeps natural table widths (without forcing small tables to full page width), renders crisp vector task checkboxes, detaches unindented column-0 text immediately following list items cleanly to match Obsidian Live Preview, and splits long tables/lists cleanly across pages with complete cell borders.
  - **LaTeX Math & Mermaid:** Supports inline (`$...$`) and block (`$$...$$`) math expressions with bundled MathJax font loading on mobile, auto-fit scaling for wide display equations, and single-piece continuous vector square-root radicals (`\sqrt{...}`) so the diagonal and horizontal bar align seamlessly (including inside fractions, tall display roots, nested roots, and nth roots), as well as Mermaid diagrams (with proportional single-page height fitting for tall vertical diagrams down to a 45% legibility floor).
  - **Page Breaks & Line Numbers:** Insert inline `<!-- pagebreak -->` markers directly inside any note (honored in previews, single-note exports, and recursive folder exports) using the **Insert page break at cursor** or **Copy page break syntax to clipboard** commands, or set manual 1-based line numbers in the sidebar (with incremental preview caching). Optionally display accurate editor line numbers in the preview across paragraphs, headings, every list item (including indented continuation lines and nested/split lists), table rows, callout lists, and footnotes.
  - **Table of Contents (Page 1), PDF Bookmarks & Clickable Links:**
    - Choose independently via checkboxes whether to include a **Document Outline** (PDF viewer sidebar structure) and/or a rendered clickable **Index on Page 1** (automatically starting note content on a new page right after the index finishes).
    - Pick exactly which heading levels (`H1`–`H6`) appear in the outline and Page 1 index via a compact horizontal checkbox bar in both the sidebar and plugin settings.
    - Preserves clickable external links (`https://`, `http://`, `mailto:`, `tel:`, `ftp://`) and internal same-note links (heading links `[[#Heading]]`, anchor links `[text](#section)`, and numeric footnotes `[^1]` / `#fn-1` / `#fnref-1`) with accurate multi-line hit areas; when **Clickable Links** is disabled, links render as plain unhighlighted text and bare URLs are prevented from being auto-linked by PDF viewers.
    - Toggle **Auto-regenerate preview** in global plugin settings to control whether opening the PDF sidebar, changing sidebar options, or switching to another Markdown note generates and refreshes the preview automatically (when disabled, opening the sidebar waits until you click **Reload**).

## How It Works & Limitations

### How It Works
1. **Reading Mode Rendering:** When generating a preview or PDF, the plugin reads the latest content of your note (including unsaved edits in an open editor) and renders it inside an isolated, hidden Obsidian **Reading Mode** view (`MarkdownView`). This allows your active theme, CSS snippets, and standard Reading Mode community plugins to run natively.
2. **Smart Pagination & Auto-Landscape:** Rendered blocks are measured and grouped into pages matching your configured size (`A4`, `Letter`, `A5`), orientation, margins, and content scale, honoring inline `<!-- pagebreak -->` markers and sidebar page-break line numbers, splitting long lists, tables, code blocks, and callouts across page boundaries when needed, and optionally rotating individual wide pages (wide tables, horizontal diagrams, panoramic images, wide equations) to Landscape while keeping their preceding section heading attached.
3. **Local PDF Generation, Text Layer & Annotations:** Each page is rasterized locally to an opaque canvas (using a native SVG `<foreignObject>` engine with automatic `html2canvas` fallback), overlaid with a compressed invisible PDF text layer aligned to exact DOM line coordinates so text remains **selectable and searchable (`Ctrl+F`)**—including full **non-Latin, RTL, and mixed-script Unicode** (Latin Extended, Greek, Cyrillic, Chinese/Japanese/Korean, Arabic, Hebrew with UAX #9 bidirectional ordering for single-copy LTR+RTL lines, math symbols, and emojis)—enriched with hierarchical **PDF bookmarks** and **clickable link annotations**, and assembled into a PDF file (`jsPDF`) saved directly inside your vault.

### Important Note on Export Fidelity & Mobile Usage
Because PDF generation runs locally via Reading Mode and canvas capture, please keep the following in mind:
- **Keep Obsidian in the Foreground on Mobile (Android & iOS):** On mobile devices, **Obsidian must remain open in the foreground (with the screen awake) until the export finishes**. Switching to another app or locking the screen causes Android and iOS to suspend or freeze the WebView, which will pause or interrupt PDF generation. On Android, if you need to use another app during a long folder export, use **Split Screen** or **Floating Window** so Obsidian stays technically in the foreground.
- **Not a 1:1 Screenshot of Live Preview:** **The exported PDF is not guaranteed to be an exact 1:1 copy of how a note looks inside Obsidian**:
  - **Community Plugins:** Some plugins add custom interactive UI, complex CSS, or rendering patterns (for example, plugins like *Rich Table* or widgets that depend on live viewport/editor state) that cannot be reliably captured during PDF export—in some cases not even by Obsidian's own built-in desktop PDF exporter.
  - **Live Preview vs. Reading Mode:** The exporter always renders in **Reading Mode**, not **Live Preview**. Syntax or plugin decorations that only appear in Live Preview (CodeMirror) will not appear in Reading Mode or in the exported PDF.
  - **Minor Visual Differences:** Certain advanced CSS effects (such as complex masks, filters, or non-standard browser form controls) may render slightly differently in the generated PDF compared to Obsidian's live screen view.

## Privacy & Network Usage

PDF generation runs **100% locally on your device**. This plugin collects **no telemetry, analytics, or personal data**, and never contacts any external backend or third-party server of its own.

If an automated plugin scanner or directory listing flags network API calls (`requestUrl`, `XMLHttpRequest`, or `fetch`) inside the bundled `main.js`, they exist solely for the following reasons:
- **Local WebView Assets (`XMLHttpRequest`):** Used exclusively on local origins (`localhost`, `app://`, `capacitor://`, `blob:`) to read bundled Obsidian/Capacitor resources—such as MathJax `.woff2` math fonts and local vault assets—so they can be embedded cleanly during offline PDF rendering.
- **User-Referenced Remote Media (`requestUrl`):** Called via Obsidian's built-in `requestUrl` API **only** if a note you export explicitly embeds external `http://` or `https://` images, CSS background URLs, or web fonts that need to be drawn into the PDF. When exporting notes with purely local content, **zero outbound internet requests** are made.
- **Bundled Libraries (`html2canvas` & `jsPDF`):** The remaining static occurrences of `XMLHttpRequest` / `fetch` reported in `main.js` come from the standard internal image/resource loaders inside `html2canvas` and `jsPDF` bundled into the plugin.

## Performance & Optimizations

To keep single-note previews, long multi-page documents, and recursive folder exports fast and stable on both desktop PCs and mobile devices—without changing export fidelity—the plugin uses several optimizations:

- **Native SVG `<foreignObject>` Rasterizer (with Automatic Fallback):** Renders each paginated Reading Mode page directly through the browser's native C++ Blink/Skia text & emoji layout engine with compact diff-only computed styles, session-cached inlined `@font-face` rules, vector checkboxes, continuous vector MathJax radicals, MathJax `<defs>` inlining, and automatic stripping of interactive UI controls (such as copy-code buttons and carousel arrows). Pages containing incompatible embeds (such as `<iframe>` or un-slotted external images) or WebViews that block `<foreignObject>` fall back seamlessly to memory-safe batched `html2canvas`.
- **Smart Lightweight Unicode & BiDi Text Layer:** Extracts visual text lines from the DOM via O(lines × log(chars)) binary search and writes an invisible PDF text layer (`3 Tr` + `Tz` horizontal alignment) over each page. Pure Western-Latin spans use built-in Helvetica with zero extra font overhead; whenever a span contains non-Latin, extended-Latin, RTL, math, emoji, or mixed-script characters, the plugin dynamically subsets a compact GlyphLess Type 0 (`Identity-H` + `/ToUnicode` UTF-16BE CMap) font containing only the unique characters used in the note (~1–4 KB total, 100% offline). Lines containing RTL scripts (Arabic, Hebrew, etc.)—alone or mixed with LTR text and numbers—are split into directional UAX #9 runs positioned visually but emitted in logical reading order so a single copy-paste preserves exact word and character direction across PDF viewers.
- **Opaque RGB PNG Fast Path for `jsPDF`:** Captures pages onto opaque (`alpha: false`) canvases so Chromium emits 24-bit RGB PNGs (`colorType = 2`), allowing `jsPDF` to embed the compressed `IDAT` stream directly instead of decoding and re-deflating RGBA pixels in JavaScript.
- **Always-Instant Export After Preview:** The sidebar preview renders at full export resolution and always caches the clean, ready-to-save PDF buffer (even when **Show Line Numbers (Preview)** is enabled). Clicking **Generate** after the preview finishes—or queuing **Generate** while that note's preview is already running—writes the cached PDF immediately once the preview completes without re-rendering.
- **Desktop Background-Safe Execution (`MessageChannel`) & Live Progress:** Uses `MessageChannel` yields whenever `document.visibilityState === 'hidden'` (avoiding Chromium's 1-second background `setTimeout` throttling on desktop when switching windows) and timer-backed frame yields in foreground, displaying live page progress (`page/total`) in both the sidebar timer and export notice. *(Note: On mobile Android/iOS, the OS freezes background WebViews, so Obsidian must remain in the foreground until the export completes.)*
- **Incremental Preview Caching:** When editing **Page Breaks** or toggling **Show Line Numbers (Preview)**, untouched pages before the first modified break line are reused automatically.
- **Device-Adaptive Throttling:** Automatically detects platform (Desktop vs. Mobile), CPU core count, and available memory (`high` / `medium` / `low` tiers) to scale parallel image prefetch concurrency, fallback batch limits, inter-page yields on long notes, and dynamic cooldown pauses between notes during recursive folder exports so lower-power PCs and mobile devices stay responsive.
- **Two-Phase DOM Sanitization & Session Caches:** Cleans Obsidian's root CSS font variables upfront, separates computed-style reads from DOM writes on the fallback path to avoid style thrashing, and caches resolved CSS colors, font stacks, and fetched font assets across renders.
- **Native Canvas 2D Unicode Footnotes & Custom Font Caching:** Non-ASCII/emoji footnotes are drawn directly on an opaque Canvas 2D buffer (with per-note caching), and custom `.ttf` fonts are read and Base64-encoded once per `(path, mtime)`.
- **Zero-Copy Image Loading, Batched Pagination & Adaptive Settle:** Vault images are prefetched in bounded parallel batches using `Blob URL`s and composited directly onto page canvases, block heights are pre-measured in a single pass, and notes without async widgets (Mermaid, Dataview, MathJax, embeds, custom code blocks) use a fast adaptive settle window.
- **Lazy On-Scroll Preview Rendering:** The sidebar immediately renders the first visible preview pages and lazily paints off-screen pages on demand via `IntersectionObserver`, reducing startup latency and memory usage on long documents.

## Installation

### Manual Installation
1. Go to the [latest release](https://github.com/ALE-ARME/markdown-to-pdf-mobile/releases/latest).
2. Download `main.js`, `manifest.json`, and `styles.css`.
3. Create a folder named `markdown-to-pdf-mobile` in your vault's `.obsidian/plugins/` directory.
4. Copy the downloaded files into that folder.
5. Restart Obsidian and enable the plugin in **Community Plugins** (requires Obsidian `1.3.5` or newer).

### Installation via BRAT
1. Install the **BRAT** plugin from the Obsidian community plugins.
2. Enable BRAT in your settings.
3. Open the command palette (`Ctrl/Cmd + P`) and run: `BRAT: Plugins: Add a beta plugin for testing (with or without version)`.
4. Enter the repository URL: `https://github.com/ALE-ARME/markdown-to-pdf-mobile`.
5. Choose the `Latest` version.
6. Click **Add Plugin**.

## Usage

### Export a Single Note
1. Open the Markdown note you want to export.
2. Open the **PDF Settings Sidebar** via the ribbon icon (`file-down`) or the Command Palette (**Open PDF settings sidebar**).
3. Adjust any options in the sidebar (Page & Layout, Appearance & Typography, Document Content, Header & Footnote, Navigation & Links, Output & Compression, Preview & Page Breaks) and click **Reload** whenever you want to refresh the preview. Changes made in the sidebar are **temporary overrides** for your current session and will not alter your Global Defaults unless you click **Save as Defaults** (or click **Reset to Defaults** at any time to revert).
4. Click **Generate** in the sidebar to export using your current sidebar settings (or run **Export current note to PDF** from the Command Palette to export directly using your Global Defaults). By default, the PDF is saved in the note's folder, or in the configured export path.

### Manual Page Breaks (`<!-- pagebreak -->`)
You can force a page break directly inside any Markdown note by placing `<!-- pagebreak -->` on its own line (ignored inside fenced code blocks and `%%` comments, and honored in previews, single-note exports, and recursive folder exports):
- **Insert page break at cursor** (Command Palette / bindable hotkey): inserts `<!-- pagebreak -->` cleanly at the current editor cursor position.
- **Copy page break syntax to clipboard** (Command Palette): copies `<!-- pagebreak -->` to your clipboard on desktop, Android, and iOS so you can paste multiple breaks quickly.

### Export a Folder Recursively (1 PDF per Note)
You can export all Markdown notes inside a folder (and all its subfolders) in one batch, with a live progress bar, elapsed timer, per-page progress, and a **Stop** button (stopping cleanly aborts the current note while keeping all already-saved PDF files):
- **Files View Context Menu:** Right-click (desktop) or long-press (mobile) any folder in Obsidian's **Files** pane and choose **Mobile PDF export (separate PDF files)**.
- **Command Palette:** Run **Export folder to separate PDF files** to open a searchable folder picker with live path filtering, then select the folder to export.

### Merge Multiple Notes or a Folder into a Single PDF
Combine a folder or a custom ordered list of notes into one PDF document, with automatic page breaks between notes, each note as a top-level chapter in the PDF Document Outline (with its headings nested underneath) and Page 1 Table of Contents, unified `{page}` / `{total}` numbering, per-note `{title}` footnotes, clickable cross-note links, and a **Stop** button:
- **Files View Context Menu:** Right-click (desktop) or long-press (mobile) any folder and choose **Mobile PDF export (single merged PDF)** to open the chapter-order dialog pre-populated with all notes in that folder.
- **Command Palette (Folder):** Run **Export folder as a single merged PDF**, pick the folder, and arrange the note order in the chapter-order dialog before exporting.
- **Command Palette (Custom Notes):** Run **Merge multiple notes into a single PDF** to search and select notes from your vault, arrange their order, and export.

**Choosing & Reordering Notes in the Merge Dialog:**
- Every note row exposes **both reordering controls simultaneously** so you can use whichever method you prefer:
  1. **Up / Down arrows (`↑` / `↓`)** first, for precise step-by-step moving.
  2. **Hamburger drag handle (`≡`)** right next to the arrows, for smooth drag-and-drop reordering on both **desktop (mouse)** and **mobile (touch)**.
- You can also quickly sort all chapters **`Asc`** or **`Desc`**, remove unwanted notes (`×`), expand **Add more notes from vault** to append extra notes, and customize the output PDF filename and destination folder before clicking **Export merged PDF**.

**Destination behavior** (configured in **Settings → Community Plugins → Markdown to PDF Mobile**):
- Folder exports, merged PDFs, quick Command Palette exports, and CLI automation (when not overridden in the job) always use your persistent **Global Defaults** from Plugin Settings—unaffected by temporary overrides in the PDF Sidebar (sidebar numeric **Page Breaks** are also ignored during folder/merged exports, while inline `<!-- pagebreak -->` markers inside each note are respected).
- **Folder Export Path:**
  - For 1-PDF-per-note folder exports: if set (e.g. `Exports/PDFs`, or `/` for the vault root), creates a subfolder with the **same name** as the exported folder inside that path and mirrors its subfolder structure; if empty, creates a sibling `<FolderName> (PDF)` folder.
  - For merged folder PDFs: saves `<FolderName>.pdf` inside **Folder Export Path** if set, or next to the original folder if left empty.
- Subfolders containing no `.md` files are skipped automatically.

### Queuing Multiple Exports & Previews
You do not need to wait for an export or preview to finish before starting the next one:
- Triggering a second folder export, merged PDF, single-note export, or automation job while another export or sidebar preview is already running places it automatically into the **FIFO export queue** and shows its queue position (`Queued (#1): ...`).
- Sidebar previews participate in the same queue: if a preview is currently generating, new exports wait for it to complete (and clicking **Generate** on that same note immediately reuses the freshly cached PDF right after); if an export is running and a sidebar preview is triggered, the preview shows `Queued (#N)...` and renders automatically when its turn arrives (newer preview refreshes replace any stale waiting preview in place so you never wait on outdated notes).
- Click **Stop** on the active notice to stop only the current export and continue with the next queued job, or click **Clear** in the notice's queue row (or run **Clear queued PDF exports** from the Command Palette) to clear waiting jobs.

### CLI & AI Agent Automation (Desktop)
Automate single-note, recursive folder, and multi-note merged PDF exports from scripts, terminals, or AI coding agents without touching the UI:

1. **Zero-Dependency CLI Wrapper (`obsidian-pdf-cli.mjs`):**
   Works on Linux, macOS, and Windows (Node.js 18+). It writes `.obsidian/plugins/markdown-to-pdf-mobile/export-job.json`, triggers `obsidian://mobile-pdf-export`, polls `export-result.json`, and prints human-readable or `--json` output:
   *(Note for Windows users: when invoking the CLI or URI launcher, a terminal window might pop up for an instant to dispatch the command to Obsidian—this is completely normal behavior and by design, do not worry).*
   ```bash
   # Single note
   node obsidian-pdf-cli.mjs --vault "/path/to/Vault" --note "Biology/Cells.md" --out "PDFs"

   # Recursive folder export (separate PDFs)
   node obsidian-pdf-cli.mjs --vault "/path/to/Vault" --folder "Biology" --out "PDFs"

   # Merge folder into one PDF with header, frontmatter & dark theme
   node obsidian-pdf-cli.mjs --vault "/path/to/Vault" --folder "Biology" --merged --name "Biology Book" --header "{title} - {page}/{total}" --frontmatter true --theme dark

   # Merge specific notes in exact order (machine-readable output for AI agents)
   node obsidian-pdf-cli.mjs --vault "/path/to/Vault" --merge "Intro.md,Ch1.md,Ch2.md" --name "Course" --json
   ```
2. **Direct Obsidian URI (`obsidian://mobile-pdf-export`):**
   Works from desktop terminals (`xdg-open` / `open` / `start`):
   ```text
   obsidian://mobile-pdf-export?vault=MyVault&note=Biology/Cells.md&out=PDFs&theme=dark&frontmatter=true&header=true
   obsidian://mobile-pdf-export?vault=MyVault&folder=Biology&mode=merged&name=BiologyBook&out=PDFs
   obsidian://mobile-pdf-export?vault=MyVault&notes=Intro.md,Ch1.md,Ch2.md&name=Combined&out=PDFs
   obsidian://mobile-pdf-export?vault=MyVault&job=default
   ```
3. **Batch Job File & Optional Startup Auto-Resume (`export-job.json` → `export-result.json`):**
   - Place a multi-task JSON job at `.obsidian/plugins/markdown-to-pdf-mobile/export-job.json` (combining any mix of `note`, `folder`, and `merge` tasks with temporary `options` overrides that never overwrite your saved settings).
   - Run via URI, Command Palette (**Run queued automation export job (export-job.json)**), or Settings (**Run Job**). You can also opt in to **Auto-run Queued Export Job on Startup** in settings (disabled by default) if you want Obsidian to automatically resume unfinished jobs on launch.
   - Automated exports show the exact same live per-note, per-page, and saved/merged progress statistics as interactive exports, and checkpoint progress incrementally to `export-result.json` after every task.
   - Once an automated job file finishes all queued tasks cleanly, the plugin automatically deletes `export-job.json` (while preserving `export-result.json` for CLI/agent polling) so running queued jobs again or restarting Obsidian will never accidentally re-run a completed export. If a job is manually cancelled mid-run, `export-job.json` is kept so it can be resumed later.
   - **Mobile foreground requirement (Android & iOS):** Obsidian must stay open in the foreground (with the screen awake) until automated batch jobs finish, as mobile operating systems suspend background WebViews. On Android, you can use **Split Screen** or **Floating Window** to keep Obsidian in the foreground while using other apps (and setting battery usage to **Unrestricted** helps prevent OS kills during long batches).
4. **Cross-Platform AI Agent Skill (`skills/obsidian-pdf-export/`):**
   - **Requirements:** Requires **Python 3.6+** (standard library only — no extra `pip` packages needed).
   - **One-Command Export Dispatcher (`export.py`):** AI agents (Antigravity, Claude Code, Codex, OpenCode) simply invoke `python export.py -t "<note or folder name>"`. The script automatically identifies the host operating system (`sys.platform`), delegating execution to `export.ps1` on Windows or `export.sh` on Linux and macOS.
   - **Zero Pre-Search Overhead:** The script handles vault-wide note/folder resolution, Unicode escaping, Obsidian background execution check, and job file lifecycle internally so agents don't waste context turns searching the filesystem.
   - **Non-Intrusive Terminal Dispatch (Windows):** On Windows, a brief command window may flash for an instant while dispatching the URI protocol to Obsidian; this is expected behavior by design.
   - **Custom Options & `SUPPLEMENT.md`:** Standard exports run with zero extra reads. If the user asks for specific custom options (theme, orientation, margins, custom fonts, index/TOC, headers/footnotes) or wants to update persistent defaults, the agent reads `SUPPLEMENT.md` to pass JSON option overrides (`-o`) directly to the dispatcher without modifying permanent settings.

### Feature Stress-Test Note (`PDF-Export-Test-Suite.md`)
Copy `PDF-Export-Test-Suite.md` into your vault to verify frontmatter + immediate callout rendering, title spacing, H1–H6 hierarchy, numbered lists with indented continuation lines & unindented column-0 text, compact/wide/ultra-wide/multi-page tables, code blocks, LaTeX math, Mermaid diagrams, large & panoramic images, manual page breaks, links/footnotes, and Unicode/BiDi/emoji text selection in a single export.

## Header & Footnote Formatting

When enabling **Show Header** and/or **Show Footnote**, each section provides its own independent **Template**, **Date Format**, and **Time Format** dropdowns (Year-first, Day-first, Month-first, 12h AM/PM or am/pm, 24h, with or without seconds).

### Base Variables
| Variable | Description | Example |
| :--- | :--- | :--- |
| `{title}` | The title (filename) of the current note | `My Note` |
| `{date}` | The current date using the selected **Header / Footnote Date Format** | `2026-01-21` |
| `{time}` | The current time using the selected **Header / Footnote Time Format** | `14:05` |
| `{page}` | The current page number | `1` |
| `{total}` | The total number of pages in the PDF | `5` |
| `{date:FORMAT}` | Custom date/time format | `21/01/26` |
| `{time:FORMAT}` | Custom time format | `02:05:30 PM` |

### Custom Date/Time Syntax (`{date:FORMAT}` / `{time:FORMAT}`)
Uses Moment.js syntax. (Note: Months and days render in English.)

| Unit | Format | Example (Jan 9, 2026) | Description |
| :--- | :--- | :--- | :--- |
| **Year** | `YYYY` / `YY` | `2026` / `26` | Full / 2-digit year |
| **Month** | `MMMM` / `MMM` | `January` / `Jan` | Full / Short name |
| | `MM` / `M` | `01` / `1` | Padded / Simple number |
| **Day** | `DD` / `D` | `09` / `9` | Padded / Simple day |
| | `dddd` / `ddd` | `Friday` / `Fri` | Full / Short day name |
| **Hour** | `HH` / `h` | `14` / `2` | 24h / 12h format (14:00 vs 2 PM) |
| **Minute** | `mm` / `m` | `05` / `5` | Padded / Simple minutes |
| **AM/PM** | `A` / `a` | `PM` / `pm` | Uppercase / Lowercase |

**Example Template:** `{title} - Page {page} of {total} | {date:DD/MM/YYYY}`

## Development

To build the plugin locally (reproducible install via `package-lock.json`):

```bash
npm ci
npm run build
```

This generates the `main.js` bundle required (alongside `manifest.json` and `styles.css`) for Obsidian to load the plugin. Pushing a version tag matching `manifest.json` (or running the workflow manually from GitHub Actions) triggers `.github/workflows/release.yml` to type-check, build `main.js`, and publish the GitHub Release artifacts automatically.

## Disclaimer
The plugin was entirely made by Gemini models