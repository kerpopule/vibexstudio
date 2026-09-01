#!/bin/sh
# Manual Media Lab sidecar setup for VibeX Studio Desktop — the advanced /
# dev-checkout path. End users don't need this: the app's first-launch
# "Make media on this computer?" does the same thing from the bundled copy.
#
# Creates a Python env for the Media Lab server, seeds its data directory,
# and writes the config the desktop shell reads at launch. Re-run safely.
#
# Usage: ./setup-medialab.sh [path-to-media-lab-repo]
set -e

MEDIALAB_DIR="${1:-$HOME/Projects/media-lab-studio}"
DATA_DIR="$HOME/media-lab-simple"
VENV="$HOME/Library/Application Support/studio.vibex.desktop/medialab-venv"
CFG_DIR="$HOME/Library/Application Support/studio.vibex.desktop"
PORT=7863

[ -f "$MEDIALAB_DIR/app.py" ] || { echo "No Media Lab at $MEDIALAB_DIR"; exit 1; }
command -v uv >/dev/null || { echo "Install uv first: brew install uv"; exit 1; }

echo "→ Python env"
uv venv "$VENV" -q
uv pip install -p "$VENV/bin/python" -q fastapi uvicorn pydantic python-multipart

echo "→ Data directory ($DATA_DIR)"
mkdir -p "$DATA_DIR"
# The server expects the deployed-tree layout under its data dir: static/
# (the UI it serves), prompt-templates/ and config/ are read at import.
for d in static prompt-templates config; do
  [ -e "$DATA_DIR/$d" ] || ln -s "$MEDIALAB_DIR/$d" "$DATA_DIR/$d"
done

echo "→ Shell config"
mkdir -p "$CFG_DIR"
cat > "$CFG_DIR/medialab.json" <<EOF
{
  "enabled": true,
  "dir": "$MEDIALAB_DIR",
  "python": "$VENV/bin/python",
  "port": $PORT
}
EOF

echo "Done. Launch VibeX Studio — Media Lab starts with it on http://127.0.0.1:$PORT"
echo "Pair inside the app: Settings → Media Lab → http://127.0.0.1:$PORT"
echo "Cloud rendering: open Media Lab → theme sheet → Cloud providers → paste your fal.ai key."
