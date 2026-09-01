/**
 * Cut — Media Lab's editor — from the phone's side. Two doors:
 *   • the paired server's own gallery: `/cut?project=<id>` is a plain page
 *     in the Media Lab tab's WebView;
 *   • something made on THIS device: upload it to the paired server
 *     (`POST /api/upload`, the same door the studio's "Bring in a video"
 *     uses), open a Cut project on it (`POST /api/cut/projects`), and land
 *     on that page.
 * Requests ride the shared cookie store, so the gate code the user entered
 * in the Media Lab page covers these calls too.
 */
import type { MediaLabLink } from '@/lib/storage/settings';
import type { GalleryItem } from '@/lib/types';

const origin = (link: MediaLabLink) => link.url.replace(/\/+$/, '');

/** The Cut page for one project — or the project picker when no id is given. */
export function cutUrl(link: MediaLabLink, projectId?: string): string {
  return projectId ? `${origin(link)}/cut?project=${encodeURIComponent(projectId)}` : `${origin(link)}/cut`;
}

async function readJson(res: Response): Promise<any> {
  try {
    return await res.json();
  } catch {
    return {};
  }
}

/** Upload one on-device gallery item to the paired Media Lab; returns its job id. */
export async function uploadToMediaLab(link: MediaLabLink, item: GalleryItem): Promise<string> {
  const form = new FormData();
  const name = `vibex-${item.id}.${item.kind === 'video' ? 'mp4' : item.mimeType.includes('png') ? 'png' : 'jpg'}`;
  if (item.uri.startsWith('data:')) {
    const blob = await (await fetch(item.uri)).blob();
    form.append('file', blob, name);
  } else {
    // React Native's FormData takes a file descriptor object.
    form.append('file', { uri: item.uri, name, type: item.mimeType } as unknown as Blob);
  }
  form.append('title', item.prompt.slice(0, 80));
  form.append('kind', item.kind);
  form.append('prompt', item.prompt);
  const res = await fetch(`${origin(link)}/api/upload`, { method: 'POST', body: form });
  const data = await readJson(res);
  if (!res.ok || !data?.id) {
    throw new Error(
      res.status === 401 || res.status === 403
        ? 'Open the Media Lab tab and enter its code first — then try again.'
        : data?.error ?? `Media Lab didn’t accept the upload (HTTP ${res.status}).`
    );
  }
  return String(data.id);
}

/** Create a Cut project from one or more Media Lab job ids; returns the project id. */
export async function createCutProject(link: MediaLabLink, jobIds: string[], name?: string): Promise<string> {
  const res = await fetch(`${origin(link)}/api/cut/projects`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ job_ids: jobIds, name }),
  });
  const data = await readJson(res);
  const id = data?.id ?? data?.project?.id ?? data?.project_id;
  if (!res.ok || !id) {
    throw new Error(
      res.status === 404
        ? 'This Media Lab doesn’t have Cut yet — update it to the latest release.'
        : data?.error ?? `Couldn’t start a Cut project (HTTP ${res.status}).`
    );
  }
  return String(id);
}

/** Upload an on-device item and open it in Cut. Returns the Cut page URL. */
export async function sendToCut(link: MediaLabLink, item: GalleryItem): Promise<string> {
  const jobId = await uploadToMediaLab(link, item);
  const projectId = await createCutProject(link, [jobId], item.prompt.slice(0, 40));
  return cutUrl(link, projectId);
}
