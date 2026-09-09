import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Crypto from 'expo-crypto';
import {libraryOrigin, type RemoteLibraryAsset} from '@/lib/library-core';
import {snapshotRemoteImage, submitBackgroundJob, cancelBackgroundRequest, readStudioJob, type BackgroundEngine, type StudioInput, type StudioJob} from '@/lib/remote-generation';

const prefix = 'vibex.background.v1.';
export type BackgroundRequest = {version:1; requestId:string; origin:string; assetId:string; title:string; createdAt:number;
  agentOwner?:string; engine:BackgroundEngine; input:StudioInput; job:StudioJob|null; cancelRequested:boolean};
const operations = new Map<string, Promise<BackgroundRequest>>();
const preparations = new Map<string, Promise<BackgroundRequest>>();

function key(id: string) {
  if (!/^[a-f0-9]{32}$/.test(id)) throw new Error('Invalid saved request identity.');
  return prefix+id;
}
function decode(raw: string, id: string): BackgroundRequest {
  const value = JSON.parse(raw) as BackgroundRequest;
  if ((value.agentOwner !== undefined && !/^[a-f0-9]{24}$/.test(value.agentOwner)) || value.version !== 1 || value.requestId !== id || libraryOrigin(value.origin) !== value.origin ||
      !/^[A-Za-z0-9_-]{1,128}$/.test(value.assetId) ||
      typeof value.title !== 'string' || !Number.isSafeInteger(value.createdAt) || typeof value.cancelRequested !== 'boolean' ||
      !value.engine || value.engine.operation !== 'remove-background' || !/^[A-Za-z0-9_-]{1,80}$/.test(value.engine.id) ||
      typeof value.engine.revision !== 'string' || !value.engine.revision || !value.input ||
      !/^[a-f0-9]{32}$/.test(value.input.id) || !/^[a-f0-9]{64}$/.test(value.input.sha256) ||
      (value.job !== null && (!/^[a-f0-9]{32}$/.test(value.job.id) || value.job.kind !== 'image' ||
        !['queued','running','cancel_requested','cancelled','failed','succeeded'].includes(value.job.status)))) {
    throw new Error('A saved background-removal request could not be read.');
  }
  return value;
}
async function load(id: string): Promise<BackgroundRequest> {
  const raw = await AsyncStorage.getItem(key(id));
  if (!raw) throw new Error('This saved request is unavailable.');
  return decode(raw,id);
}
async function save(value: BackgroundRequest) { await AsyncStorage.setItem(key(value.requestId),JSON.stringify(value)); }

export async function listBackgroundRequests(origin: string): Promise<BackgroundRequest[]> {
  const normalized = libraryOrigin(origin);
  const keys = (await AsyncStorage.getAllKeys()).filter((item) => item.startsWith(prefix));
  const rows = await AsyncStorage.multiGet(keys);
  const requests: BackgroundRequest[] = [];
  for (const [storedKey, raw] of rows) {
    if (!raw) continue;
    const value = decode(raw,storedKey.slice(prefix.length));
    if (value.origin === normalized) requests.push(value);
  }
  return requests.sort((a,b) => b.createdAt-a.createdAt);
}

/** Save the exact accepted input before any generation submission can happen. */
export async function prepareBackgroundRequest(asset: RemoteLibraryAsset, engine: BackgroundEngine): Promise<BackgroundRequest> {
  const identity = libraryOrigin(asset.serverUrl)+'/'+asset.id;
  const existing = preparations.get(identity);
  if (existing) return existing;
  const locks = typeof navigator !== 'undefined' ? navigator.locks : undefined;
  const prepare = () => prepareOnce(asset,engine);
  const operation = locks ? locks.request(prefix+'prepare.'+identity,prepare) : prepare();
  preparations.set(identity,operation);
  try {return await operation;} finally {if (preparations.get(identity) === operation) preparations.delete(identity);}
}

async function prepareOnce(asset: RemoteLibraryAsset, engine: BackgroundEngine): Promise<BackgroundRequest> {
  const pending = (await listBackgroundRequests(asset.serverUrl)).find((item) => item.assetId === asset.id &&
    !item.agentOwner && (!item.job || !['succeeded','failed','cancelled'].includes(item.job.status)));
  if (pending) return pending;
  const input = await snapshotRemoteImage(asset);
  const value: BackgroundRequest = {version:1,
    requestId:Array.from(Crypto.getRandomBytes(16), (byte) => byte.toString(16).padStart(2,'0')).join(''),
    origin:libraryOrigin(asset.serverUrl), assetId:asset.id, title:asset.title, createdAt:Date.now(), engine:{...engine}, input,
    job:null, cancelRequested:false};
  await save(value);
  return value;
}

/** Unknown acceptance is recovered by the server's exact request-ID contract. */
export async function advanceBackgroundRequest(id: string, cancel = false): Promise<BackgroundRequest> {
  const existing = operations.get(id);
  if (existing) {
    if (!cancel) return existing;
    try { await existing; } catch { /* cancellation still needs to be persisted */ }
    return advanceBackgroundRequest(id,true);
  }
  const run = async () => {
    let value = await load(id);
    if (cancel && !value.cancelRequested) {value = {...value,cancelRequested:true};await save(value);}
    if (value.job && ['succeeded','failed','cancelled'].includes(value.job.status)) return value;
    if (!value.job) {
      value = {...value,job:await (value.cancelRequested ? cancelBackgroundRequest : submitBackgroundJob)(value.origin,value.requestId,value.engine,value.input)};
      await save(value);
      if (['succeeded','failed','cancelled'].includes(value.job!.status)) return value;
    }
    const job = await readStudioJob(value.origin,value.job!.id,value.cancelRequested);
    value = {...value,job};
    await save(value);
    return value;
  };
  const locks = typeof navigator !== 'undefined' ? navigator.locks : undefined;
  const operation = locks ? locks.request(key(id),run) : run();
  operations.set(id,operation);
  try {return await operation;} finally {if (operations.get(id) === operation) operations.delete(id);}
}


/** Agent requests have a stable, owner-derived identity and never reuse a manual request. */
export async function prepareAgentBackgroundRequest(asset: RemoteLibraryAsset, engine: BackgroundEngine, owner: string, id: string): Promise<BackgroundRequest> {
  key(id);
  if (!/^[a-f0-9]{24}$/.test(owner)) throw new Error('Invalid agent identity.');
  const matches = (value: BackgroundRequest) => {
    if (value.agentOwner !== owner || value.origin !== libraryOrigin(asset.serverUrl) || value.assetId !== asset.id ||
        value.engine.id !== engine.id || value.engine.revision !== engine.revision || value.engine.operation !== engine.operation) {
      throw new Error('This request identity is already used for different media or engine settings. Use a new requestId.');
    }
    return value;
  };
  const identity = key(id)+'.prepare';
  const existing = preparations.get(identity);
  if (existing) return matches(await existing);
  const run = async () => {
    const saved = await AsyncStorage.getItem(key(id));
    if (saved) return matches(decode(saved,id));
    const input = await snapshotRemoteImage(asset);
    const value: BackgroundRequest = {version:1,requestId:id,agentOwner:owner,
      origin:libraryOrigin(asset.serverUrl),assetId:asset.id,title:asset.title,createdAt:Date.now(),
      engine:{...engine},input,job:null,cancelRequested:false};
    await save(value);
    return value;
  };
  const locks = typeof navigator !== 'undefined' ? navigator.locks : undefined;
  const operation = locks ? locks.request(identity,run) : run();
  preparations.set(identity,operation);
  try {return matches(await operation);} finally {if(preparations.get(identity)===operation)preparations.delete(identity);}
}

export async function findBackgroundRequest(id: string): Promise<BackgroundRequest|null> {
  const raw = await AsyncStorage.getItem(key(id));
  return raw ? decode(raw,id) : null;
}
