import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  EMBED_PREFIX, embedEntryUrl, embedNextPath, frameEnvelope, hostLabel, isEmbedTicket,
  messageOrigin, nativeDeliverScript, parseFrameMessage,
} from '@/lib/media-lab-embed';
import { requestEmbedTicket } from '@/lib/remote-generation';

const state = vi.hoisted(() => ({ connections: new Map<string, string>() }));
vi.mock('@/lib/storage/secrets', () => ({
  getGenerationConnection: async (origin: string) => state.connections.get(origin) ?? null,
  setGenerationConnection: async (origin: string, value: string) => { state.connections.set(origin, value); },
  getLibraryToken: async () => null,
  setLibraryToken: async () => {},
}));
vi.mock('expo-crypto', () => ({ getRandomBytes: (size: number) => new Uint8Array(size).fill(1) }));

const origin = 'https://media.example';
const device = '01'.repeat(16);
const pass = `mlab-render-v1.user.1788554000.${device}.${'f'.repeat(64)}`;
const ticket = `mlab-embed-ticket-v1.user.1790000060.${'a'.repeat(32)}.oaHR0cHM6Ly9hcHAuZXhhbXBsZQ.${'b'.repeat(64)}`;
const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });

beforeEach(() => { state.connections.clear(); vi.restoreAllMocks(); });

describe('the frame entry URL', () => {
  it('starts at the handshake page and carries only the page to open', () => {
    expect(embedEntryUrl('https://media.example/')).toBe('https://media.example/embed?next=%2F%3Fembed%3D1');
    expect(embedEntryUrl('http://100.64.0.1:7863', 'http://100.64.0.1:7863/cut?project=p1'))
      .toBe('http://100.64.0.1:7863/embed?next=' + encodeURIComponent('/cut?project=p1&embed=1'));
    expect(embedEntryUrl('https://media.example', '/?job=abc')).toBe('https://media.example/embed?next=' + encodeURIComponent('/?job=abc&embed=1'));
  });

  it('never points the frame at another origin, and refuses credentials in the address', () => {
    expect(embedNextPath(origin, 'https://evil.example/steal')).toBe('/?embed=1');
    expect(embedNextPath(origin, '//evil.example/x')).toBe('/?embed=1');
    expect(embedNextPath(origin, 'javascript:alert(1)')).toBe('/?embed=1');
    expect(embedEntryUrl('https://user:secret@media.example')).toBeNull();
    expect(embedEntryUrl('ftp://media.example')).toBeNull();
  });

  it('keeps embed=1 exactly once', () => {
    expect(embedNextPath(origin, '/?embed=1&job=x')).toBe('/?embed=1&job=x');
    expect(embedNextPath(origin, '/?embed=0')).toBe('/?embed=1');
  });
});

describe('frame messages', () => {
  it('reads only prefixed, known messages', () => {
    expect(parseFrameMessage({ type: EMBED_PREFIX + 'need-ticket' })).toEqual({ type: 'need-ticket' });
    expect(parseFrameMessage({ type: EMBED_PREFIX + 'ready', page: 'cut' })).toEqual({ type: 'ready', page: 'cut' });
    expect(parseFrameMessage({ type: EMBED_PREFIX + 'ready', page: '<b>' })).toEqual({ type: 'ready', page: 'other' });
    expect(parseFrameMessage(JSON.stringify({ type: EMBED_PREFIX + 'blocked', reason: 'cookies' }))).toEqual({ type: 'blocked', reason: 'cookies' });
    expect(parseFrameMessage({ type: 'need-ticket' })).toBeNull();
    expect(parseFrameMessage({ type: EMBED_PREFIX + 'ticket', ticket })).toBeNull();
    expect(parseFrameMessage('not json')).toBeNull();
    expect(parseFrameMessage(null)).toBeNull();
    expect(parseFrameMessage('x'.repeat(5000))).toBeNull();
  });

  it('wraps what the app sends', () => {
    expect(frameEnvelope({ type: 'ticket', ticket })).toEqual({ type: EMBED_PREFIX + 'ticket', ticket });
    expect(frameEnvelope({ type: 'no-ticket' })).toEqual({ type: EMBED_PREFIX + 'no-ticket' });
  });

  it('only accepts well-formed tickets', () => {
    expect(isEmbedTicket(ticket)).toBe(true);
    expect(isEmbedTicket(ticket.replace('.user.', '.root.'))).toBe(false);
    expect(isEmbedTicket(ticket + '"')).toBe(false);
    expect(isEmbedTicket(42)).toBe(false);
  });

  it('delivers to the phone WebView only while it is still on the studio', () => {
    const script = nativeDeliverScript(origin, { type: 'ticket', ticket });
    expect(script).toContain('if(location.origin!=="https://media.example")return;');
    expect(script).toContain(ticket);
    const delivered: unknown[] = [];
    const run = (at: string) => new Function('location', 'window', script)({ origin: at }, { __vibexEmbedDeliver: (d: unknown) => delivered.push(d) });
    run('https://evil.example');
    expect(delivered).toEqual([]);
    run(origin);
    expect(delivered).toEqual([{ type: 'ticket', ticket }]);
    expect(messageOrigin('https://media.example/embed?next=%2F')).toBe(origin);
    expect(messageOrigin('about:blank')).toBeNull();
  });

  it('labels the host plainly', () => {
    expect(hostLabel('https://media.example.com:8450/')).toBe('media.example.com');
    expect(hostLabel('http://100.64.0.1:7863')).toBe('100.64.0.1');
    expect(hostLabel('http://[::1]:7863')).toBe('::1');
    expect(hostLabel('not a url')).toBe('not a url');
  });
});

describe('embed tickets', () => {
  it('asks for a code when this device has no generation pass', async () => {
    const fetcher = vi.spyOn(globalThis, 'fetch');
    expect(await requestEmbedTicket(origin)).toEqual({ ok: false, reason: 'no-pass' });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('mints with the pass in a header, never a URL, and checks what comes back', async () => {
    state.connections.set(origin, JSON.stringify({ deviceId: device, token: pass }));
    const fetcher = vi.spyOn(globalThis, 'fetch').mockResolvedValue(json({ ticket, expiresIn: 60 }));
    expect(await requestEmbedTicket(origin + '/')).toEqual({ ok: true, ticket });
    const [url, init] = fetcher.mock.calls[0];
    expect(url).toBe(origin + '/api/embed/ticket');
    expect(String(url)).not.toContain(pass);
    expect(init).toMatchObject({ method: 'POST', credentials: 'omit', redirect: 'error', headers: { Authorization: `Bearer ${pass}` } });

    fetcher.mockResolvedValue(json({ ticket: 'mlab-render-v1.stolen' }));
    expect(await requestEmbedTicket(origin)).toEqual({ ok: false, reason: 'unsupported' });
  });

  it('tells apart an expired pass, an unlisted app and an old studio', async () => {
    state.connections.set(origin, JSON.stringify({ deviceId: device, token: pass }));
    const fetcher = vi.spyOn(globalThis, 'fetch');
    fetcher.mockResolvedValueOnce(json({ error: 'A Media Lab generation pass is required.' }, 401));
    expect(await requestEmbedTicket(origin)).toEqual({ ok: false, reason: 'pass-refused' });
    fetcher.mockResolvedValueOnce(json({ error: 'origin-not-allowed' }, 403));
    expect(await requestEmbedTicket(origin)).toEqual({ ok: false, reason: 'origin-not-allowed' });
    fetcher.mockResolvedValueOnce(json({ detail: 'Not Found' }, 404));
    expect(await requestEmbedTicket(origin)).toEqual({ ok: false, reason: 'unsupported' });
    fetcher.mockRejectedValueOnce(new Error('offline'));
    expect(await requestEmbedTicket(origin)).toEqual({ ok: false, reason: 'unreachable' });
  });
});
