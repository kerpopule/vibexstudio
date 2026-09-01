/**
 * Web/desktop secret storage. expo-secure-store has no web implementation,
 * so this module is the platform seam:
 *   • inside the VibeX desktop shell (Tauri), secrets go to the OS credential
 *     vault through the shell's `secret_set/get/delete` commands;
 *   • in a plain browser tab they fall back to localStorage (same-origin,
 *     the best a page can do — the UI says so in Privacy).
 * Same key namespace as the native module so a desktop build can migrate.
 */

const GITHUB_TOKEN_KEY = 'vibex.github.token';
const WORKBENCH_TOKEN_KEY = 'vibex.workbench.token';
const PRIVATE_INSTALLATION_PROOF_KEY = 'vibex.private.installation-proof';

type Invoke = (cmd: string, args?: Record<string, unknown>) => Promise<unknown>;

/** Tauri 2 exposes `window.__TAURI_INTERNALS__.invoke` when running in the shell. */
function tauriInvoke(): Invoke | null {
  const w = globalThis as unknown as { __TAURI_INTERNALS__?: { invoke?: Invoke } };
  const invoke = w.__TAURI_INTERNALS__?.invoke;
  return typeof invoke === 'function' ? invoke : null;
}

/** True when secrets live in the OS keychain rather than the browser. */
export function secretsInVault(): boolean {
  return tauriInvoke() != null;
}

async function setItem(key: string, value: string): Promise<void> {
  const invoke = tauriInvoke();
  if (invoke) {
    await invoke('secret_set', { key, value });
    return;
  }
  globalThis.localStorage?.setItem(key, value);
}

async function getItem(key: string): Promise<string | null> {
  const invoke = tauriInvoke();
  if (invoke) {
    const value = await invoke('secret_get', { key });
    return typeof value === 'string' ? value : null;
  }
  return globalThis.localStorage?.getItem(key) ?? null;
}

async function deleteItem(key: string): Promise<void> {
  const invoke = tauriInvoke();
  if (invoke) {
    await invoke('secret_delete', { key });
    return;
  }
  globalThis.localStorage?.removeItem(key);
}

const slug = (id: string) => id.replace(/[^A-Za-z0-9._-]/g, '_');
const providerKeyFor = (id: string) => `vibex.provider.${slug(id)}`;
const refreshKeyFor = (id: string) => `vibex.refresh.${slug(id)}`;
const privateDeviceProofKeyFor = (id: string) => `vibex.private-proof.${slug(id)}`;

export const setWorkbenchToken = (token: string) => setItem(WORKBENCH_TOKEN_KEY, token);
export const getWorkbenchToken = () => getItem(WORKBENCH_TOKEN_KEY);
export const clearWorkbenchToken = () => deleteItem(WORKBENCH_TOKEN_KEY);

export const setGitHubToken = (token: string) => setItem(GITHUB_TOKEN_KEY, token);
export const getGitHubToken = () => getItem(GITHUB_TOKEN_KEY);
export const clearGitHubToken = () => deleteItem(GITHUB_TOKEN_KEY);

export const setProviderSecret = (id: string, secret: string) => setItem(providerKeyFor(id), secret);
export const getProviderSecret = (id: string) => getItem(providerKeyFor(id));
export const clearProviderSecret = (id: string) => deleteItem(providerKeyFor(id));

export const getPrivateInstallationProof = () => getItem(PRIVATE_INSTALLATION_PROOF_KEY);
export const setPrivateInstallationProof = (proof: string) => setItem(PRIVATE_INSTALLATION_PROOF_KEY, proof);

export const setPrivateDeviceProof = (id: string, proof: string) => setItem(privateDeviceProofKeyFor(id), proof);
export const getPrivateDeviceProof = (id: string) => getItem(privateDeviceProofKeyFor(id));
export const clearPrivateDeviceProof = (id: string) => deleteItem(privateDeviceProofKeyFor(id));

export const setProviderRefreshToken = (id: string, token: string) => setItem(refreshKeyFor(id), token);
export const getProviderRefreshToken = (id: string) => getItem(refreshKeyFor(id));
export const clearProviderRefreshToken = (id: string) => deleteItem(refreshKeyFor(id));
