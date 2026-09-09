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
