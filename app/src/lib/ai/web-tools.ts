/**
 * Executes the web requests a vibe turn parsed out of ```web fences
 * (docs/AGENT-WEB.md; pure logic in src/lib/ai/web-tools-core.ts).
 *
 * search → DuckDuckGo's HTML endpoint, parsed to the top organic results.
 * url    → direct GET, text/html + text/plain only, reduced to capped text.
 *
 * Every failure degrades to a short inline note in the results — research
 * never throws out of the turn, EXCEPT a user-initiated abort (Stop), which
 * propagates so the turn finalizes as "Stopped.".
 */
import {
  formatSearchResults,
  htmlToText,
  parseDuckDuckGoResults,
  webRequestLabel,
  type WebRequest,
  type WebResult,
} from '@/lib/ai/web-tools-core';

const FETCH_TIMEOUT_MS = 10_000;
// The HTML endpoint serves real markup to desktop browsers; RN's default UA
// gets bot-walled more often.
const DESKTOP_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

export interface ExecuteWebOptions {
  signal?: AbortSignal;
  /** Progress line per request, for the streaming build card. */
  onProgress?: (label: string) => void;
}

/** Runs one round of web requests sequentially. Only aborts throw. */
export async function executeWebRequests(
  requests: WebRequest[],
  opts: ExecuteWebOptions = {}
): Promise<WebResult[]> {
  const results: WebResult[] = [];
  for (const request of requests) {
    throwIfAborted(opts.signal);
    opts.onProgress?.(webRequestLabel(request));
    results.push(await executeOne(request, opts.signal));
  }
  return results;
}

async function executeOne(request: WebRequest, signal?: AbortSignal): Promise<WebResult> {
  const heading = request.type === 'search' ? `search: ${request.query}` : request.url;
  try {
    const content = request.type === 'search' ? await runSearch(request.query, signal) : await fetchPage(request.url, signal);
    return { request, heading, content };
  } catch (e) {
    throwIfAborted(signal);
    const what = request.type === 'search' ? `search "${request.query}"` : request.url;
    return { request, heading, content: `could not fetch ${what}: ${reason(e)}` };
  }
}

async function runSearch(query: string, signal?: AbortSignal): Promise<string> {
  const res = await fetchWithTimeout(
    `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`,
    signal
  );
  if (!res.ok) throw new Error(`search returned ${res.status}`);
  return formatSearchResults(parseDuckDuckGoResults(await res.text()));
}

async function fetchPage(url: string, signal?: AbortSignal): Promise<string> {
  const res = await fetchWithTimeout(url, signal);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const contentType = (res.headers.get('content-type') ?? '').toLowerCase();
  if (!contentType.startsWith('text/html') && !contentType.startsWith('text/plain')) {
    return `(skipped: content-type "${contentType.split(';')[0] || 'unknown'}" — only text/html and text/plain pages can be read)`;
  }
  const text = htmlToText(await res.text());
  return text || '(page had no readable text)';
}

/** 10s timeout + the turn's Stop signal, whichever fires first. */
async function fetchWithTimeout(url: string, signal?: AbortSignal): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  const forward = () => controller.abort();
  signal?.addEventListener('abort', forward);
  try {
    return await fetch(url, {
      method: 'GET',
      headers: { 'User-Agent': DESKTOP_UA, Accept: 'text/html,text/plain;q=0.9,*/*;q=0.5' },
      signal: controller.signal,
    });
  } catch (e) {
    // A timeout abort should read as a timeout, not a user stop.
    if (!signal?.aborted && e instanceof DOMException && e.name === 'AbortError') {
      throw new Error('timeout');
    }
    throw e;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', forward);
  }
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
}

function reason(e: unknown): string {
  if (e instanceof Error && e.message) return e.message;
  return 'unknown error';
}
