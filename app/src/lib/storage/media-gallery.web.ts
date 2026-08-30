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
  const store = await tx('readwrite');
  await request(store.put(stored, `item:${stored.meta.id}`));
  return toItem(stored);
}

function newId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export async function saveGalleryImage(
  prompt: string,
  providerLabel: string,
  base64: string,
  mimeType: string
): Promise<GalleryItem> {
  return putItem({
    meta: { id: newId(), kind: 'image', prompt, providerLabel, createdAt: Date.now(), mimeType },
    base64,
  });
}

export async function saveGalleryVideo(
  prompt: string,
  providerLabel: string,
  url: string,
  mimeType: string
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
    meta: { id: newId(), kind: 'video', prompt, providerLabel, createdAt: Date.now(), mimeType },
    base64: globalThis.btoa(binary),
  });
}

export async function deleteGalleryItem(id: string): Promise<void> {
  const store = await tx('readwrite');
  await request(store.delete(`item:${id}`));
}
