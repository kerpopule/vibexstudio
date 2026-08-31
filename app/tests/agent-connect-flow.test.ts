import { describe, expect, it } from 'vitest';

import {
  AgentConnectCore,
  type AgentCredentialStore,
  type AgentMetadataStore,
  type ConnectHttpRequest,
} from '@/lib/agent-connect/core';
import { createProjectConnectTools } from '@/lib/agent-connect/tool-contract';

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

function request(path: string, body: unknown, token?: string): ConnectHttpRequest {
  return {
    method: 'POST',
    path,
    headers: token ? { authorization: `Bearer ${token}` } : {},
    body: JSON.stringify(body),
    remoteAddress: '192.168.1.50',
  };
}

describe('complete Agent Connect MCP flow', () => {
  it('pairs, approves, uses all five tools, and rejects the revoked token', async () => {
    let fileContent = '<h1>before</h1>';
    const messages: string[] = [];
    const tools = createProjectConnectTools({
      listProjects: async () => ({ projects: [{ id: 'p1', name: 'QA', emoji: '✨', updatedAt: 1 }], total: 1, truncated: false }),
      getProject: async () => ({ project: { id: 'p1', name: 'QA' }, files: [{ path: 'index.html', encoding: 'utf-8', bytes: fileContent.length }], totalBytes: fileContent.length }),
      readProjectFile: async () => ({ projectId: 'p1', path: 'index.html', encoding: 'utf-8', bytes: fileContent.length, content: fileContent }),
      writeProjectFiles: async (input) => {
        fileContent = input.files[0].content;
        return { ok: true, filesWritten: 1 };
      },
      appendProjectMessage: async (input) => {
        messages.push(input.message);
        return { ok: true, status: input.status };
      },
    });
    const metadata = new MemoryMetadata();
    const credentials = new MemoryCredentials();
    let sequence = 0;
    const core = new AgentConnectCore({
      metadata,
      credentials,
      tools,
      now: () => 1_800_000_000_000,
      randomHex: (bytes) => String(++sequence).padStart(bytes * 2, '0'),
    });

    const ticket = core.issueTicket();
    const pairing = core.route(request('/pair', { code: ticket.code, agentName: 'Synthetic LAN QA' }));
    expect(core.pendingApproval?.agentName).toBe('Synthetic LAN QA');
    await core.resolveApproval(true);
    const token = JSON.parse((await pairing).body).token as string;
    const mcp = (id: number, method: string, params?: Record<string, unknown>) =>
      core.route(request('/mcp', { jsonrpc: '2.0', id, method, params }, token));
    const callTool = async (id: number, name: string, args: Record<string, unknown>) => {
      const response = await mcp(id, 'tools/call', { name, arguments: args });
      expect(response.status).toBe(200);
      const result = JSON.parse(response.body).result;
      expect(result.isError).toBe(false);
      return result.structuredContent;
    };

    await mcp(1, 'initialize', { clientInfo: { name: 'Synthetic QA', version: '1' } });
    const listed = JSON.parse((await mcp(2, 'tools/list')).body).result.tools.map((tool: { name: string }) => tool.name);
    expect(listed).toEqual([
      'list_projects',
      'get_project',
      'read_project_file',
      'write_project_files',
      'append_project_message',
    ]);
    expect((await callTool(3, 'list_projects', {})).projects[0].id).toBe('p1');
    expect((await callTool(4, 'get_project', { projectId: 'p1' })).files[0].path).toBe('index.html');
    expect((await callTool(5, 'read_project_file', { projectId: 'p1', path: 'index.html' })).content).toContain('before');
    await callTool(6, 'write_project_files', {
      projectId: 'p1', overwrite: true, files: [{ path: 'index.html', content: '<h1>after</h1>' }],
    });
    await callTool(7, 'append_project_message', {
      projectId: 'p1', message: 'Synthetic flow complete.', status: 'completed',
    });
    expect(fileContent).toContain('after');
    expect(messages).toEqual(['Synthetic flow complete.']);

    await core.revokeAgent(core.agents[0].id);
    expect((await mcp(8, 'ping')).status).toBe(401);
  });
});
