/**
 * Media Lab inside the app — the pure half of the frame handshake (tested in
 * tests/media-lab-embed.test.ts; no Expo/native imports).
 *
 * The paired studio page is shown inside Create: an iframe on web/desktop, a
 * WebView on phones. The frame starts at the studio's `/embed` page, which
 * asks the app for a one-time ticket; the app mints it with the device pass it
 * got at pairing (`POST /api/embed/ticket`) and hands it to the frame by
 * postMessage addressed to the studio's exact origin (or the native bridge).
 * No pass ever rides in a URL. Server side: media-lab/media_lab_core/embed_gate.py.
 */
import { mediaServerOrigin } from '@/lib/medialab-core';

export const EMBED_PREFIX = 'vibex-lab:';

export type EmbedPage = 'lab' | 'cut' | 'other';

/** Messages the studio frame sends to the app. Nothing in them is secret. */
export type FrameMessage =
  | { type: 'hello' }
  | { type: 'need-ticket' }
  | { type: 'signed-in' }
  | { type: 'ready'; page: EmbedPage }
  | { type: 'blocked'; reason: string }
  | { type: 'failed' };

/** Messages the app sends into the frame. */
export type AppMessage =
  | { type: 'ticket'; ticket: string }
  | { type: 'no-ticket' };

const TICKET = /^mlab-embed-ticket-v1\.(user|admin)\.\d{10,12}\.[0-9a-f]{32}\.(n|o[A-Za-z0-9_-]{4,700})\.[0-9a-f]{64}$/;

/** A server ticket, shape-checked before it is ever posted anywhere. */
export function isEmbedTicket(value: unknown): value is string {
  return typeof value === 'string' && value.length < 1200 && TICKET.test(value);
}

/** Read a frame message (a web MessageEvent's data or the native bridge's JSON string). */
export function parseFrameMessage(data: unknown): FrameMessage | null {
  let value = data;
  if (typeof value === 'string') {
    if (value.length > 2000) return null;
    try { value = JSON.parse(value); } catch { return null; }
  }
  if (!value || typeof value !== 'object') return null;
  const raw = (value as { type?: unknown }).type;
  if (typeof raw !== 'string' || !raw.startsWith(EMBED_PREFIX)) return null;
  const type = raw.slice(EMBED_PREFIX.length);
  switch (type) {
    case 'hello': case 'need-ticket': case 'signed-in': case 'failed':
      return { type };
    case 'ready': {
      const page = (value as { page?: unknown }).page;
      return { type, page: page === 'lab' || page === 'cut' ? page : 'other' };
    }
    case 'blocked': {
      const reason = (value as { reason?: unknown }).reason;
      return { type, reason: typeof reason === 'string' ? reason.slice(0, 40) : 'unknown' };
    }
    default:
      return null;
  }
}

/** The web message for the frame, with the shared prefix. */
export function frameEnvelope(message: AppMessage): { type: string; ticket?: string } {
  return message.type === 'ticket'
    ? { type: EMBED_PREFIX + 'ticket', ticket: message.ticket }
    : { type: EMBED_PREFIX + 'no-ticket' };
}

/**
 * Which studio page to open after sign-in: the path and query of `page` when
 * it is on the studio's own origin, else the studio home. `embed=1` is always
 * set so the page tucks away the chrome the app already provides.
 */
export function embedNextPath(serverUrl: string, page?: string | null): string {
  const origin = mediaServerOrigin(serverUrl);
  let path = '/';
  let search = '';
  if (origin && page) {
    try {
      const url = new URL(page, origin + '/');
      if (url.origin === origin) { path = url.pathname || '/'; search = url.search; }
    } catch { /* not a URL: the studio home */ }
  }
  const params = new URLSearchParams(search);
  params.set('embed', '1');
  return `${path}?${params.toString()}`;
}

/** Where the frame starts: the studio's handshake page, carrying only the page to open. */
export function embedEntryUrl(serverUrl: string, page?: string | null): string | null {
  const origin = mediaServerOrigin(serverUrl);
  if (!origin) return null;
  return `${origin}/embed?next=${encodeURIComponent(embedNextPath(serverUrl, page))}`;
}

/** "media.example.com" for the "Connected to …" chip: the host name, no scheme or port. */
export function hostLabel(serverUrl: string): string {
  try {
    const host = new URL(serverUrl).hostname.replace(/^\[|\]$/g, '');
    return host.replace(/^www\./, '') || serverUrl;
  } catch {
    return serverUrl;
  }
}

/**
 * The script the phone app injects into its WebView to hand over a ticket.
 * It re-checks the page is still the studio before delivering, so a ticket can
 * never land on a page the WebView navigated to somewhere else.
 */
export function nativeDeliverScript(origin: string, message: AppMessage): string {
  const payload = message.type === 'ticket' ? { type: 'ticket', ticket: message.ticket } : { type: 'no-ticket' };
  return `(function(){try{if(location.origin!==${JSON.stringify(origin)})return;` +
    `if(typeof window.__vibexEmbedDeliver==='function')window.__vibexEmbedDeliver(${JSON.stringify(payload)});}catch(e){}})();true;`;
}

/** The studio origin a native WebView message came from, or null. */
export function messageOrigin(url: string | undefined): string | null {
  return mediaServerOrigin(url);
}
