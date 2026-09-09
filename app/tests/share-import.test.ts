import { beforeEach, expect, it, vi } from 'vitest';

vi.mock('expo-file-system', () => ({ File: vi.fn() }));
vi.mock('@/lib/storage/projects', () => ({
  newId: () => 'import-only',
  readProject: vi.fn(),
  writeProject: vi.fn(),
  writeChat: vi.fn(),
  writeFile: vi.fn(),
  writeBinaryFile: vi.fn(),
  deleteProject: vi.fn(),
  replaceSyncedProject: vi.fn(),
}));

import * as storage from '@/lib/storage/projects';
import { encodeBundle } from '@/lib/share/bundle';
import { importBundleText } from '@/lib/share/importBundle';

const bundle = encodeBundle({ name: 'Shared game', emoji: '🎮', description: '', files: [
  { path: 'index.html', content: '<video src="assets/win.mp4"></video>', encoding: 'utf-8' },
  { path: 'assets/win.mp4', content: 'AAECAw==', encoding: 'base64' },
] }, 1234);

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(storage.readProject).mockResolvedValue(null);
});

it('imports text and binary content unchanged into one new project', async () => {
  const result = await importBundleText(bundle);
  expect(result.fileCount).toBe(2);
  expect(storage.writeFile).toHaveBeenCalledWith('import-only', 'index.html', '<video src="assets/win.mp4"></video>');
  expect(storage.writeBinaryFile).toHaveBeenCalledWith('import-only', 'assets/win.mp4', 'AAECAw==');
  expect(storage.deleteProject).not.toHaveBeenCalled();
});

it.each(['writeProject', 'writeChat', 'writeFile', 'writeBinaryFile'] as const)(
  'removes partial storage when %s fails', async (operation) => {
    const failure = new Error('Storage full');
    vi.mocked(storage[operation]).mockRejectedValueOnce(failure);
    await expect(importBundleText(bundle)).rejects.toBe(failure);
    expect(storage.deleteProject).toHaveBeenCalledExactlyOnceWith('import-only');
  }
);

it('reports cleanup failure while retaining the original cause', async () => {
  const failure = new Error('Storage full');
  vi.mocked(storage.writeBinaryFile).mockRejectedValueOnce(failure);
  vi.mocked(storage.deleteProject).mockRejectedValueOnce(new Error('Storage unavailable'));
  await expect(importBundleText(bundle)).rejects.toMatchObject({
    message: expect.stringContaining('incomplete project could not be removed'), cause: failure,
  });
});

it('refuses an existing project ID without writing or deleting it', async () => {
  vi.mocked(storage.readProject).mockResolvedValueOnce({ id: 'import-only' } as never);
  await expect(importBundleText(bundle)).rejects.toThrow(/try importing again/);
  expect(storage.writeProject).not.toHaveBeenCalled();
  expect(storage.deleteProject).not.toHaveBeenCalled();
});

it('validates malformed bundles before accessing storage', async () => {
  await expect(importBundleText('{}')).rejects.toThrow();
  expect(storage.readProject).not.toHaveBeenCalled();
  expect(storage.writeProject).not.toHaveBeenCalled();
  expect(storage.deleteProject).not.toHaveBeenCalled();
});

it('opens portable backups through the normal import flow without losing chat',async()=>{
 const {encodeProjectSnapshot,decodeProjectSnapshot}=await import('../src/lib/sync/project-snapshot');
 const raw=encodeProjectSnapshot({meta:{id:'source',name:'Backup',description:'',emoji:'✨',createdAt:1,updatedAt:2},chat:[{id:'m',role:'user',text:'Keep this chat',createdAt:1}],files:[{path:'image.png',content:'aGVsbG8=',encoding:'base64'}]});
 vi.mocked(storage.readProject).mockResolvedValueOnce({id:'import-only',name:'Backup (restored)'} as never);
 const result=await importBundleText(raw);expect(result.meta.id).toBe('import-only');expect(result.fileCount).toBe(1);
 const [saved,expected]=vi.mocked(storage.replaceSyncedProject).mock.calls[0];expect(expected).toBeNull();expect(decodeProjectSnapshot(saved).chat[0].text).toBe('Keep this chat');
 expect(storage.writeChat).not.toHaveBeenCalled();expect(storage.deleteProject).not.toHaveBeenCalled();
});
it('rejects malformed backup versions before any project replacement',async()=>{
 await expect(importBundleText('{"format":"vibex/project-snapshot","version":2}')).rejects.toThrow('Unsupported');
 expect(storage.replaceSyncedProject).not.toHaveBeenCalled();
});
