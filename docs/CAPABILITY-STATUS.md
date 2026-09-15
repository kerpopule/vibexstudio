# Capability status

What in this repository is qualified, what is experimental, and what only
works on the maintainers' own hardware. Read this before choosing a
deployment or installing a model. "Qualified" means the maintainers run it in
production from `main`; "experimental" means the code ships but has not
completed runtime qualification on a clean install.

Last reviewed: 2026-09-15 against `main`.

## Platforms

| Platform | Status | Notes |
|---|---|---|
| iOS / iPadOS (`app/`) | Builds from source; App Store listing in progress | TestFlight builds are the tested path. `NSAllowsArbitraryLoads` is on so plain-HTTP LAN/tailnet Media Lab hosts work. |
| Android (`app/`) | Builds from source; Play listing in progress | `usesCleartextTraffic` is on for the same reason. |
| macOS Apple silicon (`desktop/`) | Qualified | Signed + notarized DMG from `desktop/scripts/release-mac.sh`; auto-updater on. |
| Windows x64 (`desktop/`) | Built and published by CI; unsigned | SmartScreen prompts once. Cannot host a local Media Lab; connect to one you run elsewhere. |
| Linux x64 / arm64 (`desktop/`) | Built and published by CI | `.deb`, `.AppImage`, `.rpm`. Local Media Lab install is offered on arm64 only. |
| Web build | Experimental | The desktop wraps it. In a plain browser, Agent Connect and the in-app Media Lab WebView are unavailable; the Media Lab host must list the browser origin in `MEDIA_LAB_BROWSER_ORIGINS`. |

## Connecting an AI

| Route | Status |
|---|---|
| API keys: OpenRouter, Anthropic, OpenAI, Gemini, xAI, Z.ai | Qualified |
| Subscriptions: ChatGPT, Grok/X Premium, MiniMax, Kimi (OAuth/device code) | Qualified on native; vendor flows change without notice |
| Local or custom OpenAI-compatible endpoint (Ollama, LM Studio, vLLM, a Spark on your tailnet) | Qualified |
| Provider priority / fallback | Not implemented: the chat provider is chosen per project; the first connection is the default and there is no automatic fallback |

## Media Lab engines (`media-lab/`)

| Engine | Status | Notes |
|---|---|---|
| fal.ai cloud (FLUX, Recraft, MiniMax H3 Max, Veo 3, Kling) | Qualified | The only cloud provider. Any machine, no GPU. |
| Image (ComfyUI sidecar) | Qualified on DGX Spark | Needs the operator's engine recipes in `config/engine-installs.json`. |
| LTX-2 video (drafts) | Qualified on DGX Spark | Private Maestro runtime; the shipped `engine-installs.json` marks it blocked until an independent installer exists. |
| Sol-H3 (MiniMax H3) video | Qualified on DGX Spark (single box, ~117 GiB resident) | 5-second clips at 1344x768, chained for storyboards. Cannot share the GPU with a local text model. |
| YuE2 music (default) | Qualified on DGX Spark | Weights are CC BY-NC 4.0: non-commercial use only. Score-level edit tools; stems via Mel-Band RoFormer. |
| MiniMax Music 3 (ComfyUI) | Qualified on DGX Spark | Alternative music engine. |
| Voicebox / Chatterbox speech | Experimental | |
| TripoSR image-to-3D | Experimental | |
| Cut (the editor) | Qualified | Frame-addressed multi-track timeline, ffmpeg export with render receipts. Reachable at `/cut` on any Media Lab host. |

A fresh `install.sh` on a plain Linux GPU box gives a running server with the
cloud path and Cut; the local video engines need a Maestro runtime the
maintainers have not yet packaged for independent install.

## Agents

| Feature | Status |
|---|---|
| Sparky (director chat) | Qualified with a Media Lab host that has a text model; otherwise runs on one of your own chat connections |
| Agent Connect (invite Hermes, Claude Code, Codex, OpenCode or any MCP client to drive the app) | Qualified on iOS/Android/desktop; unavailable in a plain browser |
| Hermes inside Media Lab | Not a feature: Media Lab has no Hermes/Telegram integration; agents reach it through the app's Agent Connect |

## Known gaps (tracked)

- No user-controlled default/fallback ordering across AI or media providers.
- Discovery of a Media Lab host is Tailscale-only and desktop-only; phones pair by QR or typed address.
- `desktop/dist/` is a committed web export and can lag `app/src`; CI re-exports on release, a local `tauri build` does not.
