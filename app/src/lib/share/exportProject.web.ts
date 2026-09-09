/** Browser export: the same portable bundle, downloaded without a native share sheet. */
import {bundleFileName, encodeBundle} from '@/lib/share/bundle';
import {listFiles, readProject} from '@/lib/storage/projects';
export {shareMessageFor} from '@/lib/share/share-message';

export async function exportProjectBundle(projectId: string): Promise<void> {
  const meta = await readProject(projectId);
  if (!meta) throw new Error('Project not found.');
  const files = await listFiles(projectId);
  if (!files.length) throw new Error('Nothing to share yet — ask the AI to build something first.');
  const text = encodeBundle({name:meta.name, emoji:meta.emoji, description:meta.description ?? '', files}, Date.now());
  const url = URL.createObjectURL(new Blob([text], {type:'application/json'}));
  const link = document.createElement('a');
  try {
    link.href = url;
    link.download = bundleFileName(meta.name);
    link.style.display = 'none';
    document.body.appendChild(link);
    link.click();
  } finally {
    link.remove();
    // Leave time for the browser to consume the download before releasing it.
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }
}
