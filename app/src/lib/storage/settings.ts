/**
 * Non-secret app settings and connection metadata, stored locally in
 * AsyncStorage. Secrets (tokens, API keys) live in the keychain — see
 * `secrets.ts`.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

import type { GitHubAccount, ProviderConnection } from '@/lib/types';

const KEYS = {
  githubAccount: 'vibex.settings.githubAccount',
  providers: 'vibex.settings.providers',
  githubClientId: 'vibex.settings.githubClientId',
  appearance: 'vibex.settings.appearance',
  vibe: 'vibex.settings.vibe',
  onboardingComplete: 'vibex.settings.onboardingComplete',
  mediaLab: 'vibex.settings.mediaLab',
  workbench: 'vibex.settings.workbench',
  androidSyncFolder: 'vibex.settings.androidSyncFolder',
} as const;

/**
 * The SAF tree URI of the user-picked Android sync folder (typically inside
 * Google Drive), granted via the system folder picker. Not a secret — it's
 * an opaque content:// URI only this app's persisted grant can open.
 */
export async function getAndroidSyncFolder(): Promise<string | null> {
  return AsyncStorage.getItem(KEYS.androidSyncFolder);
}

export async function setAndroidSyncFolder(treeUri: string | null): Promise<void> {
  if (treeUri == null) await AsyncStorage.removeItem(KEYS.androidSyncFolder);
  else await AsyncStorage.setItem(KEYS.androidSyncFolder, treeUri);
}

/**
 * A paired Media Lab server (the desktop app or a Spark) the phone can jump
 * to. Present = the Media Lab tab shows. The gate code stays out of storage —
 * the user enters it once inside the Media Lab page and its cookie persists.
 */
export interface MediaLabLink {
  url: string;
  addedAt: number;
}

export async function getMediaLab(): Promise<MediaLabLink | null> {
  return readJson<MediaLabLink>(KEYS.mediaLab);
}

export async function setMediaLab(link: MediaLabLink | null): Promise<void> {
  if (link == null) await AsyncStorage.removeItem(KEYS.mediaLab);
  else await AsyncStorage.setItem(KEYS.mediaLab, JSON.stringify(link));
}

/**
 * The paired desktop Workbench (the computer that builds and serves projects
 * on the phone's behalf). The URL is not a secret; its token lives in the
 * keychain — see secrets.ts getWorkbenchToken.
 */
export interface WorkbenchLink {
  url: string;
  addedAt: number;
}

export async function getWorkbench(): Promise<WorkbenchLink | null> {
  return readJson<WorkbenchLink>(KEYS.workbench);
}

export async function setWorkbench(link: WorkbenchLink | null): Promise<void> {
  if (link == null) await AsyncStorage.removeItem(KEYS.workbench);
  else await AsyncStorage.setItem(KEYS.workbench, JSON.stringify(link));
}

/** "Not now" on the notifications nudge — once said, never nag again. */
export async function getNotificationsDeclined(): Promise<boolean> {
  return (await AsyncStorage.getItem('vibex.settings.notificationsDeclined')) === 'true';
}

export async function setNotificationsDeclined(): Promise<void> {
  await AsyncStorage.setItem('vibex.settings.notificationsDeclined', 'true');
}

/** User-chosen color scheme; 'system' follows the OS setting. */
export type AppearancePref = 'system' | 'light' | 'dark';

export async function getAppearance(): Promise<AppearancePref> {
  // Default to dark on a fresh install; once the user picks anything (incl.
  // 'system') it's stored and remembered.
  const raw = await AsyncStorage.getItem(KEYS.appearance);
  return raw === 'light' || raw === 'dark' || raw === 'system' ? raw : 'dark';
}

export async function setAppearance(pref: AppearancePref): Promise<void> {
  await AsyncStorage.setItem(KEYS.appearance, pref);
}

/**
 * Clears the retired multi-vibe preference (bubblegum/voltage). The app now
 * ships one NOIR palette with light/dark schemes; safe to call every launch.
 */
export async function clearLegacyVibe(): Promise<void> {
  await AsyncStorage.removeItem(KEYS.vibe).catch(() => {});
}

export async function getOnboardingComplete(): Promise<boolean> {
  return (await AsyncStorage.getItem(KEYS.onboardingComplete)) === 'true';
}

export async function setOnboardingComplete(complete: boolean): Promise<void> {
  if (complete) await AsyncStorage.setItem(KEYS.onboardingComplete, 'true');
  else await AsyncStorage.removeItem(KEYS.onboardingComplete);
}

async function readJson<T>(key: string): Promise<T | null> {
  const raw = await AsyncStorage.getItem(key);
  if (raw == null) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export async function getGitHubAccount(): Promise<GitHubAccount | null> {
  return readJson<GitHubAccount>(KEYS.githubAccount);
}

export async function setGitHubAccount(account: GitHubAccount | null): Promise<void> {
  if (account == null) await AsyncStorage.removeItem(KEYS.githubAccount);
  else await AsyncStorage.setItem(KEYS.githubAccount, JSON.stringify(account));
}

export async function getProviders(): Promise<ProviderConnection[]> {
  return (await readJson<ProviderConnection[]>(KEYS.providers)) ?? [];
}

export async function setProviders(providers: ProviderConnection[]): Promise<void> {
  await AsyncStorage.setItem(KEYS.providers, JSON.stringify(providers));
}

/**
 * Optional override for the GitHub OAuth App client id used by device flow.
 * Lets users bring their own OAuth app instead of the bundled one.
 */
export async function getGitHubClientIdOverride(): Promise<string | null> {
  return AsyncStorage.getItem(KEYS.githubClientId);
}

export async function setGitHubClientIdOverride(clientId: string | null): Promise<void> {
  if (clientId == null || clientId.trim() === '') await AsyncStorage.removeItem(KEYS.githubClientId);
  else await AsyncStorage.setItem(KEYS.githubClientId, clientId.trim());
}
