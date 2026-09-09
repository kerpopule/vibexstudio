import {audioExtension} from '@/lib/audio-file';
/**
 * Web/desktop implementation of the on-device Media Lab gallery (Metro
 * resolves `.web.ts` over `.ts` on web). Items persist to IndexedDB:
 *
 *   item:<id> — { meta, base64 }
 *
 * Display URIs are data: URIs rebuilt from the stored base64. Same exported
 * surface as media-gallery.ts.
 */
import type { GalleryItem } from '@/lib/types';

const DB_NAME = 'vibex-media-lab';
const STORE = 'kv';

let dbPromise: Promise<IDBDatabase> | null = null;

function db(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbPromise;
}

function tx(mode: IDBTransactionMode): Promise<IDBObjectStore> {
  return db().then((d) => d.transaction(STORE, mode).objectStore(STORE));
}

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

interface StoredItem {
  meta: Omit<GalleryItem, 'uri'>;
  base64: string;
}

function toItem(stored: StoredItem): GalleryItem {
  return { ...stored.meta, uri: `data:${stored.meta.mimeType};base64,${stored.base64}` };
}

export async function listGallery(): Promise<GalleryItem[]> {
  const store = await tx('readonly');
  const rows = await request(store.getAll());
  return (rows as StoredItem[])
    .filter((r) => r?.meta?.id)
    .map(toItem)
    .sort((a, b) => b.createdAt - a.createdAt);
}

async function putItem(stored: StoredItem): Promise<GalleryItem> {
  await commitGalleryWrite(store => {store.put(stored, `item:${stored.meta.id}`);});
  return toItem(stored);
}

function newId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export async function saveGalleryImage(
  prompt: string,
  providerLabel: string,
  base64: string,
  mimeType: string,
  recoveryId?: string
): Promise<GalleryItem> {
  return putItem({
    meta: { id: recoveryId ? recoveredGalleryId(recoveryId) : newId(), kind: 'image', prompt, providerLabel, createdAt: Date.now(), mimeType },
    base64,
  });
}

export async function saveGalleryVideo(
  prompt: string,
  providerLabel: string,
  url: string,
  mimeType: string,
  recoveryId?: string
): Promise<GalleryItem> {
  // No filesystem on web — fetch the video and store it as base64. Some
  // vendors' download hosts lack CORS headers; that surfaces as a clear error.
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Could not download the generated video (${res.status}).`);
  const bytes = new Uint8Array(await res.arrayBuffer());
  let binary = '';
  const chunk = 8192;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return putItem({
    meta: { id: recoveryId ? recoveredGalleryId(recoveryId) : newId(), kind: 'video', prompt, providerLabel, createdAt: Date.now(), mimeType },
    base64: globalThis.btoa(binary),
  });
}

async function commitGalleryWrite(write:(store:IDBObjectStore)=>void):Promise<void> {
  const database = await db();
  await new Promise<void>((resolve,reject) => {
    const transaction = database.transaction(STORE,'readwrite');
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error ?? new Error('Gallery storage change was aborted.'));
    transaction.onerror = () => reject(transaction.error ?? new Error('Gallery storage change failed.'));
    write(transaction.objectStore(STORE));
  });
}

export async function deleteGalleryItem(id: string): Promise<void> {
  await commitGalleryWrite(store => {store.delete(`item:${id}`);});
}

/** Iterate metadata without keeping every gallery video's base64 in memory. */
export async function listGalleryMetadata(): Promise<Omit<GalleryItem, 'uri'>[]> {
  const store = await tx('readonly');
  return new Promise((resolve, reject) => {
    const items: Omit<GalleryItem, 'uri'>[] = [];
    const cursor = store.openCursor();
    cursor.onerror = () => reject(cursor.error);
    cursor.onsuccess = () => {
      const row = cursor.result;
      if (!row) { resolve(items.sort((a,b)=>b.createdAt-a.createdAt)); return; }
      const stored = row.value as StoredItem;
      if (stored?.meta?.id) items.push(stored.meta);
      row.continue();
    };
  });
}
export async function readGalleryItem(id: string): Promise<GalleryItem | null> {
  const store = await tx('readonly');
  const row = await request(store.get(`item:${id}`)) as StoredItem | undefined;
  return row?.meta?.id === id ? toItem(row) : null;
}

function recoveredGalleryId(id:string):string {
 if(!/^[A-Za-z0-9_-]{1,128}$/.test(id))throw new Error('Invalid recovered gallery identity.');
 return `fal-${id}`;
}

export async function saveGalleryAudio(prompt:string,providerLabel:string,base64:string,mimeType:string,recoveryId:string):Promise<GalleryItem>{
 audioExtension(mimeType);
 return putItem({meta:{id:recoveredGalleryId(recoveryId),kind:'audio',prompt,providerLabel,createdAt:Date.now(),mimeType},base64});
}

export async function saveEditedVideo(prompt:string,bytes:Uint8Array,id:string):Promise<GalleryItem>{
 if(!/^edit-[a-f0-9]{64}$/.test(id)||!bytes.length||bytes.length>64*1024**2)throw new Error('Invalid edited preview.');
 const existing=await readGalleryItem(id);if(existing)return existing;
 let binary='';for(let offset=0;offset<bytes.length;offset+=8192)binary+=String.fromCharCode(...bytes.subarray(offset,offset+8192));
 return putItem({meta:{id,kind:'video',prompt,providerLabel:'Edited preview',createdAt:Date.now(),mimeType:'video/mp4'},base64:globalThis.btoa(binary)});
}
