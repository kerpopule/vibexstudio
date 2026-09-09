import { libraryAssetPath, libraryOrigin, parseRemoteLibrary, type RemoteLibraryAsset } from '@/lib/library-core';
import { getLibraryToken, setLibraryToken } from '@/lib/storage/secrets';
import { decodeSpriteExport } from '@/lib/sprite-export';

async function request<T>(origin: string, path: string, init: RequestInit, read: (response: Response) => Promise<T>, timeout = 20_000): Promise<T> {
  const url = libraryOrigin(origin) + path;
  const controller = new AbortController();
  const cancel = () => controller.abort();
  if (init.signal?.aborted) cancel();
  else init.signal?.addEventListener('abort', cancel, {once:true});
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    let response: Response;
    try {
      response = await fetch(url, { ...init, credentials:'omit', redirect:'error', signal:controller.signal });
    } catch (error) {
      if (init.signal?.aborted) throw error;
      throw new Error(controller.signal.aborted
        ? 'Media Lab took too long to respond. Refresh the library to try again.'
        : 'Could not reach Media Lab. Check your connection and server address, then refresh the library.');
    }
    if (!response.ok) {
      if (response.status === 401 || response.status === 403) throw new Error('Enter your Media Lab access code to connect its library.');
      if (response.status === 404) throw new Error('Update your Media Lab server to use its library in Studio.');
      if (response.status === 413) throw new Error(path.includes('portable=1') ? 'This 3D model is too large to import. Export a GLB smaller than 64 MiB.' : 'The selected creations are too large for this operation. Select fewer or smaller files.');
      if (response.status === 422) throw new Error(path.includes('portable=1') ? 'This model cannot be copied as a portable project asset. Export a GLB with embedded resources and no extensions.' : 'Media Lab could not use this selection. Refresh the library and check the selected file types.');
      if (response.status === 429) throw new Error('Media Lab is busy. Wait a moment and try again.');
      throw new Error(`Media Lab could not complete the request (${response.status}).`);
    }
    return await read(response);
  } finally { clearTimeout(timer); init.signal?.removeEventListener('abort', cancel); }
}
export async function connectRemoteLibrary(origin: string, code: string): Promise<void> {
  const data = await request(origin, '/api/gate', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({code,studio_library:true})}, (r) => r.json());
  if (data.scope !== 'library:read' || typeof data.token !== 'string' || !data.token.startsWith('mlab-library-v1.')) throw new Error('Update your Media Lab server to use its library in Studio.');
  await setLibraryToken(libraryOrigin(origin), data.token);
}
async function headers(origin: string): Promise<Record<string,string>> {
  const token = await getLibraryToken(libraryOrigin(origin));
  if (!token) throw new Error('Connect your Media Lab library with its access code.');
  return {Authorization:`Bearer ${token}`};
}
export async function listRemoteLibrary(origin: string, timeout = 20_000): Promise<RemoteLibraryAsset[]> {
  const data = await request(origin, '/api/studio/library', {headers:await headers(origin)}, (r) => r.json(), timeout);
  return parseRemoteLibrary(data, origin);
}
export async function readRemoteAsset(asset: RemoteLibraryAsset, signal?: AbortSignal): Promise<Uint8Array> {
  if (!Number.isSafeInteger(asset.bytes) || asset.bytes <= 0) throw new Error('Refresh the library before downloading this creation.');
  if (asset.kind === 'model' && asset.bytes > 64 * 1024 * 1024) throw new Error('This 3D model is too large to import. Export a GLB smaller than 64 MiB.');
  const buffer = await request(asset.serverUrl, libraryAssetPath(asset.id)+(asset.kind === 'model' ? '?portable=1' : ''), {headers:await headers(asset.serverUrl), signal}, (r) => {
    if (asset.kind === 'model' && r.headers.get('X-Studio-Portable') !== 'glb-v1') throw new Error('Update your Media Lab server to verify portable 3D imports.');
    return readAssetBody(r, asset.bytes);
  }, 300_000);
  const bytes = new Uint8Array(buffer);
  if (!bytes.length || bytes.length !== asset.bytes) throw new Error('The creation changed or did not download completely. Refresh the library and try again.');
  return bytes;
}

async function readAssetBody(response: Response, expected: number): Promise<Uint8Array> {
  const failure = 'The creation changed or did not download completely. Refresh the library and try again.';
  const declared = response.headers.get('Content-Length');
  // A compressed representation can have a different wire length from decoded bytes.
  if (declared !== null && !response.headers.get('Content-Encoding') && Number(declared) !== expected) {
    await response.body?.cancel().catch(() => {});
    throw new Error(failure);
  }
  const reader = response.body?.getReader?.();
  // Some native fetch implementations expose only arrayBuffer; verify after reading there.
  if (!reader) return new Uint8Array(await response.arrayBuffer());
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const {done, value} = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > expected) throw new Error(failure);
      chunks.push(value);
    }
    if (total !== expected) throw new Error(failure);
    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return bytes;
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw error;
  } finally { reader.releaseLock(); }
}

export async function readRemotePreview(asset: RemoteLibraryAsset, signal?: AbortSignal): Promise<Uint8Array> {
  return request(asset.serverUrl, libraryAssetPath(asset.id).replace(/\/content$/, '/preview'),
    {headers:await headers(asset.serverUrl), signal}, async (response) => {
      const length = Number(response.headers.get('Content-Length'));
      if (!length || length > 2 * 1024 * 1024 || !response.headers.get('Content-Type')?.startsWith('image/png')) throw new Error('Preview unavailable.');
      return new Uint8Array(await response.arrayBuffer());
    });
}

export async function exportRemoteSprites(assets: RemoteLibraryAsset[]) {
  if (!assets.length || assets.length > 64 || assets.some((asset) => asset.mimeType !== 'image/png' ||
      libraryOrigin(asset.serverUrl) !== libraryOrigin(assets[0].serverUrl))) throw new Error('Choose up to 64 PNG frames from one server.');
  const origin = assets[0].serverUrl;
  const data = await request(origin, '/api/studio/library/sprites', {
    method:'POST', headers:{...await headers(origin),'Content-Type':'application/json'},
    body:JSON.stringify({assetIds:assets.map((asset) => asset.id)}),
  }, (response) => response.json(), 120_000);
  return decodeSpriteExport(data);
}

export async function listSavedCollection(origin:string, name:import('@/lib/saved-collections').CollectionName, signal?:AbortSignal) {
  if(!['characters','voices','storyboards'].includes(name)) throw new Error('Choose a saved collection.');
  const {parseSavedCollection}=await import('@/lib/saved-collections');
  const data=await request(origin,`/api/studio/collections/${name}`,{headers:await headers(origin),signal},async response=>{
    const value=await response.text();
    if(value.length>8*1024*1024) throw new Error('This saved collection is too large to open.');
    return JSON.parse(value);
  });
  return parseSavedCollection(data,name);
}
