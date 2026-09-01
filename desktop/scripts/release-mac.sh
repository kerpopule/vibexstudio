#!/bin/sh
# Signed + notarized macOS release build, uploaded to the public release.
#
#   scripts/release-mac.sh v1.2.0        # tag = $1 (default: v<tauri.conf.json version>)
#
# Run on the fleet Mac that holds the Developer ID cert, the ASC API key and
# ~/.vibex-secrets/tauri-updater.key. CI (tauri-action on kerpopule/vibexstudio)
# builds Windows + Linux for the same tag and writes latest.json; this script
# adds the darwin-aarch64 entry so mac users auto-update too. CI's own mac
# artifact is unsigned and never uploaded to the release.
set -e
cd "$(dirname "$0")/.."

TAG="${1:-v$(node -p 'require("./src-tauri/tauri.conf.json").version')}"
REPO="${REPO:-kerpopule/vibexstudio}"
UPDATER_KEY="${TAURI_SIGNING_PRIVATE_KEY_PATH:-$HOME/.vibex-secrets/tauri-updater.key}"

# Apple signing + notarization (as before).
set -a; . ~/.mealreels-secrets/asc/config; set +a
export APPLE_SIGNING_IDENTITY="Developer ID Application: Stephen Darlow (2D4KQ5RBVQ)"
export APPLE_API_KEY="$KEY_ID" APPLE_API_ISSUER="$ISSUER_ID"
export APPLE_API_KEY_PATH="$HOME/.appstoreconnect/private_keys/AuthKey_${KEY_ID}.p8"

# Updater signing: with the private key in the env, `tauri build` also emits
# bundle/macos/VibeXStudio.app.tar.gz + .sig (bundle.createUpdaterArtifacts).
[ -r "$UPDATER_KEY" ] || { echo "missing updater key: $UPDATER_KEY (see ~/.vibex-secrets/README.md)" >&2; exit 1; }
TAURI_SIGNING_PRIVATE_KEY="$(cat "$UPDATER_KEY")"; export TAURI_SIGNING_PRIVATE_KEY
export TAURI_SIGNING_PRIVATE_KEY_PASSWORD="${TAURI_SIGNING_PRIVATE_KEY_PASSWORD:-}"

CONF_VERSION="$(node -p 'require("./src-tauri/tauri.conf.json").version')"
[ "v$CONF_VERSION" = "$TAG" ] || echo "warning: tag $TAG != tauri.conf.json version $CONF_VERSION" >&2

npx tauri build

DMG=$(ls src-tauri/target/release/bundle/dmg/VibeXStudio_*_aarch64.dmg)
TARBALL=src-tauri/target/release/bundle/macos/VibeXStudio.app.tar.gz
SIG="$TARBALL.sig"
[ -f "$TARBALL" ] && [ -f "$SIG" ] || { echo "updater artifacts missing ($TARBALL / .sig) — was TAURI_SIGNING_PRIVATE_KEY picked up?" >&2; exit 1; }

# Tauri notarizes the .app; the DMG needs its own submission.
xcrun notarytool submit "$DMG" --key "$APPLE_API_KEY_PATH" --key-id "$KEY_ID" --issuer "$ISSUER_ID" --wait
# Stapling may fail on a Mac with a wedged Gatekeeper DB; notarization holds either way.
xcrun stapler staple "$DMG" || echo "staple failed (known local Gatekeeper issue) — DMG is still notarized"

# Publish: the release normally already exists (CI creates it on the tag);
# make one if the mac build got here first.
gh release view "$TAG" --repo "$REPO" >/dev/null 2>&1 \
  || gh release create "$TAG" --repo "$REPO" --title "VibeXStudio $TAG" --generate-notes
gh release upload "$TAG" --repo "$REPO" --clobber "$DMG" "$TARBALL" "$SIG"

# Add the mac entry to the updater manifest CI wrote (or create it).
node scripts/merge-latest-json.mjs "$TAG" --repo "$REPO" --tarball "$TARBALL" --sig "$SIG" --platform darwin-aarch64

echo "Release DMG: $DMG"
echo "Updater:     $TARBALL (+ .sig) → https://github.com/$REPO/releases/tag/$TAG"
