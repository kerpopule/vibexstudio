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

/** Fetch one page of the styles catalog (1-based). Empty array = the end. */
export async function fetchReferoStyles(page: number, signal?: AbortSignal): Promise<ReferoStyleCard[]> {
  const url = page <= 1 ? `${REFERO_ORIGIN}/` : `${REFERO_ORIGIN}/?page=${page}`;
  const res = await fetch(url, {
    signal,
    headers: { Accept: 'text/html' },
  });
  if (!res.ok) throw new Error(`Refero answered ${res.status}`);
  return parseReferoStyles(await res.text());
}
