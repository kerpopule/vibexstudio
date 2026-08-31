/**
 * App-level state (zustand). Thin layer over local storage: hydrates once at
 * launch, then keeps storage and UI in sync.
 */
import { Appearance } from 'react-native';
import { create } from 'zustand';

import { PROVIDERS } from '@/lib/ai/registry';
import { refreshSubscription } from '@/lib/ai/subscriptionOauth';
import {
  buildDesignAttachedMessage,
  buildExistingProjectDesignHandoffState,
  removeDesignReference,
} from '@/lib/design/references';
import {
  refreshPrivateCredential,
  revokePrivateDevice,
  type PendingPrivateProvider,
} from '@/lib/private-provider/client';
import { getAuthenticatedUser } from '@/lib/github/api';
import * as projectStore from '@/lib/storage/projects';
import * as secrets from '@/lib/storage/secrets';
import * as settings from '@/lib/storage/settings';
import type { AppearancePref, MediaLabLink, WorkbenchLink } from '@/lib/storage/settings';
import type { DesignReference, GitHubAccount, ProjectMeta, ProviderConnection, ProviderKind } from '@/lib/types';

interface AppState {
  hydrated: boolean;
  projects: ProjectMeta[];
  github: GitHubAccount | null;
  providers: ProviderConnection[];
  appearance: AppearancePref;
  onboardingComplete: boolean;
  mediaLab: MediaLabLink | null;
  /** Job id a tapped "finished" notification should land on (in-memory). */
  mediaLabFocusJob: string | null;
  workbench: WorkbenchLink | null;
  /**
   * Per-project remote preview URL while "Run on my computer" is live —
   * in-memory only, by design: a stale workbench URL after a restart would
   * just be a broken WebView.
   */
  workbenchPreview: Record<string, string>;
  pendingDesignReference: DesignReference | null;

  hydrate: () => Promise<void>;
  setAppearance: (pref: AppearancePref) => Promise<void>;
  setMediaLab: (link: MediaLabLink | null) => Promise<void>;
  setMediaLabFocusJob: (id: string | null) => void;
  pairWorkbench: (url: string, token: string) => Promise<void>;
  unpairWorkbench: () => Promise<void>;
  setWorkbenchPreview: (projectId: string, url: string | null) => void;
  completeOnboarding: () => Promise<void>;
  refreshProjects: () => Promise<void>;
  createProject: (name: string, emoji: string, designReference?: DesignReference) => Promise<ProjectMeta>;
  setPendingDesignReference: (reference: DesignReference | null) => void;
  setProjectDesignReference: (id: string, reference?: DesignReference) => Promise<ProjectMeta>;
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
    mediaModels?: ProviderConnection['mediaModels'];
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
  addPrivateProvider: (pending: PendingPrivateProvider) => Promise<ProviderConnection>;
  /** Refresh a subscription token if it's near expiry. Safe to call always. */
  refreshSubscriptionIfNeeded: (connectionId: string) => Promise<void>;
  refreshPrivateProviderIfNeeded: (connectionId: string) => Promise<void>;
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
  workbench: null,
  workbenchPreview: {},
  pendingDesignReference: null,

  hydrate: async () => {
    // Pre-sync local projects hop into the iCloud container first, so the
    // list below already sees them in their synced home. No-op off-Apple.
    await projectStore.migrateLocalProjectsToCloud().catch(() => {});
    const [projects, github, providers, appearance, onboardingComplete, mediaLab, workbench] = await Promise.all([
      projectStore.listProjects(),
      settings.getGitHubAccount(),
      settings.getProviders(),
      settings.getAppearance(),
      settings.getOnboardingComplete(),
      settings.getMediaLab(),
      settings.getWorkbench(),
    ]);
    settings.clearLegacyVibe().catch(() => {});
    applyAppearance(appearance);
    set({ projects, github, providers, appearance, onboardingComplete, mediaLab, workbench, hydrated: true });
  },

  setMediaLab: async (link) => {
    set({ mediaLab: link });
    await settings.setMediaLab(link);
  },

  mediaLabFocusJob: null,
  setMediaLabFocusJob: (id) => set({ mediaLabFocusJob: id }),

  pairWorkbench: async (url, token) => {
    // Token first: if the keychain write fails we never persist a paired
    // state that can't authenticate.
    await secrets.setWorkbenchToken(token);
    const link = { url, addedAt: Date.now() };
    await settings.setWorkbench(link);
    set({ workbench: link });
  },

  unpairWorkbench: async () => {
    await secrets.clearWorkbenchToken();
    await settings.setWorkbench(null);
    set({ workbench: null, workbenchPreview: {} });
  },

  setWorkbenchPreview: (projectId, url) =>
    set((state) => {
      const next = { ...state.workbenchPreview };
      if (url == null) delete next[projectId];
      else next[projectId] = url;
      return { workbenchPreview: next };
    }),

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

  createProject: async (name, emoji, designReference) => {
    const reference = designReference ?? get().pendingDesignReference ?? undefined;
    const meta = await projectStore.createProject(name, emoji, reference);
    if (reference) {
      await projectStore.writeChat(meta.id, [buildDesignAttachedMessage(reference)]);
    }
    set({ projects: [meta, ...get().projects], pendingDesignReference: null });
    return meta;
  },

  setPendingDesignReference: (reference) => set({ pendingDesignReference: reference }),

  setProjectDesignReference: async (id, reference) => {
    const [current, messages] = await Promise.all([
      projectStore.readProject(id),
      reference ? projectStore.readChat(id) : Promise.resolve([]),
    ]);
    if (!current) throw new Error('Project not found.');
    const transition = reference
      ? buildExistingProjectDesignHandoffState(current, messages, reference)
      : null;
    const next = transition?.project ?? removeDesignReference(current);
    await projectStore.writeProject(next);
    if (transition) await projectStore.writeChat(id, transition.messages);
    set({
      projects: get().projects
        .map((project) => (project.id === id ? next : project))
        .sort((a, b) => b.updatedAt - a.updatedAt),
    });
    return next;
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

  addProvider: async ({ kind, auth, secret, label, baseUrl, model, mediaModels }) => {
    const spec = PROVIDERS[kind];
    const connection: ProviderConnection = {
      id: projectStore.newId(),
      kind,
      auth,
      label: label?.trim() || spec.name,
      baseUrl: baseUrl?.trim() || undefined,
      mediaModels,
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

  addPrivateProvider: async (pending) => {
    if (get().providers.some((provider) => provider.privateProvider?.grantId === pending.metadata.grantId)) {
      throw new Error('This private grant is already connected on this device.');
    }
    const connection: ProviderConnection = {
      id: projectStore.newId(),
      kind: 'custom',
      auth: 'apiKey',
      label: 'Private VibeX Models',
      baseUrl: pending.baseUrl,
      defaultModel: pending.defaultModel,
      capabilities: { chat: true, image: false, video: false },
      privateProvider: pending.metadata,
      createdAt: Date.now(),
    };
    try {
      await Promise.all([
        secrets.setProviderSecret(connection.id, pending.credential),
        secrets.setProviderRefreshToken(connection.id, pending.refreshHandle),
        secrets.setPrivateDeviceProof(connection.id, pending.deviceProof),
      ]);
      const providers = [...get().providers, connection];
      await settings.setProviders(providers);
      set({ providers });
      pending.credential = '';
      pending.refreshHandle = '';
      pending.deviceProof = '';
      return connection;
    } catch (error) {
      await Promise.allSettled([
        secrets.clearProviderSecret(connection.id),
        secrets.clearProviderRefreshToken(connection.id),
        secrets.clearPrivateDeviceProof(connection.id),
      ]);
      throw error;
    }
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

  refreshPrivateProviderIfNeeded: async (connectionId) => {
    const connection = get().providers.find((provider) => provider.id === connectionId);
    if (!connection?.privateProvider || connection.privateProvider.credentialExpiresAt - Date.now() > 60_000) return;
    const [refreshHandle, deviceProof] = await Promise.all([
      secrets.getProviderRefreshToken(connectionId),
      secrets.getPrivateDeviceProof(connectionId),
    ]);
    if (!refreshHandle || !deviceProof) throw new Error('Private device credentials are missing from Keychain.');
    const refreshed = await refreshPrivateCredential(connection, refreshHandle, deviceProof);
    await secrets.setProviderSecret(connectionId, refreshed.credential);
    const providers = get().providers.map((provider) => provider.id === connectionId && provider.privateProvider
      ? { ...provider, privateProvider: { ...provider.privateProvider, credentialExpiresAt: refreshed.expiresAt } }
      : provider);
    await settings.setProviders(providers);
    set({ providers });
  },

  removeProvider: async (id) => {
    const connection = get().providers.find((provider) => provider.id === id);
    if (connection?.privateProvider) {
      const [credential, deviceProof] = await Promise.all([
        secrets.getProviderSecret(id),
        secrets.getPrivateDeviceProof(id),
      ]);
      if (credential && deviceProof) await revokePrivateDevice(connection, credential, deviceProof);
    }
    await secrets.clearProviderSecret(id);
    await secrets.clearProviderRefreshToken(id);
    await secrets.clearPrivateDeviceProof(id);
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
