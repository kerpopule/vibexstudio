import { describe, expect, it } from 'vitest';

import { getGitHubSyncConflict } from '@/lib/github/syncPolicy';

describe('getGitHubSyncConflict', () => {
  it('protects an existing same-name repo during first sync', () => {
    expect(
      getGitHubSyncConflict({
        targetFullName: 'steve/my-app',
        linkedFullName: undefined,
        lastSyncedCommit: undefined,
        remoteHeadCommit: 'remote-1',
        repoWasCreated: false,
      })
    ).toBe('existing-repo');
  });

  it('protects linked work that changed outside VibeXStudio', () => {
    expect(
      getGitHubSyncConflict({
        targetFullName: 'steve/my-app',
        linkedFullName: 'steve/my-app',
        lastSyncedCommit: 'local-1',
        remoteHeadCommit: 'remote-2',
        repoWasCreated: false,
      })
    ).toBe('remote-changed');
  });

  it('allows a new repo and an unchanged linked repo', () => {
    expect(
      getGitHubSyncConflict({
        targetFullName: 'steve/my-app',
        linkedFullName: undefined,
        lastSyncedCommit: undefined,
        remoteHeadCommit: 'auto-init',
        repoWasCreated: true,
      })
    ).toBeNull();
    expect(
      getGitHubSyncConflict({
        targetFullName: 'steve/my-app',
        linkedFullName: 'steve/my-app',
        lastSyncedCommit: 'same',
        remoteHeadCommit: 'same',
        repoWasCreated: false,
      })
    ).toBeNull();
  });
});
