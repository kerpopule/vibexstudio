#!/usr/bin/env python3
"""Repo guard: no private machine identity may be committed.

Media Lab used to be published through a rewrite step (a sanitizer that swapped
one team's usernames, tailnet addresses and hostnames for placeholders on the
way out). That step is gone: everything per-host now comes from
config/local.env (see config/local.env.example and media_lab_core/local_config.py),
so the tracked tree must simply never contain such strings. This script is the
verification half of the old sanitizer turned into a CI gate. Python bytecode
artifacts are refused outright: a CPython .pyc header embeds the absolute source
path, so a committed .pyc leaks the builder's machine identity without ever
being read.

Usage:
    python3 media-lab/tools/identity_guard.py            # scan tracked files
    python3 media-lab/tools/identity_guard.py PATH...     # scan given paths

Scope: tracked files plus untracked files git would not ignore
(`git ls-files --cached --others --exclude-standard`). Scanning untracked
files is deliberate pre-add safety -- a brand-new file is checked before it is
ever staged -- so do not drop `--others` to make local runs green. Local run
scratch (`.artifacts/`, `.worktrees/`) is instead excluded by the repo-root
`.gitignore`; anything that must not be committed gets an ignore rule there,
never an exemption in this script.

Exit 0 when clean, 1 with a listing of file:line hits otherwise. Patterns live
in PRIVATE_PATTERNS; add a line there when a new private identifier appears.
The list is intentionally explicit so a false positive is a one-line fix.
"""
from __future__ import annotations

import pathlib
import re
import subprocess
import sys

# Case-insensitive regexes. Keep the longest / most specific first for clearer
# reports; all of them are checked on every line.
PRIVATE_PATTERNS = [
    # a personal Unix account name / home directory
    r"autoedu_spark1",
    r"/home/medialab\b",
    r"\bmedialab@",
    # tailnet addresses and MagicDNS names
    r"\b100\.66\.238\.97\b",
    r"tail33c662",
    r"steves-macbook-pro",
    r"spark-d16e",
    r"spark-8fb9",
    # operator machines, homes and public hostnames
    r"/Users/vibex\b",
    r"hermes-team",
    r"media\.autoedu\.ai",
    r"media\.source4ai\.com",
    r"[a-z0-9-]+\.tail[0-9a-f]{5,6}\.ts\.net",
    # leftovers of the retired rewrite step
    r"YOUR_TAILNET_IP",
    r"your-tailnet\.ts\.net",
    r"your-server\.your-tailnet",
    r"your-machine\.your-tailnet",
]

BINARY_EXT = {
    ".png", ".jpg", ".jpeg", ".gif", ".webp", ".ico", ".mp3", ".mp4", ".wav",
    ".woff", ".woff2", ".ttf", ".otf", ".onnx", ".whl", ".zip", ".gz", ".pdf",
    ".icns", ".pyc", ".p8", ".pem", ".dmg", ".deb", ".glb", ".safetensors",
    ".jsonl", ".bin", ".pt", ".pth",
}

# Python bytecode is never allowed in the tree, whatever it contains: the .pyc
# header carries the absolute source path it was compiled from. Checked before
# the BINARY_EXT skip so it is a violation, not an ignored blob.
BYTECODE_EXT = {".pyc", ".pyo", ".pyd"}

# Shared bytecode-hit text. `scan()` still returns a flat `list[str]`, so the
# epilogue in `main()` tells the two hit classes apart by this marker instead of
# widening the public return type.
BYTECODE_HIT = "Python bytecode must not be committed"

# Files that legitimately mention the patterns: this guard and its docs.
ALLOW_FILES = {
    "media-lab/tools/identity_guard.py",
    "tools/identity_guard.py",
}

_RE = re.compile("|".join(f"(?:{p})" for p in PRIVATE_PATTERNS), re.IGNORECASE)


def repo_root() -> pathlib.Path:
    try:
        out = subprocess.run(["git", "rev-parse", "--show-toplevel"], capture_output=True,
                             text=True, check=True).stdout.strip()
        return pathlib.Path(out)
    except (subprocess.CalledProcessError, FileNotFoundError):
        return pathlib.Path.cwd()


def tracked_files(root: pathlib.Path) -> list[pathlib.Path]:
    """Tracked files plus untracked files git would not ignore (a new file is
    checked before it is ever added)."""
    out = subprocess.run(["git", "-C", str(root), "ls-files", "-z", "--cached", "--others",
                          "--exclude-standard"], capture_output=True, check=True).stdout
    files = []
    for raw in out.split(b"\0"):
        if raw:
            p = root / raw.decode()
            if p.is_file():
                files.append(p)
    return files


def iter_paths(args: list[str], root: pathlib.Path) -> list[pathlib.Path]:
    if not args:
        return tracked_files(root)
    files: list[pathlib.Path] = []
    for arg in args:
        p = pathlib.Path(arg)
        if p.is_dir():
            files.extend(q for q in p.rglob("*") if q.is_file() and ".git" not in q.parts)
        elif p.is_file():
            files.append(p)
    return files


def scan(files: list[pathlib.Path], root: pathlib.Path) -> list[str]:
    hits: list[str] = []
    for p in files:
        try:
            rel = str(p.resolve().relative_to(root.resolve()))
        except ValueError:
            rel = str(p)
        if rel in ALLOW_FILES:
            continue
        if p.suffix.lower() in BYTECODE_EXT or "__pycache__" in pathlib.PurePath(rel).parts:
            hits.append(f"{rel}: {BYTECODE_HIT} (it can embed absolute local paths)")
            continue
        if p.suffix.lower() in BINARY_EXT:
            continue
        try:
            data = p.read_bytes()
        except OSError:
            continue
        if b"\0" in data[:8192]:
            continue
        text = data.decode("utf-8", "replace")
        for n, line in enumerate(text.splitlines(), 1):
            m = _RE.search(line)
            if m:
                hits.append(f"{rel}:{n}: {m.group(0)}")
    return hits


def main(argv: list[str]) -> int:
    root = repo_root()
    files = iter_paths(argv, root)
    hits = scan(files, root)
    if hits:
        print("identity_guard: private machine identity found in the tree:", file=sys.stderr)
        for h in hits:
            print(f"  {h}", file=sys.stderr)
        if any(BYTECODE_HIT not in h for h in hits):
            print("\nMove the value into config/local.env (see config/local.env.example) and read it "
                  "through media_lab_core/local_config.py.", file=sys.stderr)
        if any(BYTECODE_HIT in h for h in hits):
            print("\nRemove the bytecode artifact from the repository (add it to .gitignore "
                  "instead of committing it).", file=sys.stderr)
        return 1
    print(f"identity_guard: {len(files)} files clean")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
