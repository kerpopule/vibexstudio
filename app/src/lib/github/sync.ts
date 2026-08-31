/**
 * Push a local project to the user's GitHub repo and enable GitHub Pages.
 *
 * Repo layout produced by sync:
 *   /               — the app's files (index.html at root so Pages serves it)
 *   /s/index.html   — share page that deep-links into VibeXStudio
 *   /vibex.json     — project metadata so other devices can import faithfully
 *
 * Uses the low-level Git Data API (blobs → tree → commit → ref) so each sync
 * is a single clean commit, straight from the phone.
 */
import { createRepo, getRepo, ghFetch, GitHubError, setRepoVisibility, toRepoName } from '@/lib/github/api';
import { getGitHubSyncConflict, type GitHubSyncConflict } from '@/lib/github/syncPolicy';
import { renderSharePage } from '@/lib/github/sharePage';
import { listFiles, readProject, writeProject } from '@/lib/storage/projects';
import type { GitHubLink, ProjectFile, ProjectMeta } from '@/lib/types';

export interface SyncProgress {
  phase: 'preparing' | 'creating-repo' | 'uploading' | 'committing' | 'pages' | 'done';
  detail?: string;
}

export interface SyncResult {
  link: GitHubLink;
  commitSha: string;
}

export class GitHubSyncConflictError extends Error {
  constructor(public readonly kind: GitHubSyncConflict) {
    super(
      kind === 'existing-repo'
        ? 'A GitHub repository with this name already exists.'
        : 'The GitHub version changed since the last VibeXStudio sync.'
    );
    this.name = 'GitHubSyncConflictError';
  }
}

export async function syncProjectToGitHub(opts: {
  token: string;
  login: string;
  projectId: string;
  /** Repo name to create when the project isn't linked yet. */
  repoName?: string;
  isPrivate?: boolean;
  /** Only set after the user explicitly confirms replacing the remote snapshot. */
  overwriteRemote?: boolean;
  onProgress?: (p: SyncProgress) => void;
}): Promise<SyncResult> {
  const { token, login, projectId, onProgress } = opts;
  const progress = (p: SyncProgress) => onProgress?.(p);

  progress({ phase: 'preparing' });
  const meta = await readProject(projectId);
  if (!meta) throw new Error('Project not found');
  const files = await listFiles(projectId);
  if (files.length === 0) throw new Error('This project has no files to sync yet. Vibe something first!');

  // Resolve or create the target repo.
  let owner = meta.github?.owner ?? login;
  let repoName = meta.github?.repo ?? toRepoName(opts.repoName ?? meta.name);
  let isPrivate = meta.github?.isPrivate ?? opts.isPrivate ?? false;
  let branch = meta.github?.branch ?? 'main';

  let repoWasCreated = false;
  let repo = await getRepo(token, owner, repoName);
  if (!repo) {
    progress({ phase: 'creating-repo', detail: repoName });
    repo = await createRepo(token, repoName, isPrivate, `${meta.name} — made with VibeXStudio`);
    repoWasCreated = true;
    owner = repo.full_name.split('/')[0];
    repoName = repo.name;
    branch = repo.default_branch;
    isPrivate = repo.private;
    // Give GitHub a moment to finish initializing the repo (auto_init commit).
    await sleep(1500);
  }

  const head = await getHeadSha(token, owner, repoName, branch);
  const conflict = getGitHubSyncConflict({
    targetFullName: `${owner}/${repoName}`,
    linkedFullName: meta.github ? `${meta.github.owner}/${meta.github.repo}` : undefined,
    lastSyncedCommit: meta.github?.lastSyncedCommit,
    remoteHeadCommit: head,
    repoWasCreated,
  });
  if (conflict && !opts.overwriteRemote) throw new GitHubSyncConflictError(conflict);

  // Build the full snapshot to commit.
  const snapshot: ProjectFile[] = [
    ...files,
    {
      path: 'vibex.json',
      content: JSON.stringify(
        { name: meta.name, emoji: meta.emoji, description: meta.description, generator: 'VibeXStudio' },
        null,
        2
      ),
    },
    {
      path: 's/index.html',
      content: renderSharePage({ owner, repo: repoName, branch, appName: meta.name, appEmoji: meta.emoji }),
    },
    {
      path: 'README.md',
      content: `# ${meta.name}\n\nMade with [VibeXStudio](https://github.com/kerpopule/vibex-studio) on a phone.\n\n- Live app: https://${owner}.github.io/${repoName}/\n- Open in VibeXStudio: https://${owner}.github.io/${repoName}/s/\n`,
    },
  ];

  // blobs → tree → commit → ref
  progress({ phase: 'uploading', detail: `${snapshot.length} files` });
  const treeEntries = await Promise.all(
    snapshot.map(async (file) => {
      const blob = await ghFetch<{ sha: string }>(token, `/repos/${owner}/${repoName}/git/blobs`, {
        method: 'POST',
        body: { content: file.content, encoding: file.encoding ?? 'utf-8' },
      });
      return { path: file.path, mode: '100644', type: 'blob', sha: blob.sha };
    })
  );

  progress({ phase: 'committing' });
  const tree = await ghFetch<{ sha: string }>(token, `/repos/${owner}/${repoName}/git/trees`, {
    method: 'POST',
    body: { tree: treeEntries },
  });
  const commit = await ghFetch<{ sha: string }>(token, `/repos/${owner}/${repoName}/git/commits`, {
    method: 'POST',
    body: {
      message: `Sync from VibeXStudio — ${new Date().toISOString()}`,
      tree: tree.sha,
      parents: head ? [head] : [],
    },
  });
  await ghFetch(token, `/repos/${owner}/${repoName}/git/refs/heads/${branch}`, {
    method: 'PATCH',
    body: { sha: commit.sha, force: false },
  });

  // Enable GitHub Pages from the branch root (best effort — not available on
  // private repos for free accounts).
  progress({ phase: 'pages' });
  let pagesUrl: string | undefined = meta.github?.pagesUrl;
  if (!isPrivate) {
    pagesUrl = await enablePages(token, owner, repoName, branch);
  }

  const link: GitHubLink = {
    owner,
    repo: repoName,
    branch,
    isPrivate,
    pagesUrl,
    lastSyncedCommit: commit.sha,
    lastSyncedAt: Date.now(),
  };
  const updated: ProjectMeta = { ...meta, github: link, updatedAt: Date.now() };
  await writeProject(updated);

  progress({ phase: 'done' });
  return { link, commitSha: commit.sha };
}

/**
 * Flip a synced repo between private and public after the fact. Going
 * public also turns on GitHub Pages (that's the whole point — the free
 * share link); going private takes the public site down. The project's
 * stored link is updated either way.
 */
export async function changeRepoVisibility(opts: {
  token: string;
  projectId: string;
  makePrivate: boolean;
}): Promise<GitHubLink> {
  const meta = await readProject(opts.projectId);
  const link = meta?.github;
  if (!meta || !link) throw new Error('This project is not synced to GitHub yet.');
  await setRepoVisibility(opts.token, link.owner, link.repo, opts.makePrivate);
  let pagesUrl = link.pagesUrl;
  if (!opts.makePrivate) {
    pagesUrl = (await enablePages(opts.token, link.owner, link.repo, link.branch)) ?? pagesUrl;
  } else {
    pagesUrl = undefined;
  }
  const next: GitHubLink = { ...link, isPrivate: opts.makePrivate, pagesUrl };
  await writeProject({ ...meta, github: next, updatedAt: Date.now() });
  return next;
}

async function getHeadSha(token: string, owner: string, repo: string, branch: string): Promise<string | null> {
  try {
    const ref = await ghFetch<{ object: { sha: string } }>(token, `/repos/${owner}/${repo}/git/ref/heads/${branch}`);
    return ref.object.sha;
  } catch (e) {
    if (e instanceof GitHubError && e.status === 404) return null;
    throw e;
  }
}

async function enablePages(token: string, owner: string, repo: string, branch: string): Promise<string | undefined> {
  try {
    const page = await ghFetch<{ html_url?: string }>(token, `/repos/${owner}/${repo}/pages`, {
      method: 'POST',
      body: { source: { branch, path: '/' } },
    });
    return page?.html_url ?? `https://${owner}.github.io/${repo}/`;
  } catch (e) {
    if (e instanceof GitHubError && e.status === 409) {
      // Pages already enabled.
      return `https://${owner}.github.io/${repo}/`;
    }
    // Pages may be unavailable (e.g. plan limits); syncing still succeeded.
    return undefined;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
