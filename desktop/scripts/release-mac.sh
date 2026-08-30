#!/bin/sh
# Signed + notarized macOS release build. Run on the fleet Mac that holds
# the Developer ID cert and the ASC API key. CI builds every other platform
# (its mac artifact is unsigned and not used for releases).
set -e
cd "$(dirname "$0")/.."
set -a; . ~/.mealreels-secrets/asc/config; set +a
export APPLE_SIGNING_IDENTITY="Developer ID Application: Stephen Darlow (2D4KQ5RBVQ)"
export APPLE_API_KEY="$KEY_ID" APPLE_API_ISSUER="$ISSUER_ID"
export APPLE_API_KEY_PATH="$HOME/.appstoreconnect/private_keys/AuthKey_${KEY_ID}.p8"
npx tauri build
DMG=src-tauri/target/release/bundle/dmg/VibeXStudio_*_aarch64.dmg
# Tauri notarizes the .app; the DMG needs its own submission.
xcrun notarytool submit $DMG --key "$APPLE_API_KEY_PATH" --key-id "$KEY_ID" --issuer "$ISSUER_ID" --wait
# Stapling may fail on a Mac with a wedged Gatekeeper DB; notarization holds either way.
xcrun stapler staple $DMG || echo "staple failed (known local Gatekeeper issue) — DMG is still notarized"
echo "Release DMG: $DMG"
