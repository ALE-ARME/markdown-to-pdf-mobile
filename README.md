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

## Installation

### Manual Installation
1. Go to the [latest release](https://github.com/ALE-ARME/markdown-to-pdf-mobile/releases/latest).
2. Download `main.js` and `manifest.json`
3. Create a folder named `markdown-to-pdf-mobile` in your vault's `.obsidian/plugins/` directory.
4. Copy the downloaded files into that folder.
5. Restart Obsidian and enable the plugin in **Community Plugins**.

### Installation via BRAT
1. Install the **BRAT** plugin from the Obsidian community plugins.
2. Enable BRAT in your settings.
3. Open the command palette (`Ctrl/Cmd + P`) and run the command: `BRAT: Plugins: Add a beta plugin for testing (with or without version)`.
4. Enter the repository URL: `https://github.com/ALE-ARME/markdown-to-pdf-mobile`.
5. Choose `Latest` version.
6. Click **Add Plugin**.

## Usage

1. Open the note you want to export.
2. Open the **PDF Settings Sidebar** via the ribbon icon (dice) or the command palette.
3. Adjust your desired settings (Theme, Font, etc.).
4. Click **Generate** to save the PDF. By default, it saves in the same folder as the note, but you can configure a global path in the plugin settings.

## Footnote Formatting

When enabling the **Show Footnote** option, you can customize the text using a template.

### Base Variables
| Variable | Description | Example |
| :--- | :--- | :--- |
| `{title}` | The title (filename) of the current note | `My Note` |
| `{date}` | The current date in default format (YYYY-MM-DD) | `2026-01-21` |
| `{time}` | The current time in 24h format (HH:mm) | `14:05` |
| `{page}` | The current page number | `1` |
| `{total}` | The total number of pages in the PDF | `5` |
| `{date:FORMAT}` | Custom date/time format | `21/01/26` |

### Custom Date/Time Syntax (`{date:FORMAT}`)
Uses Moment.js syntax. (Note: Months and days render in English).

| Unit | Format | Example (Jan 9, 2026) | Description |
| :--- | :--- | :--- | :--- |
| **Year** | `YYYY` / `YY` | `2026` / `26` | Full / 2-digit year |
| **Month**| `MMMM` / `MMM`| `January` / `Jan` | Full / Short name |
| | `MM` / `M` | `01` / `1` | Padded / Simple number |
| **Day** | `DD` / `D` | `09` / `9` | Padded / Simple day |
| | `dddd` / `ddd` | `Friday` / `Fri` | Full / Short day name |
| **Hour** | `HH` / `h` | `14` / `2` | 24h / 12h format (14:00 vs 2 PM) |
| **Minute**| `mm` / `m` | `05` / `5` | Padded / Simple minutes |
| **AM/PM** | `A` / `a` | `PM` / `pm` | Uppercase / Lowercase |

**Example Template:** `{title} - Page {page} of {total} | {date:DD/MM/YYYY}`

## Development

To build the plugin locally:

```bash
npm install
npm run build
```

This will generate the `main.js` file required for Obsidian to load the plugin.

## Disclaimer
The plugin was entirely made by Gemini 3 Pro and Flash models