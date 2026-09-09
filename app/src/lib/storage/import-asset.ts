import { mimeFor } from '@/lib/media-mime';
import { readImportSource } from '@/lib/storage/import-source';
import { writeBinaryFile, writeFile } from '@/lib/storage/projects';

export function assertAssetPath(path: string): void {
  if (!path.startsWith('assets/') || path.length > 200 ||
      !/^[\w. /-]+$/.test(path) || path.split('/').some((part) => !part || part === '.' || part === '..')) {
    throw new Error('Choose a file inside the project assets folder.');
  }
}

/** Copy bytes into the project so sharing never depends on the source machine. */
export async function importProjectAsset(projectId: string, path: string, sourceUri: string, signal?: AbortSignal): Promise<string> {
  assertAssetPath(path);
  if (!/^(https?:|blob:|data:|file:|content:)/i.test(sourceUri)) {
    throw new Error('This asset does not have a readable source.');
  }
  const bytes = await readImportSource(sourceUri, signal);
  if (signal?.aborted) throw new DOMException('Stopped', 'AbortError');
  return writeImportedAsset(projectId, path, bytes);
}

export async function writeImportedAsset(projectId: string, path: string, bytes: Uint8Array): Promise<string> {
  assertAssetPath(path);
  if (!bytes.length) throw new Error('The asset is empty. Nothing was imported.');
  if (/\.(txt|md|json|html?|css|[cm]?js|ts|tsx|jsx|csv|svg|xml|gltf)$/i.test(path)) {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    await writeFile(projectId, path, text);
    return `data:${mimeFor(path)};charset=utf-8,${encodeURIComponent(text)}`;
  }
  // Chunk conversion avoids overflowing the JS argument stack for videos.
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 8192) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
  }
  return writeBinaryFile(projectId, path, globalThis.btoa(binary));
}
