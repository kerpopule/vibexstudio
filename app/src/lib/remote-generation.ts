import * as Crypto from 'expo-crypto';
import { libraryOrigin, type RemoteLibraryAsset } from '@/lib/library-core';
import { getGenerationConnection, setGenerationConnection, getLibraryToken, setLibraryToken } from '@/lib/storage/secrets';

type Connection = {deviceId: string; token: string | null};
export type StudioJob = {id: string; kind: 'image'; status: 'queued'|'running'|'cancel_requested'|'cancelled'|'succeeded'|'failed'; createdAt: number; updatedAt: number};
export type BackgroundEngine = {id: string; revision: string; operation: 'remove-background'};
export type StudioInput = {id: string; sha256: string; bytes: number; width: number; height: number};
const hex32 = /^[a-f0-9]{32}$/;
const hex64 = /^[a-f0-9]{64}$/;
const pairings = new Map<string, Promise<void>>();

async function connection(origin: string): Promise<Connection | null> {
  const stored = await getGenerationConnection(libraryOrigin(origin));
  if (!stored) return null;
  const value = JSON.parse(stored);
  if (!hex32.test(value.deviceId) || !(value.token === null || typeof value.token === 'string')) {
    throw new Error('The saved Media Lab device connection could not be read.');
  }
  return value;
}

async function request<T>(origin: string, path: string, init: RequestInit, read: (response: Response) => Promise<T>, timeout = 20_000): Promise<T> {
  const url = libraryOrigin(origin) + path;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    let response: Response;
    try {
      response = await fetch(url, {...init, credentials:'omit', redirect:'error', signal:controller.signal});
    } catch {
      throw new Error(controller.signal.aborted
        ? 'Media Lab took too long to respond. Check saved requests before submitting again.'
        : 'Could not reach Media Lab. Check your connection and server address, then refresh saved requests.');
    }
    if (!response.ok) {
      const message = response.status === 401 || response.status === 403 ? 'Connect Media Lab with generation permission to continue.' :
        response.status === 404 && path === '/api/studio/requests/cancel' ? 'Update Media Lab to cancel a request whose acceptance is unknown. No new job was submitted.' :
        response.status === 404 ? 'This input or job is not available to this device. Check the selected server.' :
        response.status === 409 ? 'This request or result changed. Refresh its status before trying again.' :
        response.status === 429 ? 'Media Lab is busy. Try again shortly.' :
        response.status === 503 ? 'This generation capability is not ready on this server. Check its setup.' :
        `Media Lab could not complete this request (${response.status}).`;
      throw new Error(message);
    }
    return await read(response);
  } finally { clearTimeout(timer); }
}

async function headers(origin: string) {
  const value = await connection(origin);
  if (!value?.token) throw new Error('Connect Media Lab with generation permission to continue.');
  return {Authorization:`Bearer ${value.token}`};
}

export async function disconnectRemoteGeneration(origin: string): Promise<void> {
  const value = await connection(origin);
  if (value) await setGenerationConnection(libraryOrigin(origin),JSON.stringify({...value,token:null}));
}
export async function hasRemoteGenerationPermission(origin: string): Promise<boolean> {
  return Boolean((await connection(origin))?.token);
}

/** Renew the same device identity so existing owned jobs remain accessible. */
export async function connectRemoteGeneration(server: string, code: string): Promise<void> {
  const origin = libraryOrigin(server);
  const existing = pairings.get(origin);
  if (existing) return existing;
  const pair = async () => {
    let value = await connection(origin);
    if (!value) {
      value = {deviceId:Array.from(Crypto.getRandomBytes(16), (byte) => byte.toString(16).padStart(2, '0')).join(''), token:null};
      // Save before requesting a ticket: a lost response must not lose identity.
      await setGenerationConnection(origin, JSON.stringify(value));
    }
    const result = await request(origin, '/api/gate', {method:'POST', headers:{'Content-Type':'application/json'},
      body:JSON.stringify({code, studio_library:true, studio_render:true, studio_device:value.deviceId})}, (r) => r.json());
    const token = result.renderToken;
    const parts = typeof token === 'string' ? token.split('.') : [];
    if (result.renderScope !== 'jobs:own' || parts.length !== 5 || parts[0] !== 'mlab-render-v1' ||
        !['user','admin'].includes(parts[1]) || !/^\d{10,12}$/.test(parts[2]) || parts[3] !== value.deviceId || !hex64.test(parts[4]) ||
        result.scope !== 'library:read' || typeof result.token !== 'string' || !result.token.startsWith('mlab-library-v1.')) {
      throw new Error('Update your Media Lab server to connect generation securely.');
    }
    await setLibraryToken(origin, result.token);
    await setGenerationConnection(origin, JSON.stringify({...value, token}));
  };
  // Web Locks also serialize first pairing across tabs when supported. Native
  // and older browsers retain the in-process guard above.
  const locks = typeof navigator !== 'undefined' ? navigator.locks : undefined;
  const work = locks ? locks.request('vibex-generation:' + origin, pair) : pair();
  pairings.set(origin, work);
  try { await work; } finally { if (pairings.get(origin) === work) pairings.delete(origin); }
}

export async function listBackgroundEngines(origin: string): Promise<BackgroundEngine[]> {
  return (await listSupportedStudioEngines(origin)).filter((engine): engine is BackgroundEngine => engine.operation === 'remove-background');
}

export async function snapshotRemoteImage(asset: RemoteLibraryAsset): Promise<StudioInput> {
  if (!['image/png','image/jpeg','image/webp'].includes(asset.mimeType)) throw new Error('Choose a PNG, JPEG or WebP image.');
  const origin = libraryOrigin(asset.serverUrl);
  const library = await getLibraryToken(origin);
  if (!library) throw new Error('Connect your Media Lab Library first.');
  const value = await request(origin, '/api/studio/inputs/library', {method:'POST',
    headers:{...await headers(origin), 'Content-Type':'application/json', 'X-Library-Authorization':`Bearer ${library}`},
    body:JSON.stringify({assetId:asset.id})}, (r) => r.json());
  return parseStudioInput(value);
}

export async function snapshotStudioImage(origin: string, id: string): Promise<StudioInput> {
  if (!hex32.test(id)) throw new Error('Invalid job identity.');
  const value = await request(origin, `/api/studio/jobs/${id}/input`, {
    method:'POST', headers:await headers(origin),
  }, response => response.json());
  return parseStudioInput(value);
}

function parseStudioInput(value: StudioInput & {version:number}): StudioInput {
  if (!value || value.version !== 1 || !hex32.test(value.id) || !hex64.test(value.sha256) || !Number.isSafeInteger(value.bytes) ||
      value.bytes <= 0 || value.bytes > 20*1024**2 || !Number.isSafeInteger(value.width) || !Number.isSafeInteger(value.height) ||
      value.width <= 0 || value.height <= 0 || value.width*value.height > 16_000_000) throw new Error('Media Lab did not return a valid image snapshot.');
  return {id:value.id, sha256:value.sha256, bytes:value.bytes, width:value.width, height:value.height};
}

function parseJob(value: StudioJob): StudioJob {
  if (!value || !hex32.test(value.id) || value.kind !== 'image' ||
      !['queued','running','cancel_requested','cancelled','succeeded','failed'].includes(value.status) ||
      !Number.isSafeInteger(value.createdAt) || !Number.isSafeInteger(value.updatedAt)) throw new Error('Media Lab returned an invalid job status.');
  return {id:value.id,kind:value.kind,status:value.status,createdAt:value.createdAt,updatedAt:value.updatedAt};
}

export type StudioHistoryJob = Omit<StudioJob, 'kind'> & {kind:'image'|'video'|'audio'|'model'|'sprites';title?:string};
/** A Library-only connection is valid; it has no device-owned generation history. */
export async function listPermittedStudioHistory(origin: string, before?: string) {
  if (!(await hasRemoteGenerationPermission(origin))) return null;
  return listStudioHistory(origin, before);
}

export async function listStudioHistory(origin: string, before?: string): Promise<{jobs:StudioHistoryJob[];nextCursor:string|null}> {
  if (before !== undefined && !hex32.test(before)) throw new Error('Invalid history cursor.');
  const value = await request(origin, '/api/studio/jobs?limit=50'+(before ? '&before='+before : ''),
    {headers:await headers(origin)}, (r) => r.json());
  if (!value || value.version !== 1 || !Array.isArray(value.jobs) || value.jobs.length > 50 ||
      (value.nextCursor !== null && (typeof value.nextCursor !== 'string' || !hex32.test(value.nextCursor)))) {
    throw new Error('Media Lab returned invalid generation history.');
  }
  const jobs: StudioHistoryJob[] = value.jobs.map((job: StudioHistoryJob) => {
    if (!job || !['image','video','audio','model','sprites'].includes(job.kind)) throw new Error('Media Lab returned an invalid job kind.');
    if (job.title !== undefined && (typeof job.title !== 'string' || Array.from(job.title).length > 240)) throw new Error('Media Lab returned an invalid job title.');
    return {...parseJob({...job,kind:'image'}),kind:job.kind,...(job.title !== undefined ? {title:job.title} : {})};
  });
  if (new Set(jobs.map(job => job.id)).size !== jobs.length ||
      (value.nextCursor !== null && (value.nextCursor === before || value.nextCursor !== jobs.at(-1)?.id))) {
    throw new Error('Media Lab returned an invalid history cursor.');
  }
  return {jobs,nextCursor:value.nextCursor};
}

/** Caller persists requestId, engine and input before submission/retry. */
export async function submitBackgroundJob(origin: string, requestId: string, engine: BackgroundEngine, input: StudioInput): Promise<StudioJob> {
  return backgroundRequest(origin,requestId,engine,input,false);
}

export async function cancelBackgroundRequest(origin: string, requestId: string, engine: BackgroundEngine, input: StudioInput): Promise<StudioJob> {
  return backgroundRequest(origin,requestId,engine,input,true);
}

async function backgroundRequest(origin: string, requestId: string, engine: BackgroundEngine, input: StudioInput, cancel: boolean): Promise<StudioJob> {
  if (!/^[A-Za-z0-9_-]{16,128}$/.test(requestId)) throw new Error('A stable request identity is required.');
  return parseJob(await request(origin, cancel ? '/api/studio/requests/cancel' : '/api/studio/jobs', {method:'POST', headers:{...await headers(origin),'Content-Type':'application/json'},
    body:JSON.stringify({requestId, engineId:engine.id, revision:engine.revision, kind:'image', prompt:'Remove background',
      settings:{operation:'remove-background', inputId:input.id, inputSha256:input.sha256}})}, (r) => r.json()));
}

export async function readStudioJob(origin: string, id: string, cancel = false): Promise<StudioJob> {
  if (!hex32.test(id)) throw new Error('Invalid job identity.');
  const value = parseJob(await request(origin, `/api/studio/jobs/${id}${cancel ? '/cancel' : ''}`,
    {method:cancel ? 'POST' : 'GET', headers:await headers(origin)}, (r) => r.json()));
  if (value.id !== id) throw new Error('Media Lab returned a different job.');
  return value;
}

export async function saveBackgroundToLibrary(origin:string,id:string):Promise<void> {
  await saveResultToLibrary(origin,id);
}

/** Save a completed cutout or speech result into the server Library; returns the Library asset id. */
export async function saveResultToLibrary(origin:string,id:string):Promise<string> {
  if (!hex32.test(id)) throw new Error('Invalid job identity.');
  const value = await request(origin, `/api/studio/jobs/${id}/library`, {method:'POST',headers:await headers(origin)}, r=>r.json());
  if (!value || typeof value.id !== 'string' || !/^[A-Za-z0-9._-]{1,200}$/.test(value.id)) throw new Error('Media Lab did not confirm the Library save.');
  return value.id;
}

export async function readBackgroundResult(origin: string, id: string, maxBytes = 64*1024**2): Promise<Uint8Array> {
  return (await readVerifiedResult(origin, id, 'image', maxBytes)).bytes;
}

export async function readModelResult(origin: string, id: string): Promise<Uint8Array> {
  return (await readVerifiedResult(origin, id, 'model')).bytes;
}

const VIDEO_EXTENSIONS: Record<string,string> = {'video/mp4':'mp4','video/webm':'webm'};
const AUDIO_EXTENSIONS: Record<string,string> = {'audio/wav':'wav','audio/x-wav':'wav','audio/mpeg':'mp3','audio/flac':'flac','audio/x-flac':'flac'};

export async function readAudioResult(origin: string, id: string): Promise<{bytes:Uint8Array; extension:string}> {
  const result = await readVerifiedResult(origin, id, 'audio');
  return {bytes:result.bytes, extension:AUDIO_EXTENSIONS[result.mimeType]};
}

export async function readVideoResult(origin: string, id: string): Promise<{bytes:Uint8Array; extension:string}> {
  const result = await readVerifiedResult(origin, id, 'video');
  return {bytes:result.bytes, extension:VIDEO_EXTENSIONS[result.mimeType]};
}

async function readVerifiedResult(origin: string, id: string, kind: 'image'|'model'|'audio'|'video', maxBytes = 64*1024**2): Promise<{bytes:Uint8Array; mimeType:string}> {
  if (!hex32.test(id)) throw new Error('Invalid job identity.');
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0 || maxBytes > 64*1024**2) throw new Error('Invalid result size limit.');
  return request(origin, `/api/studio/jobs/${id}/content`, {headers:await headers(origin)}, async (response) => {
    const size = Number(response.headers.get('Content-Length'));
    const expected = response.headers.get('X-Content-SHA256') ?? '';
    const mimeType = response.headers.get('Content-Type') ?? '';
    if (!Number.isSafeInteger(size) || size <= 0 || size > maxBytes || !hex64.test(expected) ||
        (kind === 'video' ? !Object.hasOwn(VIDEO_EXTENSIONS,mimeType) : kind === 'audio' ? !Object.hasOwn(AUDIO_EXTENSIONS,mimeType) : mimeType !== (kind === 'model' ? 'model/gltf-binary' : 'image/png')) ||
        (kind === 'model' && response.headers.get('X-Studio-Portable') !== 'glb-v1')) throw new Error('Media Lab returned an invalid '+kind+' result.');
    const buffer = await response.arrayBuffer();
    if (buffer.byteLength !== size) throw new Error('The result did not download completely.');
    const digest = await Crypto.digest(Crypto.CryptoDigestAlgorithm.SHA256, new Uint8Array(buffer));
    const actual = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2,'0')).join('');
    if (actual !== expected) throw new Error('The result failed its integrity check.');
    return {bytes:new Uint8Array(buffer), mimeType};
  }, 120_000);
}


export async function readStudioPreview(origin:string, id:string): Promise<Uint8Array> {
  if (!hex32.test(id)) throw new Error('Invalid job identity.');
  return request(origin, `/api/studio/jobs/${id}/preview`, {headers:await headers(origin)}, async response => {
    const size = Number(response.headers.get('Content-Length'));
    if (response.headers.get('Content-Type') !== 'image/png' || !Number.isSafeInteger(size) || size <= 0 || size > 1024**2) {
      throw new Error('Media Lab returned an invalid preview.');
    }
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.length !== size) throw new Error('The preview did not download completely.');
    return bytes;
  });
}


export type ModelEngine = {id:string; revision:string; operation:'image-to-3d'; variant:string};
/** Experimental English CPU speech: exact engine identity and the reviewed default voice only. */
export type SpeechEngine = {id:'chatterbox-english-cpu'; revision:string; operation:'speak'; voice:'upstream-default-english'; language:'en'};
export type SpeechJob = Omit<StudioJob, 'kind'> & {kind:'audio'};
export const SPEECH_TEXT_LIMIT = 600;
/** Experimental ACE-Step music on the server GPU: exact engine identity, instrumental or lyrics. */
export type MusicEngine = {id:'acestep-gpu'; revision:string; operation:'compose'; maxSeconds:number};
export type MusicJob = Omit<StudioJob, 'kind'> & {kind:'audio'};
export const MUSIC_PROMPT_LIMIT = 600;
export const MUSIC_LYRICS_LIMIT = 4000;
export const MUSIC_MIN_SECONDS = 10;
/** Experimental Wan2.2 text-to-video on the server GPU: exact engine identity, frames 4n+1, fixed sizes. */
export type VideoEngine = {id:'wan22-ti2v-5b-gpu'; revision:string; operation:'text-to-video'; maxFrames:number; fps:number; sizes:string[]};
export type VideoJob = Omit<StudioJob, 'kind'> & {kind:'video'};
export const VIDEO_PROMPT_LIMIT = 600;
export const VIDEO_MIN_FRAMES = 9;
export const VIDEO_STEPS = 20;
export const VIDEO_SIZES = ['704*1280', '1280*704'] as const;
/** Experimental Z-Image-Turbo text-to-image on the server GPU: exact engine identity, fixed sizes. */
export type ImageEngine = {id:'zimage-turbo-gpu'; revision:string; operation:'text-to-image'; sizes:string[]};
export type ImageJob = Omit<StudioJob, 'kind'> & {kind:'image'};
export const IMAGE_PROMPT_LIMIT = 600;
export const IMAGE_STEPS = 9;
export const IMAGE_SIZES = ['1024*1024', '1280*768', '768*1280'] as const;

function exactImageEngine(value: ImageEngine): boolean {
  return !!value && value.id === 'zimage-turbo-gpu' && typeof value.revision === 'string' &&
    /^[A-Za-z0-9._-]{1,128}$/.test(value.revision) && value.operation === 'text-to-image' &&
    Array.isArray(value.sizes) && value.sizes.length > 0 && value.sizes.every(size => (IMAGE_SIZES as readonly string[]).includes(size));
}

export async function listImageEngines(origin:string): Promise<ImageEngine[]> {
  return (await listSupportedStudioEngines(origin)).filter((engine): engine is ImageEngine => engine.operation === 'text-to-image');
}

function parseImageJob(value:ImageJob): ImageJob {
  if (!value || value.kind !== 'image') throw new Error('Media Lab returned a different job kind.');
  return {...parseJob(value),kind:'image'};
}

/** Caller persists the exact request first. Size must be one the engine advertises. */
export async function submitImageJob(origin:string, requestId:string, engine:ImageEngine, prompt:string, size:string, seed:number): Promise<ImageJob> {
  if (!/^[A-Za-z0-9_-]{16,128}$/.test(requestId)) throw new Error('A stable request identity is required.');
  if (!exactImageEngine(engine)) throw new Error('This exact image engine is unavailable.');
  const description = prompt.trim();
  if (!description || description.length > IMAGE_PROMPT_LIMIT) throw new Error(`Describe the image in up to ${IMAGE_PROMPT_LIMIT} characters.`);
  if (!engine.sizes.includes(size)) throw new Error('Choose a supported image size.');
  if (!Number.isSafeInteger(seed) || seed < 0 || seed >= 2**32) throw new Error('Invalid image seed.');
  return parseImageJob(await request(origin, '/api/studio/jobs', {
    method:'POST', headers:{...await headers(origin),'Content-Type':'application/json'},
    body:JSON.stringify({requestId,engineId:engine.id,revision:engine.revision,kind:'image',prompt:description,
      settings:{operation:'text-to-image',size,steps:IMAGE_STEPS,seed}}),
  }, response => response.json()));
}

export async function readImageJob(origin:string, id:string, cancel=false): Promise<ImageJob> {
  if (!hex32.test(id)) throw new Error('Invalid job identity.');
  const value = parseImageJob(await request(origin, `/api/studio/jobs/${id}${cancel ? '/cancel' : ''}`, {
    method:cancel ? 'POST' : 'GET',headers:await headers(origin),
  }, response => response.json()));
  if (value.id !== id) throw new Error('Media Lab returned a different job.');
  return value;
}

function exactVideoEngine(value: VideoEngine): boolean {
  return !!value && value.id === 'wan22-ti2v-5b-gpu' && typeof value.revision === 'string' &&
    /^[A-Za-z0-9._-]{1,128}$/.test(value.revision) && value.operation === 'text-to-video' &&
    Number.isSafeInteger(value.maxFrames) && value.maxFrames >= VIDEO_MIN_FRAMES && value.maxFrames <= 601 &&
    Number.isSafeInteger(value.fps) && value.fps > 0 && value.fps <= 60 &&
    Array.isArray(value.sizes) && value.sizes.length > 0 && value.sizes.every(size => (VIDEO_SIZES as readonly string[]).includes(size));
}

export async function listVideoEngines(origin:string): Promise<VideoEngine[]> {
  return (await listSupportedStudioEngines(origin)).filter((engine): engine is VideoEngine => engine.operation === 'text-to-video');
}

function parseVideoJob(value:VideoJob): VideoJob {
  if (!value || value.kind !== 'video') throw new Error('Media Lab returned a different job kind.');
  return {...parseJob({...value,kind:'image'}),kind:'video'};
}

/** Caller persists the exact request first. Frames must be 4n+1 within the engine's limit; size must be one it advertises. */
export async function submitVideoJob(origin:string, requestId:string, engine:VideoEngine, prompt:string, frames:number, size:string, seed:number): Promise<VideoJob> {
  if (!/^[A-Za-z0-9_-]{16,128}$/.test(requestId)) throw new Error('A stable request identity is required.');
  if (!exactVideoEngine(engine)) throw new Error('This exact video engine is unavailable.');
  const description = prompt.trim();
  if (!description || description.length > VIDEO_PROMPT_LIMIT) throw new Error(`Describe the clip in up to ${VIDEO_PROMPT_LIMIT} characters.`);
  if (!Number.isSafeInteger(frames) || frames < VIDEO_MIN_FRAMES || frames > engine.maxFrames || frames % 4 !== 1) throw new Error('Choose a supported clip length.');
  if (!engine.sizes.includes(size)) throw new Error('Choose a supported clip size.');
  if (!Number.isSafeInteger(seed) || seed < 0 || seed >= 2**32) throw new Error('Invalid video seed.');
  return parseVideoJob(await request(origin, '/api/studio/jobs', {
    method:'POST', headers:{...await headers(origin),'Content-Type':'application/json'},
    body:JSON.stringify({requestId,engineId:engine.id,revision:engine.revision,kind:'video',prompt:description,
      settings:{operation:'text-to-video',frames,size,steps:VIDEO_STEPS,seed}}),
  }, response => response.json()));
}

export async function readVideoJob(origin:string, id:string, cancel=false): Promise<VideoJob> {
  if (!hex32.test(id)) throw new Error('Invalid job identity.');
  const value = parseVideoJob(await request(origin, `/api/studio/jobs/${id}${cancel ? '/cancel' : ''}`, {
    method:cancel ? 'POST' : 'GET',headers:await headers(origin),
  }, response => response.json()));
  if (value.id !== id) throw new Error('Media Lab returned a different job.');
  return value;
}

function exactMusicEngine(value: MusicEngine): boolean {
  return !!value && value.id === 'acestep-gpu' && typeof value.revision === 'string' &&
    /^[A-Za-z0-9._-]{1,128}$/.test(value.revision) && value.operation === 'compose' &&
    Number.isSafeInteger(value.maxSeconds) && value.maxSeconds >= MUSIC_MIN_SECONDS && value.maxSeconds <= 600;
}

export async function listMusicEngines(origin:string): Promise<MusicEngine[]> {
  return (await listSupportedStudioEngines(origin)).filter((engine): engine is MusicEngine => engine.operation === 'compose');
}

function parseMusicJob(value:MusicJob): MusicJob {
  if (!value || value.kind !== 'audio') throw new Error('Media Lab returned a different job kind.');
  return {...parseJob({...value,kind:'image'}),kind:'audio'};
}

/** Caller persists the exact request first. Lyrics empty means instrumental. */
export async function submitMusicJob(origin:string, requestId:string, engine:MusicEngine, prompt:string, lyrics:string, seconds:number, seed:number): Promise<MusicJob> {
  if (!/^[A-Za-z0-9_-]{16,128}$/.test(requestId)) throw new Error('A stable request identity is required.');
  if (!exactMusicEngine(engine)) throw new Error('This exact music engine is unavailable.');
  const description = prompt.trim();
  if (!description || description.length > MUSIC_PROMPT_LIMIT) throw new Error(`Describe the music in up to ${MUSIC_PROMPT_LIMIT} characters.`);
  if (lyrics.length > MUSIC_LYRICS_LIMIT) throw new Error(`Lyrics must be at most ${MUSIC_LYRICS_LIMIT} characters.`);
  if (!Number.isSafeInteger(seconds) || seconds < MUSIC_MIN_SECONDS || seconds > engine.maxSeconds) throw new Error(`Choose between ${MUSIC_MIN_SECONDS} and ${engine.maxSeconds} seconds.`);
  if (!Number.isSafeInteger(seed) || seed < 0 || seed >= 2**32) throw new Error('Invalid music seed.');
  return parseMusicJob(await request(origin, '/api/studio/jobs', {
    method:'POST', headers:{...await headers(origin),'Content-Type':'application/json'},
    body:JSON.stringify({requestId,engineId:engine.id,revision:engine.revision,kind:'audio',prompt:description,
      settings:{operation:'compose',lyrics:lyrics.trim() || '[inst]',seconds,seed}}),
  }, response => response.json()));
}

export async function readMusicJob(origin:string, id:string, cancel=false): Promise<MusicJob> {
  if (!hex32.test(id)) throw new Error('Invalid job identity.');
  const value = parseMusicJob(await request(origin, `/api/studio/jobs/${id}${cancel ? '/cancel' : ''}`, {
    method:cancel ? 'POST' : 'GET',headers:await headers(origin),
  }, response => response.json()));
  if (value.id !== id) throw new Error('Media Lab returned a different job.');
  return value;
}

function exactSpeechEngine(value: SpeechEngine): boolean {
  return !!value && value.id === 'chatterbox-english-cpu' && typeof value.revision === 'string' &&
    /^[A-Za-z0-9._-]{1,128}$/.test(value.revision) && value.operation === 'speak' &&
    value.voice === 'upstream-default-english' && value.language === 'en';
}

export async function listSpeechEngines(origin:string): Promise<SpeechEngine[]> {
  return (await listSupportedStudioEngines(origin)).filter((engine): engine is SpeechEngine => engine.operation === 'speak');
}

function parseSpeechJob(value:SpeechJob): SpeechJob {
  if (!value || value.kind !== 'audio') throw new Error('Media Lab returned a different job kind.');
  return {...parseJob({...value,kind:'image'}),kind:'audio'};
}

/** Caller persists the exact request, engine, text and seed before sending. */
export async function submitSpeechJob(origin:string, requestId:string, engine:SpeechEngine, text:string, seed:number): Promise<SpeechJob> {
  if (!/^[A-Za-z0-9_-]{16,128}$/.test(requestId)) throw new Error('A stable request identity is required.');
  if (!exactSpeechEngine(engine)) throw new Error('This exact speech engine is unavailable.');
  const prompt = text.trim();
  if (!prompt || prompt.length > SPEECH_TEXT_LIMIT) throw new Error(`Enter up to ${SPEECH_TEXT_LIMIT} characters of English text.`);
  if (!Number.isSafeInteger(seed) || seed < 0 || seed >= 2**32) throw new Error('Invalid speech seed.');
  return parseSpeechJob(await request(origin, '/api/studio/jobs', {
    method:'POST', headers:{...await headers(origin),'Content-Type':'application/json'},
    body:JSON.stringify({requestId,engineId:engine.id,revision:engine.revision,kind:'audio',prompt,
      settings:{operation:'speak',voice:engine.voice,seed}}),
  }, response => response.json()));
}

export async function readSpeechJob(origin:string, id:string, cancel=false): Promise<SpeechJob> {
  if (!hex32.test(id)) throw new Error('Invalid job identity.');
  const value = parseSpeechJob(await request(origin, `/api/studio/jobs/${id}${cancel ? '/cancel' : ''}`, {
    method:cancel ? 'POST' : 'GET',headers:await headers(origin),
  }, response => response.json()));
  if (value.id !== id) throw new Error('Media Lab returned a different job.');
  return value;
}
export type ModelJob = Omit<StudioJob, 'kind'> & {kind:'model'};
const modelVariant = 'triposr-cpu-f32-seed7-res128-vertex-color-v1';
const modelRevision = 'f72bb520b8b1a5639600ac818496f22d6ccb3b42d3942412bd1e2375ef780a2b';

function exactModelEngine(value: ModelEngine): boolean {
  return !!value && value.id === 'triposr-cpu' && value.revision === modelRevision &&
    value.operation === 'image-to-3d' && value.variant === modelVariant;
}

export async function listModelEngines(origin:string): Promise<ModelEngine[]> {
  return (await listSupportedStudioEngines(origin)).filter((engine): engine is ModelEngine => engine.operation === 'image-to-3d');
}

/** Only operations this client can use; server advertisements are not installation receipts. */
export async function listSupportedStudioEngines(origin: string): Promise<(BackgroundEngine | ModelEngine | SpeechEngine | MusicEngine | VideoEngine | ImageEngine)[]> {
  const value = await request(origin, '/api/studio/engines', {headers:await headers(origin)}, async response => {
    if (Number(response.headers.get('Content-Length')) > 65536) throw new Error('Media Lab returned an oversized capability list.');
    let body: string;
    if (response.body?.getReader) {
      const reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let size = 0;
      try {
        while (true) {
          const {done, value:chunk} = await reader.read();
          if (done) break;
          size += chunk.byteLength;
          if (size > 65536) {
            await reader.cancel();
            throw new Error('Media Lab returned an oversized capability list.');
          }
          chunks.push(chunk);
        }
      } finally { reader.releaseLock(); }
      const bytes = new Uint8Array(size);
      let offset = 0;
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
      body = new TextDecoder().decode(bytes);
    } else {
      // React Native fetch may expose only a buffered response.
      body = await response.text();
      if (new TextEncoder().encode(body).byteLength > 65536) throw new Error('Media Lab returned an oversized capability list.');
    }
    try { return JSON.parse(body); }
    catch { throw new Error('Media Lab returned an unsupported capability list.'); }
  });
  if (!value || value.version !== 1 || !Array.isArray(value.engines) || value.engines.length > 100) {
    throw new Error('Media Lab returned an unsupported capability list.');
  }
  const result: (BackgroundEngine | ModelEngine | SpeechEngine | MusicEngine | VideoEngine | ImageEngine)[] = [];
  const seen = new Set<string>();
  for (const engine of value.engines) {
    let supported: BackgroundEngine | ModelEngine | SpeechEngine | MusicEngine | VideoEngine | ImageEngine | undefined;
    if (engine && engine.operation === 'remove-background' && typeof engine.id === 'string' &&
        /^[A-Za-z0-9_-]{1,80}$/.test(engine.id) && typeof engine.revision === 'string' &&
        /^[A-Za-z0-9._-]{1,128}$/.test(engine.revision)) {
      supported = {id:engine.id, revision:engine.revision, operation:engine.operation};
    } else if (exactModelEngine(engine)) {
      supported = {id:engine.id, revision:engine.revision, operation:engine.operation, variant:engine.variant};
    } else if (exactSpeechEngine(engine)) {
      supported = {id:engine.id, revision:engine.revision, operation:'speak', voice:engine.voice, language:'en'};
    } else if (exactMusicEngine(engine)) {
      supported = {id:engine.id, revision:engine.revision, operation:'compose', maxSeconds:engine.maxSeconds};
    } else if (exactVideoEngine(engine)) {
      supported = {id:engine.id, revision:engine.revision, operation:'text-to-video', maxFrames:engine.maxFrames, fps:engine.fps, sizes:[...engine.sizes]};
    } else if (exactImageEngine(engine)) {
      supported = {id:engine.id, revision:engine.revision, operation:'text-to-image', sizes:[...engine.sizes]};
    }
    if (supported) {
      const key = JSON.stringify(supported);
      if (!seen.has(key)) { seen.add(key); result.push(supported); }
    }
  }
  return result;
}

function parseModelJob(value:ModelJob): ModelJob {
  if (!value || value.kind !== 'model') throw new Error('Media Lab returned a different job kind.');
  return {...parseJob({...value,kind:'image'}),kind:'model'};
}

/** Caller must persist the exact request, engine and input before sending. */
export async function submitModelJob(origin:string, requestId:string, engine:ModelEngine, input:StudioInput): Promise<ModelJob> {
  if (!/^[A-Za-z0-9_-]{16,128}$/.test(requestId)) throw new Error('A stable request identity is required.');
  if (!exactModelEngine(engine)) throw new Error('This exact 3D model variant is unavailable.');
  parseStudioInput({...input,version:1});
  return parseModelJob(await request(origin, '/api/studio/jobs', {
    method:'POST', headers:{...await headers(origin),'Content-Type':'application/json'},
    body:JSON.stringify({requestId,engineId:engine.id,revision:engine.revision,kind:'model',prompt:'Make a draft 3D asset',
      settings:{operation:engine.operation,variant:engine.variant,inputId:input.id,inputSha256:input.sha256}}),
  }, response => response.json()));
}

export async function readModelJob(origin:string, id:string, cancel=false): Promise<ModelJob> {
  if (!hex32.test(id)) throw new Error('Invalid job identity.');
  const value = parseModelJob(await request(origin, `/api/studio/jobs/${id}${cancel ? '/cancel' : ''}`, {
    method:cancel ? 'POST' : 'GET',headers:await headers(origin),
  }, response => response.json()));
  if (value.id !== id) throw new Error('Media Lab returned a different job.');
  return value;
}
