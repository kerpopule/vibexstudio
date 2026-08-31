import { generateKeyPairSync, sign } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import { canonicalProfile, PROFILE_AUDIENCE, PROFILE_SCHEMA, type SignedProviderProfile } from '../broker/src/core.ts';
import { parsePrivateInviteLink } from '@/lib/private-provider/links';
import { assertPrivateProviderOrigin, privateBackendNotice, PRIVATE_BROKER_API_BASE_URL, verifyProviderProfile } from '@/lib/private-provider/profile';

const { privateKey, publicKey } = generateKeyPairSync('ed25519');
const publicKeyHex = (publicKey.export({ format: 'der', type: 'spki' }) as Buffer).subarray(-32).toString('hex');

function signedProfile(now = Date.now()): SignedProviderProfile {
  const unsigned: Omit<SignedProviderProfile, 'signature'> = {
    schema: PROFILE_SCHEMA,
    issuer: 'Synthetic issuer',
    audience: PROFILE_AUDIENCE,
    grant_id: 'gr_testgrant00000000000000',
    device_credential_id: 'dev_testdevice000000000000',
    api_base_url: PRIVATE_BROKER_API_BASE_URL,
    display_name: 'Private VibeX Models',
    allowed_models: ['deepseek-v4-flash', 'approved-local-fallback'],
    capabilities: { chat: true, image: false, video: false, vision: false, tools: false },
    issued_at: now,
    expires_at: now + 24 * 60 * 60_000,
    limits: {
      perMinute: 4,
      perDevicePerDay: 20,
      perGrantPerDay: 60,
      perDeviceConcurrent: 1,
      globalConcurrent: 2,
      maxOutputTokens: 4096,
    },
    privacy_notice_version: 'private-pilot-v1',
    revocation_endpoint: `${PRIVATE_BROKER_API_BASE_URL}/private-model-devices/revoke`,
    signing_key_id: 'test-key',
  };
  return { ...unsigned, signature: sign(null, Buffer.from(canonicalProfile(unsigned)), privateKey).toString('base64url') };
}

describe('private invite link parsing', () => {
  const token = 'A'.repeat(43);

  it('accepts only the exact HTTPS and custom-scheme routes', () => {
    expect(parsePrivateInviteLink(`https://vibexstudio.com/connect/${token}`)).toBe(token);
    expect(parsePrivateInviteLink(`vibex://connect?token=${token}`)).toBe(token);
    expect(parsePrivateInviteLink(`http://vibexstudio.com/connect/${token}`)).toBeNull();
    expect(parsePrivateInviteLink(`https://evil.example/connect/${token}`)).toBeNull();
    expect(parsePrivateInviteLink(`https://vibexstudio.com/connect/${token}?next=https://evil.example`)).toBeNull();
    expect(parsePrivateInviteLink(`vibex://connect?token=${token}&origin=https://evil.example`)).toBeNull();
    expect(parsePrivateInviteLink('vibex://import?repo=owner/name')).toBeNull();
  });
});

describe('signed private provider profiles', () => {
  it('accepts an exact signed V1 profile and returns only non-secret metadata', () => {
    const now = Date.now();
    const verified = verifyProviderProfile(signedProfile(now), { now, publicKeys: { 'test-key': publicKeyHex } });
    expect(verified.grantId).toBe('gr_testgrant00000000000000');
    expect(verified.allowedModels).toEqual(['deepseek-v4-flash', 'approved-local-fallback']);
    expect(JSON.stringify(verified)).not.toContain('signature');
  });

  it.each([
    ['wrong audience', { audience: 'com.evil.app' }],
    ['client-selected origin', { api_base_url: 'https://evil.example/v1' }],
    ['tools capability', { capabilities: { chat: true, image: false, video: false, vision: false, tools: true } }],
    ['unapproved model', { allowed_models: ['arbitrary-model'] }],
    ['excessive device quota', { limits: { ...signedProfile().limits, perDevicePerDay: 21 } }],
  ])('rejects %s even if the rest of the envelope is shaped correctly', (_name, change) => {
    const now = Date.now();
    const candidate = { ...signedProfile(now), ...change };
    expect(() => verifyProviderProfile(candidate, { now, publicKeys: { 'test-key': publicKeyHex } })).toThrow();
  });

  it('rejects tampering, expiry, unknown schemas, and unknown signing keys', () => {
    const now = Date.now();
    const valid = signedProfile(now);
    expect(() => verifyProviderProfile({ ...valid, issuer: 'Tampered' }, { now, publicKeys: { 'test-key': publicKeyHex } })).toThrow(/signature/i);
    expect(() => verifyProviderProfile({ ...valid, expires_at: now - 1 }, { now, publicKeys: { 'test-key': publicKeyHex } })).toThrow(/valid/i);
    expect(() => verifyProviderProfile({ ...valid, schema: 'vibex/private-provider-profile.v2' }, { now, publicKeys: { 'test-key': publicKeyHex } })).toThrow(/unsupported/i);
    expect(() => verifyProviderProfile(valid, { now, publicKeys: {} })).toThrow(/signing key/i);
  });

  it('never routes a stored private credential to a settings-supplied origin', () => {
    expect(() => assertPrivateProviderOrigin('https://evil.example/v1')).toThrow(/origin/i);
    expect(() => assertPrivateProviderOrigin(PRIVATE_BROKER_API_BASE_URL)).not.toThrow();
  });

  it('labels approved fallback use without exposing arbitrary backend metadata', () => {
    expect(privateBackendNotice('deepseek-v4-flash', 'approved-local-fallback')).toBe('Private fallback used: approved-local-fallback');
    expect(privateBackendNotice('deepseek-v4-flash', 'deepseek-v4-flash')).toBeNull();
    expect(() => privateBackendNotice('deepseek-v4-flash', 'spark.internal:9443')).toThrow(/unapproved/i);
  });
});
