/**
 * Turns the share links people actually paste — Dropbox, Google Drive,
 * iCloud Drive, or any plain URL — into something fetchable, so a `.vibex`
 * bundle stored on the user's own cloud can be opened straight from a link.
 * Pure module — no Expo imports — so it stays unit-testable.
 */

export type NormalizedLink =
  /** Fetch this URL directly; it should return the bundle bytes. */
  | { kind: 'direct'; url: string }
  /** An iCloud Drive share that must be resolved through CloudKit first. */
  | { kind: 'icloud'; shortGuid: string };

/** Recognizes and rewrites a pasted share link. Returns null for non-URLs. */
export function normalizeShareLink(raw: string): NormalizedLink | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  // Allow pasting our own deep link with an embedded url.
  const deepLink = trimmed.match(/^vibex:\/\/import\?url=(.+)$/i);
  if (deepLink) return normalizeShareLink(decodeURIComponent(deepLink[1]));

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  const host = url.hostname.toLowerCase();

  // Dropbox: dl=1 turns any share page into a direct download.
  if (host === 'www.dropbox.com' || host === 'dropbox.com' || host.endsWith('.dropbox.com')) {
    url.searchParams.set('dl', '1');
    return { kind: 'direct', url: url.toString() };
  }

  // Google Drive: unwrap the file id from the viewer URL.
  if (host === 'drive.google.com' || host === 'docs.google.com') {
    const byPath = url.pathname.match(/\/file\/d\/([\w-]+)/);
    const id = byPath?.[1] ?? url.searchParams.get('id');
    if (id) return { kind: 'direct', url: `https://drive.google.com/uc?export=download&id=${id}` };
    return { kind: 'direct', url: url.toString() };
  }

  // iCloud Drive share links carry a short GUID that CloudKit resolves.
  if (host === 'www.icloud.com' || host === 'icloud.com') {
    const guid = url.pathname.match(/\/iclouddrive\/([\w-]+)/)?.[1] ?? url.hash.match(/iclouddrive\/([\w-]+)/)?.[1];
    if (guid) return { kind: 'icloud', shortGuid: guid };
    return null;
  }

  return { kind: 'direct', url: url.toString() };
}

/**
 * Sniffs a fetched body that is clearly a cloud provider's HTML interstitial
 * (sign-in walls, Drive's virus-scan page) rather than a bundle.
 */
export function looksLikeHtmlPage(body: string): boolean {
  // Only sniff how the body STARTS — a .vibex bundle legitimately contains
  // "<head>" etc. inside its JSON-inlined app files.
  const head = body.trimStart().slice(0, 20).toLowerCase();
  return head.startsWith('<!doctype') || head.startsWith('<html') || head.startsWith('<head');
}
