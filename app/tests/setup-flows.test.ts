import { describe, expect, it, vi } from 'vitest';

// subscriptionOauth imports expo-crypto at top level (which drags in
// react-native); stub it — nothing under test touches randomness.
vi.mock('react-native', () => ({ Platform: { OS: 'ios', select: (o: any) => o.ios ?? o.default } }));
vi.mock('expo-constants', () => ({ default: { expoConfig: { version: '1.2.0' } } }));
vi.mock('@react-native-async-storage/async-storage', () => {
  const store = new Map<string, string>();
  return {
    default: {
      getItem: async (k: string) => store.get(k) ?? null,
      setItem: async (k: string, v: string) => void store.set(k, v),
      removeItem: async (k: string) => void store.delete(k),
    },
  };
});
vi.mock('expo-crypto', () => ({
  getRandomBytes: () => new Uint8Array(32),
  digestStringAsync: async () => 'ZGlnZXN0',
  CryptoDigestAlgorithm: { SHA256: 'SHA-256' },
  CryptoEncoding: { BASE64: 'base64' },
}));

const { chatGptAccountIdFromToken, SUBSCRIPTION_ORDER, SUBSCRIPTION_PROVIDERS } = await import('../src/lib/ai/subscriptionOauth');
const { pairParamsFromInput } = await import('../src/lib/media-pairing');
const { readyToBuild, setupSteps } = await import('../src/lib/setup');

import type { ProviderConnection } from '../src/lib/types';

function jwt(claims: Record<string, unknown>): string {
  const b64 = (s: string) => Buffer.from(s).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `${b64('{"alg":"none"}')}.${b64(JSON.stringify(claims))}.sig`;
}

const chat = (label: string, extra: Partial<ProviderConnection> = {}): ProviderConnection => ({
  id: label,
  kind: 'openai',
  label,
  auth: 'apiKey',
  defaultModel: 'gpt-5.2',
  capabilities: { chat: true, image: true, video: false },
  createdAt: 0,
  ...extra,
});

describe('ChatGPT subscription', () => {
  it('is offered first and speaks the Codex Responses protocol', () => {
    expect(SUBSCRIPTION_ORDER[0]).toBe('chatgpt-oauth');
    const spec = SUBSCRIPTION_PROVIDERS['chatgpt-oauth'];
    expect(spec.protocol).toBe('codex');
    expect(spec.inferenceBaseUrl).toBe('https://chatgpt.com/backend-api/codex');
    expect(spec.inferenceHeaders?.originator).toBe('codex_cli_rs');
  });

  it('reads the account id out of the access token', () => {
    expect(chatGptAccountIdFromToken(jwt({ 'https://api.openai.com/auth': { chatgpt_account_id: 'acct_1' } }))).toBe('acct_1');
    expect(chatGptAccountIdFromToken(jwt({ sub: 'x' }))).toBeNull();
    expect(chatGptAccountIdFromToken('not-a-jwt')).toBeNull();
  });
});

describe('pairParamsFromInput', () => {
  it('accepts a v2 pair link with both halves', () => {
    const link = 'vibex://pair?medialab=http%3A%2F%2F10.0.0.5%3A7863&workbench=http%3A%2F%2F10.0.0.5%3A8794&wbt=abc123';
    expect(pairParamsFromInput(link)).toEqual({
      medialab: 'http://10.0.0.5:7863',
      workbench: 'http://10.0.0.5:8794',
      wbt: 'abc123',
    });
  });

  it('treats a bare address as a Media Lab', () => {
    expect(pairParamsFromInput(' spark.tail1234.ts.net:7863 ')).toEqual({ medialab: 'http://spark.tail1234.ts.net:7863' });
  });

  it('rejects junk and empty vibex links', () => {
    expect(pairParamsFromInput('')).toBeNull();
    expect(pairParamsFromInput('vibex://pair')).toBeNull();
    expect(pairParamsFromInput('vibex://import?repo=a/b')).toBeNull();
  });
});

describe('setup checklist', () => {
  it('needs a chat provider before a build is possible', () => {
    const none = { providers: [], mediaLab: null, workbench: null, github: null };
    expect(readyToBuild(none)).toBe(false);
    expect(setupSteps(none).find((s) => s.id === 'ai')?.done).toBe(false);
    const withChat = { ...none, providers: [chat('OpenAI')] };
    expect(readyToBuild(withChat)).toBe(true);
    expect(setupSteps(withChat).find((s) => s.id === 'ai')?.status).toBe('OpenAI');
  });

  it('counts a paired server or an image-capable provider as media-ready', () => {
    const base = { providers: [], mediaLab: null, workbench: null, github: null };
    expect(setupSteps({ ...base, mediaLab: { url: 'http://10.0.0.5:7863', addedAt: 0 } }).find((s) => s.id === 'media')?.status).toBe('Paired · 10.0.0.5');
    expect(setupSteps({ ...base, providers: [chat('OpenAI')] }).find((s) => s.id === 'media')?.done).toBe(true);
  });
});

describe('oauthErrorDetail', () => {
  it('reads every error shape vendors send', async () => {
    const { oauthErrorDetail } = await import('../src/lib/ai/subscriptionOauth');
    expect(oauthErrorDetail({ error: 'invalid_grant' }, 400)).toBe('invalid_grant');
    expect(oauthErrorDetail({ error: 'x', error_description: 'Code expired' }, 400)).toBe('Code expired');
    expect(oauthErrorDetail({ error: { message: 'Invalid authorization code' } }, 400)).toBe('Invalid authorization code');
    expect(oauthErrorDetail({}, 502)).toBe('HTTP 502');
  });
});

describe('update check', () => {
  it('orders versions and only reports newer, published releases', async () => {
    const { compareVersions, newerRelease } = await import('../src/lib/update-check');
    expect(compareVersions('1.2.0', '1.1.0')).toBe(1);
    expect(compareVersions('v1.2.0', '1.2')).toBe(0);
    expect(compareVersions('1.2.0', '1.10.0')).toBe(-1);
    expect(newerRelease({ tag_name: 'v1.3.0', html_url: 'u', body: 'notes' }, '1.2.0')?.version).toBe('1.3.0');
    expect(newerRelease({ tag_name: 'v1.2.0' }, '1.2.0')).toBeNull();
    expect(newerRelease({ tag_name: 'v9.0.0', prerelease: true }, '1.2.0')).toBeNull();
    expect(newerRelease({ tag_name: 'v9.0.0', draft: true }, '1.2.0')).toBeNull();
  });
});
