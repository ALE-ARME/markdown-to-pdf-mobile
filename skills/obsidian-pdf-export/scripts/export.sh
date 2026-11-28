#!/usr/bin/env bash
set -euo pipefail

TARGET=""
MODE="separate"
OUTPUT_DIR=""
OUTPUT_NAME=""
OPTIONS_JSON=""
TIMEOUT=180

while getopts "t:m:d:n:o:T:" opt; do
  case "$opt" in
    t) TARGET="$OPTARG" ;;
    m) MODE="$OPTARG" ;;
    d) OUTPUT_DIR="$OPTARG" ;;
    n) OUTPUT_NAME="$OPTARG" ;;
    o) OPTIONS_JSON="$OPTARG" ;;
    T) TIMEOUT="$OPTARG" ;;
    *) exit 1 ;;
  esac
done

if [[ -z "$TARGET" ]]; then
  echo "Usage: $0 -t <target> [-m separate|merged] [-d outputDir] [-n outputName] [-o optionsJson] [-T timeoutSeconds]" >&2
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SKILL_DIR="$(dirname "$SCRIPT_DIR")"
SETTINGS_PATH="$SKILL_DIR/pdf-export-settings.json"

python3 - "$SETTINGS_PATH" "$TARGET" "$MODE" "$OUTPUT_DIR" "$OUTPUT_NAME" "$OPTIONS_JSON" "$TIMEOUT" <<'PYEOF'
import json, os, sys, time, subprocess, shutil
from pathlib import Path

settings_path, target, mode, out_dir, out_name, opts_json, timeout_s = sys.argv[1:]
timeout_s = int(timeout_s)

with open(settings_path, "r", encoding="utf-8") as f:
    settings = json.load(f)

vault = os.environ.get("OBSIDIAN_VAULT_PATH", "")
if not vault or not os.path.isdir(vault):
    vault = settings.get("cli", {}).get("vaultPath", "")
if not vault or not os.path.isdir(vault):
    curr = Path(settings_path).resolve()
    for parent in curr.parents:
        if (parent / ".obsidian").exists():
            vault = str(parent)
            break
if not vault or not os.path.isdir(vault):
    raise SystemExit(f"Vault path not found: {vault}")

vault_path = Path(vault)
candidate = vault_path / target
if candidate.exists():
    item = candidate
else:
    t_low = target.lower()
    matches = []
    for p in vault_path.rglob("*"):
        if ".obsidian" in p.parts:
            continue
        if p.is_file() and p.suffix.lower() == ".pdf":
            continue
        if t_low in p.name.lower():
            matches.append(p)
    if not matches:
        raise SystemExit(f"No note or folder matching '{target}' found in {vault}")
    if len(matches) > 1:
        exact = [p for p in matches if p.stem.lower() == t_low or p.name.lower() == t_low]
        if len(exact) == 1:
            item = exact[0]
        else:
            print("MULTIPLE_MATCHES:")
            for m in matches:
                print("- " + m.relative_to(vault_path).as_posix())
            sys.exit(2)
    else:
        item = matches[0]

rel_path = item.relative_to(vault_path).as_posix()
print(f"Resolved: {rel_path} (IsDir: {item.is_dir()})")

# Enable plugin if missing
cp_path = vault_path / ".obsidian" / "community-plugins.json"
with open(cp_path, "r", encoding="utf-8") as f:
    cp = json.load(f)
if "markdown-to-pdf-mobile" not in cp:
    cp.append("markdown-to-pdf-mobile")
    with open(cp_path, "w", encoding="utf-8") as f:
        json.dump(cp, f, indent=2)
    print("Enabled markdown-to-pdf-mobile in community-plugins.json")

options = dict(settings["options"])
if opts_json:
    options.update(json.loads(opts_json))

final_out_dir = out_dir or (f"{settings['cli']['defaultOutputDir']}/{item.name}" if item.is_dir() else settings["cli"]["defaultOutputDir"])

if item.is_dir():
    task = {"type": "folder", "folderPath": rel_path, "mode": mode, "outputDir": final_out_dir}
else:
    task = {"type": "note", "notePath": rel_path, "outputDir": final_out_dir, "outputName": out_name or item.stem}

job_id = time.strftime("agent-%Y%m%d-%H%M%S")
job = {"jobId": job_id, "openResult": False, "options": options, "tasks": [task]}

plugin_dir = vault_path / ".obsidian" / "plugins" / "markdown-to-pdf-mobile"
job_path = plugin_dir / "export-job.json"
result_path = plugin_dir / "export-result.json"

with open(job_path, "w", encoding="utf-8") as f:
    json.dump(job, f, indent=2, ensure_ascii=True)

# Launch Obsidian if not running using systemd-run --user --scope so it stays open after script exits
is_flatpak = shutil.which("flatpak") and subprocess.run(["flatpak", "info", "md.obsidian.Obsidian"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL).returncode == 0
running = (subprocess.run(["pgrep", "-x", "obsidian"], stdout=subprocess.DEVNULL).returncode == 0) or (is_flatpak and "md.obsidian.Obsidian" in subprocess.run(["flatpak", "ps"], capture_output=True, text=True).stdout)

if not running:
    cmd = ["flatpak", "run", "md.obsidian.Obsidian"] if is_flatpak else [shutil.which("obsidian") or "obsidian"]
    if shutil.which("systemd-run"):
        subprocess.Popen(["systemd-run", "--user", "--quiet"] + cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, stdin=subprocess.DEVNULL)
    else:
        subprocess.Popen(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, stdin=subprocess.DEVNULL, start_new_session=True)
    print("Launched Obsidian in independent scope, waiting 10s...")
    time.sleep(10)

subprocess.run(["xdg-open", "obsidian://mobile-pdf-export"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

deadline = time.time() + timeout_s
while time.time() < deadline:
    time.sleep(1)
    if not job_path.exists():
        if result_path.exists():
            try:
                res = json.loads(result_path.read_text(encoding="utf-8"))
                if res.get("jobId") == job_id:
                    print(json.dumps(res, indent=2, ensure_ascii=False))
                    sys.exit(0)
            except Exception:
                pass
        print(json.dumps({"jobId": job_id, "status": "completed"}))
        sys.exit(0)
    elif result_path.exists():
        try:
            res = json.loads(result_path.read_text(encoding="utf-8"))
            if res.get("jobId") == job_id and res.get("status") in ("completed", "partial", "failed"):
                print(json.dumps(res, indent=2, ensure_ascii=False))
                sys.exit(0)
        except Exception:
            pass

raise SystemExit(f"Timeout after {timeout_s}s waiting for job {job_id}")
PYEOF
