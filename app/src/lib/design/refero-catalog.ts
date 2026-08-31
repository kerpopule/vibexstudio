/**
 * Native Refero styles catalog: fetch the server-rendered styles pages and
 * parse the card grid out of them, so the Templates tab can show a fast,
 * scrollable grid of STATIC thumbnails (no WebView until a card is tapped).
 */

export interface ReferoStyleCard {
  id: string;
  /** Absolute style-detail URL (opens in the in-app browser). */
  url: string;
  name: string;
  /** Static preview image. */
  image: string;
}

export const REFERO_ORIGIN = 'https://styles.refero.design';

/**
 * Pull `[href="/style/<id>"] … <img alt="Name" src="…images.refero.design…">`
 * card blocks out of the server-rendered HTML. Pure and defensive: anything
 * that doesn't look like a complete card is skipped.
 */
export function parseReferoStyles(html: string): ReferoStyleCard[] {
  const cards: ReferoStyleCard[] = [];
  const seen = new Set<string>();
  const anchorRe = /<a[^>]+href="\/style\/([0-9a-f-]{36})"[^>]*>([\s\S]{0,2500}?)<\/a>/g;
  let match: RegExpExecArray | null;
  while ((match = anchorRe.exec(html)) !== null) {
    const id = match[1];
    if (seen.has(id)) continue;
    const block = match[2];
    const img = /<img[^>]+alt="([^"]*)"[^>]+src="(https:\/\/images\.refero\.design\/[^"]+)"/.exec(block)
      ?? /<img[^>]+src="(https:\/\/images\.refero\.design\/[^"]+)"[^>]+alt="([^"]*)"/.exec(block);
    if (!img) continue;
    const image = img[1].startsWith('https://') ? img[1] : img[2];
    const name = (img[1].startsWith('https://') ? img[2] : img[1]).trim() || 'Untitled style';
    seen.add(id);
    cards.push({ id, url: `${REFERO_ORIGIN}/style/${id}`, name, image });
  }
  return cards;
}

export interface ReferoCategory {
  slug: string;
  label: string;
  path: string;
}

/** The browse surfaces Refero actually has (no fake pagination exists). */
export const REFERO_CATEGORIES: readonly ReferoCategory[] = [
  { slug: 'featured', label: 'Featured', path: '/' },
  { slug: 'clean-saas', label: 'Clean SaaS', path: '/design-styles/clean-saas' },
  { slug: 'dark-mode-websites', label: 'Dark mode', path: '/design-styles/dark-mode-websites' },
  { slug: 'devtools-websites', label: 'Devtools', path: '/design-styles/devtools-websites' },
  { slug: 'ecommerce-websites', label: 'E-commerce', path: '/design-styles/ecommerce-websites' },
  { slug: 'editorial-websites', label: 'Editorial', path: '/design-styles/editorial-websites' },
  { slug: 'fintech-websites', label: 'Fintech', path: '/design-styles/fintech-websites' },
];

/** Fetch one category's card grid. */
export async function fetchReferoCategory(category: ReferoCategory, signal?: AbortSignal): Promise<ReferoStyleCard[]> {
  const res = await fetch(`${REFERO_ORIGIN}${category.path}`, { signal, headers: { Accept: 'text/html' } });
  if (!res.ok) throw new Error(`Refero answered ${res.status}`);
  return parseReferoStyles(await res.text());
}

export interface ReferoStyleDetail {
  title: string;
  image?: string;
  videoUrl?: string;
  /** The complete raw DESIGN.md the page ships — the capture payload. */
  designMd: string;
}

/**
 * Fetch a style detail page and pull out its DESIGN.md (embedded verbatim in
 * a <pre><code> block), preview media, and title — no WebView involved.
 */
export async function fetchReferoStyleDetail(url: string, signal?: AbortSignal): Promise<ReferoStyleDetail> {
  const res = await fetch(url, { signal, headers: { Accept: 'text/html' } });
  if (!res.ok) throw new Error(`Refero answered ${res.status}`);
  const html = await res.text();

  const anchor = html.indexOf('## Tokens');
  let designMd = '';
  if (anchor >= 0) {
    const open = html.lastIndexOf('<code', anchor);
    const start = html.indexOf('>', open);
    const close = html.indexOf('</code>', anchor);
    if (open >= 0 && start >= 0 && close > start) {
      designMd = decodeEntities(html.slice(start + 1, close)).trim();
    }
  }
  if (!designMd) throw new Error('This style page did not include a readable DESIGN.md.');

  const mdTitle = /^#\s+([^\n]+)/.exec(designMd)?.[1];
  const pageTitle = /<title>([^<|]+)/.exec(html)?.[1];
  const title = (mdTitle ?? pageTitle ?? 'Refero style').trim();

  const image = /src="(https:\/\/images\.refero\.design\/[^"]+\/image\/[^"]+)"/.exec(html)?.[1];
  const videoUrl = /src="(https:\/\/images\.refero\.design\/[^"]+\/video\/[^"]+)"/.exec(html)?.[1];

  return { title, image, videoUrl, designMd };
}

function decodeEntities(input: string): string {
  return input
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');
}
