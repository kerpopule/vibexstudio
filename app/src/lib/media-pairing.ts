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
  const decoded = pairQueryParam(link, 'url');
  return decoded ? normalizeServerUrl(decoded) : null;
}

/** One decoded query param off a pair link, or null when absent/undecodable. */
function pairQueryParam(link: string, name: string): string | null {
  const match = new RegExp(`[?&]${name}=([^&#]*)`).exec(link);
  if (!match || !match[1]) return null;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return null;
  }
}

export interface WorkbenchPairing {
  url: string;
  token: string;
}

/** Everything one scanned QR can pair: either half may be missing. */
export interface PairPayload {
  mediaLab: string | null;
  workbench: WorkbenchPairing | null;
}

/**
 * V2 pair-link parser, handling both generations of the desktop QR:
 *   legacy  vibex://pair?url=<enc>                            (Media Lab only)
 *   v2      vibex://pair?medialab=<enc>&workbench=<enc>&wbt=<token>
 * Returns null when the link isn't a pair link or carries nothing usable.
 * A workbench half without a token is dropped (the server rejects everything
 * without it, so pairing would only manufacture a broken state).
 */
export function parsePairDeepLinkV2(link: string): PairPayload | null {
  if (!/^vibex:\/{2,3}pair(\?|$)/i.test(link.trim())) return null;
  const mediaLabRaw = pairQueryParam(link, 'medialab') ?? pairQueryParam(link, 'url');
  const mediaLab = mediaLabRaw ? normalizeServerUrl(mediaLabRaw) : null;
  const workbenchUrlRaw = pairQueryParam(link, 'workbench');
  const workbenchUrl = workbenchUrlRaw ? normalizeServerUrl(workbenchUrlRaw) : null;
  const token = pairQueryParam(link, 'wbt');
  const workbench =
    workbenchUrl && token && /^\S+$/.test(token) ? { url: workbenchUrl, token } : null;
  if (!mediaLab && !workbench) return null;
  return { mediaLab, workbench };
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
