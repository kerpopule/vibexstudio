import type { AgentCredentialStore, AgentMetadataStore } from '@/lib/agent-connect/core';

/** Web builds show an unsupported state and never persist pairing material. */
export const agentMetadataStore: AgentMetadataStore = {
  async load() { return null; },
  async save() { throw new Error('On-device agent connect is unavailable in web builds.'); },
};

export const agentCredentialStore: AgentCredentialStore = {
  async get() { return null; },
  async set() { throw new Error('On-device agent connect is unavailable in web builds.'); },
  async remove() {},
};
