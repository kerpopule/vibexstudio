import { beforeEach, expect, it, vi } from 'vitest';
vi.mock('@/lib/storage/secrets',()=>({getLibraryToken:vi.fn(),setLibraryToken:vi.fn()}));
import { getLibraryToken, setLibraryToken } from '@/lib/storage/secrets';
import { connectRemoteLibrary, listRemoteLibrary, readRemoteAsset } from '@/lib/remote-library';
import { libraryOrigin, parseRemoteLibrary, type RemoteLibraryAsset } from '@/lib/library-core';
const asset: RemoteLibraryAsset = {id:'asset-1',kind:'image',title:'Badge',prompt:'badge',createdAt:1,fileName:'badge.png',mimeType:'image/png',bytes:3,providerLabel:'Media Lab',serverUrl:'https://spark.example'};
beforeEach(()=>{vi.resetAllMocks();vi.unstubAllGlobals();});
it('binds catalog assets to the requested host, ignoring supplied URLs',()=>{
 const items=parseRemoteLibrary({version:1,assets:[{...asset,serverUrl:'https://attacker.example',url:'https://attacker.example/private'}]},'https://spark.example/');
 expect(items[0].serverUrl).toBe('https://spark.example');
 expect(items[0]).not.toHaveProperty('url');
 expect(()=>libraryOrigin('https://user:password@spark.example')).toThrow();
});
it('rejects invalid IDs and names instead of constructing arbitrary downloads',()=>{
 expect(parseRemoteLibrary({version:1,assets:[{...asset,id:'../admin'}, {...asset,fileName:'../../secret'}]},asset.serverUrl)).toEqual([]);
});
it('stores only a scoped ticket for the exact server origin',async()=>{
 vi.stubGlobal('fetch',vi.fn().mockResolvedValue(new Response(JSON.stringify({scope:'library:read',token:'mlab-library-v1.test-ticket'}))));
 await connectRemoteLibrary('https://spark.example/', 'test-access-code');
 expect(setLibraryToken).toHaveBeenCalledWith('https://spark.example','mlab-library-v1.test-ticket');
 expect(fetch).toHaveBeenCalledWith('https://spark.example/api/gate',expect.objectContaining({credentials:'omit',redirect:'error'}));
});
it('never treats an old server cookie response as a library connection',async()=>{
 vi.stubGlobal('fetch',vi.fn().mockResolvedValue(new Response('{"ok":true,"role":"user"}')));
 await expect(connectRemoteLibrary(asset.serverUrl,'test-code')).rejects.toThrow('Update');
 expect(setLibraryToken).not.toHaveBeenCalled();
});
it('does not send a request when this host has no saved ticket',async()=>{
 vi.mocked(getLibraryToken).mockResolvedValue(null);
 vi.stubGlobal('fetch',vi.fn());
 await expect(listRemoteLibrary(asset.serverUrl)).rejects.toThrow('access code');
 expect(fetch).not.toHaveBeenCalled();
});
it('downloads only the scoped ID endpoint and verifies bytes',async()=>{
 vi.mocked(getLibraryToken).mockResolvedValue('ticket');
 vi.stubGlobal('fetch',vi.fn().mockResolvedValue(new Response(new Uint8Array([1,2,3]))));
 expect(await readRemoteAsset(asset)).toEqual(new Uint8Array([1,2,3]));
 expect(fetch).toHaveBeenCalledWith('https://spark.example/api/studio/library/asset-1/content',expect.objectContaining({headers:{Authorization:'Bearer ticket'},redirect:'error',credentials:'omit'}));
});
it('rejects incomplete assets before project storage',async()=>{
 vi.mocked(getLibraryToken).mockResolvedValue('ticket');
 vi.stubGlobal('fetch',vi.fn().mockResolvedValue(new Response(new Uint8Array([1]))));
 await expect(readRemoteAsset(asset)).rejects.toThrow('download completely');
});
it('cancels a chunked download when it exceeds the catalog size',async()=>{
 vi.mocked(getLibraryToken).mockResolvedValue('ticket');
 const cancel=vi.fn();
 const response=new Response(new ReadableStream({pull(controller){controller.enqueue(new Uint8Array([1,2,3,4]));},cancel}));
 vi.stubGlobal('fetch',vi.fn().mockResolvedValue(response));
 await expect(readRemoteAsset(asset)).rejects.toThrow('download completely');
 expect(cancel).toHaveBeenCalledTimes(1);
});
it('refuses a changed declared length without buffering the download',async()=>{
 vi.mocked(getLibraryToken).mockResolvedValue('ticket');
 const response=new Response(new Uint8Array([1,2,3,4]),{headers:{'Content-Length':'4'}});
 const read=vi.spyOn(response,'arrayBuffer');
 vi.stubGlobal('fetch',vi.fn().mockResolvedValue(response));
 await expect(readRemoteAsset(asset)).rejects.toThrow('download completely');expect(read).not.toHaveBeenCalled();
});
it('retains native arrayBuffer compatibility and validates the result',async()=>{
 vi.mocked(getLibraryToken).mockResolvedValue('ticket');
 vi.stubGlobal('fetch',vi.fn().mockResolvedValue({ok:true,headers:new Headers(),body:null,arrayBuffer:async()=>new Uint8Array([1,2,3]).buffer}));
 expect(await readRemoteAsset(asset)).toEqual(new Uint8Array([1,2,3]));
});

it('requests a bounded authenticated preview without putting its ticket in a URL',async()=>{
 const {readRemotePreview}=await import('@/lib/remote-library');
 vi.mocked(getLibraryToken).mockResolvedValue('ticket');
 vi.stubGlobal('fetch',vi.fn().mockResolvedValue(new Response(new Uint8Array([1,2,3]),{headers:{'Content-Type':'image/png','Content-Length':'3'}})));
 expect(await readRemotePreview(asset)).toEqual(new Uint8Array([1,2,3]));
 expect(fetch).toHaveBeenCalledWith('https://spark.example/api/studio/library/asset-1/preview',expect.objectContaining({headers:{Authorization:'Bearer ticket'},credentials:'omit'}));
});
it('rejects oversized previews before reading their body',async()=>{
 const {readRemotePreview}=await import('@/lib/remote-library');
 vi.mocked(getLibraryToken).mockResolvedValue('ticket');
 const response=new Response('',{headers:{'Content-Type':'image/png','Content-Length':'9999999'}});
 const read=vi.spyOn(response,'arrayBuffer');
 vi.stubGlobal('fetch',vi.fn().mockResolvedValue(response));
 await expect(readRemotePreview(asset)).rejects.toThrow('Preview unavailable');
 expect(read).not.toHaveBeenCalled();
});

it('requires the portable verification marker for model downloads',async()=>{
 vi.mocked(getLibraryToken).mockResolvedValue('ticket');
 const model={...asset,kind:'model' as const,fileName:'chair.glb',mimeType:'model/gltf-binary'};
 vi.stubGlobal('fetch',vi.fn().mockResolvedValue(new Response(new Uint8Array([1,2,3]))));
 await expect(readRemoteAsset(model)).rejects.toThrow('Update your Media Lab');
 vi.stubGlobal('fetch',vi.fn().mockResolvedValue(new Response(new Uint8Array([1,2,3]),{headers:{'X-Studio-Portable':'glb-v1'}})));
 expect(await readRemoteAsset(model)).toEqual(new Uint8Array([1,2,3]));
 expect(fetch).toHaveBeenCalledWith('https://spark.example/api/studio/library/asset-1/content?portable=1',expect.anything());
});

it('rejects oversized 3D imports before downloading any bytes',async()=>{
 vi.stubGlobal('fetch',vi.fn());
 await expect(readRemoteAsset({...asset,kind:'model',bytes:64*1024*1024+1})).rejects.toThrow('64 MiB');
 expect(fetch).not.toHaveBeenCalled();
});

it('explains model size refusal if server metadata changed',async()=>{
 vi.mocked(getLibraryToken).mockResolvedValue('ticket');
 vi.stubGlobal('fetch',vi.fn().mockResolvedValue(new Response('',{status:413})));
 await expect(readRemoteAsset({...asset,kind:'model'})).rejects.toThrow('64 MiB');
});


it('explains offline library access without replacing the saved ticket', async () => {
 vi.mocked(getLibraryToken).mockResolvedValue('ticket');
 vi.stubGlobal('fetch',vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
 await expect(listRemoteLibrary(asset.serverUrl)).rejects.toThrow('Check your connection and server address');
 expect(setLibraryToken).not.toHaveBeenCalled();
 expect(fetch).toHaveBeenCalledTimes(1);
});
it('distinguishes the library deadline from caller cancellation', async () => {
 vi.mocked(getLibraryToken).mockResolvedValue('ticket');
 vi.useFakeTimers();
 const failure = new Error('preview cancelled');
 try {
  vi.stubGlobal('fetch', vi.fn((_url, init) => new Promise((_resolve, reject) => {
   if(init.signal.aborted) reject(failure);
   else init.signal.addEventListener('abort', () => reject(failure), {once:true});
  })));
  const deadline = expect(listRemoteLibrary(asset.serverUrl, 10)).rejects.toThrow('Refresh the library to try again');
  await vi.advanceTimersByTimeAsync(11);
  await deadline;
  const cancel = new AbortController();
  cancel.abort();
  await expect(readRemoteAsset(asset, cancel.signal)).rejects.toBe(failure);
 } finally {vi.useRealTimers();}
});
