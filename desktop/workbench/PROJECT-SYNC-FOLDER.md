# User-owned folder revisions

`project-sync-folder.mjs` is the filesystem layer for desktop Storage → Sync now. The native picker chooses a folder; this does not enable iCloud or Drive automatically.

A caller supplies a user-selected absolute directory and a validated project payload. The module stores immutable revisions under `VibeXStudioSync/v1/projects/<projectId>/<revisionId>.json`. The integration validates portable snapshots, excludes device AI/GitHub bindings, authorizes access through the native picker, replaces local projects atomically, and offers Keep both copies for conflicts. User-authored code and chat content are included; secrets typed into that content are not automatically redacted.

Each revision has a SHA-256 payload digest and parent revision IDs. The current heads are revisions not referenced by another revision. Concurrent saves create multiple heads; no timestamp chooses a winner. Resolving a conflict requires reading both versions and publishing an explicit descendant of both. Old revisions remain available. Missing parents, corrupt data, or cycles halt reads.

Publication writes and flushes a private temporary file, then hard-links it to a unique final name without overwrite. The temporary name is ignored by readers. Filesystems or storage providers without hard-link support fail publication and retain existing history. Actual iCloud/Drive/network-filesystem behavior is not yet qualified. A syncing provider can temporarily expose incomplete history; retry after it finishes.

Current limits: 30 MiB per revision, 256 MiB aggregate project history per read, 10,000 revisions, 100 parents. There is no history garbage collection yet. This format is distinct from the legacy Android SAF folder format; an explicit adapter/migration is required before claiming cross-platform folder interoperability.

Filesystem tests cover ordinary updates, stale writes, two simultaneous writers, an explicit merge, publication interruption, corrupt revisions, missing parents, traversal, and symlink roots. Native macOS acceptance also covers picker selection, save-back, receiving later revisions, unchanged detection, multi-head Keep both copies, exact preserved file bytes, and disconnect. This does not prove cross-platform or cloud-provider interoperability.

Embedded chat attachments use `vibex-project-file:` references to binary files in the same snapshot. Desktop export accepts references to its own stored files or data URLs matching embedded bytes, without fetching external URLs or reading arbitrary paths. Import reconstructs displayable data URLs in the atomic project transaction. External/missing attachments, wrong media kinds, and oversized expanded chat data are rejected. Snapshot and expanded import content are capped at25 million characters. Attachment byte round-trips are tested; actual native image/video display acceptance remains outstanding.

## Automatic desktop checks
Storage offers a per-folder opt-in for automatic checks every 30 seconds while Studio is running. Polls are serialized and skip active manual sync operations; the engine also skips projects being edited by AI. Each run is bound to the opted-in native folder so changing folders cannot redirect an automatic run. Conflicts remain unchanged for the user to resolve using Keep both copies. Turning the setting off prevents subsequent checks; an in-flight sync may finish. This is not an OS background service and does not qualify iCloud/Drive filesystem semantics or bridge the legacy Android folder format.
