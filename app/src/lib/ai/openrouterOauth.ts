/**
 * OpenRouter OAuth (PKCE) — lets users connect their OpenRouter account with
 * a tap instead of pasting an API key. No client secret or backend involved:
 * the auth page redirects back into the app via the vibex:// scheme and the
 * code is exchanged for a key directly from the device.
 *
 * Flow: https://openrouter.ai/docs/use-cases/oauth-pkce
 */
import * as Crypto from 'expo-crypto';
import * as WebBrowser from 'expo-web-browser';

export const OPENROUTER_CALLBACK_URL = 'vibex://oauth/openrouter';

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return globalThis.btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export async function generatePkce(): Promise<{ verifier: string; challenge: string }> {
  const verifier = base64UrlEncode(Crypto.getRandomBytes(32));
  const digest = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, verifier, {
    encoding: Crypto.CryptoEncoding.BASE64,
  });
  const challenge = digest.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return { verifier, challenge };
}

/**
 * Opens the OpenRouter consent page and resolves with the user's new API key.
 * Throws if the user cancels or the exchange fails.
 */
export async function connectOpenRouter(): Promise<string> {
  const { verifier, challenge } = await generatePkce();
  const authUrl =
    `https://openrouter.ai/auth?callback_url=${encodeURIComponent(OPENROUTER_CALLBACK_URL)}` +
    `&code_challenge=${challenge}&code_challenge_method=S256`;

  const result = await WebBrowser.openAuthSessionAsync(authUrl, OPENROUTER_CALLBACK_URL);
  if (result.type !== 'success' || !result.url) {
    throw new Error('OpenRouter sign-in was cancelled.');
  }
  const code = new URL(result.url).searchParams.get('code');
  if (!code) throw new Error('OpenRouter did not return an authorization code.');

  const res = await fetch('https://openrouter.ai/api/v1/auth/keys', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code, code_verifier: verifier, code_challenge_method: 'S256' }),
  });
  if (!res.ok) throw new Error(`OpenRouter key exchange failed (${res.status}).`);
  const data = await res.json();
  if (!data.key) throw new Error('OpenRouter did not return a key.');
  return data.key as string;
}
