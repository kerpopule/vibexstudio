export const AGENT_CONNECT_PORT = 8791;
export const PAIRING_TTL_MS = 15 * 60_000;
export const MAX_REQUEST_BODY_BYTES = 256 * 1024;
export const MAX_PAIR_REQUESTS_PER_MINUTE = 10;
export const MAX_MCP_REQUESTS_PER_MINUTE = 120;
export const AGENT_CREDENTIAL_TIMEOUT_MS = 8_000;
export const PAIRING_APPROVAL_TIMEOUT_MS = 90_000;
export const MCP_PROTOCOL_VERSION = '2025-06-18';

export interface PairingTicket {
  code: string;
  createdAt: number;
  expiresAt: number;
  redeemed: boolean;
}

export interface PairedAgent {
  mediaRead?: boolean;
  mediaImport?: boolean;
  mediaBackground?: boolean;
  mediaGenerate?: boolean;
  mediaEdit?: boolean;
  mediaRender?: boolean;
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
  requiredPermission?: 'mediaRead' | 'mediaImport' | 'mediaBackground' | 'mediaGenerate' | 'mediaEdit' | 'mediaRender';
  requiredPermissions?: ('mediaRead' | 'mediaImport' | 'mediaBackground' | 'mediaGenerate' | 'mediaEdit' | 'mediaRender')[];
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
  private readonly pairingRequests = new Set<string>();
  private readonly rateBuckets = new Map<string, RateBucket>();
  private readonly listeners = new Set<Listener>();
  private approvalResolution: ((decision: {approved:boolean; mediaRead:boolean; mediaImport:boolean; mediaBackground:boolean; mediaGenerate:boolean; mediaEdit:boolean; mediaRender:boolean}) => void) | null = null;
  private approvalTimer: ReturnType<typeof setTimeout> | null = null;
  private loaded = false;
  private metadataWrites: Promise<void> = Promise.resolve();
  private credentialReads = new Map<string,Promise<string|null>>();

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
          mediaRead: value.mediaRead === true,
          mediaImport: value.mediaImport === true,
          mediaBackground: value.mediaBackground === true,
          mediaGenerate: value.mediaGenerate === true,
          mediaEdit: value.mediaEdit === true,
          mediaRender: value.mediaRender === true,
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

  private persistAgents(): Promise<void> {
    // Serialize writes and take the snapshot when the write starts. An older
    // request must not overwrite a later unlink with stale grant metadata.
    const writing = this.metadataWrites.then(() => this.metadata.save(JSON.stringify(this.agents)));
    this.metadataWrites = writing.catch(() => {});
    return writing;
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

  async resolveApproval(approved: boolean, mediaRead = false, mediaImport = false, mediaBackground = false, mediaEdit = false, mediaRender = false, mediaGenerate = false): Promise<void> {
    const resolve = this.approvalResolution;
    if (!resolve) return;
    if (this.approvalTimer) clearTimeout(this.approvalTimer);
    this.approvalTimer = null;
    this.approvalResolution = null;
    this.pendingApproval = null;
    this.notify();
    resolve({approved, mediaRead: approved && (mediaRead || mediaImport || mediaBackground || mediaGenerate || mediaEdit || mediaRender), mediaImport: approved && mediaImport, mediaBackground: approved && mediaBackground, mediaGenerate: approved && mediaGenerate, mediaEdit: approved && mediaEdit, mediaRender: approved && mediaRender});
  }

  async revokeAgent(agentId: string): Promise<{ credentialCleanupPending: boolean }> {
    const agent = this.agents.find((item) => item.id === agentId);
    if (!agent) return { credentialCleanupPending: false };
    this.agents = this.agents.filter((item) => item.id !== agentId);
    this.notify();
    try {
      await this.persistAgents();
    } catch {
      // Only restore this grant if its removal could not be saved. Never
      // restore an old array that might contain other concurrently unlinked agents.
      this.agents = [...this.agents, agent];
      this.notify();
      throw new Error('Could not save the unlink. The agent is still linked. Check device storage and try again.');
    }
    // Metadata is the authorization list. A leftover vault entry cannot grant
    // access and must never cause a successfully saved revocation to roll back.
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        Promise.resolve().then(() => this.credentials.remove(agentId)),
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(() => reject(new Error('Credential cleanup timed out')), AGENT_CREDENTIAL_TIMEOUT_MS);
        }),
      ]);
      return { credentialCleanupPending: false };
    } catch {
      return { credentialCleanupPending: true };
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
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
    if (!body || typeof body !== 'object' || Array.isArray(body)) return json(400, { error: 'invalid pairing request' });
    const code = typeof body.code === 'string' ? body.code : '';
    const ticket = this.tickets.get(code);
    if (!ticket || ticket.redeemed || ticket.expiresAt <= this.now()) {
      return json(410, { error: 'code invalid, used, or expired; create a fresh invite in VibeXStudio' });
    }
    if (this.pendingApproval || this.pairingRequests.has(code)) return json(429, { error: 'another pairing request is awaiting approval or being saved' });

    this.pairingRequests.add(code);
    try {
      const decision = await new Promise<{approved:boolean; mediaRead:boolean; mediaImport:boolean; mediaBackground:boolean; mediaGenerate:boolean; mediaEdit:boolean; mediaRender:boolean}>((resolve) => {
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
      if (!decision.approved) return json(403, { error: 'declined on device' });
      if (ticket.expiresAt <= this.now() || this.tickets.get(code) !== ticket) return json(410, { error: 'code expired or was replaced while awaiting approval' });
      // Consume before the first persistence await. A failed save needs a new
      // invitation and approval; no concurrent retry may redeem this ticket.
      ticket.redeemed = true;
      this.tickets.delete(code);
      if (this.activeTicket?.code === code) this.activeTicket = null;
      this.notify();

      const agent: PairedAgent = {
        mediaRead: decision.mediaRead,
        mediaImport: decision.mediaImport,
        mediaBackground: decision.mediaBackground,
        mediaGenerate: decision.mediaGenerate,
        mediaEdit: decision.mediaEdit,
        mediaRender: decision.mediaRender,
        id: this.randomHex(12),
        name: safeAgentName(body.agentName),
        pairedAt: new Date(this.now()).toISOString(),
      };
      const token = this.randomHex(32);
      const credentialWrite = Promise.resolve().then(() => this.credentials.set(agent.id, token));
      let credentialTimer: ReturnType<typeof setTimeout> | undefined;
      try {
        try {
          await Promise.race([
            credentialWrite,
            new Promise<never>((_resolve, reject) => {
              credentialTimer = setTimeout(() => reject(new Error('Credential save timed out')), AGENT_CREDENTIAL_TIMEOUT_MS);
            }),
          ]);
        } finally {
          if (credentialTimer !== undefined) clearTimeout(credentialTimer);
        }
        this.agents = [...this.agents, agent];
        await this.persistAgents();
      } catch {
        this.agents = this.agents.filter((item) => item.id !== agent.id);
        // Cleanup is best effort and cannot grant access: no token is returned.
        // If the OS finishes a timed-out write later, delete only after that
        // write settles. Its completion cannot resume pairing or return a token.
        void credentialWrite.catch(() => {}).then(() => this.credentials.remove(agent.id)).catch(() => {});
        this.notify();
        return json(503, { error: 'Studio could not save this connection. Check device storage and secure-vault access, then create a fresh invite and approve again.' });
      }
      this.notify();
      return json(200, {
        token,
        mcp_url: '/mcp',
        note: 'Store this secret once and send it as an Authorization Bearer token on every MCP request.',
      });
    } finally {
      this.pairingRequests.delete(code);
    }
  }

  private readCredential(id:string):Promise<string|null>{
    const existing=this.credentialReads.get(id);if(existing)return existing;
    const reading=Promise.resolve().then(()=>this.credentials.get(id)).finally(()=>{
      if(this.credentialReads.get(id)===reading)this.credentialReads.delete(id);
    });
    this.credentialReads.set(id,reading);return reading;
  }

  private async authenticate(request: ConnectHttpRequest, expired:()=>boolean): Promise<PairedAgent | null> {
    const authorization = request.headers.authorization ?? request.headers.Authorization ?? '';
    const match = authorization.match(/^Bearer\s+(.+)$/i);
    if (!match) return null;
    const supplied = match[1].trim();
    if(!supplied||supplied.length>256)return null;
    for (const agent of this.agents) {
      if(expired())return null;
      const expected = await this.readCredential(agent.id);
      if(expired())return null;
      if (expected && tokensEqual(expected, supplied) && this.agents.some(current=>current.id===agent.id)) return agent;
    }
    return null;
  }

  private async handleMcp(request: ConnectHttpRequest): Promise<ConnectHttpResponse> {
    let expired=false;
    let timer:ReturnType<typeof setTimeout>|undefined;
    let agent:PairedAgent|null;
    try{
      agent=await Promise.race([
        this.authenticate(request,()=>expired),
        new Promise<never>((_resolve,reject)=>{timer=setTimeout(()=>{expired=true;reject(new Error('Credential read timed out'));},AGENT_CREDENTIAL_TIMEOUT_MS);}),
      ]);
    }catch{
      expired=true;
      return json(503,{error:'Studio could not read agent credentials. Unlock the device and check for an operating-system credential approval prompt, then retry. No tool was run.'});
    }finally{if(timer!==undefined)clearTimeout(timer);}
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
    if (!this.agents.some(current => current.id === agent.id)) {
      return json(401, { error: 'missing, unknown, or revoked bearer token' });
    }

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
        tools: Array.from(this.tools.values()).filter((tool) => (!tool.requiredPermission || agent[tool.requiredPermission] === true) && (tool.requiredPermissions ?? []).every(permission => agent[permission] === true)).map(({name, description, inputSchema}) => ({name, description, inputSchema})),
      });
    }
    if (message.method === 'tools/call') {
      const name = typeof message.params?.name === 'string' ? message.params.name : '';
      const tool = this.tools.get(name);
      const missingPermission=tool && [tool.requiredPermission,...(tool.requiredPermissions ?? [])].find(permission => permission && agent[permission] !== true);
      if (missingPermission) {
        const permission=missingPermission==='mediaGenerate' ? 'media-generation' : missingPermission==='mediaRender' ? 'video-rendering' : missingPermission==='mediaEdit' ? 'media-editing' : missingPermission==='mediaBackground' ? 'background-removal' : missingPermission==='mediaImport' ? 'media-import' : 'media-library';
        return rpcError(-32602, `This tool requires separate ${permission} approval. Unlink and pair again with that permission.`);
      }
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
