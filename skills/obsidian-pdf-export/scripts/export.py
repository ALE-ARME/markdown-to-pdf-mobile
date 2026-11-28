#!/usr/bin/env python3
import argparse
import subprocess
import sys
from pathlib import Path

def main():
    parser = argparse.ArgumentParser(description="Cross-platform Obsidian PDF export dispatcher")
    parser.add_argument("-t", "-Target", "--target", required=True, help="Note or folder name/path")
    parser.add_argument("-m", "-Mode", "--mode", default="separate", choices=["separate", "merged"], help="Folder export mode")
    parser.add_argument("-d", "-OutputDir", "--output-dir", default="", help="Output directory inside vault")
    parser.add_argument("-n", "-OutputName", "--output-name", default="", help="Output PDF filename (without .pdf)")
    parser.add_argument("-o", "-OptionsJson", "--options", default="", help="JSON string of temporary option overrides")
    parser.add_argument("-T", "-TimeoutSeconds", "--timeout", type=int, default=180, help="Timeout in seconds")

    args = parser.parse_args()
    script_dir = Path(__file__).resolve().parent

    if sys.platform == "win32":
        ps1 = script_dir / "export.ps1"
        cmd = [
            "powershell", "-ExecutionPolicy", "Bypass", "-File", str(ps1),
            "-Target", args.target,
            "-Mode", args.mode,
            "-TimeoutSeconds", str(args.timeout),
        ]
        if args.output_dir:
            cmd += ["-OutputDir", args.output_dir]
        if args.output_name:
            cmd += ["-OutputName", args.output_name]
        if args.options:
            cmd += ["-OptionsJson", args.options]
    else:
        # Linux & macOS
        sh = script_dir / "export.sh"
        cmd = [
            "bash", str(sh),
            "-t", args.target,
            "-m", args.mode,
            "-T", str(args.timeout),
        ]
        if args.output_dir:
            cmd += ["-d", args.output_dir]
        if args.output_name:
            cmd += ["-n", args.output_name]
        if args.options:
            cmd += ["-o", args.options]

    res = subprocess.run(cmd)
    sys.exit(res.returncode)

if __name__ == "__main__":
    main()
