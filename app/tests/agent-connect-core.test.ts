import { describe, expect, it } from 'vitest';

import {
  AgentConnectCore,
  MAX_MCP_REQUESTS_PER_MINUTE,
  MAX_PAIR_REQUESTS_PER_MINUTE,
  MAX_REQUEST_BODY_BYTES,
  type AgentCredentialStore,
  type AgentMetadataStore,
  type ConnectHttpRequest,
} from '@/lib/agent-connect/core';

class MemoryMetadata implements AgentMetadataStore {
  value = '[]';
  async load() { return this.value; }
  async save(value: string) { this.value = value; }
}

class MemoryCredentials implements AgentCredentialStore {
  values = new Map<string, string>();
  async get(id: string) { return this.values.get(id) ?? null; }
  async set(id: string, value: string) { this.values.set(id, value); }
  async remove(id: string) { this.values.delete(id); }
}

const request = (path: string, body: unknown, token?: string, remoteAddress = '192.168.1.10'): ConnectHttpRequest => ({
  method: 'POST',
  path,
  headers: token ? { authorization: `Bearer ${token}` } : {},
  body: typeof body === 'string' ? body : JSON.stringify(body),
  remoteAddress,
});

function harness(initialNow = 1_800_000_000_000) {
  const metadata = new MemoryMetadata();
  const credentials = new MemoryCredentials();
  let sequence = 0;
  let currentNow = initialNow;
  const core = new AgentConnectCore({
    now: () => currentNow,
    randomHex: (bytes) => `${String(++sequence).padStart(2, '0')}`.repeat(bytes).slice(0, bytes * 2),
    metadata,
    credentials,
    tools: [{
      name: 'explode',
      description: 'throws for error framing',
      inputSchema: { type: 'object' },
      handler: async () => { throw new Error('controlled failure'); },
    }],
  });
  return { core, metadata, credentials, advance: (ms: number) => { currentNow += ms; } };
}

async function pair(core: AgentConnectCore) {
  const ticket = core.issueTicket();
  const responsePromise = core.route(request('/pair', { code: ticket.code, agentName: 'Hermes' }));
  expect(core.pendingApproval?.agentName).toBe('Hermes');
  await core.resolveApproval(true);
  const response = await responsePromise;
  return JSON.parse(response.body).token as string;
}

describe('pairing and credential security', () => {
  it('uses a single-use 15-minute ticket and requires confirm-on-device approval', async () => {
    const { core } = harness();
    const ticket = core.issueTicket();
    expect(ticket.expiresAt - ticket.createdAt).toBe(15 * 60_000);

    const pending = core.route(request('/pair', { code: ticket.code, agentName: 'Codex' }));
    expect(core.pendingApproval).toMatchObject({ agentName: 'Codex', remoteAddress: '192.168.1.10' });
    await core.resolveApproval(false);
    expect((await pending).status).toBe(403);

    const retry = core.route(request('/pair', { code: ticket.code, agentName: 'Codex' }));
    await core.resolveApproval(true);
    expect((await retry).status).toBe(200);
    expect((await core.route(request('/pair', { code: ticket.code, agentName: 'Again' }))).status).toBe(410);
  });

  it('rejects an expired ticket', async () => {
    const { core, advance } = harness();
    const ticket = core.issueTicket();
    advance(15 * 60_000 + 1);
    expect((await core.route(request('/pair', { code: ticket.code, agentName: 'Late' }))).status).toBe(410);
  });

  it('keeps bearer credentials out of metadata and revokes them on unlink', async () => {
    const { core, metadata, credentials } = harness();
    const token = await pair(core);
    expect(metadata.value).not.toContain(token);
    expect([...credentials.values.values()]).toContain(token);

    const agentId = core.agents[0].id;
    await core.revokeAgent(agentId);
    expect(credentials.values.size).toBe(0);
    expect((await core.route(request('/mcp', { jsonrpc: '2.0', id: 1, method: 'ping' }, token))).status).toBe(401);
  });

  it('fixes the authoritative request body cap at exactly 256 KiB', async () => {
    expect(MAX_REQUEST_BODY_BYTES).toBe(256 * 1024);
    const { core } = harness();
    expect((await core.route(request('/pair', 'x'.repeat(MAX_REQUEST_BODY_BYTES + 1)))).status).toBe(413);
  });

  it('rate-limits pairing attempts per remote address', async () => {
    const { core } = harness();
    for (let index = 0; index < MAX_PAIR_REQUESTS_PER_MINUTE; index++) {
      expect((await core.route(request('/pair', { code: 'invalid' }))).status).toBe(410);
    }
    expect((await core.route(request('/pair', { code: 'invalid' }))).status).toBe(429);
  });
});

describe('authenticated MCP streamable HTTP subset', () => {
  it('supports initialize, ping, tools/list, notifications, and HTTP-200 tool errors', async () => {
    const { core } = harness();
    const token = await pair(core);
    const call = (body: unknown) => core.route(request('/mcp', body, token));

    expect(JSON.parse((await call({ jsonrpc: '2.0', id: 1, method: 'initialize' })).body).result.protocolVersion).toBe('2025-06-18');
    expect(JSON.parse((await call({ jsonrpc: '2.0', id: 2, method: 'ping' })).body).result).toEqual({});
    expect(JSON.parse((await call({ jsonrpc: '2.0', id: 3, method: 'tools/list' })).body).result.tools[0].name).toBe('explode');
    expect((await call({ jsonrpc: '2.0', method: 'notifications/initialized' })).status).toBe(202);

    const failed = await call({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'explode', arguments: {} } });
    expect(failed.status).toBe(200);
    expect(JSON.parse(failed.body).result).toMatchObject({ isError: true });
  });

  it('updates lastSeen only after authentication and not for rejected requests', async () => {
    const { core, advance } = harness();
    const token = await pair(core);
    const pairedAt = core.agents[0].pairedAt;
    expect(core.agents[0].lastSeenAt).toBeUndefined();
    advance(1_000);
    expect((await core.route(request('/mcp', { jsonrpc: '2.0', id: 1, method: 'ping' }, 'wrong'))).status).toBe(401);
    expect(core.agents[0].lastSeenAt).toBeUndefined();
    expect((await core.route(request('/mcp', { jsonrpc: '2.0', id: 2, method: 'ping' }, token))).status).toBe(200);
    expect(core.agents[0].lastSeenAt).not.toBe(pairedAt);
  });

  it('rate-limits authenticated MCP traffic', async () => {
    const { core } = harness();
    const token = await pair(core);
    for (let index = 0; index < MAX_MCP_REQUESTS_PER_MINUTE; index++) {
      expect((await core.route(request('/mcp', { jsonrpc: '2.0', id: index, method: 'ping' }, token))).status).toBe(200);
    }
    expect((await core.route(request('/mcp', { jsonrpc: '2.0', id: 999, method: 'ping' }, token))).status).toBe(429);
  });

  it('rejects missing auth', async () => {
    const { core } = harness();
    expect((await core.route(request('/mcp', { jsonrpc: '2.0', id: 1, method: 'ping' }))).status).toBe(401);
  });
});
