# Agent-driven media — the `medialab` fence protocol

Owner-approved design for letting the coding model CONTROL Media Lab, so
"make Steve give an intro and put him on the homepage" works end-to-end.

## The protocol

A new fence the model may emit alongside `file=` blocks:

````
```medialab kind=video|image character=<optional id> file=assets/<name>.<mp4|png>
<generation prompt>
```
````

Text-only, so it works on every provider (subscriptions included).

- `kind` — `video` or `image` (required).
- `character` — optional Media Lab character id; puts that real, cloned
  person in the shot (server-side `cast`).
- `file` — required target path, must live directly under `assets/`, with an
  extension matching the kind (`.mp4` for video; `.png`/`.jpg`/`.jpeg`/`.webp`
  for image). Sanitized like every project path — traversal is rejected.
- The fence body is the generation prompt.

The system prompt only advertises the protocol the device can honor:

- **Media Lab paired** (`useApp().mediaLab`): video + image, plus the live
  character list (id + name) fetched from `GET /api/characters` and cached
  for 5 minutes.
- **Not paired**: images only, generated via the user's connected
  image provider (Gemini / OpenAI / Grok / fal); no video.

## Flow

1. `src/lib/ai/parser.ts` parses `medialab` fences into
   `{ kind, character?, file, prompt }` (pure, tested). Invalid fences stay
   in the visible text; they are never half-executed.
2. `src/lib/vibe.ts` hands parsed media requests to
   `src/lib/medialab-tool.ts` after writing normal files:
   - **Server paired** — POST the job (`/api/generate` for video,
     `/api/image` for image; `cast: [characterId]` when a character was
     named), record `{ jobId, projectId, targetPath, kind, prompt }` in an
     AsyncStorage-backed pending list, and write a placeholder NOW: a 1-px
     PNG for images, an `assets/<name>.<ext>.pending.txt` marker for video.
     The prompt contract tells the model to give every `<video>` a poster /
     styled fallback so the page looks finished before the file lands.
   - **No server, image** — generate via the connected provider (existing
     `src/lib/ai/media.ts` providers), bounded at 90 s, written into the
     project as the real file during the turn.
   - A short status line is appended to the assistant message
     ("🎬 Rendering on your Media Lab — it'll drop into assets/intro.mp4
     when it's done.").
3. `src/lib/media-server-watch.ts` (the existing queue poller — extended,
   not duplicated) matches finished jobs against the pending list: downloads
   the result into the project's `targetPath`, deletes the marker, bumps
   `filesVersion` so the preview reloads, and fires a notification whose tap
   opens the PROJECT (`{ projectId }` routing, already wired in the root
   layout).

Media fences count as real output for the fileless-retry heuristic: a reply
with at least one file OR media fence is never retried as "no file blocks",
and the placeholder/marker writes count toward `filesWritten`.

Pure logic (request bodies, pending-list matching, path/marker helpers)
lives in `src/lib/medialab-core.ts` and is unit-tested; the effectful side
(fetches, AsyncStorage, file writes) is `src/lib/medialab-tool.ts`.

## Failure honesty

- Server unreachable at submit time → no other provider is used automatically.
  Chat reports the failure. Check the server queue before retrying an uncertain
  request; a connection failure does not prove the server rejected it.
- Server reports a job error → the pending entry is dropped and a "hit a
  snag" notification routes to the project.
- Result download fails → retried on later polls (up to 5 attempts), then
  dropped.

## Host identity and persistence

New pending records retain the accepting server origin. A queue snapshot may
settle only that origin's jobs. Legacy records without a source remain preserved;
they must be reconciled with the original server instead of guessed from a job ID.
The pending store serializes submissions and result settlement within one app
runtime, and persists retry counters even when the list length stays the same.
It never evicts older pending work to enforce a list-size or age limit. Storage failures
are surfaced rather than treated as successful tracking.

Foreground queue polling runs on web and desktop as well as mobile. Native
background execution remains an OS-controlled best effort. Completed-job
notification baselines are stored per server origin. Browser cross-origin
session authentication is a separate requirement; polling alone does not grant
access to a locked server.
