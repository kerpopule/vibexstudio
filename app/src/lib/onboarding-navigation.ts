// Setup opens these routes before the user has finished onboarding. Keep the
// wizard mounted underneath them so returning preserves the current step.
const SETUP_ROUTES = new Set([
  'onboarding',
  'pair',
  'pair-scan',
  'connect-media-lab',
  'connect-provider',
  'transfer-ai',
  'connect-subscription',
  'connect-private',
  'connect-github',
  'fal-setup',
]);

export function needsOnboardingRedirect(hydrated: boolean, complete: boolean, route?: string): boolean {
  return hydrated && !complete && !SETUP_ROUTES.has(route ?? '') && !isRedirectExempt(route);
}

// Unknown links render the branded 404 instead of being swallowed by setup.
const NOT_REDIRECTED = new Set(['+not-found']);

export function isRedirectExempt(route?: string): boolean {
  return NOT_REDIRECTED.has(route ?? '');
}

/**
 * Where a first-time visitor should land after setup. Only same-app paths
 * are allowed: a leading single slash, no scheme, no protocol-relative `//`,
 * no backslashes, and never back into onboarding itself. Anything else
 * falls back to the home tab.
 */
export function safeNextPath(next: unknown): string | null {
  if (typeof next !== 'string') return null;
  const value = next.trim();
  if (!value.startsWith('/') || value.startsWith('//') || value.includes('\\')) return null;
  if (/^\/[a-z][a-z0-9+.-]*:/i.test(value)) return null;
  const path = value.split(/[?#]/)[0];
  if (path === '/' || path === '' || path === '/onboarding' || path.startsWith('/onboarding/')) return null;
  return value;
}

/**
 * The onboarding URL for a visitor who arrived at `pathname` (+ query).
 * Route params that are already part of the path (e.g. `/project/abc` →
 * `id=abc`) are not repeated in the query.
 */
export function onboardingHrefFor(pathname: string, params: Record<string, string | string[] | undefined> = {}): string {
  const segments = new Set(pathname.split('/').filter(Boolean).map((s) => decodeURIComponent(s)));
  const query = Object.entries(params)
    .flatMap(([key, value]) => (Array.isArray(value) ? value.map((v) => [key, v] as const) : value == null ? [] : [[key, value] as const]))
    .filter(([, value]) => !segments.has(value))
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
    .join('&');
  const target = query ? `${pathname}?${query}` : pathname;
  const next = safeNextPath(target);
  return next ? `/onboarding?next=${encodeURIComponent(next)}` : '/onboarding';
}

const TAB_PATHS = new Set(['/settings', '/creations', '/media-lab']);

/** True when `path` is one of the tab screens (replace into it, don't stack it). */
export function isTabPath(path: string): boolean {
  return TAB_PATHS.has(path.split(/[?#]/)[0]);
}
