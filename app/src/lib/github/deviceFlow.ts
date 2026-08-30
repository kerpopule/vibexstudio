/**
 * GitHub OAuth Device Flow — lets the app obtain a user token without any
 * backend or client secret. The user is shown a short code and approves it at
 * github.com/login/device.
 *
 * Requires a GitHub OAuth App with device flow enabled. The bundled client id
 * below identifies the official VibeXStudio OAuth app; users can override it
 * in Settings with their own OAuth app's client id (Settings → GitHub →
 * Advanced), which keeps the app fully self-hostable.
 */
import { getGitHubClientIdOverride } from '@/lib/storage/settings';

/** The official VibeXStudio GitHub OAuth App (owner: kerpopule, device flow enabled). */
export const BUNDLED_GITHUB_CLIENT_ID = 'Ov23liJP5K99KxjBpxGH';

const SCOPES = 'repo read:user';

export interface DeviceCodeSession {
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  expiresAt: number;
  intervalMs: number;
}

export async function resolveClientId(): Promise<string> {
  const override = await getGitHubClientIdOverride();
  return override ?? BUNDLED_GITHUB_CLIENT_ID;
}

export async function startDeviceFlow(): Promise<DeviceCodeSession> {
  const clientId = await resolveClientId();
  if (clientId === 'REPLACE_WITH_VIBEX_OAUTH_CLIENT_ID') {
    throw new Error(
      'No GitHub OAuth client id is configured. Set one in Settings → GitHub → Advanced, or sign in with a personal access token instead.'
    );
  }
  const res = await fetch('https://github.com/login/device/code', {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_id: clientId, scope: SCOPES }),
  });
  if (!res.ok) throw new Error(`GitHub device code request failed (${res.status})`);
  const data = await res.json();
  if (data.error) throw new Error(data.error_description ?? data.error);
  return {
    deviceCode: data.device_code,
    userCode: data.user_code,
    verificationUri: data.verification_uri,
    expiresAt: Date.now() + data.expires_in * 1000,
    intervalMs: (data.interval ?? 5) * 1000,
  };
}

export type PollResult =
  | { status: 'pending' }
  | { status: 'slow_down'; intervalMs: number }
  | { status: 'success'; token: string }
  | { status: 'error'; message: string };

export async function pollDeviceFlow(session: DeviceCodeSession): Promise<PollResult> {
  if (Date.now() > session.expiresAt) {
    return { status: 'error', message: 'The sign-in code expired. Start over to get a new one.' };
  }
  const clientId = await resolveClientId();
  const res = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: clientId,
      device_code: session.deviceCode,
      grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
    }),
  });
  const data = await res.json();
  if (data.access_token) return { status: 'success', token: data.access_token };
  switch (data.error) {
    case 'authorization_pending':
      return { status: 'pending' };
    case 'slow_down':
      return { status: 'slow_down', intervalMs: (data.interval ?? 10) * 1000 };
    case 'expired_token':
      return { status: 'error', message: 'The sign-in code expired. Start over to get a new one.' };
    case 'access_denied':
      return { status: 'error', message: 'Sign-in was cancelled on GitHub.' };
    default:
      return { status: 'error', message: data.error_description ?? data.error ?? 'Unknown error' };
  }
}
