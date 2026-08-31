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
