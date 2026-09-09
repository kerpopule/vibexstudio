import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Crypto from 'expo-crypto';
import {libraryOrigin} from '@/lib/library-core';
import {submitMusicJob, readMusicJob, MUSIC_PROMPT_LIMIT, MUSIC_LYRICS_LIMIT, MUSIC_MIN_SECONDS, type MusicEngine, type MusicJob} from '@/lib/remote-generation';

const prefix = 'vibex.music.v1.';
export type MusicRequest = {version:1; requestId:string; origin:string; agentOwner?:string; prompt:string; lyrics:string; seconds:number; seed:number; createdAt:number;
  engine:MusicEngine; job:MusicJob|null; cancelRequested:boolean; libraryAssetId?:string};
const operations = new Map<string, Promise<MusicRequest>>();

function key(id: string) {
  if (!/^[a-f0-9]{32}$/.test(id)) throw new Error('Invalid saved request identity.');
  return prefix+id;
}
function decode(raw: string, id: string): MusicRequest {
  const value = JSON.parse(raw) as MusicRequest;
  if ((value.agentOwner !== undefined && !/^[a-f0-9]{24}$/.test(value.agentOwner)) ||
      value.version !== 1 || value.requestId !== id || libraryOrigin(value.origin) !== value.origin ||
      typeof value.prompt !== 'string' || !value.prompt.trim() || value.prompt.length > MUSIC_PROMPT_LIMIT ||
      typeof value.lyrics !== 'string' || value.lyrics.length > MUSIC_LYRICS_LIMIT ||
      !Number.isSafeInteger(value.seconds) || value.seconds < MUSIC_MIN_SECONDS || value.seconds > 600 ||
      !Number.isSafeInteger(value.seed) || value.seed < 0 || !Number.isSafeInteger(value.createdAt) || typeof value.cancelRequested !== 'boolean' ||
      (value.libraryAssetId !== undefined && (typeof value.libraryAssetId !== 'string' || !/^[A-Za-z0-9._-]{1,200}$/.test(value.libraryAssetId))) ||
      !value.engine || value.engine.id !== 'acestep-gpu' || value.engine.operation !== 'compose' ||
      !Number.isSafeInteger(value.engine.maxSeconds) || typeof value.engine.revision !== 'string' || !value.engine.revision ||
      (value.job !== null && (!/^[a-f0-9]{32}$/.test(value.job.id) || value.job.kind !== 'audio' ||
        !['queued','running','cancel_requested','cancelled','failed','succeeded'].includes(value.job.status)))) {
    throw new Error('A saved music request could not be read.');
  }
  return value;
}
async function load(id: string): Promise<MusicRequest> {
  const raw = await AsyncStorage.getItem(key(id));
  if (!raw) throw new Error('This saved request is unavailable.');
  return decode(raw,id);
}
async function save(value: MusicRequest) { await AsyncStorage.setItem(key(value.requestId),JSON.stringify(value)); }

export async function listMusicRequests(origin: string): Promise<MusicRequest[]> {
  const normalized = libraryOrigin(origin);
  const keys = (await AsyncStorage.getAllKeys()).filter((item) => item.startsWith(prefix));
  const rows = await AsyncStorage.multiGet(keys);
  const requests: MusicRequest[] = [];
  for (const [storedKey, raw] of rows) {
    if (!raw) continue;
    const value = decode(raw,storedKey.slice(prefix.length));
    if (value.origin === normalized) requests.push(value);
  }
  return requests.sort((a,b) => b.createdAt-a.createdAt);
}

/** Persist the exact description, lyrics, length, seed and engine first so a lost reply can be recovered by request ID. */
export async function prepareMusicRequest(origin: string, engine: MusicEngine, prompt: string, lyrics: string, seconds: number, seed = Math.floor(Math.random() * 2**31), options: {requestId?:string; agentOwner?:string} = {}): Promise<MusicRequest> {
  const trimmed = prompt.trim();
  if (!trimmed || trimmed.length > MUSIC_PROMPT_LIMIT) throw new Error(`Describe the music in up to ${MUSIC_PROMPT_LIMIT} characters.`);
  if (lyrics.length > MUSIC_LYRICS_LIMIT) throw new Error(`Lyrics must be at most ${MUSIC_LYRICS_LIMIT} characters.`);
  if (!Number.isSafeInteger(seconds) || seconds < MUSIC_MIN_SECONDS || seconds > engine.maxSeconds) throw new Error(`Choose between ${MUSIC_MIN_SECONDS} and ${engine.maxSeconds} seconds.`);
  const value: MusicRequest = {version:1,
    requestId:options.requestId ?? Array.from(Crypto.getRandomBytes(16), (byte) => byte.toString(16).padStart(2,'0')).join(''),
    ...(options.agentOwner ? {agentOwner:options.agentOwner} : {}),
    origin:libraryOrigin(origin), prompt:trimmed, lyrics:lyrics.trim(), seconds, seed, createdAt:Date.now(), engine:{...engine}, job:null, cancelRequested:false};
  await save(value);
  return value;
}

/** One saved request by its storage id; agent tools use this to recover their own work. */
export async function findMusicRequest(id: string): Promise<MusicRequest|null> {
  const raw = await AsyncStorage.getItem(key(id));
  return raw ? decode(raw,id) : null;
}

export async function advanceMusicRequest(id: string, cancel = false): Promise<MusicRequest> {
  const existing = operations.get(id);
  if (existing) {
    if (!cancel) return existing;
    try { await existing; } catch { /* cancellation still needs to be persisted */ }
    return advanceMusicRequest(id,true);
  }
  const run = async () => {
    let value = await load(id);
    if (cancel && !value.cancelRequested) {value = {...value,cancelRequested:true};await save(value);}
    if (value.job && ['succeeded','failed','cancelled'].includes(value.job.status)) return value;
    if (!value.job) {
      value = {...value,job:await submitMusicJob(value.origin,value.requestId,value.engine,value.prompt,value.lyrics,value.seconds,value.seed)};
      await save(value);
    }
    const job = await readMusicJob(value.origin,value.job!.id,value.cancelRequested);
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
export async function markMusicSaved(id: string, assetId: string): Promise<MusicRequest> {
  if (!/^[A-Za-z0-9._-]{1,200}$/.test(assetId)) throw new Error('Invalid Library asset identity.');
  const value = {...await load(id), libraryAssetId:assetId};
  await save(value);
  return value;
}
