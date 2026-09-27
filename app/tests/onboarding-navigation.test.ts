import { describe, expect, it } from 'vitest';
import { needsOnboardingRedirect } from '../src/lib/onboarding-navigation';

describe('first-run navigation', () => {
  it('lets a new user open each connection flow without replacing the wizard', () => {
    for (const route of ['onboarding', 'pair-scan', 'pair', 'connect-media-lab', 'connect-provider',
      'transfer-ai', 'connect-subscription', 'connect-private', 'connect-github', 'fal-setup']) {
      expect(needsOnboardingRedirect(true, false, route), route).toBe(false);
    }
  });

  it('still routes ordinary app entry through setup', () => {
    for (const route of [undefined, '(tabs)', 'project', 'library']) {
      expect(needsOnboardingRedirect(true, false, route)).toBe(true);
      expect(needsOnboardingRedirect(false, false, route)).toBe(false);
      expect(needsOnboardingRedirect(true, true, route)).toBe(false);
    }
  });
});

import { onboardingHrefFor, safeNextPath } from '../src/lib/onboarding-navigation';

describe('deep links through first-run setup', () => {
  it('shows the 404 page rather than setup for unknown links', () => {
    expect(needsOnboardingRedirect(true, false, '+not-found')).toBe(false);
  });

  it('remembers where the visitor was going', () => {
    expect(onboardingHrefFor('/settings')).toBe('/onboarding?next=%2Fsettings');
    expect(onboardingHrefFor('/project/abc', { id: 'abc' })).toBe('/onboarding?next=%2Fproject%2Fabc');
    expect(onboardingHrefFor('/import', { repo: 'me/app' })).toBe('/onboarding?next=%2Fimport%3Frepo%3Dme%252Fapp');
    expect(onboardingHrefFor('/')).toBe('/onboarding');
  });

  it('only returns to same-app paths', () => {
    expect(safeNextPath('/settings')).toBe('/settings');
    expect(safeNextPath('/import?repo=me%2Fapp')).toBe('/import?repo=me%2Fapp');
    for (const bad of ['https://evil.test', '//evil.test', '/\\evil.test', 'settings', '/onboarding', '/onboarding?next=/x', '/', '', undefined, 42, '/javascript:alert(1)']) {
      expect(safeNextPath(bad), String(bad)).toBeNull();
    }
  });
});

import { isTabPath } from '../src/lib/onboarding-navigation';

describe('isTabPath', () => {
  it('recognises tab screens only', () => {
    expect(isTabPath('/settings')).toBe(true);
    expect(isTabPath('/creations?x=1')).toBe(true);
    expect(isTabPath('/project/abc')).toBe(false);
    expect(isTabPath('/import?repo=a/b')).toBe(false);
  });
});
