/**
 * "You're behind" check — against GitHub Releases, nothing VibeX-owned.
 *
 * Each platform updates its own way, so this module only answers two
 * questions: is there a newer release, and where does THIS build go to
 * get it. The Studio tab shows a one-line banner; Setup has a row.
 *
 *   iOS / Android   → the store or TestFlight link in the release notes
 *   desktop (Tauri) → the shell's own updater (`check_for_updates`)
 *   plain web       → the releases page
 *
 * Polite by design: one request per launch at most every 6 hours, no
 * identifiers sent, and a dismissed version stays dismissed.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import { Platform } from 'react-native';

export const RELEASES_API = 'https://api.github.com/repos/kerpopule/vibexstudio/releases/latest';
export const RELEASES_PAGE = 'https://github.com/kerpopule/vibexstudio/releases/latest';
export const TESTFLIGHT_URL = 'https://testflight.apple.com/join/B7xNVhhF';

const CHECKED_AT_KEY = 'vibex.update.checkedAt';
const DISMISSED_KEY = 'vibex.update.dismissed';
const CHECK_EVERY_MS = 6 * 60 * 60 * 1000;

export interface UpdateInfo {
  version: string;
  tag: string;
  notes: string;
  url: string;
  publishedAt: string;
}

/** The running app's version, as shipped in app.json. */
export function currentVersion(): string {
  return Constants.expoConfig?.version ?? '0.0.0';
}

/** Semver-ish compare on dotted numerics: 1 if a > b, -1 if a < b, 0 if equal. */
export function compareVersions(a: string, b: string): number {
  const pa = a.replace(/^v/i, '').split('.').map((n) => parseInt(n, 10) || 0);
  const pb = b.replace(/^v/i, '').split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d > 0 ? 1 : -1;
  }
  return 0;
}

/** Parse the GitHub "latest release" JSON into what the UI needs, or null when it isn't newer. */
export function newerRelease(json: any, current: string): UpdateInfo | null {
  const tag = typeof json?.tag_name === 'string' ? json.tag_name : '';
  if (!tag || json?.draft || json?.prerelease) return null;
  const version = tag.replace(/^v/i, '');
  if (compareVersions(version, current) <= 0) return null;
  return {
    version,
    tag,
    notes: typeof json.body === 'string' ? json.body : '',
    url: typeof json.html_url === 'string' ? json.html_url : RELEASES_PAGE,
    publishedAt: typeof json.published_at === 'string' ? json.published_at : '',
  };
}

/** Where this build should send someone to update. */
export function updateDestination(info: UpdateInfo): { label: string; url: string } {
  if (Platform.OS === 'ios') {
    // TestFlight until the App Store listing is live; the store then updates on its own.
    return { label: 'Open TestFlight', url: TESTFLIGHT_URL };
  }
  if (Platform.OS === 'android') return { label: 'Get the update', url: info.url };
  return { label: 'See what’s new', url: info.url };
}

/** True inside the VibeX desktop shell, which has its own in-place updater. */
export function hasNativeUpdater(): boolean {
  const w = globalThis as unknown as { __TAURI_INTERNALS__?: { invoke?: unknown } };
  return typeof w.__TAURI_INTERNALS__?.invoke === 'function';
}

/** Ask the desktop shell to run its updater dialog. No-op elsewhere. */
export async function runNativeUpdater(): Promise<void> {
  const w = globalThis as unknown as { __TAURI_INTERNALS__?: { invoke?: (cmd: string) => Promise<unknown> } };
  await w.__TAURI_INTERNALS__?.invoke?.('check_for_updates');
}

/**
 * Check GitHub for a newer release. `force` skips the 6-hour throttle
 * (the Setup row). Resolves null when up to date, throttled, offline, or
 * when the newer version was dismissed.
 */
export async function checkForUpdate(force = false): Promise<UpdateInfo | null> {
  const now = Date.now();
  if (!force) {
    const last = Number(await AsyncStorage.getItem(CHECKED_AT_KEY)) || 0;
    if (now - last < CHECK_EVERY_MS) return null;
  }
  await AsyncStorage.setItem(CHECKED_AT_KEY, String(now));
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    const res = await fetch(RELEASES_API, {
      headers: { Accept: 'application/vnd.github+json' },
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!res.ok) return null;
    const info = newerRelease(await res.json(), currentVersion());
    if (!info) return null;
    if (!force && (await AsyncStorage.getItem(DISMISSED_KEY)) === info.version) return null;
    return info;
  } catch {
    return null;
  }
}

export async function dismissUpdate(version: string): Promise<void> {
  await AsyncStorage.setItem(DISMISSED_KEY, version);
}
