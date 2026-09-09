import {createServer} from 'node:http';
import {readAgentMediaCapabilities} from '../src/lib/agent-connect/media-capabilities';
import { createHash } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {listSupportedStudioEngines, listPermittedStudioHistory, readStudioPreview, listStudioHistory, connectRemoteGeneration, disconnectRemoteGeneration, hasRemoteGenerationPermission, listBackgroundEngines, readBackgroundResult, readModelResult, readAudioResult, readVideoResult, listModelEngines, submitModelJob, readModelJob, snapshotStudioImage, readStudioJob, snapshotRemoteImage, submitBackgroundJob, cancelBackgroundRequest} from '@/lib/remote-generation';
import type { RemoteLibraryAsset } from '@/lib/library-core';
const state = vi.hoisted(() => ({connections:new Map<string,string>(), libraries:new Map<string,string>()}));
vi.mock('@/lib/storage/secrets', () => ({
  getGenerationConnection:async (origin: string) => state.connections.get(origin) ?? null,
  setGenerationConnection:async (origin: string, value: string) => {state.connections.set(origin,value);},
  getLibraryToken:async (origin: string) => state.libraries.get(origin) ?? null,
  setLibraryToken:async (origin: string, value: string) => {state.libraries.set(origin,value);},
}));
vi.mock('expo-crypto', () => ({CryptoDigestAlgorithm:{SHA256:'SHA-256'}, getRandomBytes:(size: number) => new Uint8Array(size).fill(1),
  digest:async (_algorithm: string, bytes: Uint8Array) => {if(!(bytes instanceof Uint8Array))throw new Error('Native digest requires a typed array');return Uint8Array.from(createHash('sha256').update(bytes).digest()).buffer;}}));

const origin = 'https://media.example';
const device = '01'.repeat(16);
const token = `mlab-render-v1.user.1788554000.${device}.${'f'.repeat(64)}`;
const job = {id:'a'.repeat(32), kind:'image', status:'queued', createdAt:1, updatedAt:1};
const input = {id:'b'.repeat(32), sha256:'c'.repeat(64), bytes:100, width:4, height:3};
const engine = {id:'birefnet-cpu', revision:'exact', operation:'remove-background' as const};
const json = (value: unknown) => new Response(JSON.stringify(value), {headers:{'Content-Type':'application/json'}});
function connected() {
  state.connections.set(origin, JSON.stringify({deviceId:device, token}));
  state.libraries.set(origin, 'mlab-library-v1.test');
}
beforeEach(() => {state.connections.clear();state.libraries.clear();vi.restoreAllMocks();});

describe('independent generation client', () => {
  it('persists identity before transport and renews it after a lost response', async () => {
    const fetcher = vi.spyOn(globalThis,'fetch').mockRejectedValueOnce(new Error('offline'));
    await expect(connectRemoteGeneration(origin, 'code')).rejects.toThrow('Could not reach Media Lab');
    expect(JSON.parse(state.connections.get(origin)!)).toEqual({deviceId:device,token:null});
    fetcher.mockImplementation(async () => json({scope:'library:read',token:'mlab-library-v1.test',renderScope:'jobs:own',renderToken:token}));
    await connectRemoteGeneration(origin, 'code');
    await connectRemoteGeneration(origin, 'code');
    for (const [, init] of fetcher.mock.calls) {
      expect(JSON.parse(init!.body as string).studio_device).toBe(device);
      expect(init).toMatchObject({credentials:'omit',redirect:'error'});
    }
    expect(JSON.parse(state.connections.get(origin)!).token).toBe(token);
  });

  it('refuses a ticket for a different device', async () => {
    connected();
    vi.spyOn(globalThis,'fetch').mockResolvedValue(json({scope:'library:read',token:'mlab-library-v1.other',renderScope:'jobs:own',
      renderToken:token.replace(device,'b'.repeat(32))}));
    await expect(connectRemoteGeneration(origin,'code')).rejects.toThrow('securely');
    expect(JSON.parse(state.connections.get(origin)!).token).toBe(token);
  });

  it('sends both scoped permissions for a bounded image snapshot', async () => {
    connected();
    const fetcher = vi.spyOn(globalThis,'fetch').mockResolvedValue(json({version:1,...input}));
    const asset = {id:'image-one',serverUrl:origin,mimeType:'image/png'} as RemoteLibraryAsset;
    expect(await snapshotRemoteImage(asset)).toEqual(input);
    expect(fetcher.mock.calls[0][1]?.headers).toMatchObject({Authorization:`Bearer ${token}`,'X-Library-Authorization':'Bearer mlab-library-v1.test'});
    fetcher.mockResolvedValue(json({version:1,...input,width:16000001}));
    await expect(snapshotRemoteImage(asset)).rejects.toThrow('valid image snapshot');
  });

  it('keeps exact request content on retry and never changes server', async () => {
    connected();
    const fetcher = vi.spyOn(globalThis,'fetch').mockImplementation(async () => json(job));
    await submitBackgroundJob(origin,'stable-request-0001',engine,input);
    await submitBackgroundJob(origin,'stable-request-0001',engine,input);
    expect(fetcher.mock.calls[0][1]?.body).toBe(fetcher.mock.calls[1][1]?.body);
    expect(fetcher.mock.calls[0][0]).toBe(origin+'/api/studio/jobs');
    expect(JSON.parse(fetcher.mock.calls[0][1]!.body as string)).toMatchObject({revision:'exact',settings:{inputId:input.id,inputSha256:input.sha256}});
    await expect(submitBackgroundJob('https://another.example','stable-request-0001',engine,input)).rejects.toThrow('permission');
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('supports cancellation but rejects mismatched job responses', async () => {
    connected();
    const fetcher = vi.spyOn(globalThis,'fetch').mockResolvedValue(json({...job,status:'cancel_requested'}));
    expect((await readStudioJob(origin,job.id,true)).status).toBe('cancel_requested');
    expect(fetcher.mock.calls[0][0]).toBe(origin+`/api/studio/jobs/${job.id}/cancel`);
    expect(fetcher.mock.calls[0][1]?.method).toBe('POST');
    fetcher.mockResolvedValue(json({...job,id:'c'.repeat(32)}));
    await expect(readStudioJob(origin,job.id)).rejects.toThrow('different job');
  });

  it('returns an empty capability list without pretending a model is ready', async () => {
    connected();
    vi.spyOn(globalThis,'fetch').mockResolvedValue(json({version:1,engines:[]}));
    expect(await listBackgroundEngines(origin)).toEqual([]);
  });

  it('checks result size, MIME and SHA before returning bytes', async () => {
    connected();
    const bytes = new Uint8Array([1,2,3]);
    const sha = createHash('sha256').update(bytes).digest('hex');
    const response = (hash: string) => new Response(bytes,{headers:{'Content-Type':'image/png','Content-Length':'3','X-Content-SHA256':hash}});
    const fetcher = vi.spyOn(globalThis,'fetch').mockResolvedValue(response(sha));
    expect(await readBackgroundResult(origin,job.id)).toEqual(bytes);
    fetcher.mockResolvedValue(response('0'.repeat(64)));
    await expect(readBackgroundResult(origin,job.id)).rejects.toThrow('integrity');
  });
});

 it('disconnects generation without losing the device identity needed for recovery', async () => {
  connected();
  expect(await hasRemoteGenerationPermission(origin)).toBe(true);
  await disconnectRemoteGeneration(origin);
  expect(await hasRemoteGenerationPermission(origin)).toBe(false);
  expect(JSON.parse(state.connections.get(origin)!)).toEqual({deviceId:device,token:null});
});


it('recovers paginated history using only the paired credential', async () => {
  connected();
  const fetcher = vi.spyOn(globalThis,'fetch').mockResolvedValueOnce(json({version:1,jobs:[job],nextCursor:job.id}))
    .mockResolvedValueOnce(json({version:1,jobs:[{...job,id:'b'.repeat(32),kind:'video'}],nextCursor:null}));
  expect((await listStudioHistory(origin)).nextCursor).toBe(job.id);
  expect((await listStudioHistory(origin,job.id)).jobs[0].kind).toBe('video');
  expect(fetcher.mock.calls[1][0]).toBe(origin+'/api/studio/jobs?limit=50&before='+job.id);
  expect(fetcher.mock.calls[0][1]).toMatchObject({credentials:'omit',redirect:'error',headers:{Authorization:'Bearer '+token}});
});

it.each([
  {version:1,jobs:[job,job],nextCursor:null},
  {version:1,jobs:[job],nextCursor:'f'.repeat(32)},
  {version:1,jobs:[{...job,kind:'shell'}],nextCursor:null},
  {version:1,jobs:[],nextCursor:job.id},
])('rejects malformed history instead of importing unvalidated identities', async value => {
  connected();vi.spyOn(globalThis,'fetch').mockResolvedValue(json(value));
  await expect(listStudioHistory(origin)).rejects.toThrow();
});


it('loads bounded previews with a scoped header and rejects an oversized response', async () => {
  connected();
  const fetcher = vi.spyOn(globalThis,'fetch').mockResolvedValueOnce(new Response(new Uint8Array([1,2,3]),
    {headers:{'Content-Type':'image/png','Content-Length':'3'}})).mockResolvedValueOnce(new Response('',
    {headers:{'Content-Type':'image/png','Content-Length':'2000000'}}));
  expect(await readStudioPreview(origin,job.id)).toEqual(new Uint8Array([1,2,3]));
  expect(fetcher.mock.calls[0][0]).toBe(origin+'/api/studio/jobs/'+job.id+'/preview');
  expect(fetcher.mock.calls[0][1]).toMatchObject({credentials:'omit',headers:{Authorization:'Bearer '+token}});
  await expect(readStudioPreview(origin,job.id)).rejects.toThrow('invalid preview');
});


it('downloads model results only with portable marker, exact size and hash', async () => {
  connected();
  const bytes = new Uint8Array([1,2,3,4]);
  const digest = createHash('sha256').update(bytes).digest('hex');
  const headers = {'Content-Type':'model/gltf-binary','Content-Length':'4','X-Content-SHA256':digest,'X-Studio-Portable':'glb-v1'};
  const fetcher = vi.spyOn(globalThis,'fetch');
  fetcher.mockResolvedValueOnce(new Response(bytes,{headers}));
  expect(await readModelResult(origin,job.id)).toEqual(bytes);
  for (const override of [{'X-Studio-Portable':''},{'X-Content-SHA256':'a'.repeat(64)},{'Content-Type':'image/png'},{'Content-Length':'5'}]) {
    fetcher.mockResolvedValueOnce(new Response(bytes,{headers:{...headers,...override}}));
    await expect(readModelResult(origin,job.id)).rejects.toThrow();
  }
});


it('snapshots an owned job with only generation permission and validates the response', async () => {
  connected();
  state.libraries.clear();
  const fetcher = vi.spyOn(globalThis,'fetch').mockResolvedValueOnce(json({version:1,...input}));
  expect(await snapshotStudioImage(origin,job.id)).toEqual(input);
  expect(fetcher.mock.calls[0][0]).toBe(origin+'/api/studio/jobs/'+job.id+'/input');
  expect(fetcher.mock.calls[0][1]).toMatchObject({method:'POST',headers:{Authorization:'Bearer '+token}});
  fetcher.mockResolvedValueOnce(json({version:1,...input,width:0}));
  await expect(snapshotStudioImage(origin,job.id)).rejects.toThrow('valid image snapshot');
});


const modelEngine = {id:'triposr-cpu',revision:'f72bb520b8b1a5639600ac818496f22d6ccb3b42d3942412bd1e2375ef780a2b',
  operation:'image-to-3d' as const,variant:'triposr-cpu-f32-seed7-res128-vertex-color-v1'};
it('discovers only the exact supported server-advertised 3D variant', async () => {
  connected();
  const fetcher=vi.spyOn(globalThis,'fetch').mockResolvedValueOnce(json({version:1,engines:[engine,modelEngine,{...modelEngine,variant:'other'}]}));
  expect(await listModelEngines(origin)).toEqual([modelEngine]);
  fetcher.mockResolvedValueOnce(json({version:1,engines:[]}));
  expect(await listModelEngines(origin)).toEqual([]);
});
it('sends the exact persisted model request and refuses substitution before transport', async () => {
  connected();
  const fetcher=vi.spyOn(globalThis,'fetch').mockResolvedValue(json({...job,kind:'model'}));
  await submitModelJob(origin,'request-model-0001',modelEngine,input);
  const sent=JSON.parse(fetcher.mock.calls[0][1]!.body as string);
  expect(sent).toMatchObject({requestId:'request-model-0001',kind:'model',revision:modelEngine.revision,
    settings:{operation:'image-to-3d',variant:modelEngine.variant,inputId:input.id,inputSha256:input.sha256}});
  await expect(submitModelJob(origin,'request-model-0001',{...modelEngine,variant:'other'},input)).rejects.toThrow('exact');
  expect(fetcher).toHaveBeenCalledTimes(1);
});
it('rejects mismatched model job identity and kind when polling or cancelling', async () => {
  connected();
  const fetcher=vi.spyOn(globalThis,'fetch').mockResolvedValueOnce(json(job));
  await expect(readModelJob(origin,job.id)).rejects.toThrow('kind');
  fetcher.mockResolvedValueOnce(json({...job,kind:'model',id:'b'.repeat(32)}));
  await expect(readModelJob(origin,job.id,true)).rejects.toThrow('different job');
  expect(fetcher.mock.calls[1][1]!.method).toBe('POST');
});


it('explains a transport timeout without resubmitting or dropping identity', async () => {
  connected();
  vi.useFakeTimers();
  try {
    const fetcher = vi.spyOn(globalThis, 'fetch').mockImplementation((_url, init) => new Promise((_resolve, reject) => {
      init!.signal!.addEventListener('abort', () => reject(new Error('aborted')), {once:true});
    }));
    const check = expect(readStudioJob(origin, job.id)).rejects.toThrow('Check saved requests before submitting again');
    await vi.advanceTimersByTimeAsync(20_001);
    await check;
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(JSON.parse(state.connections.get(origin)!).token).toBe(token);
  } finally { vi.useRealTimers(); }
});


it.each([['audio/wav','wav'],['audio/mpeg','mp3'],['audio/flac','flac']])('copies owned %s results with their original extension',async(mime,extension)=>{
 connected();const bytes=new Uint8Array([7,8,9]);const hash=createHash('sha256').update(bytes).digest('hex');
 const fetcher=vi.spyOn(globalThis,'fetch').mockResolvedValue(new Response(bytes,{headers:{'Content-Type':mime,'Content-Length':'3','X-Content-SHA256':hash}}));
 expect(await readAudioResult(origin,job.id)).toEqual({bytes,extension});
 expect(new Headers(fetcher.mock.calls[0][1]?.headers).get('Authorization')).toBe('Bearer '+token);
 fetcher.mockResolvedValue(new Response(bytes,{headers:{'Content-Type':mime,'Content-Length':'3','X-Content-SHA256':'0'.repeat(64)}}));
 await expect(readAudioResult(origin,job.id)).rejects.toThrow('integrity');
});
it('rejects non-audio responses before exposing audio bytes',async()=>{
 connected();vi.spyOn(globalThis,'fetch').mockResolvedValue(new Response('bad',{headers:{'Content-Type':'text/html','Content-Length':'3','X-Content-SHA256':'0'.repeat(64)}}));
 await expect(readAudioResult(origin,job.id)).rejects.toThrow('invalid audio');
});


it.each([['video/mp4','mp4'],['video/webm','webm']])('preserves %s owned video bytes and file type',async(mime,extension)=>{
 connected();const bytes=new Uint8Array([12,13,14]);const hash=createHash('sha256').update(bytes).digest('hex');
 const fetcher=vi.spyOn(globalThis,'fetch').mockResolvedValue(new Response(bytes,{headers:{'Content-Type':mime,'Content-Length':'3','X-Content-SHA256':hash}}));
 expect(await readVideoResult(origin,job.id)).toEqual({bytes,extension});
 fetcher.mockResolvedValue(new Response(bytes,{headers:{'Content-Type':mime,'Content-Length':'4','X-Content-SHA256':hash}}));
 await expect(readVideoResult(origin,job.id)).rejects.toThrow('completely');
 fetcher.mockResolvedValue(new Response(bytes,{headers:{'Content-Type':mime,'Content-Length':'3','X-Content-SHA256':'0'.repeat(64)}}));
 await expect(readVideoResult(origin,job.id)).rejects.toThrow('integrity');
});
it('rejects an audio response when video was requested',async()=>{
 connected();vi.spyOn(globalThis,'fetch').mockResolvedValue(new Response('bad',{headers:{'Content-Type':'audio/wav','Content-Length':'3','X-Content-SHA256':'0'.repeat(64)}}));
 await expect(readVideoResult(origin,job.id)).rejects.toThrow('invalid video');
});


it('preserves bounded Unicode titles in owned history while accepting older servers',async()=>{
 connected();const title='🎬'.repeat(240);
 const fetcher=vi.spyOn(globalThis,'fetch').mockResolvedValue(json({version:1,jobs:[{...job,title}],nextCursor:null}));
 expect((await listStudioHistory(origin)).jobs[0].title).toBe(title);
 fetcher.mockResolvedValue(json({version:1,jobs:[{...job,title:title+'x'}],nextCursor:null}));
 await expect(listStudioHistory(origin)).rejects.toThrow('title');
});


it('does not request generation history for a Library-only connection',async()=>{
 state.libraries.set(origin,'mlab-library-v1.test');
 const fetch=vi.spyOn(globalThis,'fetch');
 expect(await listPermittedStudioHistory(origin)).toBeNull();
 expect(fetch).not.toHaveBeenCalled();
 connected();await disconnectRemoteGeneration(origin);
 expect(await listPermittedStudioHistory(origin)).toBeNull();
 expect(fetch).not.toHaveBeenCalled();
});
it('loads device history only when generation permission exists',async()=>{
 connected();const fetch=vi.spyOn(globalThis,'fetch').mockResolvedValue(json({version:1,jobs:[job],nextCursor:null}));
 expect((await listPermittedStudioHistory(origin))?.jobs).toHaveLength(1);
 expect(fetch).toHaveBeenCalledOnce();
});
it('does not hide an unreadable generation credential as Library-only',async()=>{
 state.connections.set(origin,'broken-json');
 await expect(listPermittedStudioHistory(origin)).rejects.toThrow();
});


it('discovers supported operations in one read without leaking extra metadata or accepting another 3D variant',async()=>{
  connected();
  const fetcher=vi.spyOn(globalThis,'fetch').mockResolvedValue(json({version:1,engines:[
    {...engine,serverUrl:'https://private.example',token:'secret'},engine,
    {id:'triposr-cpu',revision:'wrong',operation:'image-to-3d',variant:'other'},
    {id:'video',revision:'v1',operation:'text-to-video'},null,
    {id:'bad',revision:'https://private.example',operation:'remove-background'},
  ]}));
  expect(await listSupportedStudioEngines(origin)).toEqual([engine]);
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(fetcher.mock.calls[0][0]).toBe(origin+'/api/studio/engines');
  expect(fetcher.mock.calls[0][1]?.method).toBeUndefined();
  fetcher.mockResolvedValueOnce(json({version:1,engines:Array(101).fill(engine)}));
  await expect(listSupportedStudioEngines(origin)).rejects.toThrow('unsupported capability list');
  fetcher.mockResolvedValueOnce(new Response(' '.repeat(65537)));
  await expect(listSupportedStudioEngines(origin)).rejects.toThrow('oversized capability list');
  fetcher.mockResolvedValueOnce(json(null));
  await expect(listSupportedStudioEngines(origin)).rejects.toThrow('unsupported capability list');
});


it('reads capabilities from an authenticated real HTTP server without sending a job',async()=>{
  const requests:{path:string|undefined;method:string|undefined;authorization:string|undefined}[]=[];
  const server=createServer((req,res)=>{
    requests.push({path:req.url,method:req.method,authorization:req.headers.authorization});
    res.writeHead(req.headers.authorization===`Bearer ${token}`?200:401,{'Content-Type':'application/json'});
    res.end(JSON.stringify({version:1,engines:[engine]}));
  });
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
  try {
    const address=server.address();
    if(!address || typeof address==='string')throw new Error('Missing HTTP fixture address');
    const local=`http://127.0.0.1:${address.port}`;
    state.connections.set(local,JSON.stringify({deviceId:device,token}));
    const result=await readAgentMediaCapabilities({server:()=>local,permitted:hasRemoteGenerationPermission,engines:listSupportedStudioEngines});
    expect(result).toMatchObject({state:'connected',operations:[engine],agentCanSubmitJobs:false});
    expect(requests).toEqual([{path:'/api/studio/engines',method:'GET',authorization:`Bearer ${token}`}]);
    expect(JSON.stringify(result)).not.toContain(token);
    expect(JSON.stringify(result)).not.toContain(local);
  } finally { server.closeAllConnections();await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve())); }
});

it('cancels an oversized streamed capability reply and hides malformed reply content',async()=>{
  connected();
  const cancel=vi.fn();
  const fetcher=vi.spyOn(globalThis,'fetch').mockResolvedValue(new Response(new ReadableStream({
    start(controller){controller.enqueue(new Uint8Array(65537));},cancel,
  })));
  await expect(listSupportedStudioEngines(origin)).rejects.toThrow('oversized capability list');
  expect(cancel).toHaveBeenCalledOnce();
  fetcher.mockResolvedValueOnce(new Response('private-token-invalid-json'));
  await expect(listSupportedStudioEngines(origin)).rejects.toThrow(/^Media Lab returned an unsupported capability list\.$/);
});

it('rejects an agent result above its smaller download limit before buffering',async()=>{
 connected();
 const response=new Response(new Uint8Array([1]),{headers:{'Content-Type':'image/png','Content-Length':String(17*1024*1024),'X-Content-SHA256':'a'.repeat(64)}});
 const buffer=vi.spyOn(response,'arrayBuffer');
 vi.spyOn(globalThis,'fetch').mockResolvedValue(response);
 await expect(readBackgroundResult(origin,job.id,16*1024*1024)).rejects.toThrow('invalid image result');
 expect(buffer).not.toHaveBeenCalled();
});


it('cancels with the exact submission body and never falls back to submission on old servers', async () => {
  connected();
  const fetcher=vi.spyOn(globalThis,'fetch').mockImplementation(async()=>json({...job,status:'cancelled'}));
  await submitBackgroundJob(origin,'request-original-0001',engine,input);
  await cancelBackgroundRequest(origin,'request-original-0001',engine,input);
  expect(fetcher.mock.calls[1][0]).toBe(origin+'/api/studio/requests/cancel');
  expect(fetcher.mock.calls[1][1]?.body).toBe(fetcher.mock.calls[0][1]?.body);
  fetcher.mockResolvedValueOnce(new Response('',{status:404}));
  await expect(cancelBackgroundRequest(origin,'request-original-0001',engine,input)).rejects.toThrow('Update Media Lab');
  expect(fetcher).toHaveBeenCalledTimes(3);
});
