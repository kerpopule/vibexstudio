# Media Lab onboarding — the zero-knowledge path

The rule this design serves: **someone who has never heard the words
"server address" gets to a working studio in under two minutes**, and the
technical person who installed the server on their own GPU box loses
nothing. Everything is doable from inside the app.

## The four doors (in the order we offer them)

When someone reaches Media Lab for the first time, they choose one card —
worded by what they HAVE, never by how it works:

1. **"Just my phone"** *(default, zero setup)* — on-device generation
   through the AI they already connected (Grok/X Premium+, OpenAI, Gemini).
   Nothing to install. This is pre-selected; the other doors are upgrades.
2. **"I have the desktop app"** — the desktop app ships Media Lab inside
   it. The desktop shows a QR code; the phone's camera scans it; paired.
   No addresses, no typing. (Deep link: `vibex://pair?url=…`.)
3. **"I want cloud rendering (fal.ai)"** — a guided walkthrough:
   step 1 "Create a fal.ai account" (opens fal.ai/login), step 2 "Add
   billing" (opens the billing page), step 3 "Copy your API key" (opens
   the keys page), step 4 paste it here. Models auto-populate with the
   **recommended ones pre-selected and sorted first** (see catalog below).
4. **"I run my own server"** *(advanced, folded behind "More options")* —
   paste the URL, exactly today's flow.

Doors are not exclusive: pairing later, or adding fal on top of a paired
server, is always available from Settings.

## Desktop: "it just includes it"

Installing the Mac/Windows/Linux desktop app IS installing Media Lab:

- First launch asks one question: **"Make media on this computer?"**
  Yes → the sidecar sets itself up (Python env, data dir) and starts; the
  window gets a **"Pair your phone"** button showing the QR.
- The sidecar binds the LAN/tailnet interface (not just localhost) when
  pairing is enabled, so phones can reach it. The QR encodes the deep link
  with the machine's address; the phone app auto-pairs on scan.
- No GPU? The sidecar runs cloud-only and the fal.ai door (3) is offered
  inside it.

## Engines: LTX by default, everything else one tap

On GPU-capable machines (a Spark, a beefy Linux box), the server's own
first-run screen offers the engine shelf. **LTX (fast video drafts) is the
default install.** Everything else is an optional add-on with an honest
size and a checkbox:

| Add-on | What they see | ~Download |
|---|---|---|
| MiniMax H3 | "Cinematic video + talking characters" | large (user accepts terms; license is theirs) |
| Music (MiniMax Music 3 pipeline) | "Full songs & music videos" | large |
| Image suite (Qwen + FLUX) | "Image generation & tap-to-edit" | medium |
| Voicebox / Qwen TTS | "Voices — clone yours, give characters theirs" | medium |

Mechanics (this is what `media_lab_core/` was built for — wire it, don't
reinvent): hash-pinned catalog, license/terms acceptance by the human,
staged downloads, qualification receipt, promote/rollback. Installs run
**in the background while onboarding continues**; each engine flips to
"ready" independently.

**"It's ready" notifications**, honestly stated per surface:
- The server pushes webpush ("Your music studio is ready 🎵") to any
  browser/PWA that opted in — this exists today (VAPID/push-subs).
- The desktop app polls its sidecar and raises a native notification.
- The phone app shows readiness when opened (poll on focus); if the Media
  Lab PWA was added to the home screen, its webpush covers the closed-app
  case. (True remote push to the native app would need a push server —
  which we don't run, by principle.)

## fal.ai model auto-population

The server (and the on-device studio) ships a **curated fal catalog** —
id, friendly name, what-it's-for, cost hint, `recommended` flag — instead
of asking anyone to know model ids. Recommended entries sort first and are
pre-selected; "show all" reveals the rest; a free-text id field stays for
power users. The catalog is data (JSON in the repo), so keeping it current
is a PR, not a release.

## What "simple" means, concretely

- Never show an IP address unless the user opened "More options".
- Every wait states what's happening and keeps the user moving ("Installing
  the video engine — about 20 minutes. Keep setting up, we'll tell you.").
- Every failure names the fix ("This computer doesn't have a GPU — cloud
  rendering with fal.ai works great instead →").
- Every door can be revisited from Settings; nothing is one-shot.

## Build order

1. App: the four-door Media Lab onboarding step + `vibex://pair` deep link
   + fal walkthrough screens + curated-catalog picker.
2. Desktop: pair-your-phone QR + sidecar LAN binding + first-launch
   "make media on this computer?" question.
3. Server: first-run wizard (engine shelf + fal door), install
   orchestrator wired to `media_lab_core`, webpush on engine-ready.
4. The Spark path (self-hosted, like the founder's) stays what it is:
   `AGENTS.md` + one command — door 4.
