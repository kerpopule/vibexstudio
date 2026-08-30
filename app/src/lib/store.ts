/**
 * App-level state (zustand). Thin layer over local storage: hydrates once at
 * launch, then keeps storage and UI in sync.
 */
import { Appearance } from 'react-native';
import { create } from 'zustand';

import { PROVIDERS } from '@/lib/ai/registry';
import { refreshSubscription } from '@/lib/ai/subscriptionOauth';
import { getAuthenticatedUser } from '@/lib/github/api';
import * as projectStore from '@/lib/storage/projects';
import * as secrets from '@/lib/storage/secrets';
import * as settings from '@/lib/storage/settings';
import type { AppearancePref, MediaLabLink } from '@/lib/storage/settings';
import type { GitHubAccount, ProjectMeta, ProviderConnection, ProviderKind } from '@/lib/types';

interface AppState {
  hydrated: boolean;
  projects: ProjectMeta[];
  github: GitHubAccount | null;
  providers: ProviderConnection[];
  appearance: AppearancePref;
  onboardingComplete: boolean;
  mediaLab: MediaLabLink | null;

  hydrate: () => Promise<void>;
  setAppearance: (pref: AppearancePref) => Promise<void>;
  setMediaLab: (link: MediaLabLink | null) => Promise<void>;
  completeOnboarding: () => Promise<void>;
  refreshProjects: () => Promise<void>;
  createProject: (name: string, emoji: string) => Promise<ProjectMeta>;
  deleteProject: (id: string) => Promise<void>;

  connectGitHub: (token: string, auth: GitHubAccount['auth']) => Promise<GitHubAccount>;
  disconnectGitHub: () => Promise<void>;

  addProvider: (opts: {
    kind: ProviderKind;
    auth: ProviderConnection['auth'];
    secret: string;
    label?: string;
    baseUrl?: string;
    model?: string;
  }) => Promise<ProviderConnection>;
  /** Save a connected "bring your subscription" OAuth login. */
  addSubscription: (opts: {
    subscription: NonNullable<ProviderConnection['subscription']>;
    label: string;
    defaultModel: string;
    accessToken: string;
    refreshToken?: string;
    expiresAt: number;
  }) => Promise<ProviderConnection>;
  /** Refresh a subscription token if it's near expiry. Safe to call always. */
  refreshSubscriptionIfNeeded: (connectionId: string) => Promise<void>;
  removeProvider: (id: string) => Promise<void>;
  setConnectionModel: (id: string, model: string) => Promise<void>;
}

export const useApp = create<AppState>((set, get) => ({
  hydrated: false,
  projects: [],
  github: null,
  providers: [],
  appearance: 'system',
  onboardingComplete: false,
  mediaLab: null,

  hydrate: async () => {
    // Pre-sync local projects hop into the iCloud container first, so the
    // list below already sees them in their synced home. No-op off-Apple.
    await projectStore.migrateLocalProjectsToCloud().catch(() => {});
    const [projects, github, providers, appearance, onboardingComplete, mediaLab] = await Promise.all([
      projectStore.listProjects(),
      settings.getGitHubAccount(),
      settings.getProviders(),
      settings.getAppearance(),
      settings.getOnboardingComplete(),
      settings.getMediaLab(),
    ]);
    settings.clearLegacyVibe().catch(() => {});
    applyAppearance(appearance);
    set({ projects, github, providers, appearance, onboardingComplete, mediaLab, hydrated: true });
  },

  setMediaLab: async (link) => {
    set({ mediaLab: link });
    await settings.setMediaLab(link);
  },

  setAppearance: async (pref) => {
    applyAppearance(pref);
    set({ appearance: pref });
    await settings.setAppearance(pref);
  },

  completeOnboarding: async () => {
    set({ onboardingComplete: true });
    await settings.setOnboardingComplete(true);
  },

  refreshProjects: async () => {
    set({ projects: await projectStore.listProjects() });
  },

  createProject: async (name, emoji) => {
    const meta = await projectStore.createProject(name, emoji);
    set({ projects: [meta, ...get().projects] });
    return meta;
  },

  deleteProject: async (id) => {
    await projectStore.deleteProject(id);
    set({ projects: get().projects.filter((p) => p.id !== id) });
  },

  connectGitHub: async (token, auth) => {
    const user = await getAuthenticatedUser(token);
    const account: GitHubAccount = {
      login: user.login,
      name: user.name,
      avatarUrl: user.avatar_url,
      auth,
      connectedAt: Date.now(),
    };
    await secrets.setGitHubToken(token);
    await settings.setGitHubAccount(account);
    set({ github: account });
    return account;
  },

  disconnectGitHub: async () => {
    await secrets.clearGitHubToken();
    await settings.setGitHubAccount(null);
    set({ github: null });
  },

  addProvider: async ({ kind, auth, secret, label, baseUrl, model }) => {
    const spec = PROVIDERS[kind];
    const connection: ProviderConnection = {
      id: projectStore.newId(),
      kind,
      auth,
      label: label?.trim() || spec.name,
      baseUrl: baseUrl?.trim() || undefined,
      defaultModel: model?.trim() || spec.defaultModel,
      capabilities: spec.capabilities,
      createdAt: Date.now(),
    };
    await secrets.setProviderSecret(connection.id, secret);
    const providers = [...get().providers, connection];
    await settings.setProviders(providers);
    set({ providers });
    return connection;
  },

  addSubscription: async ({ subscription, label, defaultModel, accessToken, refreshToken, expiresAt }) => {
    const connection: ProviderConnection = {
      id: projectStore.newId(),
      kind: 'custom',
      auth: 'oauth',
      label,
      subscription,
      tokenExpiresAt: expiresAt,
      defaultModel,
      // xAI subscriptions can hit /images/generations like an API key can.
      capabilities: { chat: true, image: subscription === 'xai-oauth', video: false },
      createdAt: Date.now(),
    };
    await secrets.setProviderSecret(connection.id, accessToken);
    if (refreshToken) await secrets.setProviderRefreshToken(connection.id, refreshToken);
    const providers = [...get().providers, connection];
    await settings.setProviders(providers);
    set({ providers });
    return connection;
  },

  refreshSubscriptionIfNeeded: async (connectionId) => {
    const connection = get().providers.find((p) => p.id === connectionId);
    if (!connection?.subscription) return;
    // 60s skew: refresh a little before the token actually lapses.
    if ((connection.tokenExpiresAt ?? 0) - Date.now() > 60_000) return;
    const refreshToken = await secrets.getProviderRefreshToken(connectionId);
    if (!refreshToken) return; // no refresh handle — the turn will surface a clear auth error
    const tokens = await refreshSubscription(connection.subscription, refreshToken);
    await secrets.setProviderSecret(connectionId, tokens.accessToken);
    if (tokens.refreshToken) await secrets.setProviderRefreshToken(connectionId, tokens.refreshToken);
    const providers = get().providers.map((p) =>
      p.id === connectionId ? { ...p, tokenExpiresAt: tokens.expiresAt } : p
    );
    await settings.setProviders(providers);
    set({ providers });
  },

  removeProvider: async (id) => {
    await secrets.clearProviderSecret(id);
    await secrets.clearProviderRefreshToken(id);
    const providers = get().providers.filter((p) => p.id !== id);
    await settings.setProviders(providers);
    set({ providers });
  },

  setConnectionModel: async (id, model) => {
    const providers = get().providers.map((p) =>
      p.id === id ? { ...p, defaultModel: model } : p
    );
    await settings.setProviders(providers);
    set({ providers });
  },
}));

/** Overrides the OS color scheme app-wide; 'unspecified' restores "follow system". */
function applyAppearance(pref: AppearancePref): void {
  // react-native-web has no setColorScheme; the web build follows the OS.
  if (typeof Appearance.setColorScheme !== 'function') return;
  Appearance.setColorScheme(pref === 'system' ? 'unspecified' : pref);
}

/** First connection that can chat, used as the default for new projects. */
export function defaultChatProvider(providers: ProviderConnection[]): ProviderConnection | null {
  return providers.find((p) => p.capabilities.chat) ?? providers[0] ?? null;
}
