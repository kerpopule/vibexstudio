import { describe, expect, it } from 'vitest';

import { normalizeServerUrl, parsePairDeepLink } from '../src/lib/media-pairing';

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
