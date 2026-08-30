import { describe, expect, it } from 'vitest';

import { decideSyncDirection, safDocumentName, safTreeLabel } from '@/lib/sync/sync-plan';

describe('decideSyncDirection', () => {
  it('pushes when local is newer', () => {
    expect(decideSyncDirection(200, 100)).toBe('push');
  });

  it('pulls when remote is newer', () => {
    expect(decideSyncDirection(100, 200)).toBe('pull');
  });

  it('skips a tie', () => {
    expect(decideSyncDirection(100, 100)).toBe('skip');
  });

  it('pushes when the remote copy is missing', () => {
    expect(decideSyncDirection(100, null)).toBe('push');
    expect(decideSyncDirection(100, undefined)).toBe('push');
  });

  it('pulls when the local copy is missing', () => {
    expect(decideSyncDirection(null, 100)).toBe('pull');
    expect(decideSyncDirection(undefined, 100)).toBe('pull');
  });

  it('skips when neither side has a timestamp', () => {
    expect(decideSyncDirection(null, null)).toBe('skip');
    expect(decideSyncDirection(undefined, undefined)).toBe('skip');
  });

  it('treats non-finite timestamps as missing', () => {
    expect(decideSyncDirection(Number.NaN, 100)).toBe('pull');
    expect(decideSyncDirection(100, Number.POSITIVE_INFINITY)).toBe('push');
  });
});

describe('safDocumentName', () => {
  it('decodes the last path segment of a SAF document URI', () => {
    expect(
      safDocumentName(
        'content://com.android.externalstorage.documents/tree/primary%3ASync/document/primary%3ASync%2FVibeXStudio%2Fproject.json'
      )
    ).toBe('project.json');
  });

  it('handles colon-separated document ids', () => {
    expect(safDocumentName('content://provider/document/primary%3Achat.json')).toBe('chat.json');
  });

  it('falls back to the raw segment on malformed escapes', () => {
    expect(safDocumentName('content://provider/document/bad%2')).toBe('bad%2');
  });
});

describe('safTreeLabel', () => {
  it('shows the folder name for external-storage trees', () => {
    expect(safTreeLabel('content://com.android.externalstorage.documents/tree/primary%3ADocuments%2FVibeX')).toBe(
      'VibeX'
    );
  });

  it('falls back to a generic label for opaque Drive ids', () => {
    expect(
      safTreeLabel('content://com.google.android.apps.docs.storage/tree/encoded%3D1234abcd5678efgh9012ijkl3456')
    ).toBe('Selected folder');
  });
});
