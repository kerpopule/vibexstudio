/**
 * Shared domain types for VibeXStudio.
 *
 * Everything here is local-first: all of this data lives on the device only,
 * except project files the user explicitly syncs to their own GitHub account.
 */

// ---------------------------------------------------------------------------
// Projects
// ---------------------------------------------------------------------------

export interface GitHubLink {
  owner: string;
  repo: string;
  branch: string;
  /** True if the GitHub repo is private. Private repos can't use Pages share links on free plans. */
  isPrivate: boolean;
  /** https://<owner>.github.io/<repo>/ once Pages is enabled. */
  pagesUrl?: string;
  /** SHA of the last commit we pushed, for display purposes. */
  lastSyncedCommit?: string;
  lastSyncedAt?: number;
}

export interface ProjectMeta {
  id: string;
  name: string;
  description: string;
  createdAt: number;
  updatedAt: number;
  /** Emoji used as the project icon in lists. */
  emoji: string;
  /** Provider connection id + model the user picked for this project's chat. */
  ai?: { connectionId: string; model: string };
  github?: GitHubLink;
}

export interface ProjectFile {
  /** Path relative to the project files root, e.g. "index.html" or "css/app.css". */
  path: string;
  /** Text for utf-8 files; base64 for binary assets (images, etc.). */
  content: string;
  encoding?: 'utf-8' | 'base64';
}

// ---------------------------------------------------------------------------
// Chat
// ---------------------------------------------------------------------------

export type ChatRole = 'user' | 'assistant';

export interface ChatAttachment {
  kind: 'image' | 'video';
  /** Local file URI inside the project's media dir. */
  uri: string;
  prompt?: string;
}

export interface ChatMessage {
  id: string;
  role: ChatRole;
  /** Display text. For assistant messages, file blocks are stripped out and summarized. */
  text: string;
  createdAt: number;
  /** Paths written by this assistant turn, if any. */
  filesWritten?: string[];
  attachments?: ChatAttachment[];
  error?: string;
}

// ---------------------------------------------------------------------------
// AI provider connections
// ---------------------------------------------------------------------------

export type ProviderKind =
  | 'openrouter'
  | 'anthropic'
  | 'openai'
  | 'gemini'
  | 'xai'
  | 'zai'
  | 'custom';

export type ProviderAuthMethod = 'oauth' | 'apiKey';

export interface ProviderCapabilities {
  chat: boolean;
  image: boolean;
  video: boolean;
}

/**
 * A configured connection to an AI provider. The secret credential itself is
 * NOT stored here — it lives in the platform keychain, addressed by `id`.
 */
export interface ProviderConnection {
  id: string;
  kind: ProviderKind;
  label: string;
  auth: ProviderAuthMethod;
  /** Override base URL; required for 'custom', optional elsewhere. */
  baseUrl?: string;
  /**
   * Set when this connection is a "bring your subscription" OAuth login
   * (e.g. 'minimax-oauth'). Routing, protocol, and headers come from
   * SUBSCRIPTION_PROVIDERS; the bearer token + refresh handle live in the
   * keychain.
   */
  subscription?: 'minimax-oauth' | 'kimi-oauth' | 'xai-oauth';
  /** Unix ms expiry of the subscription access token, for proactive refresh. */
  tokenExpiresAt?: number;
  /** Default chat model for this connection. */
  defaultModel: string;
  capabilities: ProviderCapabilities;
  createdAt: number;
}

// ---------------------------------------------------------------------------
// GitHub account
// ---------------------------------------------------------------------------

export interface GitHubAccount {
  login: string;
  name: string | null;
  avatarUrl: string;
  /** 'device' for OAuth device flow, 'pat' for a personal access token. */
  auth: 'device' | 'pat';
  connectedAt: number;
}
