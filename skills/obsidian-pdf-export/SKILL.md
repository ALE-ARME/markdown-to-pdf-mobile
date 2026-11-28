---
name: obsidian-pdf-export
description: Export Obsidian Markdown notes, folders (one PDF per note by default), or explicitly requested merged multi-note books to PDF with the "Markdown to PDF Mobile" plugin on Windows, macOS, and Linux.
---

# Obsidian PDF Export

## STRICT EXECUTION RULE (READ FIRST)
Your **FIRST and ONLY tool call** for an export request MUST be running the cross-platform Python dispatcher below, passing the user's raw requested name directly to `-t`.

**FORBIDDEN before running the script:**
- Do **NOT** run `find`, `ls`, `grep`, or any file search (the script already performs a case-insensitive search across the vault).
- Do **NOT** read `pdf-export-settings.json` (the script loads it automatically).
- Do **NOT** check if Obsidian is running or edit plugin files (the script handles everything).
- Do **NOT** call `.ps1` or `.sh` directly — always call `export.py`.

## Quick Export Command (Windows, macOS & Linux)

```bash
python3 "<path-to-skill>/scripts/export.py" -t "<user requested name>"
```
*(If `python3` is not found on Windows, use `python` instead.)*

## After Running the Script
- Default folder mode is `separate` (one PDF per note). Use `-m merged` **only** if the user explicitly asked for a single merged PDF or book.
- If the script outputs `MULTIPLE_MATCHES:`, ask the user which one they meant or re-run with the exact path.
- Otherwise, report the generated PDF path(s) from `tasks[].outputs`.

---

**Custom settings / Permanent defaults:** ONLY if the user explicitly asked for custom PDF options (theme, orientation, margins, font, TOC, headers/footnotes, output folder, etc.) or wants to inspect/change permanent defaults, read [SUPPLEMENT.md](./SUPPLEMENT.md) before running the script.
