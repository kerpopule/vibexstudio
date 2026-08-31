import { ed25519 } from '@noble/curves/ed25519.js';

import type { PrivateProviderMetadata } from '@/lib/types';

export const PRIVATE_PROFILE_SCHEMA = 'vibex/private-provider-profile.v1' as const;
export const PRIVATE_BROKER_API_BASE_URL = 'https://api.vibexstudio.com/v1';
export const PRIVATE_ALLOWED_MODELS = ['deepseek-v4-flash', 'approved-local-fallback'] as const;

export function assertPrivateProviderOrigin(baseUrl: string | undefined): void {
  if (baseUrl !== PRIVATE_BROKER_API_BASE_URL) {
    throw new Error('Private provider origin is not allowed by this app build.');
  }
}

export function privateBackendNotice(requestedModel: string, backendModel: string | null): string | null {
  if (!backendModel || backendModel === requestedModel) return null;
  if (!PRIVATE_ALLOWED_MODELS.includes(backendModel as typeof PRIVATE_ALLOWED_MODELS[number])) {
    throw new Error('The private broker returned an unapproved backend label.');
  }
  return `Private fallback used: ${backendModel}`;
}

export const PRIVATE_PROFILE_PUBLIC_KEYS: Readonly<Record<string, string>> = {
  'vibex-private-profile-2026-01': '8bc67191881393dc484fff6a6d028d2b7abf5834cc1c2196a692b895da158391',
};

export interface SignedProviderProfileWire {
  schema: string;
  issuer: string;
  audience: string;
  grant_id: string;
  device_credential_id: string;
  api_base_url: string;
  display_name: string;
  allowed_models: string[];
  capabilities: { chat: boolean; image: boolean; video: boolean; vision: boolean; tools: boolean };
  issued_at: number;
  expires_at: number;
  limits: PrivateProviderMetadata['limits'];
  privacy_notice_version: string;
  revocation_endpoint: string;
  signing_key_id: string;
  signature: string;
}

function canonicalize(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`;
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object).sort().map((key) => `${JSON.stringify(key)}:${canonicalize(object[key])}`).join(',')}}`;
}

function hex(value: string): Uint8Array {
  if (!/^[a-f0-9]{64}$/i.test(value)) throw new Error('Invalid profile verification key.');
  return Uint8Array.from(value.match(/../g)!, (byte) => Number.parseInt(byte, 16));
}

function base64Url(value: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error('Invalid profile signature encoding.');
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(value.length / 4) * 4, '=');
  const binary = atob(base64);
  const decoded = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  if (decoded.length !== 64) throw new Error('Invalid profile signature length.');
  return decoded;
}

function exactHttps(value: string, expected: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'https:' && !parsed.username && !parsed.password && parsed.toString().replace(/\/$/, '') === expected;
  } catch {
    return false;
  }
}

export function verifyProviderProfile(
  profile: SignedProviderProfileWire,
  options: { now?: number; publicKeys?: Readonly<Record<string, string>> } = {}
): Omit<PrivateProviderMetadata, 'credentialExpiresAt'> {
  const now = options.now ?? Date.now();
  if (!profile || profile.schema !== PRIVATE_PROFILE_SCHEMA || profile.audience !== 'studio.vibex.app') {
    throw new Error('Unsupported private provider profile.');
  }
  if (typeof profile.issuer !== 'string' || profile.issuer.length < 1 || profile.issuer.length > 80 ||
      profile.privacy_notice_version !== 'private-pilot-v1') {
    throw new Error('Invalid private provider issuer or privacy notice.');
  }
  if (!/^gr_[A-Za-z0-9_-]+$/.test(profile.grant_id) || !/^dev_[A-Za-z0-9_-]+$/.test(profile.device_credential_id)) {
    throw new Error('Invalid private grant identifiers.');
  }
  if (profile.display_name !== 'Private VibeX Models' || !exactHttps(profile.api_base_url, PRIVATE_BROKER_API_BASE_URL)) {
    throw new Error('Private provider origin is not allowed.');
  }
  if (!exactHttps(profile.revocation_endpoint, `${PRIVATE_BROKER_API_BASE_URL}/private-model-devices/revoke`)) {
    throw new Error('Private provider revocation endpoint is not allowed.');
  }
  if (!Number.isFinite(profile.issued_at) || !Number.isFinite(profile.expires_at) || profile.issued_at > now + 5 * 60_000 ||
      profile.issued_at < now - 24 * 60 * 60_000 || profile.expires_at <= now || profile.expires_at > now + 14 * 24 * 60 * 60_000) {
    throw new Error('Private provider profile is not currently valid.');
  }
  if (!Array.isArray(profile.allowed_models) || profile.allowed_models.length === 0 || new Set(profile.allowed_models).size !== profile.allowed_models.length ||
    profile.allowed_models.some((model) => !PRIVATE_ALLOWED_MODELS.includes(model as typeof PRIVATE_ALLOWED_MODELS[number]))) {
    throw new Error('Private provider profile contains a model that is not allowed by this app build.');
  }
  if (!profile.capabilities || profile.capabilities.chat !== true || profile.capabilities.image !== false ||
    profile.capabilities.video !== false || profile.capabilities.vision !== false || profile.capabilities.tools !== false) {
    throw new Error('Private provider profile requests unsupported capabilities.');
  }
  const limits = profile.limits;
  if (!limits || limits.perDeviceConcurrent !== 1 || limits.globalConcurrent > 2 || limits.perDevicePerDay > 20 ||
    limits.perGrantPerDay > 60 || limits.maxOutputTokens > 4096 || Object.values(limits).some((value) => !Number.isInteger(value) || value < 1)) {
    throw new Error('Private provider profile limits exceed this app build.');
  }
  const publicKey = (options.publicKeys ?? PRIVATE_PROFILE_PUBLIC_KEYS)[profile.signing_key_id];
  if (!publicKey) throw new Error('Unknown private provider signing key.');
  const { signature, ...unsigned } = profile;
  const message = new TextEncoder().encode(canonicalize(unsigned));
  if (!ed25519.verify(base64Url(signature), message, hex(publicKey))) throw new Error('Invalid private provider profile signature.');
  return {
    schema: PRIVATE_PROFILE_SCHEMA,
    issuer: profile.issuer,
    grantId: profile.grant_id,
    deviceCredentialId: profile.device_credential_id,
    allowedModels: [...profile.allowed_models],
    expiresAt: profile.expires_at,
    limits: { ...limits },
    privacyNoticeVersion: profile.privacy_notice_version,
    revocationEndpoint: profile.revocation_endpoint,
  };
}
