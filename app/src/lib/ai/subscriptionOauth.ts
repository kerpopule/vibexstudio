/**
 * "Connect your subscription" — OAuth device-code logins that let users bring
 * their existing paid plan (MiniMax, Kimi) into VibeXStudio without an API
 * key. The flow is the mobile-friendly RFC-8628 shape: the app asks for a
 * user code, shows it + a URL, the user approves in their browser, and the
 * app polls until a token comes back.
 *
 * These use each vendor's PUBLIC client id — the same ids their official CLIs
 * ship — and PKCE, so there's no client secret and nothing VibeXStudio-owned
 * in the loop. Tokens live in the keychain (secrets.ts); only non-secret
 * metadata (expiry, refresh handle) is persisted via settings.
 *
 * Provider facts verified against the Hermes Agent + kimi-cli source, 2026-06.
 */
import * as Crypto from 'expo-crypto';

import type { WireProtocol } from '@/lib/ai/registry';

export type SubscriptionProviderId = 'chatgpt-oauth' | 'minimax-oauth' | 'kimi-oauth' | 'xai-oauth';

/** Display order everywhere subscriptions are offered. */
export const SUBSCRIPTION_ORDER: SubscriptionProviderId[] = ['chatgpt-oauth', 'xai-oauth', 'minimax-oauth', 'kimi-oauth'];

export interface SubscriptionProviderSpec {
  id: SubscriptionProviderId;
  name: string;
  blurb: string;
  /** How the vendor's device endpoints are shaped. */
  flavor: 'chatgpt' | 'minimax' | 'kimi' | 'xai';
  portalBaseUrl: string;
  /** Where chat inference is sent once authorized. */
  inferenceBaseUrl: string;
  protocol: WireProtocol;
  clientId: string;
  scope: string;
  defaultModel: string;
  suggestedModels: string[];
  /** Extra headers some vendors require on inference calls. */
  inferenceHeaders?: Record<string, string>;
}

export const SUBSCRIPTION_PROVIDERS: Record<SubscriptionProviderId, SubscriptionProviderSpec> = {
  'chatgpt-oauth': {
    id: 'chatgpt-oauth',
    name: 'ChatGPT (Plus / Pro)',
    blurb: 'Sign in with your ChatGPT plan — the same login the Codex CLI uses. No API key.',
    flavor: 'chatgpt',
    portalBaseUrl: 'https://auth.openai.com',
    // The Codex backend speaks the Responses API, not chat/completions.
    inferenceBaseUrl: 'https://chatgpt.com/backend-api/codex',
    protocol: 'codex',
    // OpenAI's public Codex CLI client id (PKCE, no secret).
    clientId: 'app_EMoamEEZ73f0CkXaXp7hrann',
    scope: 'openid profile email offline_access',
    defaultModel: 'gpt-5.5',
    suggestedModels: ['gpt-5.5', 'gpt-5.4', 'gpt-5.4-mini', 'gpt-5.3-codex'],
    // Cloudflare in front of the Codex backend only admits first-party
    // originators; this is the value the Codex CLI itself sends.
    inferenceHeaders: { originator: 'codex_cli_rs', 'OpenAI-Beta': 'responses=experimental' },
  },
  'minimax-oauth': {
    id: 'minimax-oauth',
    name: 'MiniMax (subscription)',
    blurb: 'Sign in with your MiniMax plan — uses your subscription, no API key.',
    flavor: 'minimax',
    portalBaseUrl: 'https://api.minimax.io',
    inferenceBaseUrl: 'https://api.minimax.io/anthropic',
    protocol: 'anthropic',
    clientId: '78257093-7e40-4613-99e0-527b14b39113',
    scope: 'group_id profile model.completion',
    // M3 (2026-06-01) supersedes M2.7 — bigger context, smarter.
    defaultModel: 'MiniMax-M3',
    suggestedModels: ['MiniMax-M3', 'MiniMax-M2.7'],
  },
  'kimi-oauth': {
    id: 'kimi-oauth',
    name: 'Kimi (subscription)',
    blurb: 'Sign in with your Kimi Coding Plan — uses your subscription, no API key.',
    flavor: 'kimi',
    portalBaseUrl: 'https://auth.kimi.com',
    inferenceBaseUrl: 'https://api.kimi.com/coding/v1',
    protocol: 'openai',
    clientId: '17e5f671-d194-4dfb-9706-5516cb48c098',
    scope: 'offline_access',
    defaultModel: 'kimi-for-coding',
    suggestedModels: ['kimi-for-coding', 'kimi-k2.7-code', 'kimi-k2.6', 'kimi-k2-thinking'],
    // Kimi's API returns 403 without a recognised coding-client User-Agent.
    inferenceHeaders: { 'User-Agent': 'KimiCLI/1.5' },
  },
  'xai-oauth': {
    id: 'xai-oauth',
    name: 'xAI Grok (subscription)',
    blurb: 'Sign in with SuperGrok or X Premium+ — uses your plan, no API key.',
    flavor: 'xai',
    portalBaseUrl: 'https://auth.x.ai',
    inferenceBaseUrl: 'https://api.x.ai/v1',
    protocol: 'openai',
    // Public Grok-CLI client id (same one the Hermes Agent ships); PKCE only.
    clientId: 'b1a00492-073a-47ea-816f-4c329264a828',
    scope: 'openid profile email offline_access grok-cli:access api:access',
    // grok-4 / grok-4-fast / grok-code-fast-1 were retired by xAI on
    // 2026-05-15 (https://docs.x.ai/developers/migration/may-15-retirement)
    // and now 404 "model not found". grok-4.3 is the current headline model.
    defaultModel: 'grok-4.3',
    suggestedModels: ['grok-4.3', 'grok-4.20-0309-reasoning', 'grok-4.20-multi-agent-0309'],
  },
};

/**
 * xAI has no device-code endpoint and its OAuth server only accepts this
 * exact loopback redirect for the CLI client. On a phone nothing serves
 * 127.0.0.1, so after approving, the user copies the failed callback URL out
 * of Safari and pastes it back here (the Grok CLI's --manual-paste flow).
 * `plan=generic` is required — without it auth.x.ai rejects loopback OAuth
 * from non-allowlisted clients.
 */
const XAI_REDIRECT_URI = 'http://127.0.0.1:56121/callback';

/**
 * The Codex CLI's registered loopback redirect. On a phone, VibeX itself
 * listens on this port for the few seconds the sign-in takes (see
 * loopback-callback.native.ts); anywhere it can't, the user pastes the URL.
 */
export const CHATGPT_LOOPBACK_PORT = 1455;
export const CHATGPT_REDIRECT_PATH = '/auth/callback';
const CHATGPT_REDIRECT_URI = `http://localhost:${CHATGPT_LOOPBACK_PORT}${CHATGPT_REDIRECT_PATH}`;

function startChatGpt(
  spec: SubscriptionProviderSpec,
  verifier: string,
  challenge: string
): DeviceLoginSession {
  const state = randomState();
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: spec.clientId,
    redirect_uri: CHATGPT_REDIRECT_URI,
    scope: spec.scope,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    state,
    id_token_add_organizations: 'true',
    codex_cli_simplified_flow: 'true',
    originator: 'codex_cli_rs',
  });
  return {
    provider: spec.id,
    flow: 'browser',
    redirectUri: CHATGPT_REDIRECT_URI,
    pollHandle: '',
    userCode: '',
    verificationUri: `${spec.portalBaseUrl}/oauth/authorize?${params.toString()}`,
    codeVerifier: verifier,
    codeChallenge: challenge,
    state,
    expiresAt: Date.now() + 10 * 60 * 1000,
    intervalMs: 0,
  };
}

/** The `chatgpt_account_id` claim the Codex backend wants echoed as a header. */
export function chatGptAccountIdFromToken(accessToken: string): string | null {
  try {
    const payload = accessToken.split('.')[1];
    if (!payload) return null;
    const json = atob(payload.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(payload.length / 4) * 4, '='));
    const claims = JSON.parse(json);
    const id = claims?.['https://api.openai.com/auth']?.chatgpt_account_id;
    return typeof id === 'string' && id ? id : null;
  } catch {
    return null;
  }
}

export interface DeviceLoginSession {
  provider: SubscriptionProviderId;
  /**
   * 'poll' = we wait on a device code; 'paste' = user pastes the callback URL
   * (xAI); 'browser' = a loopback listener on this device catches the
   * redirect (ChatGPT) — with paste as the fallback when it can't listen.
   */
  flow: 'poll' | 'paste' | 'browser';
  /** For 'browser' flows: the exact redirect the listener must answer. */
  redirectUri?: string;
  /** Vendor handle used when polling (device_code or user_code per flavor). */
  pollHandle: string;
  userCode: string;
  verificationUri: string;
  /** Pre-filled verification URL when the vendor provides one. */
  verificationUriComplete?: string;
  codeVerifier: string;
  /** Echoed at token exchange for servers that re-validate PKCE there (xAI). */
  codeChallenge?: string;
  /** CSRF state, validated against the pasted callback URL. */
  state?: string;
  expiresAt: number;
  intervalMs: number;
}

/** Tokens + refresh metadata; the access token is the keychain secret. */
export interface SubscriptionTokens {
  accessToken: string;
  refreshToken?: string;
  /** Unix ms. */
  expiresAt: number;
}

// --- PKCE -----------------------------------------------------------------

function base64Url(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function pkcePair(): Promise<{ verifier: string; challenge: string }> {
  const random = Crypto.getRandomBytes(32);
  const verifier = base64Url(random);
  const digest = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, verifier, {
    encoding: Crypto.CryptoEncoding.BASE64,
  });
  const challenge = digest.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return { verifier, challenge };
}

function randomState(): string {
  return base64Url(Crypto.getRandomBytes(16));
}

// --- Flow -----------------------------------------------------------------

export async function startDeviceLogin(providerId: SubscriptionProviderId): Promise<DeviceLoginSession> {
  const spec = SUBSCRIPTION_PROVIDERS[providerId];
  const { verifier, challenge } = await pkcePair();
  if (spec.flavor === 'xai') return startXai(spec, verifier, challenge);
  if (spec.flavor === 'chatgpt') return startChatGpt(spec, verifier, challenge);
  return spec.flavor === 'minimax'
    ? startMiniMax(spec, verifier, challenge)
    : startKimi(spec, verifier, challenge);
}

function startXai(
  spec: SubscriptionProviderSpec,
  verifier: string,
  challenge: string
): DeviceLoginSession {
  const state = randomState();
  const nonce = randomState();
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: spec.clientId,
    redirect_uri: XAI_REDIRECT_URI,
    scope: spec.scope,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    state,
    nonce,
    plan: 'generic',
    referrer: 'vibexstudio',
  });
  return {
    provider: spec.id,
    flow: 'paste',
    pollHandle: '',
    userCode: '',
    verificationUri: `${spec.portalBaseUrl}/oauth2/authorize?${params.toString()}`,
    codeVerifier: verifier,
    codeChallenge: challenge,
    state,
    expiresAt: Date.now() + 10 * 60 * 1000,
    intervalMs: 0,
  };
}

/**
 * Finish an xAI paste-back login. Accepts the full callback URL Safari showed
 * (http://127.0.0.1:56121/callback?code=…&state=…) or just the code itself.
 */
export async function completePasteLogin(
  session: DeviceLoginSession,
  pasted: string
): Promise<SubscriptionTokens> {
  const spec = SUBSCRIPTION_PROVIDERS[session.provider];
  if (spec.flavor === 'chatgpt') return completeChatGptLogin(session, pasted);
  const text = pasted.trim();
  if (!text) throw new Error('Paste the link from Safari first.');

  let code = text;
  if (text.includes('?') || text.includes('://')) {
    const query = text.split('?')[1] ?? '';
    const qs = new URLSearchParams(query.split('#')[0]);
    const err = qs.get('error');
    if (err) throw new Error(`xAI sign-in was denied (${err}). Try again.`);
    const pastedState = qs.get('state');
    if (session.state && pastedState && pastedState !== session.state) {
      throw new Error('That link is from an older attempt — start over and paste the newest one.');
    }
    code = qs.get('code') ?? '';
  }
  if (!code) throw new Error("That link doesn't contain a sign-in code. Copy the full URL from Safari.");

  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: XAI_REDIRECT_URI,
    client_id: spec.clientId,
    code_verifier: session.codeVerifier,
  });
  // xAI re-validates PKCE at the token step; echoing the challenge is required.
  if (session.codeChallenge) {
    body.set('code_challenge', session.codeChallenge);
    body.set('code_challenge_method', 'S256');
  }
  const res = await fetch(`${spec.portalBaseUrl}/oauth2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: body.toString(),
  });
  const data = await safeJson(res);
  if (!res.ok || !data?.access_token) {
    throw new Error(`xAI sign-in failed (${oauthErrorDetail(data, res.status)}). Start over and paste the newest link.`);
  }
  return {
    accessToken: String(data.access_token),
    refreshToken: data.refresh_token ? String(data.refresh_token) : undefined,
    expiresAt: Date.now() + Number(data.expires_in ?? 3600) * 1000,
  };
}

/** Exchange a ChatGPT callback (full URL or bare code) for tokens. */
export async function completeChatGptLogin(
  session: DeviceLoginSession,
  callbackUrlOrCode: string
): Promise<SubscriptionTokens> {
  const spec = SUBSCRIPTION_PROVIDERS[session.provider];
  const text = callbackUrlOrCode.trim();
  if (!text) throw new Error('Nothing to finish with yet — sign in first.');
  let code = text;
  if (text.includes('?') || text.includes('://')) {
    const qs = new URLSearchParams((text.split('?')[1] ?? '').split('#')[0]);
    const err = qs.get('error');
    if (err) throw new Error(`ChatGPT sign-in was denied (${qs.get('error_description') ?? err}).`);
    const pastedState = qs.get('state');
    if (session.state && pastedState && pastedState !== session.state) {
      throw new Error('That link is from an older attempt — start over and use the newest one.');
    }
    code = qs.get('code') ?? '';
  }
  if (!code) throw new Error("That link doesn't contain a sign-in code.");
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: session.redirectUri ?? CHATGPT_REDIRECT_URI,
    client_id: spec.clientId,
    code_verifier: session.codeVerifier,
  });
  const res = await fetch(`${spec.portalBaseUrl}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: body.toString(),
  });
  const data = await safeJson(res);
  if (!res.ok || !data?.access_token) {
    throw new Error(`ChatGPT sign-in failed (${oauthErrorDetail(data, res.status)}). Start over and try again.`);
  }
  if (!chatGptAccountIdFromToken(String(data.access_token))) {
    throw new Error('That ChatGPT account has no Codex access. Plus, Pro, Team, and Enterprise plans work.');
  }
  return {
    accessToken: String(data.access_token),
    refreshToken: data.refresh_token ? String(data.refresh_token) : undefined,
    expiresAt: Date.now() + Number(data.expires_in ?? 3600) * 1000,
  };
}

async function startMiniMax(
  spec: SubscriptionProviderSpec,
  verifier: string,
  challenge: string
): Promise<DeviceLoginSession> {
  const state = randomState();
  const body = new URLSearchParams({
    response_type: 'code',
    client_id: spec.clientId,
    scope: spec.scope,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    state,
  });
  const res = await fetch(`${spec.portalBaseUrl}/oauth/code`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body: body.toString(),
  });
  if (!res.ok) throw new Error(`MiniMax sign-in failed (${res.status}). Try again.`);
  const data = await res.json();
  if (!data.user_code || !data.verification_uri) {
    throw new Error('MiniMax did not return a sign-in code. Try again.');
  }
  if (data.state && data.state !== state) throw new Error('MiniMax sign-in state mismatch. Try again.');
  const expiredIn = Number(data.expired_in ?? 0);
  return {
    provider: spec.id,
    flow: 'poll',
    pollHandle: String(data.user_code),
    userCode: String(data.user_code),
    verificationUri: String(data.verification_uri),
    codeVerifier: verifier,
    expiresAt: resolveExpiry(expiredIn),
    intervalMs: Math.max(2000, Number(data.interval ?? 2000)),
  };
}

async function startKimi(
  spec: SubscriptionProviderSpec,
  verifier: string,
  challenge: string
): Promise<DeviceLoginSession> {
  // RFC 8628 device authorization request.
  const body = new URLSearchParams({
    client_id: spec.clientId,
    scope: spec.scope,
    code_challenge: challenge,
    code_challenge_method: 'S256',
  });
  const res = await fetch(`${spec.portalBaseUrl}/oauth/device/code`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body: body.toString(),
  });
  if (!res.ok) throw new Error(`Kimi sign-in failed (${res.status}). Try again.`);
  const data = await res.json();
  if (!data.device_code || !data.user_code || !data.verification_uri) {
    throw new Error('Kimi did not return a sign-in code. Try again.');
  }
  return {
    provider: spec.id,
    flow: 'poll',
    pollHandle: String(data.device_code),
    userCode: String(data.user_code),
    verificationUri: String(data.verification_uri),
    verificationUriComplete: data.verification_uri_complete
      ? String(data.verification_uri_complete)
      : undefined,
    codeVerifier: verifier,
    expiresAt: Date.now() + Number(data.expires_in ?? 600) * 1000,
    intervalMs: Math.max(2000, Number(data.interval ?? 5) * 1000),
  };
}

export type DevicePoll =
  | { status: 'pending' }
  | { status: 'success'; tokens: SubscriptionTokens }
  | { status: 'error'; message: string };

export async function pollDeviceLogin(session: DeviceLoginSession): Promise<DevicePoll> {
  if (Date.now() > session.expiresAt) {
    return { status: 'error', message: 'The sign-in code expired. Start over to get a new one.' };
  }
  const spec = SUBSCRIPTION_PROVIDERS[session.provider];
  if (spec.flavor === 'xai' || spec.flavor === 'chatgpt') {
    // Paste/browser flows have nothing to poll — the screen finishes them.
    return { status: 'pending' };
  }
  return spec.flavor === 'minimax' ? pollMiniMax(spec, session) : pollKimi(spec, session);
}

async function pollMiniMax(spec: SubscriptionProviderSpec, session: DeviceLoginSession): Promise<DevicePoll> {
  const body = new URLSearchParams({
    grant_type: 'urn:ietf:params:oauth:grant-type:user_code',
    client_id: spec.clientId,
    user_code: session.pollHandle,
    code_verifier: session.codeVerifier,
  });
  const res = await fetch(`${spec.portalBaseUrl}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: body.toString(),
  });
  const data = await safeJson(res);
  if (!res.ok) {
    const msg = data?.base_resp?.status_msg ?? `MiniMax error (${res.status})`;
    return { status: 'error', message: msg };
  }
  const status = data?.status;
  if (status === 'success' && data.access_token) {
    return {
      status: 'success',
      tokens: {
        accessToken: String(data.access_token),
        refreshToken: data.refresh_token ? String(data.refresh_token) : undefined,
        expiresAt: resolveExpiry(Number(data.expired_in ?? 0)),
      },
    };
  }
  if (status === 'error') return { status: 'error', message: 'MiniMax denied the sign-in. Try again.' };
  return { status: 'pending' };
}

async function pollKimi(spec: SubscriptionProviderSpec, session: DeviceLoginSession): Promise<DevicePoll> {
  const body = new URLSearchParams({
    grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
    client_id: spec.clientId,
    device_code: session.pollHandle,
    code_verifier: session.codeVerifier,
  });
  const res = await fetch(`${spec.portalBaseUrl}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: body.toString(),
  });
  const data = await safeJson(res);
  if (res.ok && data?.access_token) {
    return {
      status: 'success',
      tokens: {
        accessToken: String(data.access_token),
        refreshToken: data.refresh_token ? String(data.refresh_token) : undefined,
        expiresAt: Date.now() + Number(data.expires_in ?? 3600) * 1000,
      },
    };
  }
  switch (data?.error) {
    case 'authorization_pending':
    case 'slow_down':
      return { status: 'pending' };
    case 'expired_token':
      return { status: 'error', message: 'The sign-in code expired. Start over.' };
    case 'access_denied':
      return { status: 'error', message: 'Kimi sign-in was denied.' };
    default:
      return { status: data?.error ? 'error' : 'pending', message: data?.error_description ?? 'Kimi error' };
  }
}

/** Refresh an access token; returns null if the provider has no refresh token. */
export async function refreshSubscription(
  providerId: SubscriptionProviderId,
  refreshToken: string
): Promise<SubscriptionTokens> {
  const spec = SUBSCRIPTION_PROVIDERS[providerId];
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    client_id: spec.clientId,
    refresh_token: refreshToken,
  });
  if (spec.flavor === 'chatgpt') body.set('scope', 'openid profile email');
  const tokenPath = spec.flavor === 'xai' ? '/oauth2/token' : '/oauth/token';
  const res = await fetch(`${spec.portalBaseUrl}${tokenPath}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: body.toString(),
  });
  const data = await safeJson(res);
  if (!res.ok || !data?.access_token) {
    throw new Error(`${spec.name} session expired — sign in again.`);
  }
  const expiresAt =
    spec.flavor === 'minimax'
      ? resolveExpiry(Number(data.expired_in ?? 0))
      : Date.now() + Number(data.expires_in ?? 3600) * 1000;
  return {
    accessToken: String(data.access_token),
    refreshToken: data.refresh_token ? String(data.refresh_token) : refreshToken,
    expiresAt,
  };
}

/** MiniMax's `expired_in` is either a unix-ms timestamp or a TTL in seconds. */
function resolveExpiry(expiredIn: number): number {
  const nowMs = Date.now();
  if (expiredIn > nowMs / 2) return expiredIn; // already an absolute ms epoch
  return nowMs + Math.max(1, expiredIn) * 1000;
}

/** OAuth servers disagree on error shape: string, {error, error_description}, or {error:{message}}. */
export function oauthErrorDetail(data: any, status: number): string {
  const err = data?.error;
  if (typeof data?.error_description === 'string' && data.error_description) return data.error_description;
  if (typeof err === 'string' && err) return err;
  if (err && typeof err === 'object') {
    const message = err.message ?? err.error_description ?? err.code;
    if (typeof message === 'string' && message) return message;
  }
  return `HTTP ${status}`;
}

async function safeJson(res: Response): Promise<any> {
  try {
    const text = await res.text();
    return text ? JSON.parse(text) : {};
  } catch {
    return {};
  }
}
