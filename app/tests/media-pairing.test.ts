import { describe, expect, it } from 'vitest';

import { normalizeServerUrl, parsePairDeepLink, parsePairDeepLinkV2 } from '../src/lib/media-pairing';

describe('normalizeServerUrl', () => {
  it('strips paths and keeps the origin', () => {
    expect(normalizeServerUrl('http://spark:7863/studio')).toBe('http://spark:7863');
    expect(normalizeServerUrl('https://media.example.com/')).toBe('https://media.example.com');
  });

  it('adds http:// when the scheme is missing', () => {
    expect(normalizeServerUrl('spark:7863')).toBe('http://spark:7863');
    expect(normalizeServerUrl('192.168.1.20:7863')).toBe('http://192.168.1.20:7863');
  });

  it('rejects garbage', () => {
    expect(normalizeServerUrl('')).toBeNull();
    expect(normalizeServerUrl('   ')).toBeNull();
    expect(normalizeServerUrl('http://')).toBeNull();
  });
});

describe('parsePairDeepLink', () => {
  it('extracts and normalizes the encoded server URL', () => {
    expect(parsePairDeepLink('vibex://pair?url=http%3A%2F%2F192.168.1.20%3A7863')).toBe(
      'http://192.168.1.20:7863'
    );
    expect(parsePairDeepLink('vibex://pair?url=https%3A%2F%2Fmedia.example.com%2F')).toBe(
      'https://media.example.com'
    );
  });

  it('tolerates the extra slash some launchers add', () => {
    expect(parsePairDeepLink('vibex:///pair?url=http%3A%2F%2Fspark%3A7863')).toBe('http://spark:7863');
  });

  it('ignores non-pair links', () => {
    expect(parsePairDeepLink('vibex://import?repo=a/b')).toBeNull();
    expect(parsePairDeepLink('file:///tmp/app.vibex')).toBeNull();
    expect(parsePairDeepLink('https://evil.example/pair?url=http%3A%2F%2Fx')).toBeNull();
  });

  it('rejects a pair link with no or unusable url', () => {
    expect(parsePairDeepLink('vibex://pair')).toBeNull();
    expect(parsePairDeepLink('vibex://pair?url=')).toBeNull();
    expect(parsePairDeepLink('vibex://pair?url=%')).toBeNull();
  });
});

describe('parsePairDeepLinkV2', () => {
  const enc = encodeURIComponent;

  it('parses the full v2 payload (media lab + workbench + token)', () => {
    const link = `vibex://pair?medialab=${enc('http://mac.local:7863')}&workbench=${enc('http://mac.local:8794')}&wbt=abc123def456`;
    expect(parsePairDeepLinkV2(link)).toEqual({
      mediaLab: 'http://mac.local:7863',
      workbench: { url: 'http://mac.local:8794', token: 'abc123def456' },
    });
  });

  it('keeps legacy ?url= links working as media-lab-only', () => {
    expect(parsePairDeepLinkV2(`vibex://pair?url=${enc('http://192.168.1.20:7863')}`)).toEqual({
      mediaLab: 'http://192.168.1.20:7863',
      workbench: null,
    });
  });

  it('accepts workbench-only links', () => {
    expect(parsePairDeepLinkV2(`vibex://pair?workbench=${enc('http://mac:8794')}&wbt=deadbeef`)).toEqual({
      mediaLab: null,
      workbench: { url: 'http://mac:8794', token: 'deadbeef' },
    });
  });

  it('drops a workbench half with no usable token', () => {
    expect(parsePairDeepLinkV2(`vibex://pair?workbench=${enc('http://mac:8794')}`)).toBeNull();
    expect(parsePairDeepLinkV2(`vibex://pair?workbench=${enc('http://mac:8794')}&wbt=`)).toBeNull();
    const withLab = parsePairDeepLinkV2(
      `vibex://pair?medialab=${enc('http://mac:7863')}&workbench=${enc('http://mac:8794')}&wbt=`
    );
    expect(withLab).toEqual({ mediaLab: 'http://mac:7863', workbench: null });
  });

  it('normalizes both origins and tolerates the extra slash', () => {
    const link = `vibex:///pair?medialab=${enc('http://mac:7863/studio')}&workbench=${enc('mac:8794')}&wbt=tok`;
    expect(parsePairDeepLinkV2(link)).toEqual({
      mediaLab: 'http://mac:7863',
      workbench: { url: 'http://mac:8794', token: 'tok' },
    });
  });

  it('ignores non-pair links', () => {
    expect(parsePairDeepLinkV2('vibex://import?repo=a/b')).toBeNull();
    expect(parsePairDeepLinkV2('https://evil.example/pair?workbench=x&wbt=y')).toBeNull();
    expect(parsePairDeepLinkV2('vibex://pair')).toBeNull();
  });
});
