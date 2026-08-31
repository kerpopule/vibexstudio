import { AgentConnectCore, type AgentCredentialStore, type AgentMetadataStore } from '@/lib/agent-connect/core';

export interface AgentConnectSnapshot {
  supported: boolean;
  running: boolean;
  host: string | null;
  error: string | null;
}

const metadata: AgentMetadataStore = {
  async load() { return null; },
  async save() { throw new Error('unsupported'); },
};
const credentials: AgentCredentialStore = {
  async get() { return null; },
  async set() { throw new Error('unsupported'); },
  async remove() {},
};

class UnsupportedAgentConnectRuntime {
  readonly core = new AgentConnectCore({ metadata, credentials, tools: [] });
  private readonly state: AgentConnectSnapshot = {
    supported: false,
    running: false,
    host: null,
    error: 'Agent Connect requires an installed native VibeXStudio build. It is unavailable on web.',
  };

  snapshot = () => this.state;
  subscribe = (_listener: () => void) => () => {};
  async initialize() {}
  async start() {}
  stop() {}
}

export const agentConnectRuntime = new UnsupportedAgentConnectRuntime();
