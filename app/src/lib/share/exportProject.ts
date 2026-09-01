/**
 * Sending side of `.vibex` sharing: package the project into one bundle file
 * and hand it to the iOS share sheet. That sheet IS the integration — Save to
 * Files, Google Drive, Dropbox, AirDrop, Messages, Messenger,
 * WhatsApp — the user's choice, their storage, no VibeXStudio servers.
 *
 * The file travels with a short note + the get-the-app link so a recipient
 * without VibeXStudio knows what to do (targets that take only one item, like
 * some third-party apps, get the file).
 */
import { Directory, File, Paths } from 'expo-file-system';
import { Share } from 'react-native';

import { GET_APP_URL } from '@/lib/github/sharePage';
import { bundleFileName, encodeBundle } from '@/lib/share/bundle';
import { listFiles, readProject } from '@/lib/storage/projects';

export function shareMessageFor(name: string): string {
  return (
    `I made “${name}” in VibeXStudio ⚡ Open the attached .vibex file on your iPhone, iPad, or Mac to play it and remix it. ` +
    `Don’t have the app (or not sure what to do with the file)? ${GET_APP_URL}`
  );
}

export async function exportProjectBundle(projectId: string): Promise<void> {
  const meta = await readProject(projectId);
  if (!meta) throw new Error('Project not found.');
  const files = await listFiles(projectId);
  if (files.length === 0) {
    throw new Error('Nothing to share yet — ask the AI to build something first.');
  }

  const text = encodeBundle(
    { name: meta.name, emoji: meta.emoji, description: meta.description ?? '', files },
    Date.now()
  );

  const dir = new Directory(Paths.cache, 'exports');
  if (!dir.exists) dir.create({ intermediates: true });
  const file = new File(dir, bundleFileName(meta.name));
  file.write(text);

  // RN Share passes both the file URL and the note as activity items, so
  // Messages/Mail attach the bundle AND include the get-the-app text.
  await Share.share(
    { url: file.uri, message: shareMessageFor(meta.name) },
    { subject: `${meta.name} — made in VibeXStudio` }
  );
}
