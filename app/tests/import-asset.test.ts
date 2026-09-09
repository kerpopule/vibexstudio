import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('@/lib/storage/import-source', () => ({ readImportSource: vi.fn() }));
vi.mock('@/lib/storage/projects', () => ({ writeBinaryFile: vi.fn(), writeFile: vi.fn() }));
import { readImportSource } from '@/lib/storage/import-source';
import { writeBinaryFile, writeFile } from '@/lib/storage/projects';
import { importProjectAsset } from '@/lib/storage/import-asset';
import { readImportSource as readWebSource } from '@/lib/storage/import-source.web';
beforeEach(() => { vi.resetAllMocks(); vi.unstubAllGlobals(); });
describe('portable project imports', () => {
  it.each(['../x', '/assets/a.png', 'assets/../a.png', 'assets//a.png', 'assets/./a', 'assets/%2e%2e/a', 'assets/a?token=x', 'assets/'])('rejects invalid target %s before fetching', async (path) => {
    await expect(importProjectAsset('p', path, 'https://example.org/a')).rejects.toThrow();
    expect(readImportSource).not.toHaveBeenCalled();
  });
  it('preserves every byte in a video larger than the encoding chunk', async () => {
    const bytes = Uint8Array.from({ length: 200_000 }, (_, i) => i % 256);
    vi.mocked(readImportSource).mockResolvedValue(bytes);
    vi.mocked(writeBinaryFile).mockResolvedValue('stored-video');
    await expect(importProjectAsset('p', 'assets/win.webm', 'blob:video')).resolves.toBe('stored-video');
    const [id, path, data] = vi.mocked(writeBinaryFile).mock.calls[0];
    expect([id, path]).toEqual(['p', 'assets/win.webm']);
    expect(new Uint8Array(Buffer.from(data, 'base64'))).toEqual(bytes);
  });
  it('keeps imported source files editable', async () => {
    vi.mocked(readImportSource).mockResolvedValue(new TextEncoder().encode('{"title":"Café"}'));
    await importProjectAsset('p', 'assets/scene.json', 'file:///scene.json');
    expect(writeFile).toHaveBeenCalledWith('p', 'assets/scene.json', '{"title":"Café"}');
    expect(writeBinaryFile).not.toHaveBeenCalled();
  });
  it('never overwrites after a failed download', async () => {
    vi.mocked(readImportSource).mockRejectedValue(new Error('offline'));
    await expect(importProjectAsset('p', 'assets/win.mp4', 'https://host/win.mp4')).rejects.toThrow('offline');
    expect(writeBinaryFile).not.toHaveBeenCalled();
    expect(writeFile).not.toHaveBeenCalled();
  });
  it('rejects empty assets and unsupported sources', async () => {
    vi.mocked(readImportSource).mockResolvedValue(new Uint8Array());
    await expect(importProjectAsset('p', 'assets/a.png', 'data:image/png;base64,')).rejects.toThrow('empty');
    await expect(importProjectAsset('p', 'assets/a.png', 'vibex-idb://old')).rejects.toThrow('readable');
    expect(writeBinaryFile).not.toHaveBeenCalled();
  });
  it('reads browser gallery data URLs', async () => {
    expect(await readWebSource('data:application/octet-stream;base64,AAH/')).toEqual(new Uint8Array([0, 1, 255]));
  });
  it('rejects HTTP errors before storing them as assets', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('Unauthorized', { status: 401 })));
    await expect(readWebSource('https://host/asset')).rejects.toThrow('401');
  });
});
