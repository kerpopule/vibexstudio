import { getRandomBytes } from 'expo-crypto';
import * as Network from 'expo-network';
import { AppState } from 'react-native';

import { AGENT_CONNECT_PORT, AgentConnectCore } from '@/lib/agent-connect/core';
import { startLocalHttpServer, type LocalHttpServer } from '@/lib/agent-connect/http-server';
import { agentCredentialStore, agentMetadataStore } from '@/lib/agent-connect/persistence';
import { projectConnectTools } from '@/lib/agent-connect/tools';

export interface AgentConnectSnapshot {
  supported: boolean;
  running: boolean;
  host: string | null;
  error: string | null;
}

type Listener = () => void;

function randomHex(bytes: number): string {
  return Array.from(getRandomBytes(bytes), (value) => value.toString(16).padStart(2, '0')).join('');
}

class NativeAgentConnectRuntime {
  readonly core = new AgentConnectCore({
    metadata: agentMetadataStore,
    credentials: agentCredentialStore,
    tools: projectConnectTools,
    randomHex,
  });

  private state: AgentConnectSnapshot = { supported: true, running: false, host: null, error: null };
  private readonly listeners = new Set<Listener>();
  private server: LocalHttpServer | null = null;
  private startPromise: Promise<void> | null = null;
  private initialized = false;

  constructor() {
    this.core.subscribe(() => this.notify());
  }

  snapshot = (): AgentConnectSnapshot => this.state;

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  private notify(): void {
    for (const listener of this.listeners) listener();
  }

  private setState(next: Partial<AgentConnectSnapshot>): void {
    this.state = { ...this.state, ...next };
    this.notify();
  }

  async initialize(): Promise<void> {
    if (!this.initialized) {
      this.initialized = true;
      AppState.addEventListener('change', (next) => {
        if (next === 'active') void this.start();
        else this.stop();
      });
    }
    await this.core.load();
    await this.start();
  }

  async start(): Promise<void> {
    if (this.server || AppState.currentState !== 'active') return;
    if (this.startPromise) return this.startPromise;
    this.startPromise = this.startInternal().finally(() => {
      this.startPromise = null;
    });
    return this.startPromise;
  }

  private async startInternal(): Promise<void> {
    try {
      const host = await Network.getIpAddressAsync();
      if (!/^\d{1,3}(?:\.\d{1,3}){3}$/.test(host) || host === '0.0.0.0' || host.startsWith('127.')) {
        throw new Error('Join Wi-Fi so VibeXStudio can advertise a reachable LAN address.');
      }
      const server = await startLocalHttpServer(AGENT_CONNECT_PORT, (request) => this.core.route(request));
      if (AppState.currentState !== 'active') {
        server.close();
        return;
      }
      this.server = server;
      this.setState({ running: true, host, error: null });
    } catch (error) {
      this.server = null;
      this.setState({
        running: false,
        error: error instanceof Error ? error.message : 'The on-device MCP server could not start.',
      });
    }
  }

  stop(): void {
    this.server?.close();
    this.server = null;
    void this.core.resolveApproval(false);
    this.setState({ running: false });
  }
}

export const agentConnectRuntime = new NativeAgentConnectRuntime();
