import { describe, expect, it } from 'vitest';

import { workspaceLayoutForWidth } from '@/lib/layout';

describe('workspaceLayoutForWidth', () => {
  it('keeps compact phones in a stacked layout', () => {
    expect(workspaceLayoutForWidth(320)).toBe('compact');
    expect(workspaceLayoutForWidth(759)).toBe('compact');
  });

  it('uses a two-column workspace on iPad and desktop-class windows', () => {
    expect(workspaceLayoutForWidth(760)).toBe('wide');
    expect(workspaceLayoutForWidth(1366)).toBe('wide');
  });
});
