/**
 * Project storage on the device filesystem.
 *
 * Layout (under the app's document directory, backed up by the OS):
 *   projects/
 *     <id>/
 *       project.json   — ProjectMeta
 *       chat.json      — ChatMessage[]
 *       files/         — the generated web app (index.html, ...)
 *       media/         — generated images/videos referenced by chat
 */
import { Directory, File, Paths } from 'expo-file-system';

import type { ChatMessage, ProjectFile, ProjectMeta } from '@/lib/types';

/**
 * First-release storage is deliberately local-only. Ordinary OS file sharing,
 * import, export, and Android's user-picked folder sync remain separate paths.
 */
const localRoot = () => new Directory(Paths.document, 'projects');
const projectsRoot = localRoot;

/** Root of the on-device Media Lab gallery. */
export function mediaLabRoot(): Directory {
  const dir = new Directory(Paths.document, 'media-lab');
  if (!dir.exists) dir.create({ intermediates: true });
  return dir;
}

function projectDir(id: string): Directory {
  return new Directory(projectsRoot(), id);
}

function filesDir(id: string): Directory {
  return new Directory(projectDir(id), 'files');
}

export function mediaDir(id: string): Directory {
  const dir = new Directory(projectDir(id), 'media');
  if (!dir.exists) dir.create({ intermediates: true });
  return dir;
}

export function filesRootUri(id: string): string {
  return filesDir(id).uri;
}

export function newId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

// ---------------------------------------------------------------------------
// Meta
// ---------------------------------------------------------------------------

export async function listProjects(): Promise<ProjectMeta[]> {
  const root = projectsRoot();
  if (!root.exists) return [];
  const metas: ProjectMeta[] = [];
  for (const entry of root.list()) {
    if (!(entry instanceof Directory)) continue;
    const metaFile = new File(entry, 'project.json');
    if (!metaFile.exists) continue;
    try {
      metas.push(JSON.parse(await metaFile.text()) as ProjectMeta);
    } catch {
      // Skip corrupt project metadata rather than failing the whole list.
    }
  }
  return metas.sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function readProject(id: string): Promise<ProjectMeta | null> {
  const metaFile = new File(projectDir(id), 'project.json');
  if (!metaFile.exists) return null;
  try {
    return JSON.parse(await metaFile.text()) as ProjectMeta;
  } catch {
    return null;
  }
}

export async function writeProject(meta: ProjectMeta): Promise<void> {
  const dir = projectDir(meta.id);
  if (!dir.exists) dir.create({ intermediates: true });
  new File(dir, 'project.json').write(JSON.stringify(meta, null, 2));
}

export async function createProject(name: string, emoji: string): Promise<ProjectMeta> {
  const now = Date.now();
  const meta: ProjectMeta = {
    id: newId(),
    name,
    emoji,
    description: '',
    createdAt: now,
    updatedAt: now,
  };
  await writeProject(meta);
  filesDir(meta.id).create({ intermediates: true });
  await writeChat(meta.id, []);
  return meta;
}

/** Total bytes a project occupies on disk (files, chat, media, meta). */
export async function projectSizeBytes(id: string): Promise<number> {
  return dirSizeBytes(projectDir(id));
}

function dirSizeBytes(dir: Directory): number {
  if (!dir.exists) return 0;
  let total = 0;
  for (const entry of dir.list()) {
    if (entry instanceof Directory) total += dirSizeBytes(entry);
    else total += entry.size ?? 0;
  }
  return total;
}

export async function deleteProject(id: string): Promise<void> {
  const dir = projectDir(id);
  if (dir.exists) dir.delete();
}

export async function touchProject(id: string): Promise<void> {
  const meta = await readProject(id);
  if (!meta) return;
  meta.updatedAt = Date.now();
  await writeProject(meta);
}

// ---------------------------------------------------------------------------
// Chat
// ---------------------------------------------------------------------------

export async function readChat(id: string): Promise<ChatMessage[]> {
  const file = new File(projectDir(id), 'chat.json');
  if (!file.exists) return [];
  try {
    return JSON.parse(await file.text()) as ChatMessage[];
  } catch {
    return [];
  }
}

export async function writeChat(id: string, messages: ChatMessage[]): Promise<void> {
  const dir = projectDir(id);
  if (!dir.exists) dir.create({ intermediates: true });
  new File(dir, 'chat.json').write(JSON.stringify(messages));
}

// ---------------------------------------------------------------------------
// App files
// ---------------------------------------------------------------------------

const BINARY_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'ico', 'mp3', 'mp4', 'wav', 'woff', 'woff2', 'ttf']);

export function isBinaryPath(path: string): boolean {
  const ext = path.split('.').pop()?.toLowerCase() ?? '';
  return BINARY_EXTENSIONS.has(ext);
}

function collectFiles(dir: Directory, prefix: string, out: ProjectFile[]): Promise<void>[] {
  const pending: Promise<void>[] = [];
  for (const entry of dir.list()) {
    if (entry instanceof Directory) {
      pending.push(...collectFiles(entry, `${prefix}${entry.name}/`, out));
    } else {
      const path = `${prefix}${entry.name}`;
      if (isBinaryPath(path)) {
        pending.push(
          entry.base64().then((content) => {
            out.push({ path, content, encoding: 'base64' });
          })
        );
      } else {
        pending.push(
          entry.text().then((content) => {
            out.push({ path, content, encoding: 'utf-8' });
          })
        );
      }
    }
  }
  return pending;
}

export async function listFiles(id: string): Promise<ProjectFile[]> {
  const dir = filesDir(id);
  if (!dir.exists) return [];
  const out: ProjectFile[] = [];
  await Promise.all(collectFiles(dir, '', out));
  return out.sort((a, b) => a.path.localeCompare(b.path));
}

export interface ProjectFileManifestEntry {
  path: string;
  encoding: 'utf-8' | 'base64';
  bytes: number;
}

function collectFileManifest(dir: Directory, prefix: string, out: ProjectFileManifestEntry[]): void {
  for (const entry of dir.list()) {
    if (entry instanceof Directory) {
      collectFileManifest(entry, `${prefix}${entry.name}/`, out);
    } else {
      const path = `${prefix}${entry.name}`;
      out.push({ path, encoding: isBinaryPath(path) ? 'base64' : 'utf-8', bytes: entry.size });
    }
  }
}

/** Metadata-only listing for agent manifests; file contents are never loaded. */
export async function listProjectFileManifest(id: string): Promise<ProjectFileManifestEntry[]> {
  const dir = filesDir(id);
  if (!dir.exists) return [];
  const out: ProjectFileManifestEntry[] = [];
  collectFileManifest(dir, '', out);
  return out.sort((a, b) => a.path.localeCompare(b.path));
}

export function assertProjectFilePathContained(id: string, path: string): void {
  const root = filesDir(id).uri.replace(/\/?$/, '/');
  const target = new File(filesDir(id), ...path.split('/')).uri;
  if (!target.startsWith(root)) {
    throw new Error('Project path resolves outside the project root.');
  }
}

export async function getProjectFileInfo(id: string, path: string): Promise<ProjectFileManifestEntry | null> {
  assertProjectFilePathContained(id, path);
  const file = new File(filesDir(id), ...path.split('/'));
  if (!file.exists) return null;
  return { path, encoding: isBinaryPath(path) ? 'base64' : 'utf-8', bytes: file.size };
}

export async function readFile(id: string, path: string): Promise<string | null> {
  assertProjectFilePathContained(id, path);
  const file = new File(filesDir(id), ...path.split('/'));
  if (!file.exists) return null;
  return file.text();
}

/** Strict Agent Connect read: malformed UTF-8 is rejected, never replaced or base64-encoded. */
export async function readAgentUtf8File(id: string, path: string): Promise<string | null> {
  assertProjectFilePathContained(id, path);
  const file = new File(filesDir(id), ...path.split('/'));
  if (!file.exists) return null;
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(await file.bytes());
  } catch {
    throw new Error('read_project_file supports valid UTF-8 text files only.');
  }
}

export async function writeFile(id: string, path: string, content: string): Promise<void> {
  writeFileWithoutTouch(id, path, content);
  await touchProject(id);
}

/** Internal transaction primitive: callers must touch metadata after commit. */
export function writeFileWithoutTouch(id: string, path: string, content: string): void {
  assertProjectFilePathContained(id, path);
  const segments = path.split('/').filter(Boolean);
  let dir = filesDir(id);
  if (!dir.exists) dir.create({ intermediates: true });
  for (const segment of segments.slice(0, -1)) {
    dir = new Directory(dir, segment);
    if (!dir.exists) dir.create();
  }
  new File(dir, segments[segments.length - 1]).write(content);
}

export async function deleteFile(id: string, path: string): Promise<void> {
  deleteFileWithoutTouch(id, path);
  await touchProject(id);
}

/** Internal transaction primitive: callers must touch metadata after commit. */
export function deleteFileWithoutTouch(id: string, path: string): void {
  assertProjectFilePathContained(id, path);
  const file = new File(filesDir(id), ...path.split('/'));
  if (file.exists) file.delete();
}

/**
 * Write a binary (base64) asset into the project's files tree (e.g.
 * assets/img-1.png) so generated apps can reference it; returns its URI.
 */
export async function writeBinaryFile(id: string, path: string, base64: string): Promise<string> {
  const segments = path.split('/').filter(Boolean);
  let dir = filesDir(id);
  if (!dir.exists) dir.create({ intermediates: true });
  for (const segment of segments.slice(0, -1)) {
    dir = new Directory(dir, segment);
    if (!dir.exists) dir.create();
  }
  const file = new File(dir, segments[segments.length - 1]);
  file.write(base64ToBytes(base64));
  await touchProject(id);
  return file.uri;
}

/** Write a binary (base64) asset into the project's media dir; returns its URI. */
export function writeMedia(id: string, name: string, base64: string): string {
  const file = new File(mediaDir(id), name);
  file.write(base64ToBytes(base64));
  return file.uri;
}

function base64ToBytes(base64: string): Uint8Array {
  const binary = globalThis.atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
