# Device sync — no servers, no accounts of ours

VibeXStudio is local-first and free: we run no backend and never see user
data. Sync between a user's devices rides the platform's own cloud, tied to
the account already on the device. Nothing to sign up for.

## Apple (iPhone · iPad · Mac)

Projects live in the app's **iCloud Documents container**
(`iCloud.studio.vibex.app`). Whole project trees — chat, generated files,
media — sync through the user's iCloud Drive automatically.

- Native side: `modules/vibex-icloud` (Expo local module) exposes the
  ubiquity container URL; `src/lib/storage/projects.ts` roots the projects
  tree there when available, else falls back to the local documents dir
  (signed out of iCloud, or iCloud Drive off — the app works identically,
  just without sync).
- Migration: `migrateLocalProjectsToCloud()` runs on hydrate and moves any
  pre-sync local projects into the container once.
- Entitlements: `app.json → ios.usesIcloudStorage + ios.entitlements`
  (CloudDocuments + the container id). They reach the Xcode project via
  prebuild; the container must also be added to the App ID in the Apple
  Developer portal before a signed build syncs for real.
- Conflict story: iCloud Documents does file-level sync; concurrent edits to
  the SAME file on two devices produce a conflict version (iOS keeps the
  latest). Projects are edited one-at-a-time by one person in practice; the
  chat engine writes whole files, so the blast radius is one file.
- Desktop (Tauri, macOS): the same container appears on the user's Mac at
  `~/Library/Mobile Documents/iCloud~studio~vibex~app/Documents` once any
  of their Apple devices has used the app. The desktop app reads/writes that
  folder directly (roadmap item — desktop storage must move from IndexedDB
  to the filesystem first).

Lesson borrowed from MealReels (which syncs records via CloudKit private DB):
record-based sync doesn't carry files — its photos famously don't cross
devices. VibeXStudio's data IS files, which is why we use the Documents
container instead of CloudKit records.

## Android

- **Baseline: Android Auto Backup.** `allowBackup` is on, so the app's files
  (projects) and AsyncStorage back up to the user's Google account and
  restore on a new device or reinstall. Free, invisible, no login UI — but
  it's backup/restore, not live sync, and Google caps it at 25 MB.
- **Shipped v1: a user-picked folder via the Storage Access Framework**
  (`src/lib/sync/android-folder-sync.ts`). Settings → Device sync opens the
  system folder picker; granting a folder (typically inside the Google Drive
  DocumentsProvider) persists its tree URI in AsyncStorage, and the app
  mirrors every project into `<folder>/VibeXStudio/<projectId>/` —
  project.json, chat.json, and files/** (base64 for binaries; `media/` chat
  attachments are NOT mirrored yet). No OAuth client, no API keys, no login
  beyond the picker: Drive itself carries the bytes between devices, exactly
  the Apple design with the platform account doing the work.
  - Triggers: a debounced (8 s) sync after the chat engine bumps any
    project's `filesVersion` (i.e. a turn or manual edit wrote files), one
    pass shortly after launch, and a manual "Sync now" row in Settings.
    Wired from the root layout via `initAndroidFolderSync()`.
  - Honest conflict story: **last-writer-wins per WHOLE project.** The
    `updatedAt` in each side's project.json picks a direction and the
    winner's entire copy (chat + files) replaces the loser's — no per-file
    merge (pure logic in `src/lib/sync/sync-plan.ts`, unit-tested). Editing
    the same project on two devices between syncs loses the older device's
    edits for that project. project.json is written last on both push and
    pull, so an interrupted transfer reads as stale and gets repaired on the
    next round.
  - Import: a `<folder>/VibeXStudio/<id>` with a valid project.json whose id
    isn't known locally is imported whole ("Sync now" or launch pass).
  - Reality check: Drive's provider only uploads/downloads when Drive feels
    like it and SAF calls fail freely, so every call is wrapped and a failed
    project is skipped, never fatal. Sync latency between devices is Drive's,
    not ours.
- Explicitly rejected: Google Drive `appDataFolder` via OAuth (needs a
  Google Cloud OAuth client — an account of OURS in the loop) and any
  VibeX-run sync server (violates the no-backend rule in CLAUDE.md).

## Windows / Linux desktop

Same philosophy, no platform cloud assumption: the desktop app will let the
user point the projects folder at any synced location (OneDrive, Google
Drive for Desktop, Dropbox, Syncthing). File trees + "pick your folder" is
the whole integration.
