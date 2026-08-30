/**
 * On-device Media Lab gallery storage (native).
 *
 * Layout (a sibling of the projects tree — same iCloud container when Drive
 * is on, see projects.mediaLabRoot):
 *   media-lab/
 *     <id>.json          — stored metadata (kind, prompt, provider, file)
 *     <id>.<png|jpg|mp4> — the media itself
 *
 * Same exported surface as media-gallery.web.ts (Metro picks the .web.ts
 * file on web, where everything persists to IndexedDB instead).
 */
import { Directory, File } from 'expo-file-system';

import { mediaLabRoot, newId } from '@/lib/storage/projects';
import type { GalleryItem } from '@/lib/types';

interface StoredMeta {
  id: string;
  kind: GalleryItem['kind'];
  prompt: string;
  providerLabel: string;
  createdAt: number;
  /** Media file name inside media-lab/ — the URI is rebuilt at list time. */
  file: string;
  mimeType: string;
}

function toItem(meta: StoredMeta, root: Directory): GalleryItem {
  return {
    id: meta.id,
    kind: meta.kind,
    prompt: meta.prompt,
    providerLabel: meta.providerLabel,
    createdAt: meta.createdAt,
    uri: new File(root, meta.file).uri,
    mimeType: meta.mimeType,
  };
}

/** All gallery items, newest first. Corrupt entries are skipped, not fatal. */
export async function listGallery(): Promise<GalleryItem[]> {
  const root = mediaLabRoot();
  const items: GalleryItem[] = [];
  for (const entry of root.list()) {
    if (entry instanceof Directory || !entry.name.endsWith('.json')) continue;
    try {
      const meta = JSON.parse(await entry.text()) as StoredMeta;
      if (new File(root, meta.file).exists) items.push(toItem(meta, root));
    } catch {
      // Skip unreadable metadata rather than failing the whole gallery.
    }
  }
  return items.sort((a, b) => b.createdAt - a.createdAt);
}

/** Persist a generated image (base64) and return the stored item. */
export async function saveGalleryImage(
  prompt: string,
  providerLabel: string,
  base64: string,
  mimeType: string
): Promise<GalleryItem> {
  const root = mediaLabRoot();
  const id = newId();
  const ext = mimeType.includes('jpeg') ? 'jpg' : mimeType.includes('webp') ? 'webp' : 'png';
  const meta: StoredMeta = {
    id,
    kind: 'image',
    prompt,
    providerLabel,
    createdAt: Date.now(),
    file: `${id}.${ext}`,
    mimeType,
  };
  new File(root, meta.file).write(base64ToBytes(base64));
  new File(root, `${id}.json`).write(JSON.stringify(meta));
  return toItem(meta, root);
}

/** Download a generated video from its URL and persist it. */
export async function saveGalleryVideo(
  prompt: string,
  providerLabel: string,
  url: string,
  mimeType: string
): Promise<GalleryItem> {
  const root = mediaLabRoot();
  const id = newId();
  const meta: StoredMeta = {
    id,
    kind: 'video',
    prompt,
    providerLabel,
    createdAt: Date.now(),
    file: `${id}.mp4`,
    mimeType,
  };
  await File.downloadFileAsync(url, new File(root, meta.file), { idempotent: true });
  new File(root, `${id}.json`).write(JSON.stringify(meta));
  return toItem(meta, root);
}

/** Remove one item (media + metadata). Missing files are fine. */
export async function deleteGalleryItem(id: string): Promise<void> {
  const root = mediaLabRoot();
  const metaFile = new File(root, `${id}.json`);
  if (metaFile.exists) {
    try {
      const meta = JSON.parse(await metaFile.text()) as StoredMeta;
      const media = new File(root, meta.file);
      if (media.exists) media.delete();
    } catch {
      // Metadata unreadable — still remove it below.
    }
    metaFile.delete();
  }
}

function base64ToBytes(base64: string): Uint8Array {
  const binary = globalThis.atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
