/**
 * Secret storage backed by the platform keychain (iOS Keychain / Android
 * Keystore via expo-secure-store). API keys and OAuth tokens never leave the
 * device and never touch AsyncStorage or the filesystem.
 */
import * as SecureStore from 'expo-secure-store';

const GITHUB_TOKEN_KEY = 'vibex.github.token';

function providerKeyFor(connectionId: string): string {
  // SecureStore keys must match [A-Za-z0-9._-]+
  return `vibex.provider.${connectionId.replace(/[^A-Za-z0-9._-]/g, '_')}`;
}

export async function setGitHubToken(token: string): Promise<void> {
  await SecureStore.setItemAsync(GITHUB_TOKEN_KEY, token);
}

export async function getGitHubToken(): Promise<string | null> {
  return SecureStore.getItemAsync(GITHUB_TOKEN_KEY);
}

export async function clearGitHubToken(): Promise<void> {
  await SecureStore.deleteItemAsync(GITHUB_TOKEN_KEY);
}

export async function setProviderSecret(connectionId: string, secret: string): Promise<void> {
  await SecureStore.setItemAsync(providerKeyFor(connectionId), secret);
}

export async function getProviderSecret(connectionId: string): Promise<string | null> {
  return SecureStore.getItemAsync(providerKeyFor(connectionId));
}

export async function clearProviderSecret(connectionId: string): Promise<void> {
  await SecureStore.deleteItemAsync(providerKeyFor(connectionId));
}

/** Refresh tokens for subscription OAuth connections, keyed separately. */
function refreshKeyFor(connectionId: string): string {
  return `vibex.refresh.${connectionId.replace(/[^A-Za-z0-9._-]/g, '_')}`;
}

export async function setProviderRefreshToken(connectionId: string, token: string): Promise<void> {
  await SecureStore.setItemAsync(refreshKeyFor(connectionId), token);
}

export async function getProviderRefreshToken(connectionId: string): Promise<string | null> {
  return SecureStore.getItemAsync(refreshKeyFor(connectionId));
}

export async function clearProviderRefreshToken(connectionId: string): Promise<void> {
  await SecureStore.deleteItemAsync(refreshKeyFor(connectionId));
}
