---
name: obsidian-pdf-export
description: Export Obsidian Markdown notes, recursive folders, or merged multi-note books to PDF via obsidian-pdf-cli.mjs and the "Markdown to PDF Mobile" plugin on Windows, macOS, Linux, and Android Termux.
---

# Obsidian PDF Export Skill (`obsidian-pdf-cli.mjs`)

Use this skill whenever the user asks to export Obsidian notes or folders to PDF, merge multiple Markdown notes into a single PDF, or inspect/change their CLI PDF export preferences.

## Mandatory Settings Workflow (READ THIS FIRST)

This skill maintains its **own standalone settings file** located in the same folder as this `SKILL.md`:

- **Settings file:** `./pdf-export-settings.json` (in this skill's directory — completely separate from Obsidian's `.obsidian/plugins/markdown-to-pdf-mobile/data.json` so CLI/agent exports never overwrite or depend on the user's interactive UI settings).

### Required Rules for Every Agent Run
1. **Always read `pdf-export-settings.json` BEFORE generating any PDF.**
   - Load `cli` defaults (`scriptPath`, `vaultPath`, `vaultName`, `defaultOutputDir`, `openResult`, `timeoutSeconds`, `pollMs`) and all 24 PDF styling fields under `options`.
   - If `cli.vaultPath` is empty, check the `OBSIDIAN_VAULT_PATH` environment variable or ask the user once for their vault path, then save it into `pdf-export-settings.json` if the user wants it remembered.
2. **Whenever the user asks to change a default export setting** (e.g., *"from now on use dark theme"*, *"enable frontmatter by default"*, *"set margins to narrow"*, *"change output folder to PDFs"*):
   - **Update `pdf-export-settings.json` directly** (preserving valid JSON and untouched keys), confirm what changed, and use the updated values immediately.
   - If the user asks for a **one-off override** (*"export just this note in landscape"*), apply it only to the current job without modifying `pdf-export-settings.json`.
3. **Always apply all 24 `options` via `--job-file` (recommended)** rather than only CLI flags, because CLI flags cover 12 quick options while `--job-file` supports **all 24** plugin options (including margins, custom fonts, header/footnote date & time formats, heading levels, and clickable links).

---

## Executing an Export

### Recommended Pattern: Generate a Temporary Job JSON & Run `--job-file --json`

1. Read `pdf-export-settings.json`.
2. Build a job JSON object (e.g. in your OS temp directory such as `/tmp/obsidian-pdf-job.json` or `%TEMP%\obsidian-pdf-job.json`) merging `settings.options` plus any one-off overrides requested by the user:
   ```json
   {
     "jobId": "agent-2026-01-21-001",
     "openResult": false,
     "options": {
       "pdfTheme": "css",
       "pageSize": "a4",
       "pageOrientation": "portrait",
       "autoLandscapeWidePages": true,
       "marginPreset": "normal",
       "customMarginMm": 15,
       "contentScale": 100,
       "fontFamily": "obsidian",
       "customFontPath": "",
       "showTitle": true,
       "showFrontmatter": false,
       "showHeader": false,
       "headerTemplate": "{title}",
       "headerDateFormat": "YYYY-MM-DD",
       "headerTimeFormat": "HH:mm",
       "showFootnote": false,
       "footnoteTemplate": "{title} - {date} {time}",
       "footnoteDateFormat": "YYYY-MM-DD",
       "footnoteTimeFormat": "HH:mm",
       "optimizeImages": true,
       "includeBookmarks": true,
       "includeTocPage": false,
       "bookmarkHeadingLevels": [1, 2, 3, 4, 5, 6],
       "enableClickableLinks": true
     },
     "tasks": [
       {
         "type": "note",
         "notePath": "Biology/Cells.md",
         "outputDir": "PDFs",
         "outputName": "Cells"
       }
     ]
   }
   ```
3. Run `obsidian-pdf-cli.mjs` with `--job-file` and `--json` (so stdout returns clean machine-readable JSON from `export-result.json`):
   ```bash
   node "<scriptPath>" \
     --vault "<vaultPath>" \
     --job-file "<temp-job.json>" \
     --timeout <timeoutSeconds> \
     --poll <pollMs> \
     --json
   ```
   *(Pass `--vault-name "<vaultName>"` if `cli.vaultName` is non-empty and differs from the vault folder basename.)*
4. Parse the JSON result from stdout:
   - Exit code `0` and `"status": "completed"` → report the generated `tasks[].outputs` vault-relative paths to the user.
   - Exit code `1` (`"status": "partial"` or `"failed"`) → report `tasks[].outputs`, `tasks[].failedFiles`, and `tasks[].error` / top-level `error`.
   - Exit code `124` (`"status": "timeout"`) → Obsidian may not be running or could not open the `obsidian://` URI; instruct the user to open Obsidian (or run the command **Run queued automation export job (export-job.json)** inside Obsidian).

---

## Supported Task Types (`tasks[]` in `--job-file`)

A single job file can contain **one or multiple tasks** in `tasks[]`, and any individual task can also include its own `options` object to override top-level `options` for that task only.

| `type` | Required Fields | Optional Fields | Description |
| :--- | :--- | :--- | :--- |
| `"note"` | `notePath` (vault-relative `.md` path) | `outputDir`, `outputName`, `options` | Export a single Markdown note to PDF. |
| `"folder"` | `folderPath` (vault-relative folder, or `"/"` for whole vault) | `mode` (`"separate"` \| `"merged"`, default `"separate"`), `outputDir`, `outputName` (used when `mode: "merged"`), `options` | Recursively export all `.md` notes in a folder either as separate PDF files (mirroring subfolder structure) or merged into one PDF. |
| `"merge"` | `notes` (ordered array of vault-relative `.md` paths) | `outputDir`, `outputName` (default `"Merged Notes"`), `options` | Merge specific notes in exact chapter order into one PDF with bookmarks, Page 1 TOC (if enabled), unified page numbers, and cross-note links. |

---

## Complete Reference: All 24 Configurable PDF Parameters (`options`)

These exact keys are honored by the plugin's `applyTemporaryAutomationOptions()` inside `export-job.json` (and stored in `pdf-export-settings.json`). They are applied **temporarily** during the automation run and automatically restored afterward so the user's Obsidian plugin settings are never overwritten.

### 1. Page & Layout
| Parameter | Type | Allowed Values / Range | Default | Direct CLI Flag |
| :--- | :--- | :--- | :--- | :--- |
| `pageSize` | `string` | `"a4"` \| `"letter"` \| `"a5"` | `"a4"` | `--size` |
| `pageOrientation` | `string` | `"portrait"` \| `"landscape"` | `"portrait"` | `--orientation` |
| `autoLandscapeWidePages` | `boolean` | `true` \| `false` (applies in Portrait mode) | `true` | `--auto-landscape` |
| `marginPreset` | `string` | `"narrow"` (10mm) \| `"normal"` (15mm) \| `"wide"` (25mm) \| `"custom"` | `"normal"` | *(via `--job-file` only)* |
| `customMarginMm` | `number` | Integer `5`–`45` (used when `marginPreset: "custom"`) | `15` | *(via `--job-file` only)* |
| `contentScale` | `number` | `80`–`120` in steps of `5` (`80, 85, 90, 95, 100, 105, 110, 115, 120`) | `100` | `--scale` |

### 2. Appearance & Typography
| Parameter | Type | Allowed Values / Range | Default | Direct CLI Flag |
| :--- | :--- | :--- | :--- | :--- |
| `pdfTheme` | `string` | `"css"` (Match Obsidian) \| `"light"` (White) \| `"dark"` (Black) | `"css"` | `--theme` |
| `fontFamily` | `string` | `"obsidian"` \| `"custom"` | `"obsidian"` | *(via `--job-file` only)* |
| `customFontPath` | `string` | Vault-relative path to `.ttf` font (when `fontFamily: "custom"`) | `""` | *(via `--job-file` only)* |

### 3. Document Content
| Parameter | Type | Allowed Values / Range | Default | Direct CLI Flag |
| :--- | :--- | :--- | :--- | :--- |
| `showTitle` | `boolean` | `true` \| `false` | `true` | `--title` |
| `showFrontmatter` | `boolean` | `true` \| `false` (renders YAML Properties card on Page 1) | `false` | `--frontmatter` |

### 4. Header & Footnote
| Parameter | Type | Allowed Values / Range | Default | Direct CLI Flag |
| :--- | :--- | :--- | :--- | :--- |
| `showHeader` | `boolean` | `true` \| `false` | `false` | `--header` |
| `headerTemplate` | `string` | Tokens: `{title}`, `{date}`, `{time}`, `{page}`, `{total}`, `{date:FMT}`, `{time:FMT}` | `"{title}"` | `--header "<tpl>"` |
| `headerDateFormat` | `string` | Moment.js date format (e.g. `"YYYY-MM-DD"`, `"DD/MM/YYYY"`, `"MMMM D, YYYY"`) | `"YYYY-MM-DD"` | *(via `--job-file` only)* |
| `headerTimeFormat` | `string` | Moment.js time format (e.g. `"HH:mm"`, `"HH:mm:ss"`, `"h:mm A"`) | `"HH:mm"` | *(via `--job-file` only)* |
| `showFootnote` | `boolean` | `true` \| `false` | `false` | `--footnote` |
| `footnoteTemplate` | `string` | Tokens: `{title}`, `{date}`, `{time}`, `{page}`, `{total}`, `{date:FMT}`, `{time:FMT}` | `"{title} - {date} {time}"` | `--footnote "<tpl>"` |
| `footnoteDateFormat` | `string` | Moment.js date format | `"YYYY-MM-DD"` | *(via `--job-file` only)* |
| `footnoteTimeFormat` | `string` | Moment.js time format | `"HH:mm"` | *(via `--job-file` only)* |

### 5. Navigation & Links
| Parameter | Type | Allowed Values / Range | Default | Direct CLI Flag |
| :--- | :--- | :--- | :--- | :--- |
| `includeBookmarks` | `boolean` | `true` \| `false` (PDF viewer Document Outline) | `true` | `--bookmarks` |
| `includeTocPage` | `boolean` | `true` \| `false` (clickable Index rendered on Page 1) | `false` | `--toc` |
| `bookmarkHeadingLevels` | `number[]` | Subset of `[1, 2, 3, 4, 5, 6]` (H1–H6) | `[1,2,3,4,5,6]` | *(via `--job-file` only)* |
| `enableClickableLinks` | `boolean` | `true` \| `false` (external URLs, heading/footnote anchors, cross-note links) | `true` | *(via `--job-file` only)* |

### 6. Output & Compression
| Parameter | Type | Allowed Values / Range | Default | Direct CLI Flag |
| :--- | :--- | :--- | :--- | :--- |
| `optimizeImages` | `boolean` | `true` \| `false` (WebP 99% embedded images + adaptive Indexed PNG / 85% JPEG page compression) | `true` | `--optimize-images` |

---

## Direct CLI Flags Quick Reference

For simple one-liners (still consult `pdf-export-settings.json` first and prefer `--job-file` whenever any non-flag option differs from plugin defaults):

- **Target:** `--vault <dir>`, `--note <rel-path>`, `--folder <rel-path>`, `--merged`, `--merge <n1,n2,...>`, `--job-file <json-path>`
- **Output:** `--out <rel-dir>`, `--name <filename-without-pdf>`, `--open`
- **Quick styling flags:** `--theme`, `--size`, `--orientation`, `--auto-landscape`, `--scale`, `--title`, `--frontmatter`, `--header`, `--footnote`, `--optimize-images`, `--toc`, `--bookmarks`
- **Execution:** `--vault-name <name>`, `--timeout <sec>`, `--poll <ms>`, `--no-launch`, `--no-wait`, `--json`

## Platform Notes
- **Windows:** `obsidian-pdf-cli.mjs` automatically ensures `markdown-to-pdf-mobile` is enabled via `Obsidian.com` / `obsidian` CLI if available, and launches `obsidian://mobile-pdf-export?...` via `cmd.exe /c start`.
- **macOS / Linux / WSL:** Uses `open`, `xdg-open`, or WSL `cmd.exe /c start`.
- **Android (Termux):** Uses `termux-open-url` (fallback `am start`). Keep Obsidian unrestricted in Android battery settings for large folder exports.
- **Queueing:** Multiple jobs triggered back-to-back are automatically queued sequentially inside Obsidian without losing jobs.
- **Job file cleanup:** Once all tasks in a queued automation job file (`export-job.json`) finish, the plugin automatically deletes `export-job.json` (while keeping `export-result.json` intact for CLI/agent polling) so completed jobs do not re-run accidentally. Manually cancelled jobs keep `export-job.json` for resume.
