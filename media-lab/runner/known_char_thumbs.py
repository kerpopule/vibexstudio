#!/usr/bin/env python3
"""One-time harvest: a face thumbnail for every H3 known character.

The malcolmrey dataset ships per-character TEST CLIPS (mp4), not stills. This
downloads each characters first clip, grabs a frame at 40%, and saves a 256px
jpg to media/known-thumbs/<id>.jpg (id = the known:<hash> in the catalog,
sans prefix). Resumable: existing thumbs are skipped, clips are deleted after
the frame is taken.
"""
import json, re, subprocess, sys, time, urllib.request, urllib.parse, pathlib

ROOT = pathlib.Path.home() / "media-lab-simple"
CFG = ROOT / "config/h3-known-characters.json"
OUT = ROOT / "media/known-thumbs"
OUT.mkdir(parents=True, exist_ok=True)
BASE = "https://huggingface.co/datasets/malcolmrey/various/resolve/main/h3-center/known-characters/"
RAW = "https://huggingface.co/datasets/malcolmrey/various/raw/main/h3-center/known-characters/INDEX.md"

cfg = json.load(open(CFG))
chars = cfg["characters"]
byname = {}
for c in chars:
    byname.setdefault(c["name"].strip().lower(), c)

md = urllib.request.urlopen(RAW, timeout=60).read().decode()
rows = re.findall(r"^\| \*\*(.+?)\*\* \|.*?\[`(.+?)`\]\((.+?)\)", md, re.M)
print(f"{len(rows)} index rows, {len(chars)} catalog chars", flush=True)

done = fail = 0
for name, clip, rel in rows:
    c = byname.get(name.strip().lower())
    if not c:
        continue
    cid = c["id"].split(":", 1)[-1]
    thumb = OUT / f"{cid}.jpg"
    if thumb.exists():
        continue
    url = BASE + urllib.parse.quote(rel)
    tmp = OUT / f"_{cid}.mp4"
    try:
        with urllib.request.urlopen(url, timeout=120) as r, open(tmp, "wb") as f:
            while True:
                b = r.read(1 << 20)
                if not b:
                    break
                f.write(b)
        subprocess.run(["ffmpeg", "-nostdin", "-v", "error", "-y",
                        "-ss", "2", "-i", str(tmp),
                        "-frames:v", "1", "-vf", "scale=256:-2", str(thumb)],
                       check=True, timeout=60)
        done += 1
        if done % 25 == 0:
            print(f"{done} thumbs", flush=True)
    except Exception as e:
        fail += 1
        print(f"skip {name}: {e}", flush=True)
        thumb.unlink(missing_ok=True)
    finally:
        tmp.unlink(missing_ok=True)
    time.sleep(0.3)
print(f"done: {done} new thumbs, {fail} failed", flush=True)
