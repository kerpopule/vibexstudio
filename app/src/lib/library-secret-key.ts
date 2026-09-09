import * as Crypto from 'expo-crypto';
import { libraryOrigin } from '@/lib/library-core';

export async function librarySecretKey(origin: string): Promise<string> {
  return 'vibex.library.' + await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, libraryOrigin(origin));
}
