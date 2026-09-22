/**
 * The Co-Agent ambient ground washes, delivered as real CSS.
 *
 * Why this module exists: `react-native-web` has no gradient handling at all
 * (verified 2026-09-22 — zero occurrences of "gradient" in the package), so a
 * `backgroundImage` string in a `View` style is silently dropped and never
 * reaches the DOM. `ThemedView` carried the washes that way for its whole life,
 * which is why the app's ground has always been flat ink with no ambient glow.
 *
 * The fix is to publish the washes as an actual stylesheet rule and opt the
 * ground element in with `dataSet={{ vibexGround: 'on' }}` (RNW maps camelCase
 * `dataSet` keys onto `data-*` attributes). The washes then ride on the app's own
 * ground element, so they paint above the renderer's own background layer and
 * below content — no z-index or transparency games.
 *
 * Web only. Native has no radial gradients and keeps the flat `background`
 * token, exactly as before.
 */

import { Platform } from 'react-native';

import type { Theme } from '@/constants/theme';

const STYLE_ID = 'vibex-ground-washes';

/**
 * Geometry and order are Media Lab's own
 * (`media-lab/static/index.html`, `:root[data-theme="coagent"] body`):
 * blue top-left, violet top-right, warm amber bottom-centre.
 */
export function groundWashes(theme: Theme): string {
  return [
    `radial-gradient(900px 620px at 14% -6%, ${theme.washBlue} 0%, transparent 70%)`,
    `radial-gradient(820px 560px at 92% 10%, ${theme.washViolet} 0%, transparent 70%)`,
    `radial-gradient(720px 520px at 50% 102%, ${theme.washAmber} 0%, transparent 72%)`,
  ].join(',');
}

/** The attribute RNW renders for `dataSet={{ vibexGround: 'on' }}`. */
export const GROUND_ATTR = 'data-vibex-ground';

/**
 * Publish (or refresh) the wash rule for the active theme. Idempotent, and a
 * no-op off web.
 */
export function applyGroundWashes(theme: Theme): void {
  if (Platform.OS !== 'web') return;
  if (typeof document === 'undefined' || !document.head) return;

  let el = document.getElementById(STYLE_ID) as HTMLStyleElement | null;
  if (!el) {
    el = document.createElement('style');
    el.id = STYLE_ID;
    document.head.appendChild(el);
  }

  const rule = `[${GROUND_ATTR}]{background-image:${groundWashes(theme)}}`;
  if (el.textContent !== rule) el.textContent = rule;

  // Keep the window chrome and any overscroll on the same ink so the ground
  // never flashes a different colour at the edges.
  document.documentElement.style.backgroundColor = theme.background;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', theme.background);
}
