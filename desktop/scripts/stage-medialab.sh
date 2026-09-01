#!/bin/sh
# Stage the Media Lab server source into src-tauri/resources/media-lab/ so
# `tauri build` bundles it (tauri.conf.json → bundle.resources). Run before
# every build; the staged copy is gitignored.
#
# Source detection (first hit wins):
#   $MEDIALAB_SRC                       explicit override
#   ../media-lab-studio                 sibling checkout (github.com/kerpopule/media-lab-studio)
#   ../media-lab                        public monorepo layout (vibexstudio/media-lab)
#   ../../media-lab-studio, ../../media-lab   when this repo is a git worktree
#   ~/Projects/media-lab-studio         the dev machine
#
# Excluded: .git, .worktrees, __pycache__/*.pyc, docs/, the template-library
# .jpg previews (145 MB — the phone renders them from the server anyway),
# local secrets (.env*, providers.json, vapid_private.pem) and runner/wheels
# (Linux-arm64 wheels for the HunyuanAvatar engine, 51 MB, useless on a
# desktop build). Everything else — app.py, runner/, media_lab_core/,
# config/, prompt-templates/, static/ — ships as-is.
set -e

ROOT=$(cd "$(dirname "$0")/.." && pwd)
DEST="$ROOT/src-tauri/resources/media-lab"

SRC=""
for candidate in \
  "${MEDIALAB_SRC:-}" \
  "$ROOT/../media-lab-studio" \
  "$ROOT/../media-lab" \
  "$ROOT/../../media-lab-studio" \
  "$ROOT/../../media-lab" \
  "$HOME/Projects/media-lab-studio"
do
  [ -n "$candidate" ] && [ -f "$candidate/app.py" ] && { SRC=$(cd "$candidate" && pwd); break; }
done
[ -n "$SRC" ] || {
  echo "stage-medialab: no Media Lab checkout found (looked for app.py in ../media-lab-studio, ../media-lab, ~/Projects/media-lab-studio)." >&2
  echo "  git clone https://github.com/kerpopule/media-lab-studio ../media-lab-studio   or set MEDIALAB_SRC=/path" >&2
  exit 1
}

echo "→ staging Media Lab from $SRC"
rm -rf "$DEST"
mkdir -p "$DEST"

if command -v rsync >/dev/null 2>&1; then
  rsync -a \
    --exclude '.git' --exclude '.worktrees' --exclude '__pycache__' --exclude '*.pyc' \
    --exclude '/docs' --exclude '/static/template-library/**/*.jpg' --exclude '/static/template-library/*.jpg' \
    --exclude '.env' --exclude '.env.*' --exclude 'providers.json' --exclude 'vapid_private.pem' \
    --exclude '/runner/wheels' --exclude '.DS_Store' \
    "$SRC/" "$DEST/"
else
  # No rsync (Windows CI): tar in, tar out. bsdtar and GNU tar both take
  # these exclude patterns against the "./path" names tar emits.
  ( cd "$SRC" && tar -cf - \
      --exclude './.git' --exclude './.worktrees' --exclude '__pycache__' --exclude '*.pyc' \
      --exclude './docs' --exclude './static/template-library/*.jpg' --exclude './static/template-library/*/*.jpg' \
      --exclude '.env' --exclude '.env.*' --exclude 'providers.json' --exclude 'vapid_private.pem' \
      --exclude './runner/wheels' --exclude '.DS_Store' \
      . ) | ( cd "$DEST" && tar -xf - )
fi

# Provenance for the bundle: which commit shipped.
{
  echo "source: $SRC"
  echo "commit: $(git -C "$SRC" rev-parse HEAD 2>/dev/null || echo unknown)"
  echo "staged: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
} > "$DEST/STAGED.txt"

# Belt and braces: never ship a secret or a preview even if a pattern missed.
find "$DEST" \( -name '.env' -o -name '.env.*' -o -name 'providers.json' -o -name 'vapid_private.pem' \) -delete 2>/dev/null || true
find "$DEST/static/template-library" -name '*.jpg' -delete 2>/dev/null || true

[ -f "$DEST/app.py" ] || { echo "stage-medialab: app.py missing after staging" >&2; exit 1; }
echo "→ staged $(find "$DEST" -type f | wc -l | tr -d ' ') files, $(du -sh "$DEST" | cut -f1) → $DEST"
