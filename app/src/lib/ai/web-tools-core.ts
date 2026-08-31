/**
 * Pure logic for the agentic ```web fence protocol (docs/AGENT-WEB.md):
 * fence parsing, DuckDuckGo HTML result extraction, html→text reduction,
 * and the round/request budgets that bound the research loop. No network,
 * no Expo imports — everything here is unit-tested
 * (tests/web-tools-core.test.ts). The effectful side (fetches, timeouts)
 * lives in src/lib/ai/web-tools.ts.
 */

/** One parsed ```web fence from an assistant reply. */
export type WebRequest =
  | { type: 'search'; query: string }
  | { type: 'fetch'; url: string };

export const MAX_QUERY_LENGTH = 200;
/** Requests actually executed per research round. */
export const MAX_REQUESTS_PER_ROUND = 4;
/** Requests executed across the whole user turn. */
export const MAX_REQUESTS_PER_TURN = 8;
/** Research rounds (continuations) per user turn, then we force files. */
export const MAX_TOOL_ROUNDS = 2;
/** Cap on tool text injected back into the conversation, per round. */
export const MAX_TOOL_TEXT_CHARS = 20_000;
/** Cap on one fetched page's extracted text. */
export const MAX_PAGE_TEXT_CHARS = 6000;
/** Search results returned per query. */
export const MAX_SEARCH_RESULTS = 5;

const SEARCH_ATTR = /(?:^|\s)search[:=](.+)$/i;
const URL_ATTR = /(?:^|\s)url[:=](\S+)/i;

/**
 * Validates the info string of a ```web fence ("search=<query>" or
 * "url=<https url>"). Null keeps the raw block in the chat text — a
 * malformed fence is never half-executed. http:// (and every non-https
 * scheme) is rejected by design.
 */
export function parseWebFence(infoRest: string): WebRequest | null {
  const info = infoRest.trim();
  const urlMatch = info.match(URL_ATTR);
  if (urlMatch) {
    const url = urlMatch[1].replace(/[>,.)\]]+$/, '');
    if (!/^https:\/\/[^\s]+$/i.test(url)) return null;
    try {
      // Structural validation only — no fetch happens here.
      new URL(url);
    } catch {
      return null;
    }
    return { type: 'fetch', url };
  }
  const searchMatch = info.match(SEARCH_ATTR);
  if (searchMatch) {
    const query = searchMatch[1].trim().replace(/^"(.*)"$/, '$1').trim();
    if (!query || query.length > MAX_QUERY_LENGTH) return null;
    return { type: 'search', query };
  }
  return null;
}

/** Stable identity for de-duping repeated requests within a turn. */
export function webRequestKey(request: WebRequest): string {
  return request.type === 'search'
    ? `search:${request.query.toLowerCase()}`
    : `fetch:${request.url}`;
}

/** Short human label for progress streaming ("🔎 Searching: …"). */
export function webRequestLabel(request: WebRequest): string {
  if (request.type === 'search') return `🔎 Searching: ${request.query}…`;
  let host = request.url;
  try {
    host = new URL(request.url).host;
  } catch {
    // keep the raw url
  }
  return `📄 Reading ${host}…`;
}

// ---------------------------------------------------------------------------
// Budgets — the loop in vibe.ts is bounded by these, not by model behavior
// ---------------------------------------------------------------------------

export interface WebBudget {
  /** Research rounds already run this turn. */
  rounds: number;
  /** Requests already executed this turn. */
  requestsUsed: number;
}

export const EMPTY_WEB_BUDGET: WebBudget = { rounds: 0, requestsUsed: 0 };

export interface WebRoundPlan {
  /** De-duped requests to execute now (≤ per-round and per-turn caps). */
  execute: WebRequest[];
  /** Budget after this round runs. */
  next: WebBudget;
  /** True when the NEXT reply must be final (no budget left after this). */
  exhausted: boolean;
}

/**
 * Decides what (if anything) of a reply's web requests gets executed.
 * Null = no research round happens and the reply is final as-is.
 */
export function planWebRound(requests: WebRequest[], budget: WebBudget): WebRoundPlan | null {
  if (requests.length === 0) return null;
  if (budget.rounds >= MAX_TOOL_ROUNDS) return null;
  const remaining = MAX_REQUESTS_PER_TURN - budget.requestsUsed;
  if (remaining <= 0) return null;

  const seen = new Set<string>();
  const deduped: WebRequest[] = [];
  for (const request of requests) {
    const key = webRequestKey(request);
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(request);
  }
  const execute = deduped.slice(0, Math.min(MAX_REQUESTS_PER_ROUND, remaining));
  if (execute.length === 0) return null;
  const next: WebBudget = {
    rounds: budget.rounds + 1,
    requestsUsed: budget.requestsUsed + execute.length,
  };
  return {
    execute,
    next,
    exhausted: next.rounds >= MAX_TOOL_ROUNDS || next.requestsUsed >= MAX_REQUESTS_PER_TURN,
  };
}

// ---------------------------------------------------------------------------
// DuckDuckGo HTML endpoint parsing
// ---------------------------------------------------------------------------

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

/**
 * DDG result links point at //duckduckgo.com/l/?uddg=<encoded real url>.
 * Decodes the redirect back to the destination; direct http(s) hrefs pass
 * through, anything else is dropped.
 */
export function decodeDuckDuckGoHref(href: string): string | null {
  const uddg = href.match(/[?&]uddg=([^&"']+)/);
  if (uddg) {
    try {
      const decoded = decodeURIComponent(uddg[1]);
      return /^https?:\/\//i.test(decoded) ? decoded : null;
    } catch {
      return null;
    }
  }
  if (/^https?:\/\//i.test(href)) return href;
  if (href.startsWith('//')) return `https:${href}`;
  return null;
}

const RESULT_ANCHOR = /<a\b([^>]*\bclass="[^"]*\bresult__a\b[^"]*"[^>]*)>([\s\S]*?)<\/a>/gi;
const SNIPPET = /\bresult__snippet\b[^>]*>([\s\S]*?)<\/(?:a|div|span|td)>/i;

/** Extracts the top organic results from html.duckduckgo.com/html markup. */
export function parseDuckDuckGoResults(html: string, max: number = MAX_SEARCH_RESULTS): SearchResult[] {
  const results: SearchResult[] = [];
  const matches = [...html.matchAll(RESULT_ANCHOR)];
  for (let i = 0; i < matches.length && results.length < max; i += 1) {
    const match = matches[i];
    const href = match[1].match(/href="([^"]+)"/)?.[1];
    const url = href ? decodeDuckDuckGoHref(decodeEntities(href)) : null;
    if (!url) continue;
    const title = collapseWhitespace(decodeEntities(stripTags(match[2])));
    if (!title) continue;
    // The snippet lives between this anchor and the next result anchor.
    const start = (match.index ?? 0) + match[0].length;
    const end = matches[i + 1]?.index ?? html.length;
    const snippetRaw = html.slice(start, end).match(SNIPPET)?.[1] ?? '';
    const snippet = collapseWhitespace(decodeEntities(stripTags(snippetRaw)));
    results.push({ title, url, snippet });
  }
  return results;
}

/** "title — url\nsnippet" per result, the shape injected back to the model. */
export function formatSearchResults(results: SearchResult[]): string {
  if (results.length === 0) return '(no results)';
  return results
    .map((r) => `${r.title} — ${r.url}${r.snippet ? `\n${r.snippet}` : ''}`)
    .join('\n\n');
}

// ---------------------------------------------------------------------------
// Page text extraction
// ---------------------------------------------------------------------------

/**
 * Reduces an HTML (or plain-text) body to readable text: scripts/styles
 * gone, tags stripped, entities decoded, whitespace collapsed, capped.
 */
export function htmlToText(html: string, cap: number = MAX_PAGE_TEXT_CHARS): string {
  const text = collapseWhitespace(
    decodeEntities(
      html
        .replace(/<script\b[\s\S]*?<\/script\s*>/gi, ' ')
        .replace(/<style\b[\s\S]*?<\/style\s*>/gi, ' ')
        .replace(/<!--[\s\S]*?-->/g, ' ')
        .replace(/<(?:br|hr)\b[^>]*>|<\/(?:p|div|h[1-6]|li|tr|section|article|blockquote|pre)\s*>/gi, '\n')
        .replace(/<[^>]*>/g, ' ')
    )
  );
  return text.length > cap ? `${text.slice(0, cap)}…[truncated]` : text;
}

// ---------------------------------------------------------------------------
// Tool-results message
// ---------------------------------------------------------------------------

export interface WebResult {
  request: WebRequest;
  /** Section heading: the url or the query. */
  heading: string;
  /** Result text, or a short failure note ("could not fetch X: timeout"). */
  content: string;
}

const FINALIZE_NOTE =
  'Research budget is used up — do NOT emit more ```web fences. Produce your final reply now with complete file= blocks.';

/**
 * Builds the user-role continuation message carrying one round's results.
 * Bounded at MAX_TOOL_TEXT_CHARS so a heavy page can't blow up the prompt.
 */
export function buildWebResultsMessage(results: WebResult[], mustFinalize: boolean): string {
  const sections = results.map((r) => `### ${r.heading}\n${r.content}`);
  let body = sections.join('\n\n');
  if (body.length > MAX_TOOL_TEXT_CHARS) body = `${body.slice(0, MAX_TOOL_TEXT_CHARS)}…[truncated]`;
  const tail = mustFinalize
    ? FINALIZE_NOTE
    : 'Use these results. If you have what you need, output the files now; you may request at most one more research round.';
  return `[web results]\n${body}\n\n${tail}`;
}

// ---------------------------------------------------------------------------

function stripTags(html: string): string {
  return html.replace(/<[^>]*>/g, ' ');
}

function collapseWhitespace(text: string): string {
  return text
    .replace(/[ \t\r\f\v]+/g, ' ')
    .replace(/\s*\n\s*/g, '\n')
    .replace(/\n{2,}/g, '\n')
    .trim();
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  mdash: '—',
  ndash: '–',
  hellip: '…',
  rsquo: '’',
  lsquo: '‘',
  rdquo: '”',
  ldquo: '“',
};

function decodeEntities(text: string): string {
  return text.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (whole, entity: string) => {
    if (entity[0] === '#') {
      const code =
        entity[1]?.toLowerCase() === 'x'
          ? Number.parseInt(entity.slice(2), 16)
          : Number.parseInt(entity.slice(1), 10);
      return Number.isFinite(code) && code > 0 ? String.fromCodePoint(code) : whole;
    }
    return NAMED_ENTITIES[entity.toLowerCase()] ?? whole;
  });
}
