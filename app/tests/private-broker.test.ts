import { generateKeyPairSync } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';

import {
  BrokerError,
  MemoryBrokerStore,
  PrivateModelBroker,
  validateChatBody,
  type BrokerConfig,
  type DeviceAuth,
  type RedeemRequest,
} from '../broker/src/core.ts';
import { createBrokerServer } from '../broker/src/http.ts';
import { parseAssistantReply } from '@/lib/ai/parser';

const encoder = new TextEncoder();
const openServers: ReturnType<typeof createBrokerServer>[] = [];

afterEach(async () => {
  await Promise.all(openServers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
});

function sse(content = 'file=index.html\n```html\n<h1>Synthetic proof</h1>\n```', backend = 'deepseek-v4-flash'): Response {
  return new Response(
    `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\ndata: [DONE]\n\n`,
    { headers: { 'Content-Type': 'text/event-stream', 'X-VibeX-Backend-Model': backend } }
  );
}

function fixture(overrides: Partial<BrokerConfig> = {}) {
  const { privateKey } = generateKeyPairSync('ed25519');
  let now = Date.UTC(2026, 7, 17, 12);
  const logs: unknown[] = [];
  const store = new MemoryBrokerStore();
  const config: BrokerConfig = {
    publicApiBaseUrl: 'https://api.vibexstudio.com/v1',
    upstreamBaseUrl: 'http://private-mock.invalid/v1',
    upstreamBearer: 'SYNTHETIC_UPSTREAM_SECRET_NOT_REAL',
    tokenHashKey: 'synthetic-hash-key-32-characters-minimum',
    profileSigningKey: privateKey,
    signingKeyId: 'test-signing-key',
    issuer: 'Synthetic issuer',
    allowedModels: ['deepseek-v4-flash', 'approved-local-fallback'],
    limits: {
      perMinute: 100,
      perDevicePerDay: 20,
      perGrantPerDay: 60,
      perDeviceConcurrent: 1,
      globalConcurrent: 2,
      maxOutputTokens: 4096,
    },
    requestDeadlineMs: 5_000,
    now: () => now,
    fetchImpl: async () => sse(),
    logger: (event) => logs.push(event),
    ...overrides,
  };
  const broker = new PrivateModelBroker(store, config);
  return { broker, store, logs, config, advance: (milliseconds: number) => { now += milliseconds; } };
}

async function redeem(broker: PrivateModelBroker, token: string, proof = 'D'.repeat(43), nonce = 'N'.repeat(32)) {
  return broker.redeem({
    invite_token: token,
    device_proof: proof,
    app_bundle_id: 'studio.vibex.app',
    app_version: '1.0.0',
    app_build: 'synthetic',
    redemption_nonce: nonce,
    supported_profile_schemas: ['vibex/private-provider-profile.v1'],
  });
}

async function grant(broker: PrivateModelBroker, label = 'Synthetic recipient', proof = 'D'.repeat(43), nonce = 'N'.repeat(32)) {
  const invite = await broker.issueInvite({ recipientLabel: label });
  const redeemed = await redeem(broker, invite.inviteToken, proof, nonce);
  return {
    invite,
    redeemed,
    auth: { credential: redeemed.device_credential, deviceProof: proof } satisfies DeviceAuth,
  };
}

const chatBody = {
  model: 'deepseek-v4-flash',
  stream: true,
  max_tokens: 128,
  messages: [{ role: 'user', content: 'SYNTHETIC_PROMPT_MARKER' }],
};

describe('private model broker security envelope', () => {
  it('runs invite -> discover -> streaming chat -> revoke through the real HTTP adapter', async () => {
    let upstreamRequest: { input: string; init?: RequestInit } | null = null;
    const { broker, store, logs, config } = fixture({
      fetchImpl: async (input, init) => {
        upstreamRequest = { input: String(input), init };
        return sse();
      },
    });
    const invite = await broker.issueInvite({ recipientLabel: 'Synthetic E2E recipient' });
    const server = createBrokerServer(broker);
    openServers.push(server);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`;
    const deviceProof = 'P'.repeat(43);
    const request: RedeemRequest = {
      invite_token: invite.inviteToken,
      device_proof: deviceProof,
      app_bundle_id: 'studio.vibex.app',
      app_version: '1.0.0',
      app_build: 'synthetic',
      redemption_nonce: 'R'.repeat(32),
      supported_profile_schemas: ['vibex/private-provider-profile.v1'],
    };
    const redeemResponse = await fetch(`${base}/private-model-invites/redeem`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(request),
    });
    expect(redeemResponse.status).toBe(200);
    const redeemed = await redeemResponse.json() as Awaited<ReturnType<typeof redeem>>;
    const authHeaders = { Authorization: `Bearer ${redeemed.device_credential}`, 'X-VibeX-Device-Proof': deviceProof };

    const models = await fetch(`${base}/models`, { headers: authHeaders });
    expect(await models.json()).toMatchObject({ data: [{ id: 'deepseek-v4-flash' }, { id: 'approved-local-fallback' }] });

    const chat = await fetch(`${base}/chat/completions`, {
      method: 'POST', headers: { ...authHeaders, 'Content-Type': 'application/json', 'X-Attacker-Forward-Me': 'no' }, body: JSON.stringify(chatBody),
    });
    expect(chat.status).toBe(200);
    expect(chat.headers.get('X-VibeX-Backend-Model')).toBe('deepseek-v4-flash');
    const streamedText = await chat.text();
    const streamedData = streamedText.split('\n')
      .filter((line) => line.startsWith('data: ') && line !== 'data: [DONE]')
      .map((line) => JSON.parse(line.slice(6)).choices[0].delta.content)
      .join('');
    const parsed = parseAssistantReply(streamedData);
    expect(parsed.files).toEqual([
      { path: 'index.html', content: '<h1>Synthetic proof</h1>\n' },
    ]);
    expect(upstreamRequest).not.toBeNull();
    expect(upstreamRequest!.input).toBe('http://private-mock.invalid/v1/chat/completions');
    expect(upstreamRequest!.init?.redirect).toBe('error');
    expect(upstreamRequest!.init?.headers).toEqual({
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
      Authorization: `Bearer ${config.upstreamBearer}`,
    });
    expect(JSON.parse(String(upstreamRequest!.init?.body))).toEqual({ ...chatBody, max_tokens: 128 });
    expect(JSON.stringify(upstreamRequest)).not.toContain('X-Attacker-Forward-Me');

    expect((await fetch(`${base}/private-model-devices/revoke`, { method: 'POST', headers: authHeaders })).status).toBe(204);
    expect((await fetch(`${base}/models`, { headers: authHeaders })).status).toBe(401);
    expect((await fetch(`${base}/private-model-devices/refresh`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_handle: redeemed.refresh_handle, device_proof: deviceProof }),
    })).status).toBe(401);

    const persistedAndLogged = JSON.stringify({ snapshot: await store.snapshot(), logs });
    for (const secret of [invite.inviteToken, redeemed.device_credential, redeemed.refresh_handle, deviceProof,
      'SYNTHETIC_PROMPT_MARKER', 'Synthetic proof', config.upstreamBearer]) {
      expect(persistedAndLogged).not.toContain(secret);
    }
  });

  it('makes concurrent one-time redemption races single-winner and binds credentials to device proof', async () => {
    const { broker } = fixture();
    const invite = await broker.issueInvite({ recipientLabel: 'Race recipient' });
    const outcomes = await Promise.allSettled([
      redeem(broker, invite.inviteToken, 'A'.repeat(43), '1'.repeat(32)),
      redeem(broker, invite.inviteToken, 'B'.repeat(43), '2'.repeat(32)),
    ]);
    expect(outcomes.filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(1);
    expect(outcomes.filter((outcome) => outcome.status === 'rejected')).toHaveLength(1);
    const winner = outcomes.find((outcome): outcome is PromiseFulfilledResult<Awaited<ReturnType<typeof redeem>>> => outcome.status === 'fulfilled')!;
    await expect(broker.models({ credential: winner.value.device_credential, deviceProof: 'Z'.repeat(43) })).rejects.toMatchObject({ status: 401 });
  });

  it('rotates access credentials on refresh and blocks old credentials', async () => {
    const { broker } = fixture();
    const connected = await grant(broker);
    const refreshed = await broker.refresh(connected.redeemed.refresh_handle, connected.auth.deviceProof);
    await expect(broker.models(connected.auth)).rejects.toMatchObject({ status: 401 });
    await expect(broker.models({ credential: refreshed.device_credential, deviceProof: connected.auth.deviceProof })).resolves.toMatchObject({ object: 'list' });
  });

  it('enforces invite, grant, and credential expiry', async () => {
    const expiredInvite = fixture();
    const invite = await expiredInvite.broker.issueInvite({ recipientLabel: 'Expires', inviteTtlMs: 1_000 });
    expiredInvite.advance(1_001);
    await expect(redeem(expiredInvite.broker, invite.inviteToken)).rejects.toMatchObject({ status: 410 });

    const expiredCredential = fixture();
    const connected = await grant(expiredCredential.broker);
    expiredCredential.advance(60 * 60_000 + 1);
    await expect(expiredCredential.broker.models(connected.auth)).rejects.toMatchObject({ status: 401 });
    await expect(expiredCredential.broker.refresh(connected.redeemed.refresh_handle, connected.auth.deviceProof)).resolves.toBeDefined();
  });

  it('enforces per-device daily quota and per-device concurrency', async () => {
    let releaseUpstream!: () => void;
    const held = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: 'held' } }] })}\n\n`));
        releaseUpstream = () => { controller.enqueue(encoder.encode('data: [DONE]\n\n')); controller.close(); };
      },
    });
    let call = 0;
    const f = fixture({
      limits: { perMinute: 100, perDevicePerDay: 2, perGrantPerDay: 60, perDeviceConcurrent: 1, globalConcurrent: 2, maxOutputTokens: 4096 },
      fetchImpl: async () => ++call === 1 ? new Response(held, { headers: { 'X-VibeX-Backend-Model': 'deepseek-v4-flash' } }) : sse(),
    });
    const connected = await grant(f.broker);
    const first = await f.broker.chat(connected.auth, chatBody);
    await expect(f.broker.chat(connected.auth, chatBody)).rejects.toMatchObject({ code: 'device_concurrency_exceeded' });
    releaseUpstream();
    await first.text();
    await (await f.broker.chat(connected.auth, chatBody)).text();
    await expect(f.broker.chat(connected.auth, chatBody)).rejects.toMatchObject({ code: 'device_daily_quota_exceeded' });
  });

  it('enforces independent minute and grant-day quotas before inference', async () => {
    let minuteCalls = 0;
    const minute = fixture({
      limits: { perMinute: 1, perDevicePerDay: 20, perGrantPerDay: 60, perDeviceConcurrent: 1, globalConcurrent: 2, maxOutputTokens: 4096 },
      fetchImpl: async () => { minuteCalls += 1; return sse(); },
    });
    const minuteGrant = await grant(minute.broker);
    await (await minute.broker.chat(minuteGrant.auth, chatBody)).text();
    await expect(minute.broker.chat(minuteGrant.auth, chatBody)).rejects.toMatchObject({ code: 'minute_quota_exceeded' });
    expect(minuteCalls).toBe(1);

    let grantCalls = 0;
    const daily = fixture({
      limits: { perMinute: 100, perDevicePerDay: 20, perGrantPerDay: 1, perDeviceConcurrent: 1, globalConcurrent: 2, maxOutputTokens: 4096 },
      fetchImpl: async () => { grantCalls += 1; return sse(); },
    });
    const dailyGrant = await grant(daily.broker);
    await (await daily.broker.chat(dailyGrant.auth, chatBody)).text();
    await expect(daily.broker.chat(dailyGrant.auth, chatBody)).rejects.toMatchObject({ code: 'grant_daily_quota_exceeded' });
    expect(grantCalls).toBe(1);
  });

  it('releases concurrency on client cancellation and blocks the next request after mid-stream revocation', async () => {
    let upstreamCancelled = false;
    let call = 0;
    const held = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: 'partial' } }] })}\n\n`));
      },
      cancel() { upstreamCancelled = true; },
    });
    const f = fixture({
      limits: { perMinute: 100, perDevicePerDay: 20, perGrantPerDay: 60, perDeviceConcurrent: 1, globalConcurrent: 1, maxOutputTokens: 4096 },
      fetchImpl: async () => ++call === 1
        ? new Response(held, { headers: { 'X-VibeX-Backend-Model': 'deepseek-v4-flash' } })
        : sse(),
    });
    const connected = await grant(f.broker);
    const active = await f.broker.chat(connected.auth, chatBody);
    await f.broker.revoke(connected.auth);
    await expect(f.broker.chat(connected.auth, chatBody)).rejects.toMatchObject({ code: 'invalid_credentials' });
    await active.body!.cancel('synthetic client disconnect');
    expect(upstreamCancelled).toBe(true);
    const replacement = await grant(f.broker, 'replacement', 'Q'.repeat(43), 'Q'.repeat(32));
    await expect((await f.broker.chat(replacement.auth, chatBody)).text()).resolves.toContain('[DONE]');
  });

  it('enforces the pilot-wide concurrency cap across devices', async () => {
    const controllers: ReadableStreamDefaultController<Uint8Array>[] = [];
    const f = fixture({
      fetchImpl: async () => new Response(new ReadableStream<Uint8Array>({ start(controller) {
        controllers.push(controller);
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: 'held' } }] })}\n\n`));
      } }), { headers: { 'X-VibeX-Backend-Model': 'deepseek-v4-flash' } }),
    });
    const grants = await Promise.all([
      grant(f.broker, 'one', '1'.repeat(43), '1'.repeat(32)),
      grant(f.broker, 'two', '2'.repeat(43), '2'.repeat(32)),
      grant(f.broker, 'three', '3'.repeat(43), '3'.repeat(32)),
    ]);
    const active = await Promise.all([f.broker.chat(grants[0].auth, chatBody), f.broker.chat(grants[1].auth, chatBody)]);
    await expect(f.broker.chat(grants[2].auth, chatBody)).rejects.toMatchObject({ code: 'global_concurrency_exceeded' });
    controllers.forEach((controller) => { controller.enqueue(encoder.encode('data: [DONE]\n\n')); controller.close(); });
    await Promise.all(active.map((response) => response.text()));
  });

  it.each([
    ['non-allowlisted model', { ...chatBody, model: 'arbitrary-model' }, 'model_not_allowed'],
    ['tools', { ...chatBody, tools: [{ type: 'function' }] }, 'unsupported_field'],
    ['remote media content', { ...chatBody, messages: [{ role: 'user', content: [{ type: 'image_url', image_url: { url: 'https://evil.example' } }] }] }, 'invalid_messages'],
    ['client origin', { ...chatBody, upstream_url: 'https://evil.example' }, 'unsupported_field'],
    ['image route field', { ...chatBody, image: 'data:image/png;base64,AAAA' }, 'unsupported_field'],
    ['excess output', { ...chatBody, max_tokens: 4097 }, 'max_tokens_exceeded'],
  ])('rejects %s before inference', (_name, body, code) => {
    expect(() => validateChatBody(body, ['deepseek-v4-flash'])).toThrowError(expect.objectContaining({ code }));
  });

  it('fails closed on empty, malformed, unterminated, and unapproved-backend streams', async () => {
    const cases: [string, () => Response][] = [
      ['empty_upstream_stream', () => new Response('data: [DONE]\n\n', { headers: { 'X-VibeX-Backend-Model': 'deepseek-v4-flash' } })],
      ['malformed_upstream_stream', () => new Response('data: not-json\n\n', { headers: { 'X-VibeX-Backend-Model': 'deepseek-v4-flash' } })],
      ['unterminated_upstream_stream', () => new Response(`data: ${JSON.stringify({ choices: [{ delta: { content: 'partial' } }] })}\n\n`, { headers: { 'X-VibeX-Backend-Model': 'deepseek-v4-flash' } })],
      ['unapproved_backend_label', () => sse('content', 'internal-hostname/model')],
    ];
    for (const [code, response] of cases) {
      const f = fixture({ fetchImpl: async () => response() });
      const connected = await grant(f.broker);
      try {
        const result = await f.broker.chat(connected.auth, chatBody);
        await result.text();
        throw new Error('Expected stream rejection.');
      } catch (error) {
        expect(error).toBeInstanceOf(BrokerError);
        expect(error).toMatchObject({ code });
      }
    }
  });

  it('rejects query-bearing API requests instead of treating them as approved routes', async () => {
    const { broker } = fixture();
    const server = createBrokerServer(broker);
    openServers.push(server);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const response = await fetch(`${base}/v1/models?upstream=https://evil.example`);
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: { code: 'query_not_allowed' } });
  });

  it('rejects wrong content types and oversized HTTP bodies before broker dispatch', async () => {
    const { broker } = fixture();
    const server = createBrokerServer(broker);
    openServers.push(server);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1/private-model-invites/redeem`;
    const wrongType = await fetch(base, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: '{}' });
    expect(wrongType.status).toBe(415);
    expect(await wrongType.json()).toMatchObject({ error: { code: 'json_required' } });

    const oversized = await fetch(base, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ padding: 'x'.repeat(1024 * 1024) }),
    });
    expect(oversized.status).toBe(413);
    expect(await oversized.json()).toMatchObject({ error: { code: 'body_too_large' } });
  });
});
