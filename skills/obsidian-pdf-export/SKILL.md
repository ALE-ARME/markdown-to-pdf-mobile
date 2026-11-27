---
name: obsidian-pdf-export
description: Export Obsidian Markdown notes, folders (one PDF per note by default), or explicitly requested merged multi-note books to PDF with the "Markdown to PDF Mobile" plugin. Write export-job.json directly (UTF-8 no BOM, `Â°` escaped as \u00b0) and trigger `markdown-to-pdf-mobile:run-automation-job` through Obsidian CLI; never run obsidian-pdf-cli.mjs in this vault because the obsidian:// URI launch fails and node blocks for 600 s.
---

# Obsidian PDF Export Skill (job file + Obsidian CLI trigger)

Use this skill whenever the user asks to export Obsidian notes or folders to PDF, merge multiple Markdown notes into a single PDF, or inspect/change their PDF export preferences.

## Mandatory Settings Workflow (READ THIS FIRST)

This skill maintains its **own standalone settings file** located in the same folder as this `SKILL.md`:

- **Settings file:** `./pdf-export-settings.json` (in this skill's directory â€” completely separate from Obsidian's `.obsidian/plugins/markdown-to-pdf-mobile/data.json` so CLI/agent exports never overwrite or depend on the user's interactive UI settings).

### Required Rules for Every Agent Run
1. **Always read `pdf-export-settings.json` BEFORE generating any PDF.**
   - Load `cli` defaults (`scriptPath`, `vaultPath`, `vaultName`, `defaultOutputDir`, `openResult`, `timeoutSeconds`, `pollMs`) and all 24 PDF styling fields under `options`.
   - If `cli.vaultPath` is empty, check the `OBSIDIAN_VAULT_PATH` environment variable or ask the user once for their vault path, then save it into `pdf-export-settings.json` if the user wants it remembered.
2. **Default vs Temporary Settings Rule (STRICT):**
   - The settings in `pdf-export-settings.json` are the **permanent global defaults**.
   - **One-off overrides (DEFAULT BEHAVIOR):** whenever the user asks for specific settings during an export request (e.g. *"export in dark theme"*, *"no title"*, *"use landscape"*, *"narrow margins"*), **apply them ONLY TEMPORARILY to that specific job** by overriding the matching keys in the job's `options` object, and **DO NOT touch or overwrite `pdf-export-settings.json`**.
   - **Permanent default changes:** update `pdf-export-settings.json` **ONLY when the user explicitly instructs to change the default permanently** (e.g. *"save as default"*, *"set permanently"*, *"from now on use..."*, *"update defaults"*). Confirm the permanent change to the user.
3. **Always write all 24 `options` into the job file**, never rely on plugin defaults: the job file supports all 24 (margins, custom fonts, header/footnote date & time formats, heading levels, clickable links), while CLI flags cover only 12.
4. **Default mode for folders is `"separate"` (one PDF per note).** Never use `mode: "merged"` or a `"merge"` task unless the user explicitly asks for a single merged PDF in that request (*"a single merged PDF"*, *"merge them"*, *"into a book"*). A folder export request with no mode named means separate files.

---

## One-Command Export Script (RECOMMENDED â€” Use This First)

On Windows, you can run the bundled `scripts/export.ps1` script in this skill's directory. It handles everything in one call: resolving the note/folder, enabling the plugin if needed, launching Obsidian detached (`Invoke-CimMethod`), merging any one-off `options` overrides in memory (without touching `pdf-export-settings.json`), writing `export-job.json` (UTF-8 without BOM, `\u00b0` escaped), triggering `& "C:\Program Files\Obsidian\Obsidian.exe" command id=markdown-to-pdf-mobile:run-automation-job`, and polling `export-result.json`:

```powershell
powershell -ExecutionPolicy Bypass -File "scripts/export.ps1" -Target "arti inferiori"
# With one-off overrides (never modifies pdf-export-settings.json):
powershell -ExecutionPolicy Bypass -File "scripts/export.ps1" -Target "Anatomia" -Mode "merged" -OptionsJson '{"pdfTheme":"dark","pageOrientation":"landscape"}'
```

---

## CRITICAL: Do NOT run `obsidian-pdf-cli.mjs` â€” write the job file yourself

`obsidian-pdf-cli.mjs` does exactly two things: it serializes the job into `.obsidian/plugins/markdown-to-pdf-mobile/export-job.json`, and it launches `obsidian://mobile-pdf-export?...`. In this vault the URI does **nothing**, so the node process just polls until its timeout (600 s from settings) and returns nothing. Running it is pure dead time: a folder export that takes ~30 s of real work costs 2+ minutes of blocked shell.

**Skip the CLI entirely. Follow these exact 4 steps:**

**Do NOT write custom PowerShell scripts or `export-job.json` manually.** Always run `scripts/export.ps1` (see **One-Command Export Script** above). It already handles:
1. Resolving the note or folder from the filesystem (including accented/degree-symbol paths).
2. Launching Obsidian detached (`Invoke-CimMethod`) if it is not already running.
3. Enabling `markdown-to-pdf-mobile` in `community-plugins.json` if missing.
4. Merging any one-off `options` overrides in memory (without touching `pdf-export-settings.json`).
5. Writing `export-job.json` (UTF-8 without BOM, `\u00b0` escaped), triggering `Obsidian.exe command id=markdown-to-pdf-mobile:run-automation-job`, and polling `export-result.json` until `completed` / `partial` / `failed`.

### Job file skeleton (write this, don't generate it with the CLI)

`jobId` must be unique per run (timestamp). `options` comes from `pdf-export-settings.json` plus any one-off overrides. The plugin also accepts `type: "merge"` with `notes: [...]` in place of `type: "folder"`.

```json
{
  "jobId": "agent-20261121-180000-01",
  "openResult": false,
  "options": { "...": "all 24 keys from pdf-export-settings.json" },
  "tasks": [
    { "type": "folder", "folderPath": "PATH/TO/FOLDER", "mode": "separate", "outputDir": "99 - PLUGINS/PDF (Mobile)/NAME" }
  ]
}
```

Path to the job file: `<vault>/.obsidian/plugins/markdown-to-pdf-mobile/export-job.json`. Path to the result: `export-result.json` in the same folder.

### The `Â°` corruption trap (this is what breaks exports, not the plugin)

Folder names such as `3Â°ANNO` are the single most common cause of a silently dead job: the job is written, the trigger runs, and the plugin exports nothing because `folderPath` points at a folder that does not exist.

How it happens: building the string in PowerShell and passing it through a shell command mangles `Â°` (U+00B0) into `Ã‚Â°` (U+00C2 U+00B0) â€” visible in UTF-8 bytes as `C3-82-C2-B0` instead of `C3-B0`. The job file then looks fine in the editor and fails at runtime.

Rules:

1. **Never type the accented folder name by hand.** Resolve it from the filesystem: `Get-ChildItem -LiteralPath $parent -Directory | Where-Object { $_.Name -like '3*ANNO' }`.
2. **Never let the `Â°` reach the JSON as a literal character.** In a `.ps1` script, build the job JSON as ASCII and escape the character: `\u00b0`. The simplest reliable pattern is to write the JSON text, then replace the character only inside the path substring:
   `$i = $json.IndexOf('folderPath'); $json = $json.Substring(0, $i) + $json.Substring($i).Replace([string][char]0x00B0, '\u00b0')`
3. **Verify with bytes, not with eyes.** `[System.BitConverter]::ToString([System.Text.Encoding]::UTF8.GetBytes($path))` must contain `C3-B0`. `C3-82-C2-B0` means double encoding; `3F` means the character was lost entirely.
4. **Verify with `-ceq` before triggering,** comparing the parsed `folderPath` against the string rebuilt from `Get-ChildItem`. A `-like` or visual check passes on corrupted paths.
5. Also confirm the file has no BOM: first bytes must be `7B` (`{`), not `EF-BB-BF`.
6. `Set-Content -Encoding UTF8` in PowerShell 5.1 writes a BOM; strip it or write with `[System.IO.File]::WriteAllText` + `New-Object System.Text.UTF8Encoding($false)`.

### Diagnosing a job that never completes

Check in this order, once each â€” do not re-run the same command:

1. `export-job.json` `jobId` is your job and the file mtime is recent â†’ the trigger never fired, re-trigger with Obsidian CLI.
2. `export-result.json` `jobId` is your job and `status` is `running` â†’ it is working, poll again after ~20 s.
3. `export-result.json` still shows the previous job â†’ the plugin rejected the job; re-read `folderPath`/`notePath` bytes and re-check the BOM.
4. `status: completed` but no PDFs on disk â†’ check `tasks[].failedFiles` and `tasks[].error`; usually a bad path or an empty folder.

---

## Executing an Export

### Recommended Pattern: Write the Job JSON Yourself, Then Trigger

1. Read `pdf-export-settings.json`.
2. Resolve every path from the filesystem (never retype accented names) and build the job JSON text with the jobId, `options` and `tasks` described in the CRITICAL section. Escape `Â°` as `\u00b0` inside paths.
3. Write it to `<vault>/.obsidian/plugins/markdown-to-pdf-mobile/export-job.json` as UTF-8 without BOM.
4. **Verify before triggering:** parse the file back, assert the path with `-ceq`, `Test-Path` it, and confirm no BOM.
5. **Trigger and verify** (mandatory, see the CRITICAL section above):
   - `obsidian_cli: ["command", "id=markdown-to-pdf-mobile:run-automation-job"]`
   - Poll `export-result.json` in ~20 s steps until `jobId` matches and `status` is terminal. Read the result from that file, not from any command output.
6. Report `tasks[].outputs`. On `partial` / `failed` also report `tasks[].failedFiles` and `tasks[].error`.

An example job object (same shape as the file you write):

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

### When to use the CLI anyway

Only if writing the file by hand is impossible (no filesystem access). Then pass `--no-wait` so node returns immediately after writing the job, and still do steps 4â€“6 above. Never run the CLI in its default waiting mode in this vault: it blocks for the full `timeoutSeconds` (600 s) and returns nothing useful.

### Folder export default (STRICT)

For `"type": "folder"` always emit `"mode": "separate"`. Use `"merged"` or a `"merge"` task only when the user explicitly asks for one combined PDF. When in doubt, ask or go separate.

---

## Ready-to-run script (PowerShell 5.1, ASCII only)

Save as `.ps1` outside the vault or in `99 - PLUGINS/Copilot/outputs/` (delete afterwards). It resolves the folder from disk, escapes `Â°`, writes the job without BOM, and verifies it before printing `READY`. Run the trigger and the polling separately after it prints `READY`.

```powershell
param([string]$Vault, [string]$FolderRel, [string]$OutDir, [string]$JobId)

$settings = Get-Content -Raw -LiteralPath (Join-Path $Vault ".claude\skills\obsidian-pdf-export\pdf-export-settings.json") | ConvertFrom-Json

# Resolve the real folder name from disk (never type accented names)
$full = Join-Path $Vault ($FolderRel -replace '/','\')
if (-not (Test-Path -LiteralPath $full)) { throw "Folder not found: $full" }

$job = [ordered]@{
  jobId      = $JobId
  openResult = $false
  options    = $settings.options
  tasks      = @(@{ type = 'folder'; folderPath = $FolderRel; mode = 'separate'; outputDir = $OutDir })
}

$json = $job | ConvertTo-Json -Depth 6
# Escape every non-ASCII character only inside the task paths, so JSON stays ASCII
$i = $json.IndexOf('"folderPath"')
if ($i -ge 0) {
  $tail = $json.Substring($i)
  $tail = $tail.Replace([string][char]0x00B0, '\u00b0')
  $json = $json.Substring(0, $i) + $tail
}

$jobFile = Join-Path $Vault ".obsidian\plugins\markdown-to-pdf-mobile\export-job.json"
[System.IO.File]::WriteAllText($jobFile, $json, (New-Object System.Text.UTF8Encoding($false)))

# Verify: no BOM, path round-trips exactly, path exists
$bytes = [System.IO.File]::ReadAllBytes($jobFile)
if ($bytes[0] -eq 0xEF) { throw "BOM written to job file" }
$check = Get-Content -Raw -LiteralPath $jobFile | ConvertFrom-Json
if ($check.tasks[0].folderPath -cne $FolderRel) { throw "folderPath corrupted" }
if (-not (Test-Path -LiteralPath (Join-Path $Vault ($check.tasks[0].folderPath -replace '/','\')))) { throw "folderPath does not resolve" }
Write-Output "READY $($check.jobId)"
```

Call it with the folder path rebuilt from `Get-ChildItem` (e.g. `3*ANNO`) so the `Â°` never passes through a hand-typed literal.

---

## Supported Task Types (`tasks[]` in `export-job.json`)

A single job file can contain **one or multiple tasks** in `tasks[]`, and any individual task can also include its own `options` object to override top-level `options` for that task only.

| `type` | Required Fields | Optional Fields | Description |
| :--- | :--- | :--- | :--- |
| `"note"` | `notePath` (vault-relative `.md` path) | `outputDir`, `outputName`, `options` | Export a single Markdown note to PDF. |
| `"folder"` | `folderPath` (vault-relative folder, or `"/"` for whole vault) | `mode` (`"separate"` \| `"merged"`, **default and preferred `"separate"`**), `outputDir`, `outputName` (used when `mode: "merged"`), `options` | Recursively export all `.md` notes in a folder either as separate PDF files (mirroring subfolder structure) or merged into one PDF. **Use `"separate"` unless the user explicitly asks for a single merged PDF.** |
| `"merge"` | `notes` (ordered array of vault-relative `.md` paths) | `outputDir`, `outputName` (default `"Merged Notes"`), `options` | Merge specific notes in exact chapter order into one PDF with bookmarks, Page 1 TOC (if enabled), unified page numbers, and cross-note links. **Only on explicit user request.** |

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
| `customMarginMm` | `number` | Integer `5`â€“`45` (used when `marginPreset: "custom"`) | `15` | *(via `--job-file` only)* |
| `contentScale` | `number` | `80`â€“`120` in steps of `5` (`80, 85, 90, 95, 100, 105, 110, 115, 120`) | `100` | `--scale` |

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
| `bookmarkHeadingLevels` | `number[]` | Subset of `[1, 2, 3, 4, 5, 6]` (H1â€“H6) | `[1,2,3,4,5,6]` | *(via `--job-file` only)* |
| `enableClickableLinks` | `boolean` | `true` \| `false` (external URLs, heading/footnote anchors, cross-note links) | `true` | *(via `--job-file` only)* |

### 6. Output & Compression
| Parameter | Type | Allowed Values / Range | Default | Direct CLI Flag |
| :--- | :--- | :--- | :--- | :--- |
| `optimizeImages` | `boolean` | `true` \| `false` (WebP 99% embedded images + adaptive Indexed PNG / 85% JPEG page compression) | `true` | `--optimize-images` |

---

## Direct CLI Flags Quick Reference

Kept for reference only â€” in this vault write the job file directly instead (see CRITICAL above). Consult `pdf-export-settings.json` first and prefer the job file whenever any option differs from plugin defaults.

- **Target:** `--vault <dir>`, `--note <rel-path>`, `--folder <rel-path>`, `--merged`, `--merge <n1,n2,...>`, `--job-file <json-path>`
- **Output:** `--out <rel-dir>`, `--name <filename-without-pdf>`, `--open`
- **Quick styling flags:** `--theme`, `--size`, `--orientation`, `--auto-landscape`, `--scale`, `--title`, `--frontmatter`, `--header`, `--footnote`, `--optimize-images`, `--toc`, `--bookmarks`
- **Execution:** `--vault-name <name>`, `--timeout <sec>`, `--poll <ms>`, `--no-launch`, `--no-wait`, `--json`

## Platform Notes
- **Windows:** the `obsidian://mobile-pdf-export` launch is unreliable in this vault. Do not depend on the CLI at all: write `export-job.json`, then trigger `markdown-to-pdf-mobile:run-automation-job` through Obsidian CLI.
- **macOS / Linux / WSL:** Uses `open`, `xdg-open`, or WSL `cmd.exe /c start`.
- **Queueing:** Multiple jobs triggered back-to-back are automatically queued sequentially inside Obsidian without losing jobs.
