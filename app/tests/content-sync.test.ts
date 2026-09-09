import { describe, expect, it } from 'vitest';
import { contentSyncAction, syncContent } from '../src/lib/sync/content-plan';
describe('content-based sync', () => {
  it('preserves independently edited projects regardless of clock order', () => {
    expect(contentSyncAction('local edit', 'remote edit', 'shared version')).toBe('conflict');
    expect(contentSyncAction('local', 'remote', null)).toBe('conflict');
  });
  it('normalizes explicit UTF-8 and omitted encoding', () => {
    expect(syncContent({}, [], [{ path: 'a', content: 'hello', encoding: 'utf-8' }])).toBe(syncContent({}, [], [{ path: 'a', content: 'hello' }]));
  });
  it('moves changes only when the other side still matches the shared version', () => {
    expect(contentSyncAction('edit', 'base', 'base')).toBe('push');
    expect(contentSyncAction('base', 'edit', 'base')).toBe('pull');
    expect(contentSyncAction('same', 'same', 'old')).toBe('equal');
  });
  it('distinguishes initial copies from disappearing established copies', () => {
    expect(contentSyncAction('new', null, null)).toBe('push');
    expect(contentSyncAction(null, 'new', null)).toBe('pull');
    expect(contentSyncAction('old', null, 'old')).toBe('conflict');
    expect(contentSyncAction(null, 'old', 'old')).toBe('conflict');
  });
  it('ignores enumeration and metadata key order but notices edits with identical timestamps', () => {
    const a = syncContent({ updatedAt: 1, name: 'A' }, [], [{ path: 'b', content: '2' }, { path: 'a', content: '1' }]);
    expect(a).toBe(syncContent({ name: 'A', updatedAt: 1 }, [], [{ path: 'a', content: '1' }, { path: 'b', content: '2' }]));
    const edit = syncContent({ updatedAt: 1, name: 'A' }, [], [{ path: 'a', content: 'changed' }]);
    expect(contentSyncAction(a, edit, null)).toBe('conflict');
  });
});
