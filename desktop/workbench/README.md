# Workbench server

The desktop-side engine for VibeX Studio's phone app: the phone pushes a
project snapshot here, asks the computer to `npm install` / build /
typecheck / run a dev server, previews the running app over LAN/tailnet
through the built-in reverse proxy, and pulls the resulting tree back.
The full wire contract lives in [`API.md`](./API.md); the product vision in
the oss repo's `docs/WORKBENCH.md`.

Plain Node (>= 18), **zero npm dependencies** — only `node:http`,
`node:child_process`, `node:fs/promises`, `node:path`, `node:crypto`.

## Run it

```sh
./sidecar/setup-workbench.sh      # once: checks Node, mints token, writes config
node workbench/server.mjs         # standalone (the Tauri shell normally spawns it)
```

Config is read from
`~/Library/Application Support/studio.vibex.desktop/workbench.json`
(`{ enabled, port: 8794, token, projectsRoot }`). Override the path with
`WORKBENCH_CONFIG=/path/to/workbench.json` — used by the tests so they never
touch your real config. The server **refuses to start without a token**.

## Threat model

This service executes code on your machine, so it is locked down harder
than the Media Lab sidecar:

- **Token on every request.** `X-Workbench-Token` (constant-time compare);
  preview GETs may pass `?wbt=` because WebViews can't set headers on
  subresources — the token is stripped before proxying upstream. The token
  travels only inside the pairing QR; rotate with
  `setup-workbench.sh --new-token`.
- **Allowlist, not a shell.** `/exec` accepts exactly
  `install | build | typecheck | dev | serve | stop-dev`. Arguments are
  fixed; nothing from the request reaches a shell.
- **Paths stay inside `projectsRoot`.** Import paths are rejected if
  absolute, containing `..`, or containing backslashes; project ids are a
  strict `[A-Za-z0-9._-]` slug.
- **Minimal child env.** Spawned toolchains get only `PATH`, `HOME` (and
  `PORT` for dev) — no tokens or shell env leak into project scripts.
- **Children die with the server.** SIGTERM/SIGINT kills every dev/serve
  child (process-group kill) before exit.
- Binds 0.0.0.0 on purpose (LAN/tailnet pairing) — the token is the gate.

## Test

```sh
./workbench/test.sh
```

Spins up a sandboxed config + projects root under a temp dir, runs the
whole contract live (auth, import, serve + preview proxy, events long-poll,
npm build job, typecheck failure path, stop-dev, shutdown) and prints
PASS/FAIL per check.


## Run on your own headless server

Run the preparation command on the machine that will host Studio's build and project-storage service. It requires Node.js18 or later and does not require the desktop app. Choose a new installation directory; preparation refuses to overwrite an existing one.

```sh
node desktop/scripts/prepare-workbench-server.mjs --output /home/you/vibex-server --port 8794 --sync-folder /home/you/Studio-files
```

The storage directory must already exist. Omit `--sync-folder` to leave project sync disabled. Add `--origin https://your-studio.example` for each browser app origin you explicitly want to allow. Native clients do not require a browser origin. Use absolute paths appropriate to your OS; the preparation code uses Node's platform filesystem APIs.

From the generated directory, start `node run.mjs`. The README there explains invitations and device revocation through `pair-cli.mjs`. Run it with your OS service manager if it should remain available after logout or reboot. Preparation does not install a system service, configure a domain, change Tailscale, or expose a public port for you. Keep its owner configuration private. Project files and device records live on your server, with no VibeX-operated storage service.

A Linux ARM64 Spark acceptance check verified detached operation after the setup SSH session exited, invitation enrollment over Tailscale, exact media-project round trip, device/project persistence across server restart, and revocation. This does not qualify physical Mac-off Media Lab generation, Windows service setup, public HTTPS, or phone camera scanning.
