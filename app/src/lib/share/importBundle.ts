/**
 * Receiving side of `.vibex` sharing: turn a bundle — from a tapped file, a
 * picked document, or a pasted cloud link — into a fresh local project the
 * recipient can preview, edit in chat, and share back.
 */
import { File } from 'expo-file-system';

import { decodeBundle } from '@/lib/share/bundle';
import { looksLikeHtmlPage, normalizeShareLink } from '@/lib/share/cloudLinks';
import { newId, writeBinaryFile, writeChat, writeFile, writeProject } from '@/lib/storage/projects';
import type { ProjectMeta } from '@/lib/types';

export interface BundleImportResult {
  meta: ProjectMeta;
  fileCount: number;
}

/** Create a local project from raw bundle text. */
export async function importBundleText(
  text: string,
  onProgress?: (detail: string) => void
): Promise<BundleImportResult> {
  const bundle = decodeBundle(text);

  const now = Date.now();
  const meta: ProjectMeta = {
    id: newId(),
    name: bundle.name,
    emoji: bundle.emoji,
    description: bundle.description,
    createdAt: now,
    updatedAt: now,
  };
  await writeProject(meta);
  await writeChat(meta.id, []);

  let done = 0;
  for (const file of bundle.files) {
    if (file.encoding === 'base64') await writeBinaryFile(meta.id, file.path, file.content);
    else await writeFile(meta.id, file.path, file.content);
    done += 1;
    onProgress?.(`Unpacking files… ${done}/${bundle.files.length}`);
  }

  return { meta, fileCount: bundle.files.length };
}

/** Import from a local file URI (tapped .vibex, document picker, AirDrop). */
export async function importBundleFromFile(
  uri: string,
  onProgress?: (detail: string) => void
): Promise<BundleImportResult> {
  onProgress?.('Reading bundle…');
  const text = await new File(uri).text();
  return importBundleText(text, onProgress);
}

/** Import from a pasted share link (Dropbox, Google Drive, or any URL). */
export async function importBundleFromUrl(
  raw: string,
  onProgress?: (detail: string) => void
): Promise<BundleImportResult> {
  const link = normalizeShareLink(raw);
  if (!link) throw new Error("That doesn't look like a share link.");

  onProgress?.('Fetching the app…');
  const res = await fetch(link.url);
  if (!res.ok) throw new Error(`Couldn't download from that link (${res.status}).`);
  const text = await res.text();
  if (looksLikeHtmlPage(text)) {
    throw new Error(
      'That link opens a web page, not the app file. Make sure the link is shared with “anyone with the link” and points at a .vibex file.'
    );
  }
  return importBundleText(text, onProgress);
}
