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

/** Import from a pasted share link (Dropbox, Google Drive, iCloud, or any URL). */
export async function importBundleFromUrl(
  raw: string,
  onProgress?: (detail: string) => void
): Promise<BundleImportResult> {
  const link = normalizeShareLink(raw);
  if (!link) throw new Error("That doesn't look like a share link.");

  onProgress?.('Fetching the app…');
  const url = link.kind === 'icloud' ? await resolveICloudLink(link.shortGuid) : link.url;

  const res = await fetch(url);
  if (!res.ok) throw new Error(`Couldn't download from that link (${res.status}).`);
  const text = await res.text();
  if (looksLikeHtmlPage(text)) {
    throw new Error(
      'That link opens a web page, not the app file. Make sure the link is shared with “anyone with the link” and points at a .vibex file.'
    );
  }
  return importBundleText(text, onProgress);
}

/**
 * iCloud Drive share links hide the file behind a short GUID; CloudKit's
 * public resolve endpoint hands back the real download URL.
 */
async function resolveICloudLink(shortGuid: string): Promise<string> {
  const friendly =
    'Couldn\'t unwrap that iCloud link. Easiest path: open the .vibex file in the Files app and pick "VibeXStudio".';
  let downloadUrl: string | undefined;
  try {
    const res = await fetch(
      'https://ckdatabasews.icloud.com/database/1/com.apple.cloudkit/production/public/records/resolve',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ shortGUIDs: [{ value: shortGuid }] }),
      }
    );
    const data = await res.json();
    downloadUrl = data?.results?.[0]?.rootRecord?.fields?.fileContent?.value?.downloadURL;
  } catch {
    throw new Error(friendly);
  }
  if (!downloadUrl) throw new Error(friendly);
  // CloudKit returns a templated URL; ${f} is the filename slot.
  return downloadUrl.replace('${f}', 'bundle.vibex');
}
