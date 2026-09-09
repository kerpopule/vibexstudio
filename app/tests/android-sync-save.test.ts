import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
const f = vi.hoisted(() => ({
  remote: new Map<string, string | null>(), local: new Map<string, { meta: any; chat: any[]; files: any[] }>(), settings: new Map<string, string>(), failWrite: false, failCommit: false, serial: 0,
}));
const root = 'content://tree/VibeXStudio';
vi.mock('react-native', () => ({ Platform: { OS: 'android' } }));
vi.mock('expo-crypto', () => ({ CryptoDigestAlgorithm: { SHA256: 'sha256' }, getRandomBytes: () => new Uint8Array(16).fill(++f.serial), digestStringAsync: async (_: string, text: string) => createHash('sha256').update(text).digest('hex') }));
vi.mock('@react-native-async-storage/async-storage', () => ({ default: { getItem: async (key: string) => f.settings.get(key) ?? null, setItem: async (key: string, value: string) => { f.settings.set(key, value); } } }));
vi.mock('@/lib/storage/settings', () => ({ getAndroidSyncFolder: async () => 'content://tree', setAndroidSyncFolder: vi.fn() }));
vi.mock('@/lib/chat-engine', () => ({ useChat: { getState: () => ({ sessions: {}, bumpFiles: vi.fn() }), subscribe: vi.fn() } }));
vi.mock('@/lib/storage/projects', () => {
  const project = (id: string) => { if (!f.local.has(id)) f.local.set(id, { meta: null, chat: [], files: [] }); return f.local.get(id)!; };
  const write = async (id: string, path: string, content: string, encoding = 'utf-8') => {
    const p = project(id); p.files = p.files.filter((file) => file.path !== path); p.files.push({ path, content, encoding });
  };
  return { withSyncRecovery: async (_: string, replace: () => Promise<void>) => replace(), newId: () => 'copy1', listProjects: async () => [...f.local.values()].map((p) => p.meta).filter(Boolean), readProject: async (id: string) => f.local.get(id)?.meta ?? null, readChat: async (id: string) => project(id).chat, listFiles: async (id: string) => project(id).files,
    isBinaryPath: (path: string) => path.endsWith('.png'), deleteProject: async (id: string) => { f.local.delete(id); }, writeChat: async (id: string, chat: any[]) => { project(id).chat = chat; }, writeFile: write, writeBinaryFile: async (id: string, path: string, content: string) => write(id, path, content, 'base64'), writeProject: async (meta: any) => { project(meta.id).meta = meta; } };
});
vi.mock('expo-file-system/legacy', () => ({ EncodingType: { UTF8: 'utf8', Base64: 'base64' }, StorageAccessFramework: {
  readDirectoryAsync: async (uri: string) => { if (f.remote.get(uri) !== null) throw new Error('Not a directory'); return [...f.remote.keys()].filter((key) => key.startsWith(`${uri}/`) && !key.slice(uri.length + 1).includes('/')); },
  readAsStringAsync: async (uri: string) => { const value = f.remote.get(uri); if (typeof value !== 'string') throw new Error('Missing file'); return value; },
  makeDirectoryAsync: async (uri: string, name: string) => { const path = `${uri}/${name}`; f.remote.set(path, null); return path; },
  createFileAsync: async (uri: string, name: string) => { const path = `${uri}/${name}`; f.remote.set(path, ''); return path; },
  writeAsStringAsync: async (uri: string, value: string) => { if (f.failWrite || (f.failCommit && uri.endsWith('/commit.json'))) throw new Error('Offline'); f.remote.set(uri, value); },
  deleteAsync: async (uri: string) => { for (const key of f.remote.keys()) if (key === uri || key.startsWith(`${uri}/`)) f.remote.delete(key); },
} }));
const { listFolderConflicts, keepBothFolderCopies, syncNow } = await import('../src/lib/sync/android-folder-sync');
beforeEach(() => {
  f.local.clear(); f.remote.clear(); f.settings.clear(); f.failWrite = false; f.failCommit = false; f.serial = 0;
  const meta = { id: 'p1', name: 'Project', description: '', emoji: '📦', createdAt: 1, updatedAt: 10, github: { repo: 'original-only' }, ai: { connectionId: 'private', model: 'model' } };
  f.local.set('p1', { meta, chat: [], files: [{ path: 'index.html', content: 'local edit', encoding: 'utf-8' }] });
  for (const dir of ['content://tree', root, `${root}/p1`, `${root}/p1/files`]) f.remote.set(dir, null);
  f.remote.set(`${root}/p1/project.json`, JSON.stringify(meta)); f.remote.set(`${root}/p1/chat.json`, '[]'); f.remote.set(`${root}/p1/files/index.html`, 'folder edit'); f.remote.set(`${root}/p1/files/sprite.png`, 'AQID');
});
describe('keep both full storage integration', () => {
  it('saves both versions and syncs the original without losing the remote version', async () => {
    const [conflict] = await listFolderConflicts();
    expect(await keepBothFolderCopies(conflict)).toBe('copy1');
    expect(f.local.get('p1')?.files[0].content).toBe('local edit');
    expect(f.local.get('copy1')?.files.find((file) => file.path === 'sprite.png')).toMatchObject({ content: 'AQID', encoding: 'base64' });
    expect(f.local.get('copy1')?.meta.github).toBeUndefined(); expect(f.local.get('copy1')?.meta.ai).toBeUndefined();
    expect([...f.remote.entries()].find(([key]) => key.startsWith(`${root}/copy1/.revisions/`) && key.endsWith('/files/index.html'))?.[1]).toBe('folder edit');
    const result = await syncNow(); expect(result?.failed).toBe(0); expect(result?.conflicts).toBe(0);
    expect([...f.remote.entries()].find(([key]) => key.startsWith(`${root}/p1/.revisions/`) && key.endsWith('/files/index.html'))?.[1]).toBe('local edit');
    expect(f.remote.get(`${root}/p1/files/index.html`)).toBe('folder edit');
    expect([...f.remote.entries()].find(([key]) => key.startsWith(`${root}/copy1/.revisions/`) && key.endsWith('/files/index.html'))?.[1]).toBe('folder edit');
  });
  it('ignores an interrupted commit and retries without deleting the prior revision', async () => {
    await keepBothFolderCopies((await listFolderConflicts())[0]);
    await syncNow();
    const commits = [...f.remote.entries()].filter(([key, value]) => key.startsWith(`${root}/p1/`) && key.endsWith('/commit.json') && value);
    f.local.get('p1')!.files[0].content = 'second local edit';
    f.failCommit = true;
    expect((await syncNow())?.failed).toBe(1);
    for (const [key, value] of commits) expect(f.remote.get(key)).toBe(value);
    f.failCommit = false;
    expect((await syncNow())?.failed).toBe(0);
    expect((await listFolderConflicts()).length).toBe(0);
    for (const [key, value] of commits) expect(f.remote.get(key)).toBe(value);
  });
  it('recovers a failed first publication without deleting its partial revision', async () => {
    for (const key of f.remote.keys()) if (key.startsWith(`${root}/p1`)) f.remote.delete(key);
    f.failCommit = true;
    expect((await syncNow())?.failed).toBe(1);
    const partial = [...f.remote.keys()].find((key) => key.endsWith('/files/index.html'))!;
    expect(f.remote.get(partial)).toBe('local edit');
    f.failCommit = false;
    const retried = await syncNow();
    expect(retried?.failed).toBe(0); expect(retried?.pushed).toBe(1);
    expect(f.remote.get(partial)).toBe('local edit');
    expect((await listFolderConflicts()).length).toBe(0);
  });
  it('refuses competing highest revisions instead of silently selecting a winner', async () => {
    await keepBothFolderCopies((await listFolderConflicts())[0]); await syncNow();
    const commit = [...f.remote.keys()].find((key) => key.startsWith(`${root}/p1/.revisions/`) && key.endsWith('/commit.json'))!;
    const directory = commit.slice(0, -'/commit.json'.length);
    const branch = `${root}/p1/.revisions/concurrent`;
    for (const [key, value] of [...f.remote]) if (key === directory || key.startsWith(`${directory}/`)) f.remote.set(key.replace(directory, branch), value);
    f.remote.set(`${branch}/files/index.html`, 'concurrent edit');
    const before = f.local.get('p1')!.files[0].content;
    expect((await syncNow())?.failed).toBe(1);
    expect(f.local.get('p1')!.files[0].content).toBe(before);
    expect(f.remote.get(`${branch}/files/index.html`)).toBe('concurrent edit');
  });
  it('retains both originals and the unresolved conflict when the new folder copy fails', async () => {
    const [conflict] = await listFolderConflicts(); f.failWrite = true;
    await expect(keepBothFolderCopies(conflict)).rejects.toThrow();
    expect(f.local.get('p1')?.files[0].content).toBe('local edit');
    expect(f.remote.get(`${root}/p1/files/index.html`)).toBe('folder edit');
    expect((await listFolderConflicts()).some((item) => item.id === 'p1')).toBe(true);
    expect([...f.settings.keys()].some((key) => key.endsWith(':p1'))).toBe(false);
  });
});
