/**
 * Web/desktop implementation of project storage (Metro resolves `.web.ts`
 * over `.ts` on the web platform). expo-file-system's `File`/`Directory`
 * class API has no web backend, so everything persists to IndexedDB instead:
 *
 *   meta:<id>          — ProjectMeta
 *   chat:<id>          — ChatMessage[]
 *   file:<id>:<path>   — { content, encoding }
 *
 * Same exported surface as projects.ts. `filesRootUri` returns a synthetic
 * scheme (there is no filesystem URI on web); the web preview builds blob
 * URLs from listFiles() instead of loading file:// paths.
 */
import type { ChatMessage, ProjectFile, ProjectMeta } from '@/lib/types';

const DB_NAME = 'vibex-projects';
const STORE = 'kv';

let dbPromise: Promise<IDBDatabase> | null = null;

function db(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbPromise;
}

function tx(mode: IDBTransactionMode): Promise<IDBObjectStore> {
  return db().then((d) => d.transaction(STORE, mode).objectStore(STORE));
}

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function get<T>(key: string): Promise<T | undefined> {
  return request((await tx('readonly')).get(key)) as Promise<T | undefined>;
}

async function put(key: string, value: unknown): Promise<void> {
  await request((await tx('readwrite')).put(value, key));
}

async function del(key: string): Promise<void> {
  await request((await tx('readwrite')).delete(key));
}

/** All entries whose key starts with `prefix`, as [key, value] pairs. */
async function scan<T>(prefix: string): Promise<[string, T][]> {
  const store = await tx('readonly');
  const range = IDBKeyRange.bound(prefix, `${prefix}￿`);
  const [keys, values] = await Promise.all([
    request(store.getAllKeys(range)),
    request(store.getAll(range)),
  ]);
  return keys.map((k, i) => [String(k), values[i] as T]);
}

type StoredFile = { content: string; encoding: 'utf-8' | 'base64' };

const fileKey = (id: string, path: string) => `file:${id}:${path}`;

export function filesRootUri(id: string): string {
  return `vibex-idb://${id}/files`;
}

/** No iCloud container on web/desktop; sync is a desktop-roadmap item. */
export function cloudSyncActive(): boolean {
  return false;
}

export async function migrateLocalProjectsToCloud(): Promise<void> {}

export function newId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/** No filesystem on web — media lands in the files tree via writeMedia. */
export function mediaDir(id: string): { uri: string } {
  return { uri: `vibex-idb://${id}/media` };
}

// ---------------------------------------------------------------------------
// Meta
// ---------------------------------------------------------------------------

export async function listProjects(): Promise<ProjectMeta[]> {
  const rows = await scan<ProjectMeta>('meta:');
  return rows.map(([, meta]) => meta).sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function readProject(id: string): Promise<ProjectMeta | null> {
  return (await get<ProjectMeta>(`meta:${id}`)) ?? null;
}

export async function writeProject(meta: ProjectMeta): Promise<void> {
  await put(`meta:${meta.id}`, meta);
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
  await writeChat(meta.id, []);
  return meta;
}

export async function projectSizeBytes(id: string): Promise<number> {
  const files = await scan<StoredFile>(fileKey(id, ''));
  const chat = (await get<ChatMessage[]>(`chat:${id}`)) ?? [];
  return (
    files.reduce((sum, [, f]) => sum + f.content.length, 0) + JSON.stringify(chat).length
  );
}

export async function deleteProject(id: string): Promise<void> {
  const files = await scan<StoredFile>(fileKey(id, ''));
  await Promise.all(files.map(([key]) => del(key)));
  await del(`chat:${id}`);
  await del(`meta:${id}`);
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
  return (await get<ChatMessage[]>(`chat:${id}`)) ?? [];
}

export async function writeChat(id: string, messages: ChatMessage[]): Promise<void> {
  await put(`chat:${id}`, messages);
}

// ---------------------------------------------------------------------------
// App files
// ---------------------------------------------------------------------------

const BINARY_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'ico', 'mp3', 'mp4', 'wav', 'woff', 'woff2', 'ttf']);

export function isBinaryPath(path: string): boolean {
  const ext = path.split('.').pop()?.toLowerCase() ?? '';
  return BINARY_EXTENSIONS.has(ext);
}

export async function listFiles(id: string): Promise<ProjectFile[]> {
  const rows = await scan<StoredFile>(fileKey(id, ''));
  const prefix = fileKey(id, '');
  return rows
    .map(([key, f]) => ({ path: key.slice(prefix.length), content: f.content, encoding: f.encoding }))
    .sort((a, b) => a.path.localeCompare(b.path));
}

export async function readFile(id: string, path: string): Promise<string | null> {
  const f = await get<StoredFile>(fileKey(id, path));
  return f?.content ?? null;
}

export async function writeFile(id: string, path: string, content: string): Promise<void> {
  await put(fileKey(id, path), { content, encoding: 'utf-8' } satisfies StoredFile);
  await touchProject(id);
}

export async function deleteFile(id: string, path: string): Promise<void> {
  await del(fileKey(id, path));
  await touchProject(id);
}

export async function writeBinaryFile(id: string, path: string, base64: string): Promise<string> {
  await put(fileKey(id, path), { content: base64, encoding: 'base64' } satisfies StoredFile);
  await touchProject(id);
  return `${filesRootUri(id)}/${path}`;
}

export function writeMedia(id: string, name: string, base64: string): string {
  // Fire-and-forget parity with the sync native signature.
  void put(fileKey(id, `media/${name}`), { content: base64, encoding: 'base64' } satisfies StoredFile);
  return `${filesRootUri(id)}/media/${name}`;
}
