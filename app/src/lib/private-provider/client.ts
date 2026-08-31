import Constants from 'expo-constants';
import * as Crypto from 'expo-crypto';

import { getPrivateInstallationProof, setPrivateInstallationProof } from '@/lib/storage/secrets';
import type { ProviderConnection } from '@/lib/types';
import {
  PRIVATE_BROKER_API_BASE_URL,
  PRIVATE_PROFILE_SCHEMA,
  verifyProviderProfile,
  type SignedProviderProfileWire,
} from '@/lib/private-provider/profile';

function base64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function installationProof(): Promise<string> {
  const existing = await getPrivateInstallationProof();
  if (existing) return existing;
  const created = base64Url(Crypto.getRandomBytes(32));
  await setPrivateInstallationProof(created);
  return created;
}

async function boundedJson(response: Response): Promise<Record<string, unknown>> {
  const text = await response.text();
  if (text.length > 256_000) throw new Error('Private broker returned an oversized response.');
  let body: Record<string, unknown>;
  try { body = JSON.parse(text) as Record<string, unknown>; }
  catch { throw new Error('Private broker returned an invalid response.'); }
  if (!response.ok) {
    const error = body.error as { message?: unknown } | undefined;
    throw new Error(typeof error?.message === 'string' ? error.message : 'Private broker request failed.');
  }
  return body;
}

export interface PendingPrivateProvider {
  recipientLabel: string;
  credential: string;
  refreshHandle: string;
  deviceProof: string;
  metadata: NonNullable<ProviderConnection['privateProvider']>;
  baseUrl: string;
  defaultModel: string;
}

export async function redeemPrivateInvite(inviteToken: string): Promise<PendingPrivateProvider> {
  const deviceProof = await installationProof();
  const response = await fetch(`${PRIVATE_BROKER_API_BASE_URL}/private-model-invites/redeem`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      invite_token: inviteToken,
      device_proof: deviceProof,
      app_bundle_id: 'studio.vibex.app',
      app_version: Constants.expoConfig?.version ?? 'unknown',
      app_build: Constants.expoConfig?.ios?.buildNumber ?? 'unknown',
      redemption_nonce: base64Url(Crypto.getRandomBytes(24)),
      supported_profile_schemas: [PRIVATE_PROFILE_SCHEMA],
    }),
  });
  const body = await boundedJson(response);
  const verified = verifyProviderProfile(body.profile as SignedProviderProfileWire);
  const credential = body.device_credential;
  const refreshHandle = body.refresh_handle;
  const credentialExpiresAt = body.credential_expires_at;
  if (typeof credential !== 'string' || typeof refreshHandle !== 'string' || typeof credentialExpiresAt !== 'number') {
    throw new Error('Private broker omitted device credentials.');
  }
  return {
    recipientLabel: String(body.recipient_label ?? 'Private recipient'),
    credential,
    refreshHandle,
    deviceProof,
    metadata: { ...verified, credentialExpiresAt },
    baseUrl: PRIVATE_BROKER_API_BASE_URL,
    defaultModel: verified.allowedModels[0],
  };
}

export async function refreshPrivateCredential(connection: ProviderConnection, refreshHandle: string, deviceProof: string) {
  if (!connection.privateProvider || connection.baseUrl !== PRIVATE_BROKER_API_BASE_URL) throw new Error('Not a private provider.');
  const response = await fetch(`${PRIVATE_BROKER_API_BASE_URL}/private-model-devices/refresh`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ refresh_handle: refreshHandle, device_proof: deviceProof }),
  });
  const body = await boundedJson(response);
  if (typeof body.device_credential !== 'string' || typeof body.expires_at !== 'number') {
    throw new Error('Private broker omitted refreshed credentials.');
  }
  return { credential: body.device_credential, expiresAt: body.expires_at };
}

export async function revokePrivateDevice(connection: ProviderConnection, credential: string, deviceProof: string): Promise<void> {
  if (!connection.privateProvider || connection.baseUrl !== PRIVATE_BROKER_API_BASE_URL) throw new Error('Not a private provider.');
  const response = await fetch(`${PRIVATE_BROKER_API_BASE_URL}/private-model-devices/revoke`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${credential}`, 'X-VibeX-Device-Proof': deviceProof },
  });
  if (!response.ok && response.status !== 401) throw new Error('The broker could not revoke this device.');
}

/** Revokes a redeemed-but-not-yet-saved grant when the consent sheet is cancelled. */
export async function discardPendingPrivateProvider(pending: PendingPrivateProvider): Promise<void> {
  const response = await fetch(`${PRIVATE_BROKER_API_BASE_URL}/private-model-devices/revoke`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${pending.credential}`, 'X-VibeX-Device-Proof': pending.deviceProof },
  });
  if (!response.ok && response.status !== 401) throw new Error('The pending private grant could not be revoked.');
  pending.credential = '';
  pending.refreshHandle = '';
  pending.deviceProof = '';
}
