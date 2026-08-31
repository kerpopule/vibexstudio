import { describe, expect, it } from 'vitest';

import { onboardingLayoutForViewport, workspaceLayoutForWidth } from '@/lib/layout';

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

describe('onboardingLayoutForViewport', () => {
  it('selects the compact-height layout at the 393×852 iPhone QA viewport', () => {
    expect(onboardingLayoutForViewport(393, 852)).toBe('compact-height');
  });

  it('keeps taller phones stacked and iPad-class windows wide', () => {
    expect(onboardingLayoutForViewport(430, 932)).toBe('compact');
    expect(onboardingLayoutForViewport(1024, 768)).toBe('wide');
  });
});
