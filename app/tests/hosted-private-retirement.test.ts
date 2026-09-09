import { expect, it, vi } from 'vitest';
const proof = vi.hoisted(() => vi.fn());
vi.mock('expo-constants', () => ({ default: {} }));
vi.mock('expo-crypto', () => ({ getRandomBytes: vi.fn() }));
vi.mock('@/lib/storage/secrets', () => ({ getPrivateInstallationProof: proof, setPrivateInstallationProof: vi.fn() }));
import { redeemPrivateInvite, refreshPrivateCredential } from '../src/lib/private-provider/client';
it('blocks hosted enrollment and refresh before device identity or network access', async () => {
  const request = vi.fn(); vi.stubGlobal('fetch', request);
  try {
    await expect(redeemPrivateInvite('test-only-invite')).rejects.toThrow('retired');
    await expect(refreshPrivateCredential({} as any, 'test-refresh', 'test-proof')).rejects.toThrow('retired');
    expect(proof).not.toHaveBeenCalled(); expect(request).not.toHaveBeenCalled();
  } finally { vi.unstubAllGlobals(); }
});
