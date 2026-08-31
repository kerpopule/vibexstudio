import { describe, expect, it } from 'vitest';

import {
  buildWebResultsMessage,
  decodeDuckDuckGoHref,
  EMPTY_WEB_BUDGET,
  formatSearchResults,
  htmlToText,
  MAX_PAGE_TEXT_CHARS,
  MAX_TOOL_TEXT_CHARS,
  parseDuckDuckGoResults,
  parseWebFence,
  planWebRound,
  webRequestKey,
  webRequestLabel,
  type WebRequest,
} from '@/lib/ai/web-tools-core';

describe('parseWebFence', () => {
  it('parses a search request', () => {
    expect(parseWebFence('search=best free weather api no key')).toEqual({
      type: 'search',
      query: 'best free weather api no key',
    });
  });

  it('accepts search: variant and strips surrounding quotes', () => {
    expect(parseWebFence('search:"chart.js cdn"')).toEqual({ type: 'search', query: 'chart.js cdn' });
  });

  it('rejects empty and over-long queries', () => {
    expect(parseWebFence('search=')).toBeNull();
    expect(parseWebFence('search=   ')).toBeNull();
    expect(parseWebFence(`search=${'x'.repeat(201)}`)).toBeNull();
    expect(parseWebFence(`search=${'x'.repeat(200)}`)).toEqual({
      type: 'search',
      query: 'x'.repeat(200),
    });
  });

  it('parses an https url request', () => {
    expect(parseWebFence('url=https://example.com/docs/api')).toEqual({
      type: 'fetch',
      url: 'https://example.com/docs/api',
    });
  });

  it('rejects http, other schemes, and bare domains', () => {
    expect(parseWebFence('url=http://example.com')).toBeNull();
    expect(parseWebFence('url=ftp://example.com/x')).toBeNull();
    expect(parseWebFence('url=javascript:alert(1)')).toBeNull();
    expect(parseWebFence('url=example.com/docs')).toBeNull();
  });

  it('trims trailing punctuation a model may glue onto a url', () => {
    expect(parseWebFence('url=https://example.com/docs.')).toEqual({
      type: 'fetch',
      url: 'https://example.com/docs',
    });
  });

  it('rejects an info string with neither attribute', () => {
    expect(parseWebFence('')).toBeNull();
    expect(parseWebFence('lookup=cats')).toBeNull();
  });
});

describe('webRequestKey / webRequestLabel', () => {
  it('keys searches case-insensitively and fetches exactly', () => {
    expect(webRequestKey({ type: 'search', query: 'Chart.JS' })).toBe(
      webRequestKey({ type: 'search', query: 'chart.js' })
    );
    expect(webRequestKey({ type: 'fetch', url: 'https://a.com/' })).not.toBe(
      webRequestKey({ type: 'fetch', url: 'https://a.com/x' })
    );
  });

  it('labels a fetch with its host', () => {
    expect(webRequestLabel({ type: 'fetch', url: 'https://docs.example.com/api?x=1' })).toBe(
      '📄 Reading docs.example.com…'
    );
    expect(webRequestLabel({ type: 'search', query: 'cats' })).toBe('🔎 Searching: cats…');
  });
});

describe('decodeDuckDuckGoHref', () => {
  it('decodes the uddg redirect param', () => {
    const href =
      '//duckduckgo.com/l/?uddg=https%3A%2F%2Fwww.chartjs.org%2Fdocs%2Flatest%2F&rut=abc123';
    expect(decodeDuckDuckGoHref(href)).toBe('https://www.chartjs.org/docs/latest/');
  });

  it('passes through direct urls and upgrades protocol-relative ones', () => {
    expect(decodeDuckDuckGoHref('https://example.com/x')).toBe('https://example.com/x');
    expect(decodeDuckDuckGoHref('//example.com/x')).toBe('https://example.com/x');
  });

  it('rejects a uddg that decodes to a non-http destination', () => {
    expect(decodeDuckDuckGoHref('/l/?uddg=javascript%3Aalert(1)')).toBeNull();
  });
});

// A trimmed slice of real html.duckduckgo.com/html markup shape.
const DDG_FIXTURE = `
<div class="result results_links results_links_deep web-result">
  <div class="links_main links_deep result__body">
    <h2 class="result__title">
      <a rel="nofollow" class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fwww.chartjs.org%2F&amp;rut=1a2b">Chart.js | Open source HTML5 charts</a>
    </h2>
    <a class="result__snippet" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fwww.chartjs.org%2F&amp;rut=1a2b">Simple yet <b>flexible</b> JavaScript charting library.</a>
  </div>
</div>
<div class="result">
  <h2 class="result__title">
    <a rel="nofollow" class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fdeveloper.mozilla.org%2Fcanvas&amp;rut=3c4d">Canvas API - Web APIs | MDN</a>
  </h2>
  <a class="result__snippet" href="#">Draw graphics via JavaScript &amp; HTML canvas.</a>
</div>
<div class="result">
  <h2><a class="result__a" href="javascript:void(0)">Bogus non-http result</a></h2>
</div>
`;

describe('parseDuckDuckGoResults', () => {
  it('extracts titles, decoded urls, and snippets from DDG html', () => {
    const results = parseDuckDuckGoResults(DDG_FIXTURE);
    expect(results).toEqual([
      {
        title: 'Chart.js | Open source HTML5 charts',
        url: 'https://www.chartjs.org/',
        snippet: 'Simple yet flexible JavaScript charting library.',
      },
      {
        title: 'Canvas API - Web APIs | MDN',
        url: 'https://developer.mozilla.org/canvas',
        snippet: 'Draw graphics via JavaScript & HTML canvas.',
      },
    ]);
  });

  it('honors the max-results cap', () => {
    expect(parseDuckDuckGoResults(DDG_FIXTURE, 1)).toHaveLength(1);
  });

  it('formats results as "title — url\\nsnippet"', () => {
    const text = formatSearchResults(parseDuckDuckGoResults(DDG_FIXTURE, 1));
    expect(text).toBe(
      'Chart.js | Open source HTML5 charts — https://www.chartjs.org/\nSimple yet flexible JavaScript charting library.'
    );
    expect(formatSearchResults([])).toBe('(no results)');
  });
});

describe('htmlToText', () => {
  it('strips scripts, styles, comments, and tags, and decodes entities', () => {
    const html = `<html><head><style>body{color:red}</style>
      <script>alert("nope")</script></head>
      <body><h1>Docs &amp; Guides</h1><p>First&nbsp;line</p><!-- hidden --><p>Second &lt;b&gt;</p></body></html>`;
    const text = htmlToText(html);
    expect(text).toBe('Docs & Guides\nFirst line\nSecond <b>');
    expect(text).not.toContain('alert');
    expect(text).not.toContain('color:red');
  });

  it('collapses runs of whitespace', () => {
    expect(htmlToText('a   b\n\n\n   c\t\td')).toBe('a b\nc d');
  });

  it('truncates at the cap with a marker', () => {
    const text = htmlToText('x'.repeat(MAX_PAGE_TEXT_CHARS + 500));
    expect(text.length).toBe(MAX_PAGE_TEXT_CHARS + '…[truncated]'.length);
    expect(text.endsWith('…[truncated]')).toBe(true);
  });

  it('passes plain text through unharmed', () => {
    expect(htmlToText('just words')).toBe('just words');
  });
});

describe('planWebRound (budgets)', () => {
  const search = (q: string): WebRequest => ({ type: 'search', query: q });

  it('caps a round at 4 requests and de-dupes', () => {
    const requests = [search('a'), search('A'), search('b'), search('c'), search('d'), search('e')];
    const round = planWebRound(requests, EMPTY_WEB_BUDGET);
    expect(round?.execute.map((r) => (r.type === 'search' ? r.query : ''))).toEqual([
      'a',
      'b',
      'c',
      'd',
    ]);
    expect(round?.next).toEqual({ rounds: 1, requestsUsed: 4 });
    expect(round?.exhausted).toBe(false);
  });

  it('the second full round exhausts the turn', () => {
    const requests = [search('a'), search('b'), search('c'), search('d')];
    const first = planWebRound(requests, EMPTY_WEB_BUDGET)!;
    const second = planWebRound(
      [search('e'), search('f'), search('g'), search('h'), search('i')],
      first.next
    )!;
    expect(second.execute).toHaveLength(4);
    expect(second.exhausted).toBe(true);
    expect(planWebRound([search('j')], second.next)).toBeNull();
  });

  it('never exceeds the per-turn request cap across uneven rounds', () => {
    const first = planWebRound([search('a')], EMPTY_WEB_BUDGET)!;
    expect(first.next.requestsUsed).toBe(1);
    const second = planWebRound(
      [search('b'), search('c'), search('d'), search('e'), search('f')],
      first.next
    )!;
    expect(second.execute).toHaveLength(4);
    // Two rounds used — round budget is the binding cap now.
    expect(planWebRound([search('g')], second.next)).toBeNull();
  });

  it('returns null for no requests or a spent round budget', () => {
    expect(planWebRound([], EMPTY_WEB_BUDGET)).toBeNull();
    expect(planWebRound([search('a')], { rounds: 2, requestsUsed: 0 })).toBeNull();
    expect(planWebRound([search('a')], { rounds: 1, requestsUsed: 8 })).toBeNull();
  });
});

describe('buildWebResultsMessage', () => {
  it('sections results under their heading and instructs the next step', () => {
    const message = buildWebResultsMessage(
      [
        { request: { type: 'search', query: 'q' }, heading: 'search: q', content: 'r1 — u1' },
        { request: { type: 'fetch', url: 'https://a.com' }, heading: 'https://a.com', content: 'body' },
      ],
      false
    );
    expect(message.startsWith('[web results]\n### search: q\nr1 — u1\n\n### https://a.com\nbody')).toBe(
      true
    );
    expect(message).toContain('one more research round');
    expect(message).not.toContain('Research budget is used up');
  });

  it('forces finalization when the budget is spent', () => {
    const message = buildWebResultsMessage(
      [{ request: { type: 'search', query: 'q' }, heading: 'search: q', content: 'x' }],
      true
    );
    expect(message).toContain('Research budget is used up');
    expect(message).toContain('file= blocks');
  });

  it('caps total injected tool text', () => {
    const big = 'x'.repeat(MAX_TOOL_TEXT_CHARS);
    const message = buildWebResultsMessage(
      [
        { request: { type: 'fetch', url: 'https://a.com' }, heading: 'https://a.com', content: big },
        { request: { type: 'fetch', url: 'https://b.com' }, heading: 'https://b.com', content: big },
      ],
      true
    );
    expect(message.length).toBeLessThan(MAX_TOOL_TEXT_CHARS + 300);
    expect(message).toContain('…[truncated]');
  });
});
