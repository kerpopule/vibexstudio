import {
  createHash,
  createHmac,
  randomBytes,
  sign as cryptoSign,
  timingSafeEqual,
  type KeyObject,
} from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

export const PROFILE_SCHEMA = 'vibex/private-provider-profile.v1' as const;
export const PROFILE_AUDIENCE = 'studio.vibex.app' as const;
export const STORE_SCHEMA = 'vibex/private-broker-store.v1' as const;
export const MAX_BODY_BYTES = 1024 * 1024;
export const MAX_OUTPUT_TOKENS = 4096;
export const MAX_MESSAGES = 80;
export const MAX_CONTEXT_CHARS = 240_000;

export interface BrokerLimits {
  perMinute: number;
  perDevicePerDay: number;
  perGrantPerDay: number;
  perDeviceConcurrent: number;
  globalConcurrent: number;
  maxOutputTokens: number;
}

export interface BrokerConfig {
  publicApiBaseUrl: string;
  upstreamBaseUrl: string;
  upstreamBearer: string;
  tokenHashKey: string;
  profileSigningKey: KeyObject;
  signingKeyId: string;
  issuer: string;
  allowedModels: readonly string[];
  limits: BrokerLimits;
  requestDeadlineMs?: number;
  now?: () => number;
  random?: (bytes: number) => Buffer;
  fetchImpl?: typeof fetch;
  logger?: (event: BrokerLogEvent) => void;
}

export interface BrokerLogEvent {
  event: string;
  status: 'ok' | 'denied' | 'error';
  code?: string;
  grantId?: string;
  deviceCredentialId?: string;
  model?: string;
}

interface InviteRecord {
  id: string;
  tokenHash: string;
  recipientLabel: string;
  issuer: string;
  expiresAt: number;
  redemptionsRemaining: number;
  grantExpiresAt: number;
  consumedAt?: number;
}

interface GrantRecord {
  id: string;
  inviteId: string;
  expiresAt: number;
  revokedAt?: number;
  dailyCount: Record<string, number>;
}

interface DeviceRecord {
  id: string;
  grantId: string;
  proofHash: string;
  credentialHash: string;
  refreshHash: string;
  credentialExpiresAt: number;
  revokedAt?: number;
  dailyCount: Record<string, number>;
  minuteStarts: number[];
}

export interface BrokerStoreData {
  schema: typeof STORE_SCHEMA;
  invites: InviteRecord[];
  grants: GrantRecord[];
  devices: DeviceRecord[];
  redemptionNonces: string[];
}

export interface BrokerStore {
  transaction<T>(work: (data: BrokerStoreData) => T | Promise<T>): Promise<T>;
}

export class MemoryBrokerStore implements BrokerStore {
  private data: BrokerStoreData = {
    schema: STORE_SCHEMA,
    invites: [],
    grants: [],
    devices: [],
    redemptionNonces: [],
  };
  private queue = Promise.resolve();

  async transaction<T>(work: (data: BrokerStoreData) => T | Promise<T>): Promise<T> {
    const previous = this.queue;
    let release!: () => void;
    this.queue = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      return await work(this.data);
    } finally {
      release();
    }
  }

  /** Test/receipt inspection. Never includes raw tokens, prompts, or outputs. */
  async snapshot(): Promise<BrokerStoreData> {
    return this.transaction((data) => structuredClone(data));
  }
}

export class JsonFileBrokerStore implements BrokerStore {
  private queue = Promise.resolve();

  constructor(private readonly path: string) {}

  async transaction<T>(work: (data: BrokerStoreData) => T | Promise<T>): Promise<T> {
    const previous = this.queue;
    let release!: () => void;
    this.queue = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      await mkdir(dirname(this.path), { recursive: true, mode: 0o700 });
      let data: BrokerStoreData;
      try {
        data = JSON.parse(await readFile(this.path, 'utf8')) as BrokerStoreData;
        if (data.schema !== STORE_SCHEMA) throw new Error('Unsupported broker store schema.');
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        data = { schema: STORE_SCHEMA, invites: [], grants: [], devices: [], redemptionNonces: [] };
      }
      const result = await work(data);
      const temporary = `${this.path}.tmp`;
      await writeFile(temporary, `${JSON.stringify(data, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
      await rename(temporary, this.path);
      return result;
    } finally {
      release();
    }
  }
}

export interface SignedProviderProfile {
  schema: typeof PROFILE_SCHEMA;
  issuer: string;
  audience: typeof PROFILE_AUDIENCE;
  grant_id: string;
  device_credential_id: string;
  api_base_url: string;
  display_name: 'Private VibeX Models';
  allowed_models: string[];
  capabilities: { chat: true; image: false; video: false; vision: false; tools: false };
  issued_at: number;
  expires_at: number;
  limits: BrokerLimits;
  privacy_notice_version: 'private-pilot-v1';
  revocation_endpoint: string;
  signing_key_id: string;
  signature: string;
}

export interface RedeemRequest {
  invite_token: string;
  device_proof: string;
  app_bundle_id: string;
  app_version: string;
  app_build: string;
  redemption_nonce: string;
  supported_profile_schemas: string[];
}

export interface RedeemResponse {
  recipient_label: string;
  device_credential: string;
  credential_expires_at: number;
  refresh_handle: string;
  profile: SignedProviderProfile;
}

export interface DeviceAuth {
  credential: string;
  deviceProof: string;
}

export class BrokerError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly retryAfterSeconds?: number
  ) {
    super(message);
  }
}

function canonicalize(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`;
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalize(object[key])}`)
    .join(',')}}`;
}

export function canonicalProfile(profile: Omit<SignedProviderProfile, 'signature'>): string {
  return canonicalize(profile);
}

function token(bytes: number, random: (bytes: number) => Buffer): string {
  return random(bytes).toString('base64url');
}

function isOpaqueToken(value: string): boolean {
  return /^[A-Za-z0-9_-]{22,256}$/.test(value);
}

function dayKey(now: number): string {
  return new Date(now).toISOString().slice(0, 10);
}

function safeEqualHex(a: string, b: string): boolean {
  if (!/^[a-f0-9]+$/.test(a) || !/^[a-f0-9]+$/.test(b) || a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'));
}

function requireHttpsOrigin(url: string): string {
  const parsed = new URL(url);
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new Error('Broker public API base URL must be a clean HTTPS URL.');
  }
  return parsed.toString().replace(/\/$/, '');
}

function requireFixedUpstream(url: string): string {
  const parsed = new URL(url);
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new Error('The broker upstream must be one fixed HTTP(S) URL without credentials, query, or fragment.');
  }
  return parsed.toString().replace(/\/$/, '');
}

export function validateChatBody(value: unknown, allowedModels: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new BrokerError(400, 'invalid_request', 'The request body must be a JSON object.');
  }
  const body = value as Record<string, unknown>;
  const allowedKeys = new Set(['model', 'messages', 'stream', 'max_tokens', 'temperature', 'top_p', 'stop']);
  for (const key of Object.keys(body)) {
    if (!allowedKeys.has(key)) throw new BrokerError(400, 'unsupported_field', `Unsupported field: ${key}.`);
  }
  if (typeof body.model !== 'string' || !allowedModels.includes(body.model)) {
    throw new BrokerError(400, 'model_not_allowed', 'That model is not allowed for this private grant.');
  }
  if (body.stream !== true) throw new BrokerError(400, 'stream_required', 'Private model requests must stream.');
  if (!Array.isArray(body.messages) || body.messages.length === 0 || body.messages.length > MAX_MESSAGES) {
    throw new BrokerError(400, 'invalid_messages', 'Messages must be a non-empty bounded array.');
  }
  let contextChars = 0;
  const messages = body.messages.map((message) => {
    if (!message || typeof message !== 'object' || Array.isArray(message)) {
      throw new BrokerError(400, 'invalid_messages', 'Every message must be an object.');
    }
    const candidate = message as Record<string, unknown>;
    if (Object.keys(candidate).some((key) => key !== 'role' && key !== 'content')) {
      throw new BrokerError(400, 'unsupported_message_field', 'Only role and string content are supported.');
    }
    if (!['system', 'user', 'assistant'].includes(String(candidate.role)) || typeof candidate.content !== 'string') {
      throw new BrokerError(400, 'invalid_messages', 'Only system, user, and assistant string messages are supported.');
    }
    contextChars += candidate.content.length;
    return { role: candidate.role, content: candidate.content };
  });
  if (contextChars > MAX_CONTEXT_CHARS) {
    throw new BrokerError(413, 'context_too_large', 'The text context is too large.');
  }
  const maxTokens = body.max_tokens ?? MAX_OUTPUT_TOKENS;
  if (!Number.isInteger(maxTokens) || Number(maxTokens) < 1 || Number(maxTokens) > MAX_OUTPUT_TOKENS) {
    throw new BrokerError(400, 'max_tokens_exceeded', `max_tokens must be between 1 and ${MAX_OUTPUT_TOKENS}.`);
  }
  if (body.temperature !== undefined && (typeof body.temperature !== 'number' || body.temperature < 0 || body.temperature > 2)) {
    throw new BrokerError(400, 'invalid_temperature', 'temperature must be between 0 and 2.');
  }
  if (body.top_p !== undefined && (typeof body.top_p !== 'number' || body.top_p < 0 || body.top_p > 1)) {
    throw new BrokerError(400, 'invalid_top_p', 'top_p must be between 0 and 1.');
  }
  if (body.stop !== undefined && typeof body.stop !== 'string' && !(
    Array.isArray(body.stop) && body.stop.length <= 4 && body.stop.every((item) => typeof item === 'string' && item.length <= 100)
  )) {
    throw new BrokerError(400, 'invalid_stop', 'stop must be a bounded string or string array.');
  }
  return { ...body, messages, max_tokens: Number(maxTokens), stream: true };
}

export class PrivateModelBroker {
  private readonly now: () => number;
  private readonly random: (bytes: number) => Buffer;
  private readonly apiBaseUrl: string;
  private readonly upstreamBaseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly logger: (event: BrokerLogEvent) => void;
  private globalInFlight = 0;
  private deviceInFlight = new Map<string, number>();

  constructor(private readonly store: BrokerStore, private readonly config: BrokerConfig) {
    this.now = config.now ?? Date.now;
    this.random = config.random ?? randomBytes;
    this.apiBaseUrl = requireHttpsOrigin(config.publicApiBaseUrl);
    this.upstreamBaseUrl = requireFixedUpstream(config.upstreamBaseUrl);
    this.fetchImpl = config.fetchImpl ?? fetch;
    this.logger = config.logger ?? (() => {});
    if (!config.tokenHashKey || config.tokenHashKey.length < 32) throw new Error('tokenHashKey must be at least 32 characters.');
    if (!config.upstreamBearer) throw new Error('upstreamBearer is required.');
    if (!config.allowedModels.length) throw new Error('At least one model must be allowlisted.');
  }

  private hash(value: string): string {
    return createHmac('sha256', this.config.tokenHashKey).update(value).digest('hex');
  }

  private log(event: BrokerLogEvent): void {
    this.logger(event);
  }

  async issueInvite(input: {
    recipientLabel: string;
    inviteTtlMs?: number;
    grantTtlMs?: number;
    redemptions?: number;
  }): Promise<{ inviteToken: string; inviteId: string; connectUrl: string; expiresAt: number }> {
    const now = this.now();
    const inviteToken = token(32, this.random);
    const inviteId = `inv_${token(12, this.random)}`;
    const expiresAt = now + (input.inviteTtlMs ?? 72 * 60 * 60 * 1000);
    const grantExpiresAt = now + (input.grantTtlMs ?? 14 * 24 * 60 * 60 * 1000);
    const recipientLabel = input.recipientLabel.trim();
    if (!recipientLabel || recipientLabel.length > 80) throw new BrokerError(400, 'invalid_recipient', 'Recipient label is required.');
    if ((input.redemptions ?? 1) !== 1) throw new BrokerError(400, 'invalid_redemptions', 'Pilot V1 invites allow exactly one redemption.');
    if (expiresAt <= now || expiresAt > now + 72 * 60 * 60 * 1000 || grantExpiresAt <= now || grantExpiresAt > now + 14 * 24 * 60 * 60 * 1000) {
      throw new BrokerError(400, 'invalid_expiry', 'Pilot V1 invite and grant expiry exceed the approved envelope.');
    }
    await this.store.transaction((data) => {
      data.invites.push({
        id: inviteId,
        tokenHash: this.hash(inviteToken),
        recipientLabel,
        issuer: this.config.issuer,
        expiresAt,
        redemptionsRemaining: 1,
        grantExpiresAt,
      });
    });
    return {
      inviteToken,
      inviteId,
      connectUrl: `https://vibexstudio.com/connect/${inviteToken}`,
      expiresAt,
    };
  }

  async redeem(request: RedeemRequest): Promise<RedeemResponse> {
    this.validateRedeemRequest(request);
    const now = this.now();
    return this.store.transaction((data) => {
      if (data.redemptionNonces.includes(request.redemption_nonce)) {
        throw new BrokerError(409, 'nonce_replayed', 'That redemption request was already used.');
      }
      const requestedHash = this.hash(request.invite_token);
      const invite = data.invites.find((candidate) => safeEqualHex(candidate.tokenHash, requestedHash));
      if (!invite || invite.expiresAt <= now || invite.redemptionsRemaining < 1 || invite.consumedAt) {
        this.log({ event: 'invite_redeem', status: 'denied', code: 'invite_invalid' });
        throw new BrokerError(410, 'invite_invalid', 'This invite is invalid, expired, or already redeemed.');
      }
      data.redemptionNonces.push(request.redemption_nonce);
      if (data.redemptionNonces.length > 10_000) data.redemptionNonces.splice(0, data.redemptionNonces.length - 10_000);
      invite.redemptionsRemaining -= 1;
      invite.consumedAt = now;

      const grant: GrantRecord = {
        id: `gr_${token(12, this.random)}`,
        inviteId: invite.id,
        expiresAt: Math.min(invite.grantExpiresAt, now + 14 * 24 * 60 * 60 * 1000),
        dailyCount: {},
      };
      const credential = token(32, this.random);
      const refreshHandle = token(32, this.random);
      const device: DeviceRecord = {
        id: `dev_${token(12, this.random)}`,
        grantId: grant.id,
        proofHash: this.hash(request.device_proof),
        credentialHash: this.hash(credential),
        refreshHash: this.hash(refreshHandle),
        credentialExpiresAt: Math.min(grant.expiresAt, now + 60 * 60 * 1000),
        dailyCount: {},
        minuteStarts: [],
      };
      data.grants.push(grant);
      data.devices.push(device);
      const profile = this.signProfile(grant, device, now);
      this.log({ event: 'invite_redeem', status: 'ok', grantId: grant.id, deviceCredentialId: device.id });
      return {
        recipient_label: invite.recipientLabel,
        device_credential: credential,
        credential_expires_at: device.credentialExpiresAt,
        refresh_handle: refreshHandle,
        profile,
      };
    });
  }

  private validateRedeemRequest(request: RedeemRequest): void {
    if (!request || typeof request !== 'object') throw new BrokerError(400, 'invalid_request', 'Invalid redemption request.');
    if (!isOpaqueToken(request.invite_token)) throw new BrokerError(400, 'invalid_invite', 'Invalid invite token.');
    if (!isOpaqueToken(request.device_proof)) throw new BrokerError(400, 'invalid_device_proof', 'Invalid device proof.');
    if (request.app_bundle_id !== PROFILE_AUDIENCE) throw new BrokerError(403, 'wrong_audience', 'This invite is for VibeXStudio only.');
    if (!request.app_version || !request.app_build || request.app_version.length > 32 || request.app_build.length > 32) {
      throw new BrokerError(400, 'invalid_app_version', 'App version and build are required.');
    }
    if (!isOpaqueToken(request.redemption_nonce)) throw new BrokerError(400, 'invalid_nonce', 'Invalid redemption nonce.');
    if (!Array.isArray(request.supported_profile_schemas) || !request.supported_profile_schemas.includes(PROFILE_SCHEMA)) {
      throw new BrokerError(409, 'unsupported_profile_schema', 'The app does not support this provider profile.');
    }
  }

  private signProfile(grant: GrantRecord, device: DeviceRecord, now: number): SignedProviderProfile {
    const unsigned: Omit<SignedProviderProfile, 'signature'> = {
      schema: PROFILE_SCHEMA,
      issuer: this.config.issuer,
      audience: PROFILE_AUDIENCE,
      grant_id: grant.id,
      device_credential_id: device.id,
      api_base_url: this.apiBaseUrl,
      display_name: 'Private VibeX Models',
      allowed_models: [...this.config.allowedModels],
      capabilities: { chat: true, image: false, video: false, vision: false, tools: false },
      issued_at: now,
      expires_at: grant.expiresAt,
      limits: { ...this.config.limits, maxOutputTokens: Math.min(this.config.limits.maxOutputTokens, MAX_OUTPUT_TOKENS) },
      privacy_notice_version: 'private-pilot-v1',
      revocation_endpoint: `${this.apiBaseUrl}/private-model-devices/revoke`,
      signing_key_id: this.config.signingKeyId,
    };
    const signature = cryptoSign(null, Buffer.from(canonicalProfile(unsigned)), this.config.profileSigningKey).toString('base64url');
    return { ...unsigned, signature };
  }

  private async authenticate(auth: DeviceAuth, allowExpiredCredential = false): Promise<{ device: DeviceRecord; grant: GrantRecord }> {
    if (!isOpaqueToken(auth.credential) || !isOpaqueToken(auth.deviceProof)) {
      throw new BrokerError(401, 'invalid_credentials', 'Device credentials are invalid.');
    }
    const credentialHash = this.hash(auth.credential);
    const proofHash = this.hash(auth.deviceProof);
    const now = this.now();
    return this.store.transaction((data) => {
      const device = data.devices.find((candidate) => safeEqualHex(candidate.credentialHash, credentialHash));
      const grant = device && data.grants.find((candidate) => candidate.id === device.grantId);
      if (
        !device || !grant || !safeEqualHex(device.proofHash, proofHash) || device.revokedAt || grant.revokedAt ||
        grant.expiresAt <= now || (!allowExpiredCredential && device.credentialExpiresAt <= now)
      ) {
        throw new BrokerError(401, 'invalid_credentials', 'Device credentials are invalid, expired, or revoked.');
      }
      return { device, grant };
    });
  }

  async refresh(refreshHandle: string, deviceProof: string): Promise<{ device_credential: string; expires_at: number }> {
    if (!isOpaqueToken(refreshHandle) || !isOpaqueToken(deviceProof)) {
      throw new BrokerError(401, 'invalid_refresh', 'Refresh credentials are invalid.');
    }
    const refreshHash = this.hash(refreshHandle);
    const proofHash = this.hash(deviceProof);
    const now = this.now();
    return this.store.transaction((data) => {
      const device = data.devices.find((candidate) => safeEqualHex(candidate.refreshHash, refreshHash));
      const grant = device && data.grants.find((candidate) => candidate.id === device.grantId);
      if (!device || !grant || !safeEqualHex(device.proofHash, proofHash) || device.revokedAt || grant.revokedAt || grant.expiresAt <= now) {
        throw new BrokerError(401, 'invalid_refresh', 'Refresh credentials are invalid, expired, or revoked.');
      }
      const credential = token(32, this.random);
      device.credentialHash = this.hash(credential);
      device.credentialExpiresAt = Math.min(grant.expiresAt, now + 60 * 60 * 1000);
      return { device_credential: credential, expires_at: device.credentialExpiresAt };
    });
  }

  async revoke(auth: DeviceAuth): Promise<void> {
    const { device } = await this.authenticate(auth, true);
    await this.store.transaction((data) => {
      const stored = data.devices.find((candidate) => candidate.id === device.id);
      if (stored) stored.revokedAt = this.now();
    });
    this.log({ event: 'device_revoke', status: 'ok', grantId: device.grantId, deviceCredentialId: device.id });
  }

  async models(auth: DeviceAuth): Promise<{ object: 'list'; data: { id: string; object: 'model'; owned_by: 'vibex-private' }[] }> {
    await this.authenticate(auth);
    return {
      object: 'list',
      data: this.config.allowedModels.map((id) => ({ id, object: 'model', owned_by: 'vibex-private' as const })),
    };
  }

  async chat(auth: DeviceAuth, rawBody: unknown, signal?: AbortSignal): Promise<Response> {
    const body = validateChatBody(rawBody, this.config.allowedModels);
    const { device, grant } = await this.authenticate(auth);
    const release = await this.reserve(device, grant, String(body.model));
    const deadline = AbortSignal.timeout(this.config.requestDeadlineMs ?? 5 * 60 * 1000);
    const combinedSignal = signal ? AbortSignal.any([signal, deadline]) : deadline;
    try {
      const response = await this.fetchImpl(`${this.upstreamBaseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'text/event-stream',
          Authorization: `Bearer ${this.config.upstreamBearer}`,
        },
        body: JSON.stringify(body),
        signal: combinedSignal,
        redirect: 'error',
      });
      if (!response.ok || !response.body) {
        release();
        this.log({ event: 'chat', status: 'error', code: 'upstream_failure', model: String(body.model) });
        throw new BrokerError(502, 'upstream_failure', 'The private model is temporarily unavailable.');
      }
      const backendModel = response.headers.get('X-VibeX-Backend-Model') ??
        (response.headers.get('X-Spark-Backend') === 'fallback' ? 'approved-local-fallback' : String(body.model));
      if (!this.config.allowedModels.includes(backendModel)) {
        release();
        throw new BrokerError(502, 'unapproved_backend_label', 'The private model returned unapproved backend metadata.');
      }
      const reader = response.body.getReader();
      const state = { buffer: '', sawContent: false, sawDone: false, decoder: new TextDecoder() };
      const buffered: Uint8Array[] = [];
      while (!state.sawContent) {
        const chunk = await reader.read();
        if (chunk.done) {
          validateSseEnd(state);
          throw new BrokerError(502, 'empty_upstream_stream', 'The private model returned no generated text.');
        }
        validateSseChunk(state, chunk.value);
        buffered.push(chunk.value);
        if (state.sawDone && !state.sawContent) {
          throw new BrokerError(502, 'empty_upstream_stream', 'The private model returned no generated text.');
        }
      }
      const stream = new ReadableStream<Uint8Array>({
        async pull(controller) {
          try {
            const prefix = buffered.shift();
            if (prefix) {
              controller.enqueue(prefix);
              return;
            }
            const chunk = await reader.read();
            if (chunk.done) {
              validateSseEnd(state);
              controller.close();
              release();
            } else {
              validateSseChunk(state, chunk.value);
              controller.enqueue(chunk.value);
            }
          } catch (error) {
            release();
            controller.error(error);
          }
        },
        async cancel(reason) {
          await reader.cancel(reason);
          release();
        },
      });
      return new Response(stream, {
        status: 200,
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-store',
          'X-VibeX-Backend-Model': backendModel,
        },
      });
    } catch (error) {
      release();
      if (error instanceof BrokerError) throw error;
      throw new BrokerError(502, 'upstream_failure', 'The private model is temporarily unavailable.');
    }
  }

  private async reserve(device: DeviceRecord, grant: GrantRecord, model: string): Promise<() => void> {
    const now = this.now();
    const minuteCutoff = now - 60_000;
    await this.store.transaction((data) => {
      const liveDevice = data.devices.find((candidate) => candidate.id === device.id)!;
      const liveGrant = data.grants.find((candidate) => candidate.id === grant.id)!;
      liveDevice.minuteStarts = liveDevice.minuteStarts.filter((value) => value > minuteCutoff);
      const day = dayKey(now);
      if (liveDevice.minuteStarts.length >= this.config.limits.perMinute) {
        throw new BrokerError(429, 'minute_quota_exceeded', 'Per-minute private model limit reached.', 60);
      }
      if ((liveDevice.dailyCount[day] ?? 0) >= this.config.limits.perDevicePerDay) {
        throw new BrokerError(429, 'device_daily_quota_exceeded', 'Daily device limit reached.');
      }
      if ((liveGrant.dailyCount[day] ?? 0) >= this.config.limits.perGrantPerDay) {
        throw new BrokerError(429, 'grant_daily_quota_exceeded', 'Daily grant limit reached.');
      }
      if ((this.deviceInFlight.get(device.id) ?? 0) >= this.config.limits.perDeviceConcurrent) {
        throw new BrokerError(429, 'device_concurrency_exceeded', 'This device already has a generation running.', 2);
      }
      if (this.globalInFlight >= this.config.limits.globalConcurrent) {
        throw new BrokerError(429, 'global_concurrency_exceeded', 'The private pilot is at capacity.', 2);
      }
      liveDevice.minuteStarts.push(now);
      liveDevice.dailyCount[day] = (liveDevice.dailyCount[day] ?? 0) + 1;
      liveGrant.dailyCount[day] = (liveGrant.dailyCount[day] ?? 0) + 1;
      this.globalInFlight += 1;
      this.deviceInFlight.set(device.id, (this.deviceInFlight.get(device.id) ?? 0) + 1);
    });
    let released = false;
    this.log({ event: 'chat', status: 'ok', grantId: grant.id, deviceCredentialId: device.id, model });
    return () => {
      if (released) return;
      released = true;
      this.globalInFlight = Math.max(0, this.globalInFlight - 1);
      const next = Math.max(0, (this.deviceInFlight.get(device.id) ?? 1) - 1);
      if (next) this.deviceInFlight.set(device.id, next);
      else this.deviceInFlight.delete(device.id);
    };
  }
}

interface SseValidationState {
  buffer: string;
  sawContent: boolean;
  sawDone: boolean;
  decoder: TextDecoder;
}

function validateSseLine(state: SseValidationState, line: string): void {
  const normalized = line.endsWith('\r') ? line.slice(0, -1) : line;
  if (!normalized || normalized.startsWith(':')) return;
  if (!normalized.startsWith('data:')) {
    throw new BrokerError(502, 'malformed_upstream_stream', 'The private model returned malformed streaming data.');
  }
  const data = normalized.slice(5).trimStart();
  if (data === '[DONE]') {
    state.sawDone = true;
    return;
  }
  let event: unknown;
  try {
    event = JSON.parse(data);
  } catch {
    throw new BrokerError(502, 'malformed_upstream_stream', 'The private model returned malformed streaming data.');
  }
  if (!event || typeof event !== 'object' || Array.isArray(event)) {
    throw new BrokerError(502, 'malformed_upstream_stream', 'The private model returned malformed streaming data.');
  }
  const record = event as { error?: unknown; choices?: { delta?: { content?: unknown } }[] };
  if (record.error) throw new BrokerError(502, 'upstream_stream_error', 'The private model reported a streaming error.');
  if (!Array.isArray(record.choices) || !record.choices[0]?.delta ||
      (record.choices[0].delta.content !== undefined && typeof record.choices[0].delta.content !== 'string')) {
    throw new BrokerError(502, 'malformed_upstream_stream', 'The private model returned malformed streaming data.');
  }
  if (record.choices[0].delta.content) state.sawContent = true;
}

function validateSseChunk(state: SseValidationState, chunk: Uint8Array): void {
  state.buffer += state.decoder.decode(chunk, { stream: true });
  const lines = state.buffer.split('\n');
  state.buffer = lines.pop() ?? '';
  for (const line of lines) validateSseLine(state, line);
}

function validateSseEnd(state: SseValidationState): void {
  state.buffer += state.decoder.decode();
  if (state.buffer) validateSseLine(state, state.buffer);
  state.buffer = '';
  if (!state.sawContent) throw new BrokerError(502, 'empty_upstream_stream', 'The private model returned no generated text.');
  if (!state.sawDone) throw new BrokerError(502, 'unterminated_upstream_stream', 'The private model stream ended without a terminal event.');
}

export function errorResponse(error: unknown): Response {
  const brokerError = error instanceof BrokerError
    ? error
    : new BrokerError(500, 'internal_error', 'The broker could not complete the request.');
  const headers: Record<string, string> = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };
  if (brokerError.retryAfterSeconds) headers['Retry-After'] = String(brokerError.retryAfterSeconds);
  return Response.json({ error: { code: brokerError.code, message: brokerError.message } }, { status: brokerError.status, headers });
}

export function bodyDigest(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}
