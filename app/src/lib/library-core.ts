import { mediaServerOrigin } from '@/lib/medialab-core';

const EXTENSIONS = {
  image:/\.(png|jpe?g|gif|webp|avif)$/i, video:/\.(mp4|webm|mov|mkv)$/i,
  audio:/\.(mp3|wav|flac|m4a|ogg)$/i, model:/\.glb$/i,
};
export interface RemoteLibraryAsset {
  id: string; kind: 'image' | 'video' | 'audio' | 'model'; title: string;
  prompt: string; createdAt: number; fileName: string; mimeType: string;
  folder?: string; bytes: number; hasPreview?: boolean; providerLabel: string; serverUrl: string;
}
export function libraryOrigin(value: string): string {
  const origin = mediaServerOrigin(value);
  if (!origin) throw new Error('Enter an HTTP or HTTPS Media Lab address without credentials.');
  return origin;
}
export function libraryAssetPath(id: string): string {
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(id)) throw new Error('Invalid library asset.');
  return `/api/studio/library/${id}/content`;
}
export function parseRemoteLibrary(data: unknown, origin: string): RemoteLibraryAsset[] {
  const envelope = data as { version?: unknown; assets?: unknown } | null;
  if (envelope?.version !== 1 || !Array.isArray(envelope.assets)) throw new Error('This server needs the Studio library update.');
  const items: RemoteLibraryAsset[] = [];
  const seen = new Set<string>();
  for (const item of envelope.assets) {
    if (!item || typeof item !== 'object') continue;
    const row = item as RemoteLibraryAsset;
    if (typeof row.id !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(row.id) || seen.has(row.id) ||
        !['image','video','audio','model'].includes(row.kind) || typeof row.fileName !== 'string' ||
        (!row.fileName || row.fileName.length > 240 || /[\\/\x00-\x1f:*?"<>|]/.test(row.fileName) || row.fileName === '.' || row.fileName === '..') || !Number.isFinite(row.bytes) || row.bytes < 0 ||
        typeof row.mimeType !== 'string' || !EXTENSIONS[row.kind].test(row.fileName)) continue;
    seen.add(row.id);
    items.push({ id:row.id, kind:row.kind, title:String(row.title || 'Untitled creation').slice(0,240),
      prompt:String(row.prompt || '').slice(0,2000), createdAt:Number.isFinite(row.createdAt) ? row.createdAt : 0,
      folder:typeof row.folder === 'string' && row.folder.length <= 1024 && !/[\\\x00-\x1f]/.test(row.folder) && row.folder.split('/').every(part => part && part !== '.' && part !== '..') ? row.folder : undefined,
      fileName:row.fileName, mimeType:row.mimeType, bytes:row.bytes, hasPreview:row.hasPreview === true,
      providerLabel:String(row.providerLabel || 'Media Lab').slice(0,100), serverUrl:libraryOrigin(origin) });
  }
  return items.sort((a,b)=>b.createdAt-a.createdAt);
}
