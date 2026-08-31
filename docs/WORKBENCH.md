# The Workbench — your computer as the engine, your phone as the remote

The owner's framing, which this design serves verbatim: *"turn this from
just do-what-you-can within mobile infrastructure into: if the computer app
is installed and connected, the mobile one works remotely using the
computer to do everything — the mobile app is just how the user interacts
with it."*

Nothing is hosted by us — this is open source. The user's own computer is
the host, opt-in, discovered by the same QR pairing the Media Lab sidecar
already uses.

## What the phone can't do alone (and the Workbench can)

| Capability | Phone-only today | With a paired Workbench |
|---|---|---|
| Web context for the model | ✅ fence-based search/fetch (AGENT-WEB.md) | Same, plus headless browsing for JS-heavy pages |
| Dependencies | ❌ static files only | `npm install` — real packages, real lockfiles |
| Build steps | ❌ | Vite/Next/Expo builds, TypeScript, bundlers |
| Dev servers | ❌ preview is static | Real `npm run dev` with HMR, previewed in the phone's WebView over LAN/tailnet |
| Project storage | App sandbox (+iCloud/Drive sync) | Any folder the user picks — their repos, their disk |
| Always-on agents | Builds pause when iOS suspends | Long-running turns finish on the computer; phone gets a push-style notification via the existing watcher pattern |

## Architecture: one more sidecar, same trust model

The desktop app grows a second local service beside the Media Lab sidecar —
the **Workbench server** (Node, ships inside the desktop app; no Python
needed for this one):

- **Pairing**: the existing "Pair your phone" QR gains a second entry, or a
  combined `vibex://pair?workbench=<url>&medialab=<url>` payload. Same
  LAN/tailnet trust boundary, plus a pairing token minted at QR time
  (the Workbench executes code, so unlike Media Lab it MUST require the
  token on every request).
- **API surface (v1)**:
  - `POST /projects/import` — receive a project snapshot from the phone
    (or adopt a folder the user picks on the computer).
  - `POST /exec` — run a whitelisted toolchain command (`npm install`,
    `npm run build`, `npm run dev`, `npx tsc`) inside the project dir,
    streaming output. Never a general shell in v1.
  - `GET /preview/<project>` — proxy to the running dev server so the
    phone's Preview pane shows the REAL app with HMR.
  - `GET /events` — job stream (build finished, dev server up, agent turn
    done) that the phone's existing watcher turns into notifications.
- **Turn routing**: when a Workbench is connected, the chat engine offers
  the model two more fences —
  ```workbench exec=install``` / ```exec=build``` / ```exec=dev``` and
  file operations execute against the Workbench copy; the phone syncs the
  tree back on completion. Same bounded-loop mechanics as AGENT-WEB.md.
- **Always-on option**: a desktop preference ("Keep working when my phone
  leaves") — turns started from the phone continue on the computer; the
  phone reconnects and catches up from `/events`.

## Security lines (non-negotiable)

- Workbench binds LAN only, token-gated per request, token shown only in
  the QR; regenerate any time.
- `exec` is a command allowlist with per-project working dirs — no
  arbitrary shell in v1. Anything more is a loud opt-in later.
- Everything is the user's own machine and network. No relay, no cloud, no
  telemetry — the open-source rule holds.

## Build order

1. ✅ SHIPPED — Workbench server in `desktop/workbench/` (zero-dependency
   Node sidecar): pairing token, `/projects/import`, `/exec` (allowlist),
   `/jobs`, `/events`, `/preview` proxy. Contract: `desktop/workbench/API.md`.
2. ✅ SHIPPED — Phone: combined-QR pairing lands on a real `vibex://pair`
   screen, "Run on my computer" in the project's Share pane, and the Preview
   pane hosts the computer-served app over LAN/tailnet with a "computer"
   badge.
3. `workbench` fences in the chat engine + turn handoff.
4. Always-on continuation + catch-up.

Related: `AGENT-WEB.md` (web tools — shipped), `AGENT-MEDIA.md` (Media Lab
fences — shipped), `ONBOARDING.md` (pairing doors).
