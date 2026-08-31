export type WorkspaceLayout = 'compact' | 'wide';
export type OnboardingLayout = 'compact-height' | 'compact' | 'wide';

/** iPad and desktop-class windows get a two-column workspace. */
export function workspaceLayoutForWidth(width: number): WorkspaceLayout {
  return width >= 760 ? 'wide' : 'compact';
}

/** Exact compact-height selector used to protect onboarding controls on 393×852 iPhones. */
export function onboardingLayoutForViewport(width: number, height: number): OnboardingLayout {
  if (workspaceLayoutForWidth(width) === 'wide') return 'wide';
  return height <= 852 ? 'compact-height' : 'compact';
}
