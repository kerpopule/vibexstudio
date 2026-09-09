/**
 * Android device sync v1 — mirror projects into a user-picked folder via the
 * Storage Access Framework (docs/SYNC.md). The user grants a folder with the
 * system picker (typically inside Google Drive); we persist the grant and
 * mirror whole projects into `<folder>/VibeXStudio/<projectId>/…`. Drive (or
 * any syncing DocumentsProvider) carries the bytes between devices — no OAuth
 * client of ours, no servers.
 *
 * Direction uses a shared content digest. Independently changed projects
 * stay untouched and count as conflicts. The legacy folder layout remains
 * whole-project; media/ chat attachments are not mirrored yet.
 *
 * Every function is a no-op on iOS/web. SAF calls
 * throw freely — a revoked grant, a Drive hiccup, provider quirks — so
 * everything is wrapped and a failed project never stops the others.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { digestStringAsync, getRandomBytes, CryptoDigestAlgorithm } from 'expo-crypto';
import { contentSyncAction, syncContent } from '@/lib/sync/content-plan';
import { Platform } from 'react-native';
import { EncodingType, StorageAccessFramework as SAF } from 'expo-file-system/legacy';

import { useChat } from '@/lib/chat-engine';
import {
  deleteProject,
  isBinaryPath,
  listFiles,
  listProjects,
  readChat,
  readProject,
  newId,
  withSyncRecovery,
  writeBinaryFile,
  writeChat,
  writeFile,
  writeProject,
} from '@/lib/storage/projects';
import { getAndroidSyncFolder, setAndroidSyncFolder } from '@/lib/storage/settings';
import { safDocumentName } from '@/lib/sync/sync-plan';
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
  /** Both copies changed; neither was overwritten. */
  conflicts: number;
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
  const children = await SAF.readDirectoryAsync(dirUri);
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

/** Immutable revisions retain the previous payload until a complete new commit exists. */
async function committedRevisions(dir: string): Promise<{ sequence: number; dir: string }[]> {
  const revisions = await childByName(dir, '.revisions');
  if (!revisions) return [];
  const result: { sequence: number; dir: string }[] = [];
  for (const child of await SAF.readDirectoryAsync(revisions)) {
    const commitUri = await childByName(child, 'commit.json');
    if (!commitUri) continue;
    const text = await SAF.readAsStringAsync(commitUri, { encoding: EncodingType.UTF8 });
    let commit: { sequence: number } | null = null;
    try { commit = JSON.parse(text); } catch { continue; } // incomplete commit is not published
    if (commit && Number.isSafeInteger(commit.sequence) && commit.sequence > 0) result.push({ sequence: commit.sequence, dir: child });
  }
  return result.sort((a, b) => b.sequence - a.sequence);
}

async function resolvedProjectDir(dir: string): Promise<string> {
  const revisions = await committedRevisions(dir);
  if (revisions.length > 1 && revisions[0].sequence === revisions[1].sequence) {
    throw new Error('Two devices saved at the same time. Both revisions are kept for review.');
  }
  return revisions[0]?.dir ?? dir;
}

async function readRemoteMeta(dir: string): Promise<ProjectMeta | null> {
  return readSafJson<ProjectMeta>(await resolvedProjectDir(dir), 'project.json');
}

async function pushProject(meta: ProjectMeta, rootUri: string): Promise<void> {
  const projectUri = await ensureDir(rootUri, meta.id);
  if (!projectUri) throw new Error('cannot create project dir');
  const before = await committedRevisions(projectUri);
  const sequence = (before[0]?.sequence ?? 0) + 1;
  const revisions = await ensureDir(projectUri, '.revisions');
  if (!revisions) throw new Error('cannot create revision directory');
  const revisionId = Array.from(getRandomBytes(16), (byte) => byte.toString(16).padStart(2, '0')).join('');
  if (await childByName(revisions, revisionId)) throw new Error('Revision collision; retry sync.');
  const dirUri = await ensureDir(revisions, revisionId);
  if (!dirUri) throw new Error('cannot create revision');

  const [chat, files] = await Promise.all([readChat(meta.id), listFiles(meta.id)]);

  // Write into a fresh directory. Previous revisions are never deleted here.
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
  const expected = await digestStringAsync(CryptoDigestAlgorithm.SHA256, syncContent(meta, chat, files));
  if (await remoteDigest(meta, dirUri) !== expected) throw new Error('Revision verification failed');
  const after = await committedRevisions(projectUri);
  if ((after[0]?.sequence ?? 0) !== sequence - 1) throw new Error('Another device saved first. Retry sync.');
  if (!(await writeSafFile(dirUri, 'commit.json', JSON.stringify({ sequence }), EncodingType.UTF8))) {
    throw new Error('Could not finish the revision. The previous copy is preserved.');
  }
}

// ---------------------------------------------------------------------------
// Pull: folder project → local
// ---------------------------------------------------------------------------

async function collectRemoteFiles(dirUri: string, prefix: string, out: { path: string; uri: string }[]): Promise<void> {
  for (const child of await SAF.readDirectoryAsync(dirUri)) {
    const name = safDocumentName(child);
    if (await isSafDirectory(child)) await collectRemoteFiles(child, `${prefix}${name}/`, out);
    else out.push({ path: `${prefix}${name}`, uri: child });
  }
}

async function pullProject(remoteMeta: ProjectMeta, remoteDirUri: string): Promise<void> {
  remoteDirUri = await resolvedProjectDir(remoteDirUri);
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
  await withSyncRecovery(remoteMeta.id, async () => {
  await deleteProject(remoteMeta.id);
  await writeChat(remoteMeta.id, chat);
  for (const file of loaded) {
    if (file.binary) await writeBinaryFile(remoteMeta.id, file.path, file.content);
    else await writeFile(remoteMeta.id, file.path, file.content);
  }
  await writeProject(remoteMeta);
  });

  // An open preview of this project should reload with the pulled files.
  useChat.getState().bumpFiles(remoteMeta.id);
}

// ---------------------------------------------------------------------------
// Public sync entry points
// ---------------------------------------------------------------------------

/**
 * Mirror projects with a three-way content comparison. Divergent edits are
 * counted as conflicts and preserved on both sides. Returns null when not on Android or no folder is granted.
 */
function baselineKey(root: string, id: string): string {
  return `vibex.sync.base.v2:${encodeURIComponent(root)}:${encodeURIComponent(id)}`;
}

async function localDigest(id: string): Promise<string | null> {
  const meta = await readProject(id);
  if (!meta) return null;
  return digestStringAsync(CryptoDigestAlgorithm.SHA256, syncContent(meta, await readChat(id), await listFiles(id)));
}

async function remoteDigest(meta: ProjectMeta, dir: string): Promise<string> {
  dir = await resolvedProjectDir(dir);
  const chatUri = await childByName(dir, 'chat.json');
  const filesDir = await childByName(dir, 'files');
  if (!chatUri || !filesDir) throw new Error('Incomplete folder project');
  const chat = JSON.parse(await SAF.readAsStringAsync(chatUri, { encoding: EncodingType.UTF8 }));
  if (!Array.isArray(chat)) throw new Error('Invalid chat history');
  const remoteFiles: { path: string; uri: string }[] = [];
  await collectRemoteFiles(filesDir, '', remoteFiles);
  const files = [];
  for (const file of remoteFiles) {
    const binary = isBinaryPath(file.path);
    files.push({ path: file.path, content: await SAF.readAsStringAsync(file.uri, { encoding: binary ? EncodingType.Base64 : EncodingType.UTF8 }), encoding: binary ? 'base64' : 'utf8' });
  }
  return digestStringAsync(CryptoDigestAlgorithm.SHA256, syncContent(meta, chat, files));
}

export async function mirrorAllProjects(): Promise<SyncSummary | null> {
  if (!isAndroid) return null;
  const root = await appRoot();
  if (!root) return null;

  const summary: SyncSummary = { pushed: 0, pulled: 0, imported: 0, failed: 0, conflicts: 0 };
  for (const meta of await listProjects()) {
    try {
      const remoteDir = await childByName(root, meta.id);
      const remoteMeta = remoteDir ? await readRemoteMeta(remoteDir) : null;
      // A corrupt existing folder is not a missing project to overwrite.
      if (remoteDir && !remoteMeta) {
        // A failed first publication has only unpublished revision directories.
        // Retry there without treating malformed legacy or committed data as empty.
        const children = await SAF.readDirectoryAsync(remoteDir);
        const unpublishedOnly = children.length > 0
          && children.every((uri) => safDocumentName(uri) === '.revisions')
          && (await committedRevisions(remoteDir)).length === 0;
        if (!unpublishedOnly) throw new Error('Unreadable folder project');
      }
      if (remoteMeta && remoteMeta.id !== meta.id) throw new Error('Unreadable folder project');
      if (useChat.getState().sessions[meta.id]?.busy) continue;
      const local = await localDigest(meta.id);
      const remote = remoteMeta && remoteDir ? await remoteDigest(remoteMeta, remoteDir) : null;
      const key = baselineKey(root, meta.id);
      const base = await AsyncStorage.getItem(key);
      const direction = contentSyncAction(local, remote, base);
      if (direction === 'conflict') {
        summary.conflicts += 1;
        continue;
      }
      if (direction === 'equal') {
        if (local) await AsyncStorage.setItem(key, local);
        continue;
      }
      // Do not overwrite a project edited while the provider read was pending.
      if (useChat.getState().sessions[meta.id]?.busy || await localDigest(meta.id) !== local) {
        summary.conflicts += 1;
        continue;
      }
      if (remoteMeta && remoteDir && await remoteDigest(remoteMeta, remoteDir) !== remote) {
        summary.conflicts += 1;
        continue;
      }
      if (direction === 'push') {
        await pushProject(meta, root);
        // Only acknowledge content actually read back from the user's folder.
        const writtenDir = await childByName(root, meta.id);
        const writtenMeta = writtenDir ? await readRemoteMeta(writtenDir) : null;
        if (!writtenDir || !writtenMeta || await remoteDigest(writtenMeta, writtenDir) !== local) throw new Error('Folder verification failed');
        await AsyncStorage.setItem(key, local!);
        summary.pushed += 1;
      } else if (direction === 'pull' && remoteMeta && remoteDir) {
        await pullProject(remoteMeta, remoteDir);
        if (await localDigest(meta.id) !== remote) throw new Error('Local verification failed');
        await AsyncStorage.setItem(key, remote!);
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

  const summary: SyncSummary = { pushed: 0, pulled: 0, imported: 0, failed: 0, conflicts: 0 };
  const localIds = new Set((await listProjects()).map((p) => p.id));
  for (const child of await listChildren(root)) {
    const id = safDocumentName(child);
    if (localIds.has(id)) continue;
    try {
      if (!(await isSafDirectory(child))) continue;
      const remoteMeta = await readRemoteMeta(child);
      if (!remoteMeta || remoteMeta.id !== id) continue; // stranger folders aren't ours
      await pullProject(remoteMeta, child);
      const digest = await localDigest(id);
      if (digest) await AsyncStorage.setItem(baselineKey(root, id), digest);
      summary.imported += 1;
    } catch {
      summary.failed += 1;
    }
  }
  return summary;
}

export interface FolderConflict { id: string; name: string; local: string; remote: string; }

/** Re-read actual content; conflict prompts never rely on cached counts. */
export async function listFolderConflicts(): Promise<FolderConflict[]> {
  if (!isAndroid) return [];
  const root = await appRoot();
  if (!root) return [];
  const result: FolderConflict[] = [];
  for (const meta of await listProjects()) {
    const dir = await childByName(root, meta.id);
    const remoteMeta = dir ? await readRemoteMeta(dir) : null;
    if (!dir || !remoteMeta || remoteMeta.id !== meta.id) continue;
    const local = await localDigest(meta.id);
    const remote = await remoteDigest(remoteMeta, dir);
    if (local && contentSyncAction(local, remote, await AsyncStorage.getItem(baselineKey(root, meta.id))) === 'conflict') {
      result.push({ id: meta.id, name: meta.name, local, remote });
    }
  }
  return result;
}

/** Keep the local original and preserve the folder version as a separate project on both sides. */
export async function keepBothFolderCopies(conflict: FolderConflict): Promise<string> {
  if (!isAndroid || syncInFlight) throw new Error('Wait for the current sync to finish.');
  syncInFlight = true;
  try {
    const root = await appRoot();
    if (!root) throw new Error('Reconnect your sync folder first.');
    const dir = await childByName(root, conflict.id);
    const remoteMeta = dir ? await readRemoteMeta(dir) : null;
    if (!dir || !remoteMeta || remoteMeta.id !== conflict.id) throw new Error('The folder copy is unavailable.');
    if (useChat.getState().sessions[conflict.id]?.busy || await localDigest(conflict.id) !== conflict.local || await remoteDigest(remoteMeta, dir) !== conflict.remote) {
      throw new Error('This project changed. Review its copies again.');
    }
    const id = newId();
    if (await readProject(id) || await childByName(root, id)) throw new Error('Could not allocate a new copy. Try again.');
    // A duplicate must not inherit publishing or AI connection identities.
    const copy: ProjectMeta = { id, name: `${remoteMeta.name} (folder copy)`, description: remoteMeta.description, emoji: remoteMeta.emoji, createdAt: Date.now(), updatedAt: remoteMeta.updatedAt };
    const expected = await remoteDigest(copy, dir);
    await pullProject(copy, dir);
    if (await localDigest(id) !== expected) throw new Error('Could not verify the new copy. The originals are unchanged.');
    await pushProject(copy, root);
    const savedDir = await childByName(root, id);
    const savedMeta = savedDir ? await readRemoteMeta(savedDir) : null;
    if (!savedDir || !savedMeta || await remoteDigest(savedMeta, savedDir) !== expected) throw new Error('The new copy is local, but its folder save needs retrying.');
    await AsyncStorage.setItem(baselineKey(root, id), expected);
    // Only release the original conflict after the second version is durable
    // and neither original changed during the copy operation.
    const currentRemote = await readRemoteMeta(dir);
    if (!currentRemote || await remoteDigest(currentRemote, dir) !== conflict.remote || await localDigest(conflict.id) !== conflict.local) {
      throw new Error('Both copies were saved, but the original changed again. Review it once more.');
    }
    await AsyncStorage.setItem(baselineKey(root, conflict.id), conflict.remote);
    return id;
  } finally { syncInFlight = false; }
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
      conflicts: mirrored.conflicts + (imported?.conflicts ?? 0),
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
