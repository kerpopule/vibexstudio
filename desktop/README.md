# VibeX Studio Desktop

A Tauri shell around the [VibeXStudio](https://github.com/kerpopule/vibexstudio)
web build — the free, open-source studio on macOS, Windows, and Linux, and
the place [Media Lab](https://github.com/kerpopule/media-lab-studio) plugs in.

<p align="center">
  <img src="docs/screenshots/desktop-dark.png" width="420" alt="VibeX Studio Desktop — NOIR dark">
  &nbsp;
  <img src="docs/screenshots/desktop-light.png" width="420" alt="VibeX Studio Desktop — NOIR light">
</p>

## Download

Grab the [latest release](https://github.com/kerpopule/vibexstudio-desktop/releases/latest):

| OS | File | Notes |
|---|---|---|
| macOS (Apple Silicon) | `VibeXStudio_*_aarch64.dmg` | Signed + notarized |
| Windows x64 | `VibeXStudio_*_x64-setup.exe` / `.msi` | Unsigned for now — SmartScreen asks once |
| Linux x64 | `VibeXStudio_*_amd64.deb` / `.AppImage` | |
| Linux arm64 | `VibeXStudio_*_arm64.deb` / `aarch64.AppImage` | Tested on an NVIDIA DGX Spark |

No accounts, no telemetry: projects live on your machine, AI keys are yours,
and device sync rides your own iCloud/Drive — see the app repo's
[docs/SYNC.md](https://github.com/kerpopule/vibexstudio/blob/main/docs/SYNC.md).

## How it fits together

- `dist/` — the exported VibeXStudio web app (`npx expo export --platform web
  --output-dir dist-web` in `../vibex-studio`, copied here). Projects, chat,
  and generated files persist in IndexedDB (`src/lib/storage/projects.web.ts`
  in the app repo).
- `src-tauri/` — the native shell. Milestone 1 is a plain window; the
  roadmap below adds the Media Lab sidecar.
- Media Lab pairing already works from inside the app: Settings → Media Lab →
  paste a server URL (desktop sidecar or a Spark). The Media Lab tab appears
  once paired.

## Build

```sh
npm install
npx tauri build        # .app + .dmg in src-tauri/target/release/bundle
npx tauri dev          # against `npx expo start --web` in ../vibex-studio
```

Refresh the frontend after app changes:

```sh
cd ../vibex-studio && npx expo export --platform web --output-dir dist-web
rm -rf dist && cp -R ../vibex-studio/dist-web dist
```

## Roadmap

1. **Media Lab sidecar** — bundle the Media Lab FastAPI server with its own
   Python (PyInstaller or uv-managed env) as a Tauri sidecar on localhost;
   an "Enable Media Lab" toggle starts it and shows the pairing QR for
   phones. Local engines optional; cloud-only (fal.ai) works on any Mac.
2. **Native file storage** — swap IndexedDB for Tauri fs behind the same
   storage interface, so projects live as real folders.
3. **Pairing QR** — desktop shows `vibex://pair?...`; the phone camera does
   the rest.
4. **Auto-update** — Tauri updater once releases are signed.

## License

Apache-2.0 (see LICENSE). The Media Lab open-source build must never bundle
the H3 engine — its license covers private single-machine use only.

## Credits

Built on [Tauri 2](https://tauri.app) (shell), the VibeXStudio Expo web
build (frontend), and Media Lab's FastAPI server (sidecar). See CREDITS.md
in those repos — we credit what we build on, required or not.
