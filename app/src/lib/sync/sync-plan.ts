/**
 * Pure decision logic for Android folder sync (no Expo imports — unit-tested
 * in tests/sync-plan.test.ts). The sync is last-writer-wins at WHOLE-PROJECT
 * granularity: `updatedAt` in each side's project.json decides which copy of
 * the entire project wins; there is no per-file merging.
 */

export type SyncDirection = 'push' | 'pull' | 'skip';

/**
 * Decide which way a single project syncs.
 * - push: local copy overwrites the folder copy
 * - pull: folder copy overwrites the local copy
 * - skip: both sides carry the same updatedAt — nothing to do
 *
 * A missing side (null/undefined timestamp) loses to a present one; two
 * missing timestamps skip (nothing trustworthy to copy either way).
 */
export function decideSyncDirection(
  localUpdatedAt: number | null | undefined,
  remoteUpdatedAt: number | null | undefined
): SyncDirection {
  const local = typeof localUpdatedAt === 'number' && Number.isFinite(localUpdatedAt) ? localUpdatedAt : null;
  const remote = typeof remoteUpdatedAt === 'number' && Number.isFinite(remoteUpdatedAt) ? remoteUpdatedAt : null;
  if (local == null && remote == null) return 'skip';
  if (remote == null) return 'push';
  if (local == null) return 'pull';
  if (local > remote) return 'push';
  if (remote > local) return 'pull';
  return 'skip';
}

/**
 * Display/file name of a SAF document URI. SAF directory listings return
 * full `content://` URIs whose last path segment is the percent-encoded
 * document id (e.g. `...%2FVibeXStudio%2Fproject.json`); the name is the
 * part after the final separator once decoded.
 */
export function safDocumentName(uri: string): string {
  const lastSegment = uri.split('/').pop() ?? uri;
  let decoded = lastSegment;
  try {
    decoded = decodeURIComponent(lastSegment);
  } catch {
    // Malformed escapes: fall back to the raw segment.
  }
  const idx = Math.max(decoded.lastIndexOf('/'), decoded.lastIndexOf(':'));
  return idx >= 0 ? decoded.slice(idx + 1) : decoded;
}

/**
 * Human-readable folder name for a granted SAF tree URI, e.g.
 * `content://com.android.externalstorage.documents/tree/primary%3ADocuments%2FVibeX`
 * → "VibeX". Google Drive tree URIs are opaque ids — fall back to a generic
 * label rather than showing gibberish.
 */
export function safTreeLabel(treeUri: string): string {
  const name = safDocumentName(treeUri);
  // Opaque provider ids (Drive uses long alphanumeric blobs) aren't names.
  if (!name || /^[A-Za-z0-9+/=_-]{16,}$/.test(name) || /^\d+$/.test(name)) return 'Selected folder';
  return name;
}
