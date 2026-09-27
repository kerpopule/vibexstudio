import { describe, expect, it } from 'vitest';

import { APP_TITLE, pageTitle } from '../src/lib/page-titles';

describe('pageTitle', () => {
  it('names the home tab', () => {
    expect(pageTitle('/')).toBe(`Build · ${APP_TITLE}`);
    expect(pageTitle(undefined)).toBe(`Build · ${APP_TITLE}`);
    expect(pageTitle('/(tabs)')).toBe(`Build · ${APP_TITLE}`);
  });

  it('names known routes, ignoring groups, params and queries', () => {
    expect(pageTitle('/settings')).toBe(`Setup · ${APP_TITLE}`);
    expect(pageTitle('/(tabs)/creations')).toBe(`Library · ${APP_TITLE}`);
    expect(pageTitle('/project/abc123')).toBe(`Project · ${APP_TITLE}`);
    expect(pageTitle('/onboarding?from=%2Fsettings')).toBe(`Welcome · ${APP_TITLE}`);
  });

  it('falls back for unknown routes', () => {
    expect(pageTitle('/definitely-missing')).toBe(`Page not found · ${APP_TITLE}`);
  });
});
