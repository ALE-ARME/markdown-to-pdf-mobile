# Obsidian PDF Export — Custom Settings & Defaults

## 1. Temporary Overrides vs Permanent Defaults
- **One-off overrides (DEFAULT):** Pass only the changed keys via `-o` (Linux) or `-OptionsJson` (Windows). **Do NOT modify `pdf-export-settings.json`.**
- **Permanent default changes:** Read and update `pdf-export-settings.json` **only** when the user explicitly asks to change defaults permanently (e.g. *"save as default"*, *"from now on use..."*).

## 2. Script Flags
- **Linux (`export.sh`):** `-t <target>`, `-m separate|merged`, `-d <outputDir>`, `-n <outputName>`, `-o '<json>'`, `-T <timeoutSeconds>`
- **Windows (`export.ps1`):** `-Target`, `-Mode`, `-OutputDir`, `-OutputName`, `-OptionsJson`, `-TimeoutSeconds`

### Examples
```bash
# Linux / macOS: merged folder with dark theme & landscape
python3 path/to/scripts/export.py -t "Biology" -m "merged" -o '{"pdfTheme":"dark","pageOrientation":"landscape"}'
```
```powershell
# Windows: narrow margins & no title
python path/to/scripts/export.py -t "Notes" -o '{"marginPreset":"narrow","showTitle":false}'
```

## 3. Available `options` Keys (in `pdf-export-settings.json`)
- `pdfTheme`: `"css"` | `"light"` | `"dark"`
- `pageSize`: `"a4"` | `"letter"` | `"a5"`
- `pageOrientation`: `"portrait"` | `"landscape"`
- `autoLandscapeWidePages`: `true` | `false`
- `marginPreset`: `"normal"` | `"narrow"` | `"wide"` | `"none"` | `"custom"`
- `customMarginMm`: number (e.g. `15`)
- `contentScale`: number (e.g. `100`)
- `fontFamily`: `"obsidian"` | `"sans"` | `"serif"` | `"mono"` | `"custom"`
- `customFontPath`: string
- `showTitle`, `showFrontmatter`, `showHeader`, `showFootnote`: `true` | `false`
- `headerTemplate`, `footnoteTemplate`: string (supports `{title}`, `{date}`, `{time}`)
- `headerDateFormat`, `headerTimeFormat`, `footnoteDateFormat`, `footnoteTimeFormat`: string
- `includeBookmarks`, `includeTocPage`, `enableClickableLinks`, `optimizeImages`: `true` | `false`
- `bookmarkHeadingLevels`: array (e.g. `[1,2,3,4,5,6]`)
