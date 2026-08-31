export const AGENT_CONNECT_PORT = 8791;
export const PAIRING_TTL_MS = 15 * 60_000;
export const MAX_REQUEST_BODY_BYTES = 256 * 1024;
export const MAX_PAIR_REQUESTS_PER_MINUTE = 10;
export const MAX_MCP_REQUESTS_PER_MINUTE = 120;
export const PAIRING_APPROVAL_TIMEOUT_MS = 90_000;
export const MCP_PROTOCOL_VERSION = '2025-06-18';

export interface PairingTicket {
  code: string;
  createdAt: number;
  expiresAt: number;
  redeemed: boolean;
}

export interface PairedAgent {
  id: string;
  name: string;
  pairedAt: string;
  lastSeenAt?: string;
  clientInfo?: { name?: string; version?: string };
}

export interface PendingApproval {
  code: string;
  agentName: string;
  remoteAddress: string;
}

export interface AgentMetadataStore {
  load(): Promise<string | null>;
  save(value: string): Promise<void>;
}

export interface AgentCredentialStore {
  get(agentId: string): Promise<string | null>;
  set(agentId: string, value: string): Promise<void>;
  remove(agentId: string): Promise<void>;
}

export interface ConnectTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  handler: (args: Record<string, unknown>, agent: PairedAgent) => Promise<unknown> | unknown;
}

export interface ConnectHttpRequest {
  method: string;
  path: string;
  headers: Record<string, string>;
  body: string;
  remoteAddress: string;
}

export interface ConnectHttpResponse {
  status: number;
  headers?: Record<string, string>;
  body: string;
}

interface JsonRpcRequest {
  jsonrpc: '2.0';
  id?: number | string | null;
  method: string;
  params?: Record<string, unknown>;
}

interface CoreOptions {
  metadata: AgentMetadataStore;
  credentials: AgentCredentialStore;
  tools: ConnectTool[];
  now?: () => number;
  randomHex?: (bytes: number) => string;
  approvalTimeoutMs?: number;
}

type Listener = () => void;

interface RateBucket {
  windowStartedAt: number;
  count: number;
}

function defaultRandomHex(bytes: number): string {
  const values = new Uint8Array(bytes);
  globalThis.crypto.getRandomValues(values);
  return Array.from(values, (value) => value.toString(16).padStart(2, '0')).join('');
}

function utf8Bytes(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function json(status: number, value: unknown): ConnectHttpResponse {
  return {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    body: JSON.stringify(value),
  };
}

function safeAgentName(value: unknown): string {
  if (typeof value !== 'string') return 'Unnamed agent';
  const normalized = value.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 80);
  return normalized || 'Unnamed agent';
}

function tokensEqual(left: string, right: string): boolean {
  const length = Math.max(left.length, right.length);
  let difference = left.length ^ right.length;
  for (let index = 0; index < length; index++) {
    difference |= (left.charCodeAt(index) || 0) ^ (right.charCodeAt(index) || 0);
  }
  return difference === 0;
}

export class AgentConnectCore {
  agents: PairedAgent[] = [];
  activeTicket: PairingTicket | null = null;
  pendingApproval: PendingApproval | null = null;

  private readonly metadata: AgentMetadataStore;
  private readonly credentials: AgentCredentialStore;
  private readonly tools = new Map<string, ConnectTool>();
  private readonly now: () => number;
  private readonly randomHex: (bytes: number) => string;
  private readonly approvalTimeoutMs: number;
  private readonly tickets = new Map<string, PairingTicket>();
  private readonly rateBuckets = new Map<string, RateBucket>();
  private readonly listeners = new Set<Listener>();
  private approvalResolution: ((approved: boolean) => void) | null = null;
  private approvalTimer: ReturnType<typeof setTimeout> | null = null;
  private loaded = false;

  constructor(options: CoreOptions) {
    this.metadata = options.metadata;
    this.credentials = options.credentials;
    this.now = options.now ?? Date.now;
    this.randomHex = options.randomHex ?? defaultRandomHex;
    this.approvalTimeoutMs = options.approvalTimeoutMs ?? PAIRING_APPROVAL_TIMEOUT_MS;
    for (const tool of options.tools) this.tools.set(tool.name, tool);
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify(): void {
    for (const listener of this.listeners) listener();
  }

  async load(): Promise<void> {
    if (this.loaded) return;
    this.loaded = true;
    try {
      const raw = await this.metadata.load();
      if (!raw) return;
      const parsed: unknown = JSON.parse(raw);
      if (!Array.isArray(parsed)) return;
      this.agents = parsed.flatMap((candidate): PairedAgent[] => {
        if (!candidate || typeof candidate !== 'object') return [];
        const value = candidate as Record<string, unknown>;
        if (typeof value.id !== 'string' || typeof value.name !== 'string' || typeof value.pairedAt !== 'string') return [];
        return [{
          id: value.id,
          name: safeAgentName(value.name),
          pairedAt: value.pairedAt,
          lastSeenAt: typeof value.lastSeenAt === 'string' ? value.lastSeenAt : undefined,
          clientInfo: value.clientInfo && typeof value.clientInfo === 'object'
            ? value.clientInfo as PairedAgent['clientInfo']
            : undefined,
        }];
      });
    } catch {
      this.agents = [];
    } finally {
      this.notify();
    }
  }

  private async persistAgents(): Promise<void> {
    await this.metadata.save(JSON.stringify(this.agents));
  }

  issueTicket(): PairingTicket {
    const now = this.now();
    if (this.activeTicket && !this.activeTicket.redeemed && this.activeTicket.expiresAt > now) {
      return this.activeTicket;
    }
    const ticket: PairingTicket = {
      code: this.randomHex(16),
      createdAt: now,
      expiresAt: now + PAIRING_TTL_MS,
      redeemed: false,
    };
    this.tickets.clear();
    this.tickets.set(ticket.code, ticket);
    this.activeTicket = ticket;
    this.notify();
    return ticket;
  }

  async resolveApproval(approved: boolean): Promise<void> {
    const resolve = this.approvalResolution;
    if (!resolve) return;
    if (this.approvalTimer) clearTimeout(this.approvalTimer);
    this.approvalTimer = null;
    this.approvalResolution = null;
    this.pendingApproval = null;
    this.notify();
    resolve(approved);
  }

  async revokeAgent(agentId: string): Promise<void> {
    const previous = this.agents;
    if (!previous.some((agent) => agent.id === agentId)) return;
    this.agents = previous.filter((agent) => agent.id !== agentId);
    try {
      await this.metadata.save(JSON.stringify(this.agents));
      await this.credentials.remove(agentId);
    } catch (error) {
      this.agents = previous;
      await this.metadata.save(JSON.stringify(previous)).catch(() => {});
      throw error;
    }
    this.notify();
  }

  async route(request: ConnectHttpRequest): Promise<ConnectHttpResponse> {
    if (utf8Bytes(request.body) > MAX_REQUEST_BODY_BYTES) {
      return json(413, { error: 'request body too large' });
    }
    const path = request.path.split('?')[0];
    if (request.method === 'GET' && path === '/health') {
      return json(200, { ok: true, app: 'vibexstudio', transport: 'local-lan' });
    }
    if (request.method === 'POST' && path === '/pair') {
      if (!this.consumeRate(`pair:${request.remoteAddress || 'unknown'}`, MAX_PAIR_REQUESTS_PER_MINUTE)) {
        return json(429, { error: 'pairing request rate limit exceeded' });
      }
      return this.handlePair(request);
    }
    if (request.method === 'POST' && path === '/mcp') {
      if (!this.consumeRate(`mcp:${request.remoteAddress || 'unknown'}`, MAX_MCP_REQUESTS_PER_MINUTE)) {
        return json(429, { error: 'MCP request rate limit exceeded' });
      }
      return this.handleMcp(request);
    }
    if (path === '/mcp') return json(405, { error: 'POST required' });
    return json(404, { error: 'not found' });
  }

  private consumeRate(key: string, limit: number): boolean {
    const now = this.now();
    const current = this.rateBuckets.get(key);
    if (!current || now - current.windowStartedAt >= 60_000) {
      if (this.rateBuckets.size > 2_048) {
        for (const [bucketKey, bucket] of this.rateBuckets) {
          if (now - bucket.windowStartedAt >= 60_000) this.rateBuckets.delete(bucketKey);
        }
      }
      this.rateBuckets.set(key, { windowStartedAt: now, count: 1 });
      return true;
    }
    current.count += 1;
    return current.count <= limit;
  }

  private async handlePair(request: ConnectHttpRequest): Promise<ConnectHttpResponse> {
    let body: Record<string, unknown>;
    try {
      body = JSON.parse(request.body || '{}') as Record<string, unknown>;
    } catch {
      return json(400, { error: 'invalid json' });
    }
    const code = typeof body.code === 'string' ? body.code : '';
    const ticket = this.tickets.get(code);
    if (!ticket || ticket.redeemed || ticket.expiresAt <= this.now()) {
      return json(410, { error: 'code invalid, used, or expired; create a fresh invite in VibeXStudio' });
    }
    if (this.pendingApproval) return json(429, { error: 'another pairing request is awaiting approval' });

    const approved = await new Promise<boolean>((resolve) => {
      this.approvalResolution = resolve;
      this.pendingApproval = {
        code,
        agentName: safeAgentName(body.agentName),
        remoteAddress: request.remoteAddress || 'unknown',
      };
      this.approvalTimer = setTimeout(() => {
        void this.resolveApproval(false);
      }, this.approvalTimeoutMs);
      this.notify();
    });
    if (!approved) return json(403, { error: 'declined on device' });
    if (ticket.expiresAt <= this.now()) return json(410, { error: 'code expired while awaiting approval' });

    const agent: PairedAgent = {
      id: this.randomHex(12),
      name: safeAgentName(body.agentName),
      pairedAt: new Date(this.now()).toISOString(),
    };
    const token = this.randomHex(32);
    try {
      await this.credentials.set(agent.id, token);
      this.agents = [...this.agents, agent];
      await this.persistAgents();
    } catch (error) {
      this.agents = this.agents.filter((item) => item.id !== agent.id);
      await this.credentials.remove(agent.id).catch(() => {});
      throw error;
    }
    ticket.redeemed = true;
    this.tickets.delete(code);
    if (this.activeTicket?.code === code) this.activeTicket = null;
    this.notify();
    return json(200, {
      token,
      mcp_url: '/mcp',
      note: 'Store this secret once and send it as an Authorization Bearer token on every MCP request.',
    });
  }

  private async authenticate(request: ConnectHttpRequest): Promise<PairedAgent | null> {
    const authorization = request.headers.authorization ?? request.headers.Authorization ?? '';
    const match = authorization.match(/^Bearer\s+(.+)$/i);
    if (!match) return null;
    const supplied = match[1].trim();
    for (const agent of this.agents) {
      const expected = await this.credentials.get(agent.id);
      if (expected && tokensEqual(expected, supplied)) return agent;
    }
    return null;
  }

  private async handleMcp(request: ConnectHttpRequest): Promise<ConnectHttpResponse> {
    const agent = await this.authenticate(request);
    if (!agent) return json(401, { error: 'missing, unknown, or revoked bearer token' });

    let message: JsonRpcRequest;
    try {
      message = JSON.parse(request.body) as JsonRpcRequest;
    } catch {
      return json(400, { error: 'invalid json' });
    }
    if (!message || message.jsonrpc !== '2.0' || typeof message.method !== 'string') {
      return json(400, { error: 'invalid JSON-RPC request' });
    }

    agent.lastSeenAt = new Date(this.now()).toISOString();
    await this.persistAgents();
    this.notify();

    if (message.id === undefined || message.id === null) {
      return { status: 202, headers: { 'Cache-Control': 'no-store' }, body: '' };
    }
    const reply = (result: unknown) => json(200, { jsonrpc: '2.0', id: message.id, result });
    const rpcError = (code: number, errorMessage: string) =>
      json(200, { jsonrpc: '2.0', id: message.id, error: { code, message: errorMessage } });

    if (message.method === 'initialize') {
      const info = message.params?.clientInfo;
      if (info && typeof info === 'object') {
        const raw = info as Record<string, unknown>;
        agent.clientInfo = {
          name: typeof raw.name === 'string' ? raw.name.slice(0, 80) : undefined,
          version: typeof raw.version === 'string' ? raw.version.slice(0, 40) : undefined,
        };
        await this.persistAgents();
      }
      return reply({
        protocolVersion: MCP_PROTOCOL_VERSION,
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: 'vibexstudio-on-device', version: '1.0.0' },
      });
    }
    if (message.method === 'ping') return reply({});
    if (message.method === 'tools/list') {
      return reply({
        tools: Array.from(this.tools.values(), ({ name, description, inputSchema }) => ({ name, description, inputSchema })),
      });
    }
    if (message.method === 'tools/call') {
      const name = typeof message.params?.name === 'string' ? message.params.name : '';
      const tool = this.tools.get(name);
      if (!tool) return rpcError(-32602, `unknown tool: ${name || '(missing)'}`);
      const args = message.params?.arguments;
      if (args !== undefined && (!args || typeof args !== 'object' || Array.isArray(args))) {
        return rpcError(-32602, 'tool arguments must be an object');
      }
      try {
        const value = await tool.handler((args ?? {}) as Record<string, unknown>, agent);
        return reply({
          content: [{ type: 'text', text: JSON.stringify(value) }],
          structuredContent: value,
          isError: false,
        });
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'tool failed';
        return reply({ content: [{ type: 'text', text: errorMessage }], isError: true });
      }
    }
    return rpcError(-32601, `method not found: ${message.method}`);
  }
}
