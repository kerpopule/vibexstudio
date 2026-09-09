# Workbench API v1 — the contract both sides build against

Plain-HTTP JSON on port **8794**, bound 0.0.0.0 (LAN/tailnet). EVERY request
requires `X-Workbench-Token: <token>` (401 otherwise) — the token is minted
at setup and travels only inside the pairing QR. Preview GETs may pass it as
`?wbt=<token>` instead (WebViews can't set headers on subresources).

## Endpoints

### GET /status
`{ ok: true, version: 1, projectsRoot, projects: [{id, name, devRunning, devPort?}] }`

### POST /projects/import
Body `{ id, name, files: [{ path, content, encoding?: 'utf-8'|'base64' }] }`
Writes the snapshot to `<projectsRoot>/<id>/` (paths sanitized, no `..`,
no absolute). Overwrites the tree ("phone is truth on import").
→ `{ ok: true, dir }`

### GET /projects/:id/files
Return the tree back (same file shape) so the phone can pull results after
builds/agent work. Excludes node_modules, .git, dist caches over 2MB/file.

### POST /exec
Body `{ project, task }`, task ∈ `install | build | typecheck | dev | stop-dev | serve`
- `install` → `npm install` (only if package.json exists; else no-op ok)
- `build` → `npm run build` (script must exist)
- `typecheck` → `npx tsc --noEmit` (tsconfig must exist)
- `dev` → `npm run dev` on an assigned port (PORT env), long-running
- `serve` → built-in static file server of the project dir (for the classic
  VibeXStudio static apps — instant, zero deps), long-running
- `stop-dev` → kill the project's running dev/serve
NOTHING else — an allowlist, not a shell.
→ `{ ok: true, job: <jobId> }` (long-running tasks stay 'running')

### GET /jobs/:id
`{ id, project, task, state: queued|running|done|failed, exitCode?, logTail (last 4KB), startedAt, finishedAt? }`

### GET /events?since=<seq>
Long-poll (≤25s hold): `{ seq, events: [{ seq, at, type: job-done|job-failed|dev-up, project, task?, jobId?, port? }] }`

### GET /preview/:project/*
Reverse-proxies to the project's running dev/serve port (404 with a clear
JSON error when nothing is running). Token via `?wbt=` accepted here.

## Files
- Server: `workbench/server.mjs` — **zero npm dependencies** (node:http,
  node:child_process, node:fs). Node ≥ 18.
- Config: `~/Library/Application Support/studio.vibex.desktop/workbench.json`
  `{ enabled, port: 8794, token, projectsRoot }` (created by
  `sidecar/setup-workbench.sh`; token = 32 hex chars). The env var
  `WORKBENCH_CONFIG=<path>` overrides the config path (tests use this so
  they never touch the real Application Support). The server refuses to
  start without a token.
- The Tauri shell spawns/kills it like the Media Lab sidecar, and the
  pairing QR becomes `vibex://pair?medialab=<url>&workbench=<url>&wbt=<token>`
  (legacy `?url=` stays supported as medialab-only).

## Security
Token on every request; allowlisted tasks; sanitized paths under
projectsRoot only; spawned processes get cwd = project dir and a minimal
env; kill children on server exit.

## Optional user-owned project synchronization

Set `syncFolder` in the owner's Workbench configuration to an existing absolute directory to enable the revision transport. It is off by default and is independent of build-server pairing. `/status` includes `projectSync: {version: 1}` when enabled, otherwise `null`. The folder must not be a symlink. The normal desktop bundle includes the revision-store module.

Authenticated `POST /sync` accepts one operation:

- `{operation: "list"}` returns `{projects: [id, ...]}`.
- `{operation: "read", projectId}` returns current `heads` and their revision envelopes; historical payloads are retained on disk.
- `{operation: "append", projectId, payload, expectedHeads}` adds a portable `vibex/project-snapshot` v1 payload only if the current heads match. Stale heads return 409. The snapshot identity must match the requested project.

The server-selected folder is authoritative; request-supplied paths cannot select a different destination. Requests are limited to 32 MiB, snapshot strings to 25 million characters, and replies to 64 MiB. Clients must perform full portable snapshot validation before local import. The transport stores immutable revisions without executing project code or exposing deletion. Conflicts remain separate heads. An invalid token returns 401; sync disabled returns 404. This uses the existing Workbench bearer authentication; short-lived device enrollment and UI-managed permissions are not implemented by this endpoint.

This is storage on the user's server, not a VibeX cloud. Use an authenticated encrypted network path for remote access. Cloud-folder filesystem behavior, mobile adapter wiring, resumable transfers and device approval remain separate acceptance gates.

### Browser origins for project sync

For browser or desktop-WebView clients, the owner can configure `syncOrigins` as an array of exact origins, such as `["https://studio.example.org", "tauri://localhost"]`. No wildcard, opaque `null` origin, path or embedded credentials is accepted. At most 20 origins are supported. Leave the list empty when only native clients connect.

Only `/status` GET, `/sync` POST and `/pairing/claim` POST receive this CORS handling. Allowed OPTIONS preflights may request `Content-Type` and `X-Workbench-Token`. Successful preflight does not authenticate a client: subsequent data requests still require the token. Unlisted browser origins receive403; allowed origins receive an exact Allow-Origin and Vary:Origin. Cookie credentials are not enabled. This does not bypass browser mixed-content, private-network or certificate policies; use the owner's HTTPS endpoint where needed.


## Single-use device invitations

These endpoints are implemented in the server; the app accepts wbi invitation links and the desktop pairing window issues them, lists devices, and revokes access. Existing owner-token clients continue to work.

- Owner-authenticated `POST /pairing/invites` returns `{code, expiresAt}`. The random code is valid for five minutes and one successful claim. At most eight invitations may be outstanding. Invitations are held in memory and expire on restart.
- `POST /pairing/claim` accepts `{code, name}` without the owner token and returns `{deviceId, token, scope: "build-and-project-sync"}`. Store this new token in the device's secret storage and use it as `X-Workbench-Token`. A used or expired invitation returns410. Claim bodies are limited to2KiB. Browser claims require an owner-allowed origin.
- Owner-authenticated `GET /pairing/devices` returns device IDs, names and creation times, without token hashes.
- Owner-authenticated `POST /pairing/revoke` with `{deviceId}` revokes that device's future authenticated requests. It does not cancel a request or build already underway. Device tokens cannot call these owner-management endpoints.

The user-owned registry lives beside the configuration as `<config path>.devices.json`. Only hashed tokens persist, through serialized atomic replacement with0600 mode on Unix. Windows file ACL qualification remains open. Maximum100 devices. Changing the owner's token invalidates previous device credentials. Build-and-project-sync grants access to all of this server's projects and build operations; it is not a per-project permission. Pairing does not enable a disabled sync folder. Invitation and credential replies use `Cache-Control: no-store`. Remote use still requires an authenticated encrypted network path.
