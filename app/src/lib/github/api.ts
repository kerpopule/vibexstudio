/**
 * Minimal GitHub REST v3 client. Talks straight from the device to
 * api.github.com with the user's own token — no middleman.
 */

const API = 'https://api.github.com';

export class GitHubError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message);
    this.name = 'GitHubError';
  }
}

export async function ghFetch<T = unknown>(
  token: string,
  path: string,
  init?: { method?: string; body?: unknown }
): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    method: init?.method ?? 'GET',
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': '2022-11-28',
      ...(init?.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    },
    body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  const data = text ? JSON.parse(text) : undefined;
  if (!res.ok) {
    throw new GitHubError(data?.message ?? `GitHub request failed (${res.status})`, res.status);
  }
  return data as T;
}

export interface GitHubUser {
  login: string;
  name: string | null;
  avatar_url: string;
}

export async function getAuthenticatedUser(token: string): Promise<GitHubUser> {
  return ghFetch<GitHubUser>(token, '/user');
}

export interface RepoInfo {
  name: string;
  full_name: string;
  private: boolean;
  default_branch: string;
  html_url: string;
}

export async function getRepo(token: string, owner: string, repo: string): Promise<RepoInfo | null> {
  try {
    return await ghFetch<RepoInfo>(token, `/repos/${owner}/${repo}`);
  } catch (e) {
    if (e instanceof GitHubError && e.status === 404) return null;
    throw e;
  }
}

export async function createRepo(token: string, name: string, isPrivate: boolean, description: string): Promise<RepoInfo> {
  return ghFetch<RepoInfo>(token, '/user/repos', {
    method: 'POST',
    body: {
      name,
      description,
      private: isPrivate,
      auto_init: true,
      has_issues: false,
      has_projects: false,
      has_wiki: false,
    },
  });
}

/**
 * Flip an existing repo between private and public. Making a repo public
 * is what unlocks the free GitHub Pages share link; making it private
 * takes the public site down (GitHub disables Pages on free plans).
 */
export async function setRepoVisibility(
  token: string,
  owner: string,
  repo: string,
  isPrivate: boolean
): Promise<RepoInfo> {
  return ghFetch<RepoInfo>(token, `/repos/${owner}/${repo}`, {
    method: 'PATCH',
    body: { private: isPrivate },
  });
}

/** Sanitize a project name into a valid GitHub repo name. */
export function toRepoName(projectName: string): string {
  const slug = projectName
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  return slug || 'vibex-app';
}
