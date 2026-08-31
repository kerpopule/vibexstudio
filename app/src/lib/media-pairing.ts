/**
 * Media Lab pairing helpers — shared by the vibex://pair deep link handler
 * (desktop QR flow), the paste-a-URL screen, and the Media Lab tab.
 * Pure parsing lives here so it's unit-testable; the probe is a plain fetch.
 */

/** Normalizes user/QR input to a bare origin ("http://host:port"), or null. */
export function normalizeServerUrl(raw: string): string | null {
  let url = raw.trim();
  if (!url) return null;
  if (!/^https?:\/\//i.test(url)) url = `http://${url}`;
  try {
    const parsed = new URL(url);
    if (!parsed.host) return null;
    return `${parsed.protocol}//${parsed.host}`;
  } catch {
    return null;
  }
}

/**
 * Extracts the server origin from a `vibex://pair?url=<encoded>` deep link.
 * Returns null for anything that isn't a well-formed pair link (including
 * the .vibex file URLs the root layout also handles).
 */
export function parsePairDeepLink(link: string): string | null {
  // Accept vibex://pair and vibex:///pair (some launchers add a slash).
  if (!/^vibex:\/{2,3}pair(\?|$)/i.test(link.trim())) return null;
  const match = /[?&]url=([^&#]*)/.exec(link);
  if (!match || !match[1]) return null;
  let decoded: string;
  try {
    decoded = decodeURIComponent(match[1]);
  } catch {
    return null;
  }
  return normalizeServerUrl(decoded);
}

/** True when a Media Lab answers at `url` (gate-exempt /manifest.json). */
export async function probeMediaLab(url: string, timeoutMs = 6000): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const res = await fetch(`${url.replace(/\/+$/, '')}/manifest.json`, { signal: controller.signal });
    clearTimeout(timer);
    return res.ok;
  } catch {
    return false;
  }
}
