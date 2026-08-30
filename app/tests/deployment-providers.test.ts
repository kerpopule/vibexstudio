import { describe, expect, it } from 'vitest';

import { DEPLOYMENT_PROVIDERS } from '@/lib/share/deploymentProviders';

describe('DEPLOYMENT_PROVIDERS', () => {
  it('uses explicit user-owned provider handoffs instead of hidden deployment APIs', () => {
    expect(DEPLOYMENT_PROVIDERS.map((provider) => provider.id)).toEqual([
      'vercel',
      'netlify',
      'railway',
      'digitalocean',
    ]);
    for (const provider of DEPLOYMENT_PROVIDERS) {
      expect(new URL(provider.url).protocol).toBe('https:');
      expect(provider.requiresSignIn).toBe(true);
    }
  });
});
