import { describe, expect, it } from 'vitest';

import { createProjectConnectTools } from '@/lib/agent-connect/tool-contract';
import type { PairedAgent } from '@/lib/agent-connect/core';

const agent: PairedAgent = { id: 'a1', name: 'Hermes', pairedAt: '2026-08-29T00:00:00.000Z' };

function harness() {
  const calls: { method: string; value: unknown }[] = [];
  const adapter = {
    listProjects: async () => ({ projects: [], total: 0, truncated: false }),
    getProject: async (value: unknown) => { calls.push({ method: 'getProject', value }); return {}; },
    readProjectFile: async (value: unknown) => { calls.push({ method: 'readProjectFile', value }); return {}; },
    writeProjectFiles: async (value: unknown) => { calls.push({ method: 'writeProjectFiles', value }); return {}; },
    appendProjectMessage: async (value: unknown) => { calls.push({ method: 'appendProjectMessage', value }); return {}; },
  };
  return { tools: createProjectConnectTools(adapter), calls };
}

describe('VibeX MCP project tool contract', () => {
  it('publishes exactly the required five useful tools in stable order', () => {
    const { tools } = harness();
    expect(tools.map((tool) => tool.name)).toEqual([
      'list_projects',
      'get_project',
      'read_project_file',
      'write_project_files',
      'append_project_message',
    ]);
    expect(tools.map((tool) => tool.description).join(' ')).not.toMatch(/base64|binary files are returned/i);
  });

  it('dispatches get_project', async () => {
    const { tools, calls } = harness();
    await tools[1].handler({ projectId: 'p1' }, agent);
    expect(calls).toEqual([{ method: 'getProject', value: { projectId: 'p1' } }]);
  });

  it('dispatches bounded UTF-8-only read_project_file', async () => {
    const { tools, calls } = harness();
    await tools[2].handler({ projectId: 'p1', path: 'index.html' }, agent);
    expect(calls).toEqual([{ method: 'readProjectFile', value: { projectId: 'p1', path: 'index.html' } }]);
  });

  it('dispatches atomic write_project_files with explicit overwrite semantics', async () => {
    const { tools, calls } = harness();
    const files = [{ path: 'index.html', content: 'hello' }];
    await tools[3].handler({ projectId: 'p1', overwrite: false, files }, agent);
    expect(calls).toEqual([{ method: 'writeProjectFiles', value: { projectId: 'p1', overwrite: false, files } }]);
    expect(tools[3].inputSchema).toMatchObject({ required: ['projectId', 'overwrite', 'files'] });
  });

  it('dispatches append_project_message with authenticated agent attribution', async () => {
    const { tools, calls } = harness();
    await tools[4].handler({ projectId: 'p1', message: 'Hello', status: 'info' }, agent);
    expect(calls).toEqual([{
      method: 'appendProjectMessage',
      value: { projectId: 'p1', message: 'Hello', status: 'info', agentName: 'Hermes' },
    }]);
  });
});
