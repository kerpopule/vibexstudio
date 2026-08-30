import { describe, expect, it, vi } from 'vitest';

// expo-crypto isn't available under vitest; the expiry math we test doesn't
// touch it, but the module imports it at top level — stub it.
vi.mock('expo-crypto', () => ({
  getRandomBytes: () => new Uint8Array(32),
  digestStringAsync: async () => 'ZGlnZXN0',
  CryptoDigestAlgorithm: { SHA256: 'SHA-256' },
  CryptoEncoding: { BASE64: 'base64' },
}));

const { SUBSCRIPTION_PROVIDERS } = await import('../src/lib/ai/subscriptionOauth');

describe('SUBSCRIPTION_PROVIDERS', () => {
  it('routes MiniMax through the Anthropic-compatible endpoint', () => {
    const mm = SUBSCRIPTION_PROVIDERS['minimax-oauth'];
    expect(mm.protocol).toBe('anthropic');
    expect(mm.inferenceBaseUrl).toContain('/anthropic');
    expect(mm.clientId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('routes Kimi through the OpenAI-compatible coding endpoint with a UA header', () => {
    const kimi = SUBSCRIPTION_PROVIDERS['kimi-oauth'];
    expect(kimi.protocol).toBe('openai');
    expect(kimi.inferenceBaseUrl).toContain('kimi.com/coding');
    expect(kimi.inferenceHeaders?.['User-Agent']).toBeTruthy();
  });

  it('every provider declares a default model that is also suggested', () => {
    for (const spec of Object.values(SUBSCRIPTION_PROVIDERS)) {
      expect(spec.suggestedModels).toContain(spec.defaultModel);
    }
  });
});
