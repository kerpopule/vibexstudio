import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Crypto from 'expo-crypto';
import {libraryOrigin} from '@/lib/library-core';
import {submitVideoJob, readVideoJob, VIDEO_PROMPT_LIMIT, VIDEO_MIN_FRAMES, type VideoEngine, type VideoJob} from '@/lib/remote-generation';

const prefix = 'vibex.video.v1.';
export type VideoRequest = {version:1; requestId:string; origin:string; agentOwner?:string; prompt:string; frames:number; size:string; seed:number; createdAt:number;
  engine:VideoEngine; job:VideoJob|null; cancelRequested:boolean; libraryAssetId?:string};
const operations = new Map<string, Promise<VideoRequest>>();

function key(id: string) {
  if (!/^[a-f0-9]{32}$/.test(id)) throw new Error('Invalid saved request identity.');
  return prefix+id;
}
function decode(raw: string, id: string): VideoRequest {
  const value = JSON.parse(raw) as VideoRequest;
  if ((value.agentOwner !== undefined && !/^[a-f0-9]{24}$/.test(value.agentOwner)) ||
      value.version !== 1 || value.requestId !== id || libraryOrigin(value.origin) !== value.origin ||
      typeof value.prompt !== 'string' || !value.prompt.trim() || value.prompt.length > VIDEO_PROMPT_LIMIT ||
      !Number.isSafeInteger(value.frames) || value.frames < VIDEO_MIN_FRAMES || value.frames > 601 || value.frames % 4 !== 1 ||
      typeof value.size !== 'string' || !/^\d{3,4}\*\d{3,4}$/.test(value.size) ||
      !Number.isSafeInteger(value.seed) || value.seed < 0 || !Number.isSafeInteger(value.createdAt) || typeof value.cancelRequested !== 'boolean' ||
      (value.libraryAssetId !== undefined && (typeof value.libraryAssetId !== 'string' || !/^[A-Za-z0-9._-]{1,200}$/.test(value.libraryAssetId))) ||
      !value.engine || value.engine.id !== 'wan22-ti2v-5b-gpu' || value.engine.operation !== 'text-to-video' ||
      !Number.isSafeInteger(value.engine.maxFrames) || !Array.isArray(value.engine.sizes) || typeof value.engine.revision !== 'string' || !value.engine.revision ||
      (value.job !== null && (!/^[a-f0-9]{32}$/.test(value.job.id) || value.job.kind !== 'video' ||
        !['queued','running','cancel_requested','cancelled','failed','succeeded'].includes(value.job.status)))) {
    throw new Error('A saved video request could not be read.');
  }
  return value;
}
async function load(id: string): Promise<VideoRequest> {
  const raw = await AsyncStorage.getItem(key(id));
  if (!raw) throw new Error('This saved request is unavailable.');
  return decode(raw,id);
}
async function save(value: VideoRequest) { await AsyncStorage.setItem(key(value.requestId),JSON.stringify(value)); }

export async function listVideoRequests(origin: string): Promise<VideoRequest[]> {
  const normalized = libraryOrigin(origin);
  const keys = (await AsyncStorage.getAllKeys()).filter((item) => item.startsWith(prefix));
  const rows = await AsyncStorage.multiGet(keys);
  const requests: VideoRequest[] = [];
  for (const [storedKey, raw] of rows) {
    if (!raw) continue;
    const value = decode(raw,storedKey.slice(prefix.length));
    if (value.origin === normalized) requests.push(value);
  }
  return requests.sort((a,b) => b.createdAt-a.createdAt);
}

/** Persist the exact description, length, size, seed and engine first so a lost reply can be recovered by request ID. */
export async function prepareVideoRequest(origin: string, engine: VideoEngine, prompt: string, frames: number, size: string, seed = Math.floor(Math.random() * 2**31), options: {requestId?:string; agentOwner?:string} = {}): Promise<VideoRequest> {
  const trimmed = prompt.trim();
  if (!trimmed || trimmed.length > VIDEO_PROMPT_LIMIT) throw new Error(`Describe the clip in up to ${VIDEO_PROMPT_LIMIT} characters.`);
  if (!Number.isSafeInteger(frames) || frames < VIDEO_MIN_FRAMES || frames > engine.maxFrames || frames % 4 !== 1) throw new Error('Choose a supported clip length.');
  if (!engine.sizes.includes(size)) throw new Error('Choose a supported clip size.');
  const value: VideoRequest = {version:1,
    requestId:options.requestId ?? Array.from(Crypto.getRandomBytes(16), (byte) => byte.toString(16).padStart(2,'0')).join(''),
    ...(options.agentOwner ? {agentOwner:options.agentOwner} : {}),
    origin:libraryOrigin(origin), prompt:trimmed, frames, size, seed, createdAt:Date.now(), engine:{...engine, sizes:[...engine.sizes]}, job:null, cancelRequested:false};
  await save(value);
  return value;
}

/** One saved request by its storage id; agent tools use this to recover their own work. */
export async function findVideoRequest(id: string): Promise<VideoRequest|null> {
  const raw = await AsyncStorage.getItem(key(id));
  return raw ? decode(raw,id) : null;
}

export async function advanceVideoRequest(id: string, cancel = false): Promise<VideoRequest> {
  const existing = operations.get(id);
  if (existing) {
    if (!cancel) return existing;
    try { await existing; } catch { /* cancellation still needs to be persisted */ }
    return advanceVideoRequest(id,true);
  }
  const run = async () => {
    let value = await load(id);
    if (cancel && !value.cancelRequested) {value = {...value,cancelRequested:true};await save(value);}
    if (value.job && ['succeeded','failed','cancelled'].includes(value.job.status)) return value;
    if (!value.job) {
      value = {...value,job:await submitVideoJob(value.origin,value.requestId,value.engine,value.prompt,value.frames,value.size,value.seed)};
      await save(value);
    }
    const job = await readVideoJob(value.origin,value.job!.id,value.cancelRequested);
    value = {...value,job};
    await save(value);
    return value;
  };
  const locks = typeof navigator !== 'undefined' ? navigator.locks : undefined;
  const operation = locks ? locks.request(key(id),run) : run();
  operations.set(id,operation);
  try {return await operation;} finally {if (operations.get(id) === operation) operations.delete(id);}
}

/** Remember a completed Library save so the panel does not offer it again after a reload. */
export async function markVideoSaved(id: string, assetId: string): Promise<VideoRequest> {
  if (!/^[A-Za-z0-9._-]{1,200}$/.test(assetId)) throw new Error('Invalid Library asset identity.');
  const value = {...await load(id), libraryAssetId:assetId};
  await save(value);
  return value;
}
