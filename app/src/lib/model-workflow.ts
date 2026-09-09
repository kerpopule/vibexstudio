import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Crypto from 'expo-crypto';
import {libraryOrigin} from '@/lib/library-core';
import {snapshotStudioImage, submitModelJob, readModelJob, type ModelEngine, type StudioInput, type ModelJob} from '@/lib/remote-generation';

export type ModelSource = {id:string;serverUrl:string;title:string};

const prefix = 'vibex.model.v1.';
export type ModelRequest = {version:1; requestId:string; origin:string; assetId:string; title:string; createdAt:number;
  engine:ModelEngine; input:StudioInput; job:ModelJob|null; cancelRequested:boolean};
const operations = new Map<string, Promise<ModelRequest>>();
const preparations = new Map<string, Promise<ModelRequest>>();

function key(id: string) {
  if (!/^[a-f0-9]{32}$/.test(id)) throw new Error('Invalid saved request identity.');
  return prefix+id;
}
function decode(raw: string, id: string): ModelRequest {
  const value = JSON.parse(raw) as ModelRequest;
  if (value.version !== 1 || value.requestId !== id || libraryOrigin(value.origin) !== value.origin ||
      !/^[a-f0-9]{32}$/.test(value.assetId) ||
      typeof value.title !== 'string' || !Number.isSafeInteger(value.createdAt) || typeof value.cancelRequested !== 'boolean' ||
      !value.engine || value.engine.operation !== 'image-to-3d' || !/^[A-Za-z0-9_-]{1,80}$/.test(value.engine.id) ||
      typeof value.engine.revision !== 'string' || !value.engine.revision || typeof value.engine.variant !== 'string' || !value.engine.variant || !value.input ||
      !/^[a-f0-9]{32}$/.test(value.input.id) || !/^[a-f0-9]{64}$/.test(value.input.sha256) ||
      (value.job !== null && (!/^[a-f0-9]{32}$/.test(value.job.id) || value.job.kind !== 'model' ||
        !['queued','running','cancel_requested','cancelled','failed','succeeded'].includes(value.job.status)))) {
    throw new Error('A saved 3D generation request could not be read.');
  }
  return value;
}
async function load(id: string): Promise<ModelRequest> {
  const raw = await AsyncStorage.getItem(key(id));
  if (!raw) throw new Error('This saved request is unavailable.');
  return decode(raw,id);
}
async function save(value: ModelRequest) { await AsyncStorage.setItem(key(value.requestId),JSON.stringify(value)); }

export async function listModelRequests(origin: string): Promise<ModelRequest[]> {
  const normalized = libraryOrigin(origin);
  const keys = (await AsyncStorage.getAllKeys()).filter((item) => item.startsWith(prefix));
  const rows = await AsyncStorage.multiGet(keys);
  const requests: ModelRequest[] = [];
  for (const [storedKey, raw] of rows) {
    if (!raw) continue;
    const value = decode(raw,storedKey.slice(prefix.length));
    if (value.origin === normalized) requests.push(value);
  }
  return requests.sort((a,b) => b.createdAt-a.createdAt);
}

/** Save the exact accepted input before any generation submission can happen. */
export async function prepareModelRequest(asset: ModelSource, engine: ModelEngine): Promise<ModelRequest> {
  if (!/^[a-f0-9]{32}$/.test(asset.id)) throw new Error('Choose a completed image job.');
  const identity = libraryOrigin(asset.serverUrl)+'/'+asset.id+'/'+engine.id+'/'+engine.revision+'/'+engine.variant;
  const existing = preparations.get(identity);
  if (existing) return existing;
  const locks = typeof navigator !== 'undefined' ? navigator.locks : undefined;
  const prepare = () => prepareOnce(asset,engine);
  const operation = locks ? locks.request(prefix+'prepare.'+identity,prepare) : prepare();
  preparations.set(identity,operation);
  try {return await operation;} finally {if (preparations.get(identity) === operation) preparations.delete(identity);}
}

async function prepareOnce(asset: ModelSource, engine: ModelEngine): Promise<ModelRequest> {
  const pending = (await listModelRequests(asset.serverUrl)).find((item) => item.assetId === asset.id && item.engine.id === engine.id && item.engine.revision === engine.revision && item.engine.variant === engine.variant &&
    (!item.job || !['succeeded','failed','cancelled'].includes(item.job.status)));
  if (pending) return pending;
  const input = await snapshotStudioImage(asset.serverUrl,asset.id);
  const value: ModelRequest = {version:1,
    requestId:Array.from(Crypto.getRandomBytes(16), (byte) => byte.toString(16).padStart(2,'0')).join(''),
    origin:libraryOrigin(asset.serverUrl), assetId:asset.id, title:asset.title, createdAt:Date.now(), engine:{...engine}, input,
    job:null, cancelRequested:false};
  await save(value);
  return value;
}

/** Unknown acceptance is recovered by the server's exact request-ID contract. */
export async function advanceModelRequest(id: string, cancel = false): Promise<ModelRequest> {
  const existing = operations.get(id);
  if (existing) {
    if (!cancel) return existing;
    try { await existing; } catch { /* cancellation still needs to be persisted */ }
    return advanceModelRequest(id,true);
  }
  const run = async () => {
    let value = await load(id);
    if (cancel && !value.cancelRequested) {value = {...value,cancelRequested:true};await save(value);}
    if (value.job && ['succeeded','failed','cancelled'].includes(value.job.status)) return value;
    if (!value.job) {
      value = {...value,job:await submitModelJob(value.origin,value.requestId,value.engine,value.input)};
      await save(value);
    }
    const job = await readModelJob(value.origin,value.job!.id,value.cancelRequested);
    value = {...value,job};
    await save(value);
    return value;
  };
  const locks = typeof navigator !== 'undefined' ? navigator.locks : undefined;
  const operation = locks ? locks.request(key(id),run) : run();
  operations.set(id,operation);
  try {return await operation;} finally {if (operations.get(id) === operation) operations.delete(id);}
}
