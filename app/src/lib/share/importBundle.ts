/**
 * Receiving side of `.vibex` sharing: turn a bundle — from a tapped file, a
 * picked document, or a pasted cloud link — into a fresh local project the
 * recipient can preview, edit in chat, and share back.
 */
import {restoreProjectBackup} from '@/lib/share/project-backup';
import {decodeProjectSnapshot} from '@/lib/sync/project-snapshot';
import {readBundleFile} from '@/lib/share/read-bundle-file';

import { decodeBundle } from '@/lib/share/bundle';
import { looksLikeHtmlPage, normalizeShareLink } from '@/lib/share/cloudLinks';
import { deleteProject, newId, readProject, writeBinaryFile, writeChat, writeFile, writeProject } from '@/lib/storage/projects';
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
  if(text.length>25_000_000)throw new Error('That project file is too large to import.');
  let format:unknown;try{format=JSON.parse(text)?.format;}catch{ /* Existing bundle decoder supplies the error. */ }
  if(format==='vibex/project-snapshot'){
    const snapshot=decodeProjectSnapshot(text);
    onProgress?.('Restoring chat and project files…');
    const id=await restoreProjectBackup(text);
    const meta=await readProject(id);
    if(!meta)throw new Error('The backup was saved, but its project could not be loaded. Reopen your projects to check it.');
    return {meta,fileCount:snapshot.files.length};
  }
  const bundle = decodeBundle(text);

  const id = newId();
  if (await readProject(id)) {
    throw new Error("Couldn’t create a new project. Please try importing again.");
  }

  const now = Date.now();
  const meta: ProjectMeta = {
    id,
    name: bundle.name,
    emoji: bundle.emoji,
    description: bundle.description,
    createdAt: now,
    updatedAt: now,
  };
  try {
    await writeProject(meta);
    await writeChat(meta.id, []);

    let done = 0;
    for (const file of bundle.files) {
      if (file.encoding === 'base64') await writeBinaryFile(meta.id, file.path, file.content);
      else await writeFile(meta.id, file.path, file.content);
      done += 1;
      onProgress?.(`Unpacking files… ${done}/${bundle.files.length}`);
    }
  } catch (error) {
    try {
      await deleteProject(meta.id);
    } catch {
      throw new Error(
        'The import failed, and its incomplete project could not be removed. Free up storage, remove the incomplete project if it appears, and try again.',
        { cause: error }
      );
    }
    throw error;
  }

  return { meta, fileCount: bundle.files.length };
}

/** Import from a local file URI (tapped .vibex, document picker, AirDrop). */
export async function importBundleFromFile(
  uri: string,
  onProgress?: (detail: string) => void
): Promise<BundleImportResult> {
  onProgress?.('Reading bundle…');
  const text = await readBundleFile(uri);
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
