#!/bin/sh
# Manual Workbench sidecar setup for VibeX Studio Desktop — the advanced /
# dev-checkout path. The app mints this file itself when Media Lab is set
# up and Node is present; Media Lab → Rotate Workbench token rotates it.
#
# Checks for Node >= 18, creates the projects root, mints the pairing token,
# and writes the config the desktop shell (and workbench/server.mjs) reads
# at launch. Re-run safely — an existing token is kept unless you pass
# --new-token.
#
# Usage: ./setup-workbench.sh [projects-root] [--new-token]
set -e

PROJECTS_ROOT="$HOME/VibeXStudio-Projects"
NEW_TOKEN=0
for arg in "$@"; do
  case "$arg" in
    --new-token) NEW_TOKEN=1 ;;
    *) PROJECTS_ROOT="$arg" ;;
  esac
done

CFG_DIR="$HOME/Library/Application Support/studio.vibex.desktop"
CFG="$CFG_DIR/workbench.json"
PORT=8794

command -v node >/dev/null || { echo "Node.js is required — install it from https://nodejs.org (v18+)"; exit 1; }
NODE_MAJOR=$(node --version | sed 's/^v//' | cut -d. -f1)
[ "$NODE_MAJOR" -ge 18 ] || { echo "Node $(node --version) is too old — install v18+ from https://nodejs.org"; exit 1; }

echo "→ Projects root ($PROJECTS_ROOT)"
mkdir -p "$PROJECTS_ROOT"

# Keep an existing token across re-runs so paired phones stay paired.
TOKEN=""
if [ "$NEW_TOKEN" -eq 0 ] && [ -f "$CFG" ]; then
  TOKEN=$(node -e "try{const c=require('$CFG');if(c.token)process.stdout.write(c.token)}catch(e){}")
fi
if [ -z "$TOKEN" ]; then
  echo "→ Minting pairing token"
  TOKEN=$(openssl rand -hex 16)
fi

echo "→ Shell config"
mkdir -p "$CFG_DIR"
cat > "$CFG" <<EOF
{
  "enabled": true,
  "port": $PORT,
  "token": "$TOKEN",
  "projectsRoot": "$PROJECTS_ROOT"
}
EOF
chmod 600 "$CFG"

echo "Done. Launch VibeX Studio — the Workbench starts with it on port $PORT."
echo "Pair your phone: the app's Pair QR now carries the Workbench URL + token."
echo "Standalone run: node workbench/server.mjs   (reads $CFG)"
echo "Rotate the token any time: ./setup-workbench.sh --new-token"
