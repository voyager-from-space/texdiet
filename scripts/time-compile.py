#!/usr/bin/env python3
"""Time one pdflatex pass of an original zip vs its texdiet-fixed zip.

Writes JSON to --out. This is the source of truth for the proof page.
Does not print a ship-ready claim; the caller reads the JSON.
"""
from __future__ import annotations

import argparse
import json
import os
import shutil
import statistics
import subprocess
import sys
import tempfile
import time
import zipfile
from pathlib import Path


def find_texbin() -> Path:
    env = os.environ.get("TEXDIET_TEXBIN")
    if env:
        p = Path(env) / "pdflatex"
        if p.exists():
            return Path(env)
    which = shutil.which("pdflatex")
    if which:
        return Path(which).parent
    home = Path.home() / ".TinyTeX" / "bin" / "x86_64-linux"
    if (home / "pdflatex").exists():
        return home
    sys.exit("pdflatex not found. Install TeX Live / TinyTeX, or set TEXDIET_TEXBIN.")


def unzip(src: Path, dest: Path) -> Path:
    dest.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(src) as z:
        z.extractall(dest)
        mains = [
            n
            for n in z.namelist()
            if n.endswith(".tex") and "\\documentclass" in z.read(n).decode("utf-8", "replace")
        ]
    if not mains:
        sys.exit(f"no root .tex with \\documentclass in {src}")
    return dest / mains[0]


def pdfinfo_pages(pdf: Path) -> int:
    r = subprocess.run(["pdfinfo", str(pdf)], capture_output=True, text=True)
    if r.returncode != 0:
        return 0
    for line in r.stdout.splitlines():
        if line.startswith("Pages:"):
            return int(line.split(":")[1].strip())
    return 0


def compile_once(main: Path, work: Path, shell_escape: bool) -> dict:
    pdf = main.with_suffix(".pdf")
    log = main.with_suffix(".log")
    cmd = [
        "pdflatex",
        "-interaction=nonstopmode",
        "-halt-on-error",
        "-file-line-error",
    ]
    if shell_escape:
        cmd.append("-shell-escape")
    cmd.append(main.name)
    env = os.environ.copy()
    env["PATH"] = str(find_texbin()) + os.pathsep + env.get("PATH", "")
    t0 = time.perf_counter()
    r = subprocess.run(cmd, cwd=str(main.parent), env=env, capture_output=True)
    ms = (time.perf_counter() - t0) * 1000
    pages = pdfinfo_pages(pdf) if pdf.exists() else 0
    size = pdf.stat().st_size if pdf.exists() else 0
    tail = ""
    if r.returncode != 0 and log.exists():
        tail = log.read_text(errors="replace")[-2000:]
    elif r.returncode != 0:
        tail = (r.stderr or r.stdout).decode("utf-8", "replace")[-2000:]
    return {
        "ms": round(ms, 1),
        "exit": r.returncode,
        "pages": pages,
        "pdf_bytes": size,
        "shell_escape": shell_escape,
        "log_tail": tail,
    }


def median(xs: list[float]) -> float:
    return float(statistics.median(xs))


def summarize(runs: list[dict], *, has_cold: bool = True) -> dict:
    ok = all(r["exit"] == 0 for r in runs)
    times = [r["ms"] for r in runs]
    warm = times[1:] if has_cold and len(times) > 1 else times
    pages = {r["pages"] for r in runs}
    pdfs = {r["pdf_bytes"] for r in runs if r["exit"] == 0}
    return {
        "ok": ok,
        "n": len(runs),
        "cold_ms": times[0] if times else None,
        "warm_median_ms": round(median(warm), 1) if warm else None,
        "warm_min_ms": min(warm) if warm else None,
        "warm_max_ms": max(warm) if warm else None,
        "warm_runs_ms": warm,
        "pages": sorted(pages),
        "pdf_bytes": max(pdfs) if pdfs else 0,
        "runs": runs,
    }


def extract_fresh(zip_path: Path, parent: Path, name: str) -> Path:
    dest = parent / name
    if dest.exists():
        shutil.rmtree(dest)
    return unzip(zip_path, dest)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--orig", required=True)
    ap.add_argument("--fixed", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--runs", type=int, default=6, help="total runs per side including one cold")
    ap.add_argument("--se-warm", type=int, default=5, help="shell-escape follow-up runs after the first")
    args = ap.parse_args()
    orig_zip = Path(args.orig).resolve()
    fixed_zip = Path(args.fixed).resolve()
    out = Path(args.out).resolve()
    texbin = find_texbin()
    pdftex = subprocess.run(["pdflatex", "--version"], capture_output=True, text=True, env={**os.environ, "PATH": str(texbin) + os.pathsep + os.environ.get("PATH", "")})
    engine = pdftex.stdout.splitlines()[0] if pdftex.stdout else "pdflatex"
    nproc = os.cpu_count() or 0
    uptime = Path("/proc/loadavg").read_text().split()[:3] if Path("/proc/loadavg").exists() else []

    work = Path(tempfile.mkdtemp(prefix="texdiet-time-"))
    try:
        orig_main = extract_fresh(orig_zip, work, "orig")
        fixed_main = extract_fresh(fixed_zip, work, "fixed")
        interleaved = []
        orig_runs = []
        fixed_runs = []
        for i in range(args.runs):
            o = compile_once(orig_main, work, False)
            print(f"orig  {i+1}/{args.runs}  {o['ms']:.0f} ms  exit={o['exit']}  pages={o['pages']}", flush=True)
            if o["exit"] != 0:
                print(o["log_tail"], file=sys.stderr)
                sys.exit(f"original compile {i+1} failed")
            orig_runs.append({k: v for k, v in o.items() if k != "log_tail"})
            f = compile_once(fixed_main, work, False)
            print(f"fixed {i+1}/{args.runs}  {f['ms']:.0f} ms  exit={f['exit']}  pages={f['pages']}", flush=True)
            if f["exit"] != 0:
                print(f["log_tail"], file=sys.stderr)
                sys.exit(f"fixed compile {i+1} (no shell-escape) failed")
            fixed_runs.append({k: v for k, v in f.items() if k != "log_tail"})
            interleaved.append(["orig", "fixed"])

        se_dir_main = extract_fresh(fixed_zip, work, "fixed-se")
        se_first = compile_once(se_dir_main, work, True)
        print(f"fixed-se first  {se_first['ms']:.0f} ms  exit={se_first['exit']}  pages={se_first['pages']}", flush=True)
        if se_first["exit"] != 0:
            print(se_first["log_tail"], file=sys.stderr)
            # first-pass externalize can fail; still record it
        se_warm = []
        if se_first["exit"] == 0:
            for i in range(args.se_warm):
                r = compile_once(se_dir_main, work, True)
                print(f"fixed-se warm {i+1}/{args.se_warm}  {r['ms']:.0f} ms  exit={r['exit']}  pages={r['pages']}", flush=True)
                if r["exit"] != 0:
                    print(r["log_tail"], file=sys.stderr)
                    sys.exit(f"fixed shell-escape compile {i+1} failed")
                se_warm.append({k: v for k, v in r.items() if k != "log_tail"})

        result = {
            "fixture": "proof-thesis",
            "description": "pdfLaTeX thesis with large NASA figures and un-externalized TikZ pictures. One pdflatex pass, no bibliography.",
            "engine": engine,
            "texbin": str(texbin),
            "flags": "-interaction=nonstopmode -halt-on-error -file-line-error",
            "machine": {
                "nproc": nproc,
                "loadavg_at_start": [float(x) for x in uptime],
            },
            "zips": {
                "orig_bytes": orig_zip.stat().st_size,
                "fixed_bytes": fixed_zip.stat().st_size,
                "orig": str(orig_zip),
                "fixed": str(fixed_zip),
            },
            "original_no_shell_escape": summarize(orig_runs),
            "fixed_no_shell_escape": summarize(fixed_runs),
            "fixed_shell_escape_first": {k: v for k, v in se_first.items() if k != "log_tail"} | {"ok": se_first["exit"] == 0, "log_tail": se_first["log_tail"] if se_first["exit"] != 0 else ""},
            "fixed_shell_escape_warm": summarize(se_warm, has_cold=False) if se_warm else None,
            "protocol": "sides alternated (orig, fixed) with no shell-escape in one persistent tree per side; run 1 is cold, runs 2-N are warm recompiles. separately, a fresh extract of the fixed zip was compiled with -shell-escape once (to fill tikz-cache) then again N times.",
        }
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text(json.dumps(result, indent=2) + "\n")
        print("wrote", out, flush=True)
    finally:
        shutil.rmtree(work, ignore_errors=True)


if __name__ == "__main__":
    main()
