export type GitHubSyncConflict = 'existing-repo' | 'remote-changed';

export function getGitHubSyncConflict(input: {
  targetFullName: string;
  linkedFullName?: string;
  lastSyncedCommit?: string;
  remoteHeadCommit: string | null;
  repoWasCreated: boolean;
}): GitHubSyncConflict | null {
  if (input.repoWasCreated || !input.remoteHeadCommit) return null;

  if (input.linkedFullName !== input.targetFullName) return 'existing-repo';
  if (!input.lastSyncedCommit || input.lastSyncedCommit !== input.remoteHeadCommit) return 'remote-changed';

  return null;
}
