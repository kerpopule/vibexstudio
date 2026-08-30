/**
 * Android device sync v1 — mirror projects into a user-picked folder via the
 * Storage Access Framework (docs/SYNC.md). The user grants a folder with the
 * system picker (typically inside Google Drive); we persist the grant and
 * mirror whole projects into `<folder>/VibeXStudio/<projectId>/…`. Drive (or
 * any syncing DocumentsProvider) carries the bytes between devices — no OAuth
 * client of ours, no servers.
 *
 * Granularity is last-writer-wins per WHOLE PROJECT: `updatedAt` in each
 * side's project.json picks a direction (push or pull) and the winner's copy
 * of project.json + chat.json + files/** replaces the loser's. No per-file
 * merging. `media/` (chat attachments) is not mirrored in v1.
 *
 * Every function is a no-op on iOS/web (iCloud covers Apple sync). SAF calls
 * throw freely — a revoked grant, a Drive hiccup, provider quirks — so
 * everything is wrapped and a failed project never stops the others.
 */
import { Platform } from 'react-native';
import { EncodingType, StorageAccessFramework as SAF } from 'expo-file-system/legacy';

import { useChat } from '@/lib/chat-engine';
import {
  deleteProject,
  isBinaryPath,
  listFiles,
  listProjects,
  readChat,
  writeBinaryFile,
  writeChat,
  writeFile,
  writeProject,
} from '@/lib/storage/projects';
import { getAndroidSyncFolder, setAndroidSyncFolder } from '@/lib/storage/settings';
import { decideSyncDirection, safDocumentName } from '@/lib/sync/sync-plan';
import type { ChatMessage, ProjectMeta } from '@/lib/types';

const APP_DIR = 'VibeXStudio';
const isAndroid = Platform.OS === 'android';

export interface SyncSummary {
  /** Projects whose local copy overwrote the folder copy. */
  pushed: number;
  /** Projects whose folder copy overwrote the local copy. */
  pulled: number;
  /** Folder-only projects imported locally for the first time. */
  imported: number;
  /** Projects that threw and were skipped this round. */
  failed: number;
}

// ---------------------------------------------------------------------------
// Grant lifecycle
// ---------------------------------------------------------------------------

/**
 * Open the system folder picker and persist the granted tree URI. Returns the
 * URI, or null when not on Android / the user cancelled / the picker threw.
 */
export async function pickSyncFolder(): Promise<string | null> {
  if (!isAndroid) return null;
  try {
    const permission = await SAF.requestDirectoryPermissionsAsync();
    if (!permission.granted) return null;
    await setAndroidSyncFolder(permission.directoryUri);
    return permission.directoryUri;
  } catch {
    return null;
  }
}

/** Forget the granted folder. Files already mirrored there are left alone. */
export async function clearSyncFolder(): Promise<boolean> {
  if (!isAndroid) return false;
  await setAndroidSyncFolder(null);
  return true;
}

/** The persisted SAF tree URI, or null when unset / not on Android. */
export async function syncFolderUri(): Promise<string | null> {
  if (!isAndroid) return null;
  return getAndroidSyncFolder();
}

// ---------------------------------------------------------------------------
// SAF helpers (every call defensive — providers throw a lot)
// ---------------------------------------------------------------------------

async function listChildren(dirUri: string): Promise<string[]> {
  try {
    return await SAF.readDirectoryAsync(dirUri);
  } catch {
    return [];
  }
}

async function childByName(dirUri: string, name: string): Promise<string | null> {
  const children = await listChildren(dirUri);
  return children.find((uri) => safDocumentName(uri) === name) ?? null;
}

/**
 * Find-or-create a subdirectory. Always look before creating: SAF's
 * createDocument silently makes "Name (1)" duplicates for existing names.
 */
async function ensureDir(parentUri: string, name: string): Promise<string | null> {
  const existing = await childByName(parentUri, name);
  if (existing) return existing;
  try {
    return await SAF.makeDirectoryAsync(parentUri, name);
  } catch {
    return null;
  }
}

function mimeFor(name: string): string {
  if (name.endsWith('.json')) return 'application/json';
  return isBinaryPath(name) ? 'application/octet-stream' : 'text/plain';
}

/** Overwrite-or-create a file inside a SAF directory. */
async function writeSafFile(
  dirUri: string,
  name: string,
  content: string,
  encoding: EncodingType
): Promise<boolean> {
  try {
    const uri = (await childByName(dirUri, name)) ?? (await SAF.createFileAsync(dirUri, name, mimeFor(name)));
    await SAF.writeAsStringAsync(uri, content, { encoding });
    return true;
  } catch {
    return false;
  }
}

async function readSafJson<T>(dirUri: string, name: string): Promise<T | null> {
  try {
    const uri = await childByName(dirUri, name);
    if (!uri) return null;
    return JSON.parse(await SAF.readAsStringAsync(uri, { encoding: EncodingType.UTF8 })) as T;
  } catch {
    return null;
  }
}

/** True when the URI lists as a directory. SAF gives us no cheap stat, so we probe. */
async function isSafDirectory(uri: string): Promise<boolean> {
  try {
    await SAF.readDirectoryAsync(uri);
    return true;
  } catch {
    return false;
  }
}

/** The `<tree>/VibeXStudio` root, created on demand. Null when no grant works. */
async function appRoot(): Promise<string | null> {
  const tree = await syncFolderUri();
  if (!tree) return null;
  return ensureDir(tree, APP_DIR);
}

// ---------------------------------------------------------------------------
// Push: local project → folder
// ---------------------------------------------------------------------------

async function pushProject(meta: ProjectMeta, rootUri: string): Promise<void> {
  const dirUri = await ensureDir(rootUri, meta.id);
  if (!dirUri) throw new Error('cannot create project dir');

  const [chat, files] = await Promise.all([readChat(meta.id), listFiles(meta.id)]);

  // Whole-project LWW: drop the old files tree so deletions propagate, then
  // rewrite everything. project.json goes LAST — a half-pushed project reads
  // as older/absent, so the next sync round repairs it.
  const oldFiles = await childByName(dirUri, 'files');
  if (oldFiles) await SAF.deleteAsync(oldFiles, { idempotent: true }).catch(() => {});
  const filesRoot = await ensureDir(dirUri, 'files');
  if (!filesRoot) throw new Error('cannot create files dir');

  const dirCache = new Map<string, string>([['', filesRoot]]);
  const dirFor = async (relDir: string): Promise<string | null> => {
    const cached = dirCache.get(relDir);
    if (cached) return cached;
    const parts = relDir.split('/');
    const parent = await dirFor(parts.slice(0, -1).join('/'));
    if (!parent) return null;
    const made = await ensureDir(parent, parts[parts.length - 1]);
    if (made) dirCache.set(relDir, made);
    return made;
  };

  for (const file of files) {
    const segments = file.path.split('/');
    const dir = await dirFor(segments.slice(0, -1).join('/'));
    if (!dir) throw new Error(`cannot create dir for ${file.path}`);
    const encoding = file.encoding === 'base64' ? EncodingType.Base64 : EncodingType.UTF8;
    if (!(await writeSafFile(dir, segments[segments.length - 1], file.content, encoding))) {
      throw new Error(`cannot write ${file.path}`);
    }
  }

  if (!(await writeSafFile(dirUri, 'chat.json', JSON.stringify(chat), EncodingType.UTF8))) {
    throw new Error('cannot write chat.json');
  }
  if (!(await writeSafFile(dirUri, 'project.json', JSON.stringify(meta, null, 2), EncodingType.UTF8))) {
    throw new Error('cannot write project.json');
  }
}

// ---------------------------------------------------------------------------
// Pull: folder project → local
// ---------------------------------------------------------------------------

async function collectRemoteFiles(dirUri: string, prefix: string, out: { path: string; uri: string }[]): Promise<void> {
  for (const child of await listChildren(dirUri)) {
    const name = safDocumentName(child);
    if (await isSafDirectory(child)) await collectRemoteFiles(child, `${prefix}${name}/`, out);
    else out.push({ path: `${prefix}${name}`, uri: child });
  }
}

async function pullProject(remoteMeta: ProjectMeta, remoteDirUri: string): Promise<void> {
  const chat = (await readSafJson<ChatMessage[]>(remoteDirUri, 'chat.json')) ?? [];
  const filesDirUri = await childByName(remoteDirUri, 'files');
  const remoteFiles: { path: string; uri: string }[] = [];
  if (filesDirUri) await collectRemoteFiles(filesDirUri, '', remoteFiles);

  // Read every remote file BEFORE touching the local copy, so a flaky
  // provider read can't leave us with a half-deleted project.
  const loaded: { path: string; content: string; binary: boolean }[] = [];
  for (const file of remoteFiles) {
    const binary = isBinaryPath(file.path);
    const content = await SAF.readAsStringAsync(file.uri, {
      encoding: binary ? EncodingType.Base64 : EncodingType.UTF8,
    });
    loaded.push({ path: file.path, content, binary });
  }

  // Whole-project replace: clear the local tree, rewrite from the folder
  // copy. project.json last, with the REMOTE updatedAt intact (writeFile
  // touches the project, which would otherwise mark the pull as a new edit).
  await deleteProject(remoteMeta.id);
  await writeChat(remoteMeta.id, chat);
  for (const file of loaded) {
    if (file.binary) await writeBinaryFile(remoteMeta.id, file.path, file.content);
    else await writeFile(remoteMeta.id, file.path, file.content);
  }
  await writeProject(remoteMeta);

  // An open preview of this project should reload with the pulled files.
  useChat.getState().bumpFiles(remoteMeta.id);
}

// ---------------------------------------------------------------------------
// Public sync entry points
// ---------------------------------------------------------------------------

/**
 * Mirror every local project to/from the folder. Per project, updatedAt in
 * project.json decides direction (last writer wins); ties and failures are
 * skipped. Returns null when not on Android or no folder is granted.
 */
export async function mirrorAllProjects(): Promise<SyncSummary | null> {
  if (!isAndroid) return null;
  const root = await appRoot();
  if (!root) return null;

  const summary: SyncSummary = { pushed: 0, pulled: 0, imported: 0, failed: 0 };
  for (const meta of await listProjects()) {
    try {
      const remoteDir = await childByName(root, meta.id);
      const remoteMeta = remoteDir ? await readSafJson<ProjectMeta>(remoteDir, 'project.json') : null;
      const direction = decideSyncDirection(meta.updatedAt, remoteMeta?.updatedAt);
      if (direction === 'push') {
        await pushProject(meta, root);
        summary.pushed += 1;
      } else if (direction === 'pull' && remoteMeta && remoteDir) {
        await pullProject(remoteMeta, remoteDir);
        summary.pulled += 1;
      }
    } catch {
      summary.failed += 1;
    }
  }
  return summary;
}

/**
 * Import folder projects that don't exist locally yet (created on another
 * device). Returns null when not on Android or no folder is granted.
 */
export async function importNewProjects(): Promise<SyncSummary | null> {
  if (!isAndroid) return null;
  const root = await appRoot();
  if (!root) return null;

  const summary: SyncSummary = { pushed: 0, pulled: 0, imported: 0, failed: 0 };
  const localIds = new Set((await listProjects()).map((p) => p.id));
  for (const child of await listChildren(root)) {
    const id = safDocumentName(child);
    if (localIds.has(id)) continue;
    try {
      if (!(await isSafDirectory(child))) continue;
      const remoteMeta = await readSafJson<ProjectMeta>(child, 'project.json');
      if (!remoteMeta || remoteMeta.id !== id) continue; // stranger folders aren't ours
      await pullProject(remoteMeta, child);
      summary.imported += 1;
    } catch {
      summary.failed += 1;
    }
  }
  return summary;
}

let syncInFlight = false;

/** Full round: two-way mirror of known projects + import of new ones. */
export async function syncNow(): Promise<SyncSummary | null> {
  if (!isAndroid || syncInFlight) return null;
  syncInFlight = true;
  try {
    const mirrored = await mirrorAllProjects();
    if (!mirrored) return null;
    const imported = await importNewProjects();
    return {
      pushed: mirrored.pushed,
      pulled: mirrored.pulled,
      imported: imported?.imported ?? 0,
      failed: mirrored.failed + (imported?.failed ?? 0),
    };
  } finally {
    syncInFlight = false;
  }
}

// ---------------------------------------------------------------------------
// Auto-mirror after turns
// ---------------------------------------------------------------------------

const AUTO_SYNC_DEBOUNCE_MS = 8_000;
let autoSyncStarted = false;

/**
 * Start mirroring automatically: watch the chat engine's per-project
 * filesVersion counters (bumped whenever a turn or manual edit writes
 * files) and run a debounced sync after they settle. Also kicks one sync
 * shortly after launch to catch edits made on other devices. Call once from
 * the root layout; a no-op off Android or when called twice.
 */
export function initAndroidFolderSync(): void {
  if (!isAndroid || autoSyncStarted) return;
  autoSyncStarted = true;

  let timer: ReturnType<typeof setTimeout> | null = null;
  const schedule = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      void syncNow().catch(() => {});
    }, AUTO_SYNC_DEBOUNCE_MS);
  };

  let lastTotal = totalFilesVersion();
  useChat.subscribe((state) => {
    const total = Object.values(state.sessions).reduce((sum, s) => sum + s.filesVersion, 0);
    if (total === lastTotal) return;
    lastTotal = total;
    schedule();
  });

  // Startup pass (delayed so hydrate finishes first): pull edits from other
  // devices and push anything made while the folder was unreachable.
  schedule();
}

function totalFilesVersion(): number {
  return Object.values(useChat.getState().sessions).reduce((sum, s) => sum + s.filesVersion, 0);
}
