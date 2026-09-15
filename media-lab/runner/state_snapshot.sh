#!/bin/bash
# Hourly snapshot of the small state files that hold irreplaceable user data.
# Exists because characters.json was silently clobbered to a 2-entry stub some
# time before 2026-08-23 and only an ad-hoc backup saved the cast.
set -u
ROOT="$HOME/media-lab-simple"
DEST="$ROOT/backups"
STAMP=$(date +%Y%m%d-%H)
for f in characters.json voices.json gallery.json boards.json; do
  [ -s "$ROOT/$f" ] || continue
  # skip if unchanged since the newest snapshot of this file
  last=$(ls -t "$DEST/$f".* 2>/dev/null | head -1)
  if [ -n "$last" ] && cmp -s "$ROOT/$f" "$last"; then continue; fi
  cp "$ROOT/$f" "$DEST/$f.$STAMP"
done
# keep 7 days
find "$DEST" -name "*.json.*" -mtime +7 -delete
