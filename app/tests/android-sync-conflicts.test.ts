import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
const f = vi.hoisted(() => ({ meta: { id: 'p1', name: 'Project', emoji: '📦', createdAt: 1, updatedAt: 10 }, remoteText: 'remote edit', failRead: false, storage: new Map<string, string>(), write: vi.fn(), remove: vi.fn(), localWrite: vi.fn() }));
vi.mock('react-native', () => ({ Platform: { OS: 'android' } }));
vi.mock('expo-crypto', () => ({ CryptoDigestAlgorithm: { SHA256: 'SHA256' }, digestStringAsync: async (_: string, value: string) => createHash('sha256').update(value).digest('hex') }));
vi.mock('@react-native-async-storage/async-storage', () => ({ default: { getItem: async (key: string) => f.storage.get(key) ?? null, setItem: async (key: string, value: string) => { f.storage.set(key, value); } } }));
vi.mock('@/lib/storage/settings', () => ({ getAndroidSyncFolder: async () => 'content://tree', setAndroidSyncFolder: vi.fn() }));
vi.mock('@/lib/chat-engine', () => ({ useChat: { getState: () => ({ sessions: {}, bumpFiles: vi.fn() }), subscribe: vi.fn() } }));
vi.mock('@/lib/storage/projects', () => ({ withSyncRecovery: async (_: string, replace: () => Promise<void>) => replace(), listProjects: async () => [f.meta], readProject: async () => f.meta, readChat: async () => [], listFiles: async () => [{ path: 'index.html', content: 'local edit' }], isBinaryPath: () => false, deleteProject: f.localWrite, writeChat: f.localWrite, writeFile: f.localWrite, writeBinaryFile: f.localWrite, writeProject: f.localWrite }));
vi.mock('expo-file-system/legacy', () => ({ EncodingType: { UTF8: 'utf8', Base64: 'base64' }, StorageAccessFramework: {
  readDirectoryAsync: async (uri: string) => {
    if (uri === 'content://tree') return ['content://tree/VibeXStudio'];
    if (uri.endsWith('/VibeXStudio')) return [`${uri}/p1`];
    if (uri.endsWith('/p1')) return [`${uri}/project.json`, `${uri}/chat.json`, `${uri}/files`];
    if (uri.endsWith('/files')) { if (f.failRead) throw new Error('Folder offline'); return [`${uri}/index.html`]; }
    throw new Error('Not a directory');
  },
  readAsStringAsync: async (uri: string) => uri.endsWith('project.json') ? JSON.stringify(f.meta) : uri.endsWith('chat.json') ? '[]' : f.remoteText,
  writeAsStringAsync: f.write, deleteAsync: f.remove, makeDirectoryAsync: f.write, createFileAsync: f.write,
} }));
const { mirrorAllProjects, listFolderConflicts, keepBothFolderCopies } = await import('../src/lib/sync/android-folder-sync');
beforeEach(() => { f.storage.clear(); f.remoteText = 'remote edit'; f.failRead = false; vi.clearAllMocks(); });
describe('Android folder conflict integration', () => {
  it('keeps different existing content intact even when timestamps match', async () => {
    expect((await mirrorAllProjects())?.conflicts).toBe(1);
    expect(f.write).not.toHaveBeenCalled(); expect(f.remove).not.toHaveBeenCalled(); expect(f.localWrite).not.toHaveBeenCalled();
  });
  it('refuses a stale keep-both request without modifying either copy', async () => {
    const [conflict] = await listFolderConflicts();
    expect(conflict.name).toBe('Project');
    f.remoteText = 'edited after review';
    await expect(keepBothFolderCopies(conflict)).rejects.toThrow('changed');
    expect(f.write).not.toHaveBeenCalled(); expect(f.localWrite).not.toHaveBeenCalled();
    expect((await mirrorAllProjects())?.conflicts).toBe(1);
  });
  it('establishes a baseline only when full copies match', async () => {
    f.remoteText = 'local edit';
    expect((await mirrorAllProjects())?.conflicts).toBe(0);
    expect(f.storage.size).toBe(1); expect(f.write).not.toHaveBeenCalled();
  });
  it('does not treat failed directory reads as empty projects', async () => {
    f.failRead = true;
    expect((await mirrorAllProjects())?.failed).toBe(1);
    expect(f.localWrite).not.toHaveBeenCalled(); expect(f.write).not.toHaveBeenCalled(); expect(f.storage.size).toBe(0);
  });
});
