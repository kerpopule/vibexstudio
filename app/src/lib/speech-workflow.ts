import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Crypto from 'expo-crypto';
import {libraryOrigin} from '@/lib/library-core';
import {submitSpeechJob, readSpeechJob, SPEECH_TEXT_LIMIT, type SpeechEngine, type SpeechJob} from '@/lib/remote-generation';

const prefix = 'vibex.speech.v1.';
export type SpeechRequest = {version:1; requestId:string; origin:string; agentOwner?:string; text:string; seed:number; createdAt:number;
  engine:SpeechEngine; job:SpeechJob|null; cancelRequested:boolean; libraryAssetId?:string};
const operations = new Map<string, Promise<SpeechRequest>>();

function key(id: string) {
  if (!/^[a-f0-9]{32}$/.test(id)) throw new Error('Invalid saved request identity.');
  return prefix+id;
}
function decode(raw: string, id: string): SpeechRequest {
  const value = JSON.parse(raw) as SpeechRequest;
  if ((value.agentOwner !== undefined && !/^[a-f0-9]{24}$/.test(value.agentOwner)) ||
      value.version !== 1 || value.requestId !== id || libraryOrigin(value.origin) !== value.origin ||
      typeof value.text !== 'string' || !value.text.trim() || value.text.length > SPEECH_TEXT_LIMIT ||
      !Number.isSafeInteger(value.seed) || value.seed < 0 || !Number.isSafeInteger(value.createdAt) || typeof value.cancelRequested !== 'boolean' ||
      (value.libraryAssetId !== undefined && (typeof value.libraryAssetId !== 'string' || !/^[A-Za-z0-9._-]{1,200}$/.test(value.libraryAssetId))) ||
      !value.engine || value.engine.id !== 'chatterbox-english-cpu' || value.engine.operation !== 'speak' ||
      value.engine.voice !== 'upstream-default-english' || typeof value.engine.revision !== 'string' || !value.engine.revision ||
      (value.job !== null && (!/^[a-f0-9]{32}$/.test(value.job.id) || value.job.kind !== 'audio' ||
        !['queued','running','cancel_requested','cancelled','failed','succeeded'].includes(value.job.status)))) {
    throw new Error('A saved speech request could not be read.');
  }
  return value;
}
async function load(id: string): Promise<SpeechRequest> {
  const raw = await AsyncStorage.getItem(key(id));
  if (!raw) throw new Error('This saved request is unavailable.');
  return decode(raw,id);
}
async function save(value: SpeechRequest) { await AsyncStorage.setItem(key(value.requestId),JSON.stringify(value)); }

export async function listSpeechRequests(origin: string): Promise<SpeechRequest[]> {
  const normalized = libraryOrigin(origin);
  const keys = (await AsyncStorage.getAllKeys()).filter((item) => item.startsWith(prefix));
  const rows = await AsyncStorage.multiGet(keys);
  const requests: SpeechRequest[] = [];
  for (const [storedKey, raw] of rows) {
    if (!raw) continue;
    const value = decode(raw,storedKey.slice(prefix.length));
    if (value.origin === normalized) requests.push(value);
  }
  return requests.sort((a,b) => b.createdAt-a.createdAt);
}

/** Persist the exact text, seed and engine first so a lost reply can be recovered by request ID. */
export async function prepareSpeechRequest(origin: string, engine: SpeechEngine, text: string, seed = 7, options: {requestId?:string; agentOwner?:string} = {}): Promise<SpeechRequest> {
  const trimmed = text.trim();
  if (!trimmed || trimmed.length > SPEECH_TEXT_LIMIT) throw new Error(`Enter up to ${SPEECH_TEXT_LIMIT} characters of English text.`);
  const value: SpeechRequest = {version:1,
    requestId:options.requestId ?? Array.from(Crypto.getRandomBytes(16), (byte) => byte.toString(16).padStart(2,'0')).join(''),
    ...(options.agentOwner ? {agentOwner:options.agentOwner} : {}),
    origin:libraryOrigin(origin), text:trimmed, seed, createdAt:Date.now(), engine:{...engine}, job:null, cancelRequested:false};
  await save(value);
  return value;
}

/** One saved request by its storage id; agent tools use this to recover their own work. */
export async function findSpeechRequest(id: string): Promise<SpeechRequest|null> {
  const raw = await AsyncStorage.getItem(key(id));
  return raw ? decode(raw,id) : null;
}

export async function advanceSpeechRequest(id: string, cancel = false): Promise<SpeechRequest> {
  const existing = operations.get(id);
  if (existing) {
    if (!cancel) return existing;
    try { await existing; } catch { /* cancellation still needs to be persisted */ }
    return advanceSpeechRequest(id,true);
  }
  const run = async () => {
    let value = await load(id);
    if (cancel && !value.cancelRequested) {value = {...value,cancelRequested:true};await save(value);}
    if (value.job && ['succeeded','failed','cancelled'].includes(value.job.status)) return value;
    if (!value.job) {
      value = {...value,job:await submitSpeechJob(value.origin,value.requestId,value.engine,value.text,value.seed)};
      await save(value);
    }
    const job = await readSpeechJob(value.origin,value.job!.id,value.cancelRequested);
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
export async function markSpeechSaved(id: string, assetId: string): Promise<SpeechRequest> {
  if (!/^[A-Za-z0-9._-]{1,200}$/.test(assetId)) throw new Error('Invalid Library asset identity.');
  const value = {...await load(id), libraryAssetId:assetId};
  await save(value);
  return value;
}
