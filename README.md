# VibeXStudio 🪄 — now featuring Media Lab

**One open-source studio for building apps and making media, on every device
you own — with nothing to sign up for.**

Describe an app in chat and watch it become real. Make images, video, and
music in Media Lab. Use the AI you already pay for — an API key, or a
subscription sign-in (xAI/Grok, MiniMax, Kimi today; more coming). Your
projects sync between your devices through **your** iCloud or **your**
Google Drive. Publish to **your** GitHub. Free, Apache-2.0, no servers, no
accounts, no telemetry.

<p align="center">
  <img src="app/docs/screenshots/iphone-dark.png" width="220" alt="VibeXStudio on iPhone — NOIR dark">
  &nbsp;
  <img src="media-lab/docs/screenshots/media-lab-desktop.png" width="500" alt="Media Lab — a real studio full of generated films">
</p>
<p align="center">
  <img src="app/docs/screenshots/desktop-dark.png" width="360" alt="VibeXStudio Desktop — dark">
  &nbsp;
  <img src="app/docs/screenshots/desktop-light.png" width="360" alt="VibeXStudio Desktop — light">
</p>

## Get it

| Platform | How |
|---|---|
| **macOS** (Apple Silicon) | [Notarized .dmg](https://github.com/kerpopule/vibexstudio/releases/latest) |
| **Windows** x64 | [Installer](https://github.com/kerpopule/vibexstudio/releases/latest) *(unsigned for now — SmartScreen asks once)* |
| **Linux** x64 / arm64 | [.deb / .AppImage](https://github.com/kerpopule/vibexstudio/releases/latest) |
| **iPhone / iPad · Android** | App Store & Google Play releases in progress — or build from source below |

## One repo, three parts

| Directory | What it is |
|---|---|
| [`app/`](app/) | The VibeXStudio app — Expo/React Native for iOS, Android, and the web build the desktop wraps. Chat-to-app builder, background builds, device sync, Media Lab tab. |
| [`desktop/`](desktop/) | Tauri shell for macOS/Windows/Linux. Hosts the app and can run Media Lab as a local sidecar. |
| [`media-lab/`](media-lab/) | The Media Lab server — films, songs, images, characters, and Sparky the director. Run it on your own GPU box, or cloud-only with your fal.ai key. |

```mermaid
flowchart LR
    subgraph one app everywhere
      A[📱 app/ — iOS · Android] ---|your iCloud /\nyour Drive folder| A2[📱 your other devices]
      D[🖥️ desktop/ — macOS · Windows · Linux]
    end
    D -->|sidecar| M[🎬 media-lab/\nlocal engines · your fal.ai key]
    A -->|pairs over LAN/tailnet| M
    A -->|publish| G[(your GitHub + Pages)]
    A -->|chat + media| P[(your AI: API keys or\nGrok/MiniMax/Kimi subscriptions)]
```

## The one-stop-shop idea

- **Build**: chat → files → live preview → publish to your GitHub Pages.
- **Make media, three ways** — the Media Lab tab uses whichever you have:
  1. **On device**: generate images and video straight through your
     connected providers (OpenAI images, Grok/xAI, Gemini/Veo) into a local
     gallery — no server needed.
  2. **Your fal.ai key**: cloud rendering through Media Lab's provider
     settings.
  3. **Your own hardware**: pair a Media Lab server (the desktop app can
     host one) and get the full studio — LTX drafts, cinematic H3,
     music, characters, Sparky.
- **Bring the AI you already pay for**: API keys for OpenRouter, Anthropic,
  OpenAI, Gemini, xAI, GLM, custom endpoints — or subscription sign-in
  (device-code OAuth) for xAI/Grok, MiniMax, and Kimi.
- **Sync is yours**: Apple devices sync whole projects via your iCloud;
  Android mirrors to a folder you pick in Google Drive.
  ([How sync works](app/docs/SYNC.md))

## Build from source

```sh
cd app && npm install
npm run ios | android | web            # the app
cd ../desktop && npm install && npx tauri build   # the desktop shell
cd ../media-lab && pip install fastapi uvicorn pydantic python-multipart
uvicorn app:app --port 7863            # the studio server
```

Contributor guides live inside each part: [`app/CLAUDE.md`](app/CLAUDE.md)
(architecture invariants), [`app/docs/SYNC.md`](app/docs/SYNC.md),
[`media-lab/AGENTS.md`](media-lab/AGENTS.md) (agent-guided setup), and
[`media-lab/docs/`](media-lab/docs/).

## Privacy, in one paragraph

Projects, chats, galleries, and keys live on your devices (keys in the OS
keychain; sync — if you enable it — rides your own iCloud/Drive). The apps
talk only to the AI providers you configured, your GitHub, and any Media
Lab you paired. There is nothing else to talk to: VibeXStudio has no
backend. The Media Lab server you run yourself stores its jobs and
galleries on that machine, and never bundles model weights — engines are
installed and licensed by you (the MiniMax H3 model in particular is
private-use licensed and never ships here).

## License & credits

Apache-2.0 across the repo. We credit everything we build on, required or
not — [`app/CREDITS.md`](app/CREDITS.md) ·
[`desktop/CREDITS.md`](desktop/CREDITS.md) ·
[`media-lab/CREDITS.md`](media-lab/CREDITS.md). If your work appears
uncredited, open an issue.
