import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

function source(path: string): string {
  return readFileSync(path, 'utf8');
}

describe('Agent Connect platform configuration', () => {
  it('declares local-network purpose without an unjustified Bonjour service', () => {
    const app = JSON.parse(source('app.json')) as { expo: { ios: { infoPlist: Record<string, unknown> } } };
    expect(app.expo.ios.infoPlist.NSLocalNetworkUsageDescription).toMatch(/agent.*approve.*local Wi-Fi/i);
    expect(app.expo.ios.infoPlist).not.toHaveProperty('NSBonjourServices');
  });

  it('keeps non-secret metadata in AsyncStorage and bearer credentials in SecureStore', () => {
    const persistence = source('src/lib/agent-connect/persistence.native.ts');
    expect(persistence).toContain('AsyncStorage.getItem(METADATA_KEY)');
    expect(persistence).toContain('SecureStore.getItemAsync(credentialKey(agentId))');
    expect(persistence).toContain('WHEN_UNLOCKED_THIS_DEVICE_ONLY');
    expect(persistence).not.toMatch(/AsyncStorage\.(?:getItem|setItem)\(credentialKey/);
  });

  it('truthfully reports Agent Connect as unavailable on web', () => {
    const runtime = source('src/lib/agent-connect/runtime.ts');
    expect(runtime).toContain('supported: false');
    expect(runtime).toContain('unavailable on web');
  });

  it('shares the authoritative body cap with the native HTTP listener', () => {
    const httpServer = source('src/lib/agent-connect/http-server.native.ts');
    expect(httpServer).toContain('MAX_REQUEST_BODY_BYTES');
    expect(httpServer).not.toContain('512 * 1024');
  });
});
