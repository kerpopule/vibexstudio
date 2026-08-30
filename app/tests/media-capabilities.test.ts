import { describe, expect, it, vi } from 'vitest';

// media.ts pulls in subscriptionOauth, which imports expo-crypto at top
// level; stub it (the capability logic under test never touches it).
vi.mock('expo-crypto', () => ({
  getRandomBytes: () => new Uint8Array(32),
  digestStringAsync: async () => 'ZGlnZXN0',
  CryptoDigestAlgorithm: { SHA256: 'SHA-256' },
  CryptoEncoding: { BASE64: 'base64' },
}));

const { canGenerateImages, canGenerateVideo } = await import('../src/lib/ai/media');

import type { ProviderConnection } from '../src/lib/types';

function conn(partial: Partial<ProviderConnection>): ProviderConnection {
  return {
    id: 'c1',
    kind: 'custom',
    label: 'Test',
    auth: 'apiKey',
    defaultModel: 'm',
    capabilities: { chat: true, image: false, video: false },
    createdAt: 0,
    ...partial,
  };
}

describe('canGenerateImages', () => {
  it('allows the image-capable API-key providers', () => {
    expect(canGenerateImages(conn({ kind: 'gemini' }))).toBe(true);
    expect(canGenerateImages(conn({ kind: 'openai' }))).toBe(true);
    expect(canGenerateImages(conn({ kind: 'xai' }))).toBe(true);
  });

  it('rejects chat-only providers', () => {
    expect(canGenerateImages(conn({ kind: 'anthropic' }))).toBe(false);
    expect(canGenerateImages(conn({ kind: 'openrouter' }))).toBe(false);
    expect(canGenerateImages(conn({ kind: 'custom' }))).toBe(false);
  });

  it('lets a Grok subscription make images, but not other subscriptions', () => {
    expect(canGenerateImages(conn({ subscription: 'xai-oauth' }))).toBe(true);
    expect(canGenerateImages(conn({ subscription: 'kimi-oauth' }))).toBe(false);
    expect(canGenerateImages(conn({ subscription: 'minimax-oauth' }))).toBe(false);
  });
});

describe('canGenerateVideo', () => {
  it('is Gemini-only (Veo)', () => {
    expect(canGenerateVideo(conn({ kind: 'gemini' }))).toBe(true);
    expect(canGenerateVideo(conn({ kind: 'openai' }))).toBe(false);
    expect(canGenerateVideo(conn({ kind: 'xai' }))).toBe(false);
  });

  it('never routes video through a subscription login', () => {
    expect(canGenerateVideo(conn({ subscription: 'xai-oauth' }))).toBe(false);
  });
});
