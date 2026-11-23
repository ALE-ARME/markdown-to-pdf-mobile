#!/usr/bin/env node
/**
 * obsidian-pdf-cli.mjs — Zero-dependency cross-platform CLI & AI Agent wrapper
 * for the Obsidian "Markdown to PDF Mobile" plugin.
 *
 * Works on:
 *   - Linux, macOS, Windows (Node.js 18+)
 *   - Android via Termux (uses `termux-open-url` or `am start`)
 *   - AI coding agents / scripts (`--json` machine-readable output)
 *
 * Examples:
 *   node obsidian-pdf-cli.mjs --vault "/path/to/Vault" --note "Biology/Cells.md"
 *   node obsidian-pdf-cli.mjs --vault "/path/to/Vault" --folder "Biology" --out "PDFs"
 *   node obsidian-pdf-cli.mjs --vault "/path/to/Vault" --folder "Biology" --merged --name "Biology Book"
 *   node obsidian-pdf-cli.mjs --vault "/path/to/Vault" --merge "Intro.md,Ch1.md,Ch2.md" --name "Course" --theme dark
 *   node obsidian-pdf-cli.mjs --vault "/path/to/Vault" --note "Notes/Lab.md" --header "{title}" --frontmatter --json
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';

const PLUGIN_ID = 'markdown-to-pdf-mobile';

function printHelp() {
    console.log(`
obsidian-pdf-cli.mjs — Automate Obsidian "Markdown to PDF Mobile" exports

Usage:
  node obsidian-pdf-cli.mjs --vault <vault-dir> [target] [options]

Required:
  --vault <path>            Absolute or relative path to your Obsidian vault folder
                            (or set OBSIDIAN_VAULT_PATH environment variable)

Targets (pick one, or pass --job-file):
  --note <rel-path>         Export a single Markdown note (vault-relative, e.g. "Bio/Cells.md")
  --folder <rel-path>       Export all Markdown notes in a folder ("/" for whole vault)
  --merge <n1,n2,...>       Comma-separated vault-relative note paths to merge in exact order
  --job-file <json-path>    Run a custom multi-task JSON job file

Target options:
  --merged                  When used with --folder, merge folder notes into a single PDF
  --out <rel-dir>           Destination folder inside the vault (e.g. "PDFs/Exports")
  --name <pdf-name>         Output PDF filename (without .pdf)
  --open                    Open the generated PDF in Obsidian when finished

PDF styling overrides (temporary for this job only):
  --theme <css|light|dark>  Page theme
  --size <a4|letter|a5>     Paper size
  --orientation <portrait|landscape>
  --auto-landscape <true|false>
  --scale <80..120>         Content scale percent
  --title <true|false>      Show Note Title
  --frontmatter <true|false> Show YAML Properties card on Page 1
  --header <template>       Enable header and set template (e.g. "{title} - {page}/{total}")
  --footnote <template>     Enable footnote and set template
  --optimize-images <true|false> Enable/disable WebP 99% optimization
  --toc <true|false>        Include Page 1 Table of Contents
  --bookmarks <true|false>  Include PDF Document Outline bookmarks

Execution options:
  --vault-name <name>       Obsidian vault name for URI (defaults to vault folder basename)
  --timeout <seconds>       Max seconds to wait for completion (default: 600)
  --poll <ms>               Polling interval in ms (default: 750)
  --no-launch               Write export-job.json only without launching obsidian:// URI
  --no-wait                 Trigger Obsidian and exit immediately without waiting
  --json                    Print final export-result.json to stdout (ideal for AI agents)
  -h, --help                Show this help
`.trim());
}

function parseBool(raw, defaultVal = true) {
    if (raw === undefined || raw === null) return defaultVal;
    const s = String(raw).trim().toLowerCase();
    if (s === 'true' || s === '1' || s === 'yes' || s === 'on') return true;
    if (s === 'false' || s === '0' || s === 'no' || s === 'off') return false;
    return defaultVal;
}

function parseArgs(argv) {
    const args = { _: [] };
    for (let i = 0; i < argv.length; i++) {
        const tok = argv[i];
        if (!tok.startsWith('-')) {
            args._.push(tok);
            continue;
        }
        if (tok === '-h' || tok === '--help') {
            args.help = true;
            continue;
        }
        const eqIdx = tok.indexOf('=');
        if (eqIdx > 0) {
            const k = tok.slice(2, eqIdx);
            args[k] = tok.slice(eqIdx + 1);
            continue;
        }
        const key = tok.replace(/^--?/, '');
        const next = argv[i + 1];
        const flagOnly = new Set(['merged', 'open', 'json', 'no-launch', 'no-wait']);
        if (flagOnly.has(key) || next === undefined || next.startsWith('--')) {
            args[key] = true;
        } else {
            args[key] = next;
            i++;
        }
    }
    return args;
}

function ensurePluginEnabled(pluginId = PLUGIN_ID) {
    const candidates = [
        'obsidian',
        'C:\\Program Files\\Obsidian\\Obsidian.com',
        path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Obsidian', 'Obsidian.com')
    ];
    for (const bin of candidates) {
        try {
            if (bin !== 'obsidian' && !fs.existsSync(bin)) continue;
            const res = spawnSync(bin, ['plugin:enable', `id=${pluginId}`], { encoding: 'utf8', windowsHide: true });
            if (res.status === 0 || (res.stderr && res.stderr.includes('already enabled')) || (res.stdout && res.stdout.includes('already enabled'))) {
                return true;
            }
        } catch {}
    }
    return false;
}

function launchObsidianUri(uri) {
    const platform = process.platform;
    const isTermux = Boolean(process.env.TERMUX_VERSION || (process.env.PREFIX && process.env.PREFIX.includes('com.termux')));

    if (isTermux) {
        let res = spawnSync('termux-open-url', [uri], { stdio: 'ignore' });
        if (res.status === 0) return { ok: true, method: 'termux-open-url' };
        res = spawnSync('am', ['start', '-a', 'android.intent.action.VIEW', '-d', uri], { stdio: 'ignore' });
        if (res.status === 0) return { ok: true, method: 'am start' };
        return { ok: false, error: 'Failed to launch URI in Termux (install termux-api or ensure `am` is accessible).' };
    }

    if (platform === 'darwin') {
        const res = spawnSync('open', [uri], { stdio: 'ignore' });
        return res.status === 0 ? { ok: true, method: 'open' } : { ok: false, error: 'macOS `open` failed.' };
    }

    if (platform === 'win32') {
        const res = spawnSync('cmd.exe', ['/c', `start "" "${uri.replace(/"/g, '')}"`], { stdio: 'ignore', windowsHide: true });
        return res.status === 0 ? { ok: true, method: 'cmd start' } : { ok: false, error: 'Windows `start` failed.' };
    }

    // Linux / WSL
    if (os.release().toLowerCase().includes('microsoft')) {
        const wslRes = spawnSync('cmd.exe', ['/c', 'start', '', uri], { stdio: 'ignore' });
        if (wslRes.status === 0) return { ok: true, method: 'wsl cmd.exe' };
    }
    const res = spawnSync('xdg-open', [uri], { stdio: 'ignore' });
    return res.status === 0 ? { ok: true, method: 'xdg-open' } : { ok: false, error: '`xdg-open` failed.' };
}

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
    const args = parseArgs(process.argv.slice(2));
    if (args.help) {
        printHelp();
        process.exit(0);
    }

    const vaultPathRaw = args.vault || process.env.OBSIDIAN_VAULT_PATH;
    if (!vaultPathRaw) {
        console.error('Error: --vault <path> (or OBSIDIAN_VAULT_PATH) is required. Run with --help for usage.');
        process.exit(2);
    }

    const vaultDir = path.resolve(String(vaultPathRaw));
    if (!fs.existsSync(vaultDir) || !fs.statSync(vaultDir).isDirectory()) {
        console.error(`Error: Vault directory does not exist: ${vaultDir}`);
        process.exit(2);
    }

    const pluginDir = path.join(vaultDir, '.obsidian', 'plugins', PLUGIN_ID);
    const jobFilePath = path.join(pluginDir, 'export-job.json');
    const resultFilePath = path.join(pluginDir, 'export-result.json');
    fs.mkdirSync(pluginDir, { recursive: true });

    let spec;
    if (args['job-file']) {
        const raw = fs.readFileSync(path.resolve(String(args['job-file'])), 'utf8');
        spec = JSON.parse(raw);
        if (!spec.jobId) spec.jobId = `cli-${Date.now()}`;
    } else {
        const options = {};
        if (args.theme) options.pdfTheme = String(args.theme);
        if (args.size) options.pageSize = String(args.size);
        if (args.orientation) options.pageOrientation = String(args.orientation);
        if (args['auto-landscape'] !== undefined) options.autoLandscapeWidePages = parseBool(args['auto-landscape'], true);
        if (args.scale !== undefined) options.contentScale = Number(args.scale);
        if (args.title !== undefined) options.showTitle = parseBool(args.title, true);
        if (args.frontmatter !== undefined) options.showFrontmatter = parseBool(args.frontmatter, true);
        if (args.header !== undefined) {
            if (args.header === true || String(args.header).toLowerCase() === 'true') {
                options.showHeader = true;
            } else if (String(args.header).toLowerCase() === 'false') {
                options.showHeader = false;
            } else {
                options.showHeader = true;
                options.headerTemplate = String(args.header);
            }
        }
        if (args.footnote !== undefined) {
            if (args.footnote === true || String(args.footnote).toLowerCase() === 'true') {
                options.showFootnote = true;
            } else if (String(args.footnote).toLowerCase() === 'false') {
                options.showFootnote = false;
            } else {
                options.showFootnote = true;
                options.footnoteTemplate = String(args.footnote);
            }
        }
        if (args['optimize-images'] !== undefined) options.optimizeImages = parseBool(args['optimize-images'], true);
        if (args.toc !== undefined) options.includeTocPage = parseBool(args.toc, true);
        if (args.bookmarks !== undefined) options.includeBookmarks = parseBool(args.bookmarks, true);

        const tasks = [];
        if (args.merge) {
            const notes = String(args.merge).split(',').map((s) => s.trim()).filter(Boolean);
            tasks.push({
                type: 'merge',
                notes,
                outputDir: args.out !== undefined ? String(args.out) : undefined,
                outputName: args.name !== undefined ? String(args.name) : 'Merged Notes'
            });
        } else if (args.folder !== undefined) {
            tasks.push({
                type: 'folder',
                folderPath: args.folder === true ? '/' : String(args.folder),
                mode: args.merged ? 'merged' : 'separate',
                outputDir: args.out !== undefined ? String(args.out) : undefined,
                outputName: args.name !== undefined ? String(args.name) : undefined
            });
        } else if (args.note) {
            tasks.push({
                type: 'note',
                notePath: String(args.note),
                outputDir: args.out !== undefined ? String(args.out) : undefined,
                outputName: args.name !== undefined ? String(args.name) : undefined
            });
        } else {
            console.error('Error: Specify one of --note, --folder, --merge, or --job-file. Run with --help.');
            process.exit(2);
        }

        spec = {
            jobId: `cli-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
            options: Object.keys(options).length > 0 ? options : undefined,
            openResult: Boolean(args.open),
            tasks
        };
    }

    fs.writeFileSync(jobFilePath, JSON.stringify(spec, null, 2), 'utf8');

    const vaultName = args['vault-name'] ? String(args['vault-name']) : path.basename(vaultDir);
    const uri = `obsidian://mobile-pdf-export?vault=${encodeURIComponent(vaultName)}&job=default`;

    ensurePluginEnabled(PLUGIN_ID);

    if (!args['no-launch']) {
        const launch = launchObsidianUri(uri);
        if (!launch.ok && !args.json) {
            console.warn(`Warning: ${launch.error}`);
            console.warn(`Open Obsidian manually or run: ${uri}`);
        }
    }

    if (args['no-wait']) {
        if (args.json) {
            console.log(JSON.stringify({ queued: true, jobId: spec.jobId, jobFile: jobFilePath, uri }, null, 2));
        } else {
            console.log(`Queued job ${spec.jobId} at ${jobFilePath}`);
            console.log(`URI: ${uri}`);
        }
        process.exit(0);
    }

    const timeoutMs = Math.max(5, Number(args.timeout || 600)) * 1000;
    const pollMs = Math.max(200, Number(args.poll || 750));
    const startMs = Date.now();
    let lastCompletedCount = -1;

    while (Date.now() - startMs < timeoutMs) {
        if (fs.existsSync(resultFilePath)) {
            try {
                const res = JSON.parse(fs.readFileSync(resultFilePath, 'utf8'));
                if (res && res.jobId === spec.jobId) {
                    const done = Array.isArray(res.completedTaskIndices) ? res.completedTaskIndices.length : 0;
                    if (!args.json && done !== lastCompletedCount) {
                        lastCompletedCount = done;
                        console.error(`[${res.status}] Tasks completed: ${done}/${res.totalTasks}`);
                    }
                    if (res.status === 'completed' || res.status === 'partial' || res.status === 'failed') {
                        if (args.json) {
                            console.log(JSON.stringify(res, null, 2));
                        } else {
                            const outputs = (res.tasks || []).flatMap((t) => t.outputs || []);
                            console.log(`Status: ${res.status} (${outputs.length} PDF${outputs.length === 1 ? '' : 's'})`);
                            for (const out of outputs) {
                                console.log(`  - ${out}`);
                            }
                            for (const t of (res.tasks || [])) {
                                if (t.error) console.error(`  ! Task #${t.index + 1} error: ${t.error}`);
                            }
                        }
                        process.exit(res.status === 'completed' ? 0 : 1);
                    }
                }
            } catch {
                // Result file may still be mid-write; retry next poll
            }
        }
        await sleep(pollMs);
    }

    const timeoutErr = {
        jobId: spec.jobId,
        status: 'timeout',
        error: `Timed out after ${Math.round(timeoutMs / 1000)}s waiting for Obsidian to finish ${jobFilePath}`
    };
    if (args.json) {
        console.log(JSON.stringify(timeoutErr, null, 2));
    } else {
        console.error(timeoutErr.error);
    }
    process.exit(124);
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
