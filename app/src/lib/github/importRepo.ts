/**
 * Import a VibeXStudio app from a GitHub repo — the receiving side of the
 * share link. Works without any GitHub account for public repos (raw
 * downloads); uses the signed-in user's token when available so private repos
 * shared between a user's own devices also work.
 */
import { ghFetch, GitHubError } from '@/lib/github/api';
import { isBinaryPath, newId, writeBinaryFile, writeChat, writeFile, writeProject } from '@/lib/storage/projects';
import type { ProjectMeta } from '@/lib/types';

/** Repo paths that are sync machinery rather than app files. */
const SKIP_PATHS = new Set(['README.md', 'vibex.json']);
const SKIP_PREFIXES = ['s/', '.github/'];

export interface ImportResult {
  meta: ProjectMeta;
  fileCount: number;
}

export async function importRepoAsProject(opts: {
  owner: string;
  repo: string;
  ref?: string;
  token?: string | null;
  onProgress?: (detail: string) => void;
}): Promise<ImportResult> {
  const { owner, repo, token, onProgress } = opts;
  const ref = opts.ref ?? 'main';

  onProgress?.('Listing files…');
  const tree = await fetchTree(owner, repo, ref, token);
  const blobs = tree.filter(
    (entry) =>
      entry.type === 'blob' &&
      !SKIP_PATHS.has(entry.path) &&
      !SKIP_PREFIXES.some((prefix) => entry.path.startsWith(prefix))
  );
  if (blobs.length === 0) throw new Error('No app files found in this repo.');

  // Project name/emoji travel in vibex.json when present.
  let name = repo;
  let emoji = '📦';
  let description = '';
  const metaEntry = tree.find((entry) => entry.path === 'vibex.json');
  if (metaEntry) {
    try {
      const metaJson = JSON.parse(await fetchBlob(owner, repo, ref, metaEntry, token));
      if (typeof metaJson.name === 'string') name = metaJson.name;
      if (typeof metaJson.emoji === 'string') emoji = metaJson.emoji;
      if (typeof metaJson.description === 'string') description = metaJson.description;
    } catch {
      // Fall back to repo name.
    }
  }

  const now = Date.now();
  const meta: ProjectMeta = {
    id: newId(),
    name,
    emoji,
    description,
    createdAt: now,
    updatedAt: now,
    github: { owner, repo, branch: ref, isPrivate: false },
  };
  await writeProject(meta);
  await writeChat(meta.id, []);

  let done = 0;
  for (const entry of blobs) {
    if (isBinaryPath(entry.path)) {
      await writeBinaryFile(meta.id, entry.path, await fetchBlobBase64(owner, repo, ref, entry, token));
    } else {
      await writeFile(meta.id, entry.path, await fetchBlob(owner, repo, ref, entry, token));
    }
    done += 1;
    onProgress?.(`Downloading files… ${done}/${blobs.length}`);
  }

  return { meta, fileCount: blobs.length };
}

interface TreeEntry {
  path: string;
  type: 'blob' | 'tree';
  sha: string;
}

async function fetchTree(owner: string, repo: string, ref: string, token?: string | null): Promise<TreeEntry[]> {
  if (token) {
    const data = await ghFetch<{ tree: TreeEntry[]; truncated: boolean }>(
      token,
      `/repos/${owner}/${repo}/git/trees/${encodeURIComponent(ref)}?recursive=1`
    );
    return data.tree;
  }
  // Unauthenticated: public repos only.
  const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/git/trees/${encodeURIComponent(ref)}?recursive=1`, {
    headers: { Accept: 'application/vnd.github+json' },
  });
  if (!res.ok) {
    throw new GitHubError(
      res.status === 404
        ? 'Repo not found. If it is private, connect the matching GitHub account first.'
        : `Could not list the repo (${res.status}).`,
      res.status
    );
  }
  const data = await res.json();
  return data.tree as TreeEntry[];
}

async function fetchBlob(
  owner: string,
  repo: string,
  ref: string,
  entry: TreeEntry,
  token?: string | null
): Promise<string> {
  if (token) {
    const blob = await ghFetch<{ content: string; encoding: string }>(
      token,
      `/repos/${owner}/${repo}/git/blobs/${entry.sha}`
    );
    if (blob.encoding === 'base64') return decodeBase64Utf8(blob.content.replace(/\n/g, ''));
    return blob.content;
  }
  const res = await fetch(`https://raw.githubusercontent.com/${owner}/${repo}/${encodeURIComponent(ref)}/${entry.path}`);
  if (!res.ok) throw new Error(`Could not download ${entry.path} (${res.status})`);
  return res.text();
}

async function fetchBlobBase64(
  owner: string,
  repo: string,
  ref: string,
  entry: TreeEntry,
  token?: string | null
): Promise<string> {
  if (token) {
    const blob = await ghFetch<{ content: string; encoding: string }>(
      token,
      `/repos/${owner}/${repo}/git/blobs/${entry.sha}`
    );
    return blob.content.replace(/\n/g, '');
  }
  const res = await fetch(`https://raw.githubusercontent.com/${owner}/${repo}/${encodeURIComponent(ref)}/${entry.path}`);
  if (!res.ok) throw new Error(`Could not download ${entry.path} (${res.status})`);
  const bytes = new Uint8Array(await res.arrayBuffer());
  let binary = '';
  const chunk = 8192;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return globalThis.btoa(binary);
}

function decodeBase64Utf8(base64: string): string {
  const binary = globalThis.atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new TextDecoder('utf-8').decode(bytes);
}
