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
