import { describe, expect, it } from 'vitest';

import {
  MAX_AGENT_READ_BYTES,
  ProjectAgentAdapter,
  type ProjectAgentRepository,
} from '@/lib/agent-connect/project-adapter';
import type { ChatMessage, ProjectFile, ProjectMeta } from '@/lib/types';

class MemoryRepo implements ProjectAgentRepository {
  projects: ProjectMeta[] = [{ id: 'p1', name: 'One', emoji: '✨', description: 'Demo', createdAt: 1, updatedAt: 2 }];
  files = new Map<string, ProjectFile>([
    ['p1:index.html', { path: 'index.html', content: '<h1>old</h1>', encoding: 'utf-8' }],
    ['p1:assets/logo.png', { path: 'assets/logo.png', content: 'aGVsbG8=', encoding: 'base64' }],
  ]);
  messages: ChatMessage[] = [];
  writes: string[] = [];
  refreshes = 0;
  chatRefreshes = 0;
  failPath: string | null = null;
  escapedPath: string | null = null;

  async listProjects() { return this.projects; }
  async listFileManifest(projectId: string) {
    return [...this.files.entries()]
      .filter(([key]) => key.startsWith(`${projectId}:`))
      .map(([, file]) => ({
        path: file.path,
        encoding: file.encoding === 'base64' ? 'base64' as const : 'utf-8' as const,
        bytes: file.encoding === 'base64' ? 5 : new TextEncoder().encode(file.content).byteLength,
      }));
  }
  async getFileInfo(projectId: string, path: string) {
    const file = this.files.get(`${projectId}:${path}`);
    if (!file) return null;
    return {
      path,
      encoding: file.encoding === 'base64' ? 'base64' as const : 'utf-8' as const,
      bytes: file.encoding === 'base64' ? 5 : new TextEncoder().encode(file.content).byteLength,
    };
  }
  async readFile(projectId: string, path: string) { return this.files.get(`${projectId}:${path}`)?.content ?? null; }
  async writeFile(projectId: string, path: string, content: string) {
    this.writes.push(path);
    if (path === this.failPath) throw new Error('disk full');
    this.files.set(`${projectId}:${path}`, { path, content, encoding: 'utf-8' });
  }
  async deleteFile(projectId: string, path: string) { this.files.delete(`${projectId}:${path}`); }
  async appendMessage(_projectId: string, message: ChatMessage) { this.messages.push(message); }
  async removeMessage(_projectId: string, messageId: string) {
    this.messages = this.messages.filter((message) => message.id !== messageId);
  }
  async refreshProjects() { this.refreshes++; }
  async refreshChat() { this.chatRefreshes++; }
  async assertPathContained(_projectId: string, path: string) {
    if (path === this.escapedPath) throw new Error('Project path resolves outside the project root.');
  }
}

const createAdapter = (repo = new MemoryRepo()) => ({
  repo,
  adapter: new ProjectAgentAdapter(repo, { now: () => 1234, newId: () => 'agent-message-1' }),
});

describe('agent project adapter', () => {
  it('lists bounded summaries and gets bounded metadata plus a content-free manifest', async () => {
    const { adapter } = createAdapter();
    expect(await adapter.listProjects()).toEqual({
      projects: [{ id: 'p1', name: 'One', emoji: '✨', updatedAt: 2 }],
      total: 1,
      truncated: false,
    });
    expect(await adapter.getProject({ projectId: 'p1' })).toEqual({
      project: { id: 'p1', name: 'One', emoji: '✨', description: 'Demo', createdAt: 1, updatedAt: 2 },
      files: [
        { path: 'index.html', encoding: 'utf-8', bytes: 12 },
        { path: 'assets/logo.png', encoding: 'base64', bytes: 5 },
      ],
    });
    expect(JSON.stringify(await adapter.getProject({ projectId: 'p1' }))).not.toContain('<h1>');
    expect(JSON.stringify(await adapter.getProject({ projectId: 'p1' }))).not.toContain('/Users/');
  });

  it('reads one bounded UTF-8 file and rejects binary files', async () => {
    const { adapter, repo } = createAdapter();
    await expect(adapter.readProjectFile({ projectId: 'p1', path: 'index.html' })).resolves.toEqual({
      path: 'index.html',
      content: '<h1>old</h1>',
      encoding: 'utf-8',
      bytes: 12,
    });
    await expect(adapter.readProjectFile({ projectId: 'p1', path: 'assets/logo.png' })).rejects.toThrow(/UTF-8/i);
    repo.files.set('p1:large.txt', { path: 'large.txt', content: 'x'.repeat(MAX_AGENT_READ_BYTES + 1), encoding: 'utf-8' });
    await expect(adapter.readProjectFile({ projectId: 'p1', path: 'large.txt' })).rejects.toThrow(/limit/i);
  });

  it.each(['../secret', '/etc/passwd', 'a/../../b', 'a\\b', '.', '', 'C:/boot.ini'])('rejects unsafe path %j before any read or write', async (path) => {
    const { adapter, repo } = createAdapter();
    await expect(adapter.readProjectFile({ projectId: 'p1', path })).rejects.toThrow(/path/i);
    await expect(adapter.writeProjectFiles({ projectId: 'p1', overwrite: true, files: [{ path, content: 'x' }] })).rejects.toThrow(/path/i);
    expect(repo.writes).toEqual([]);
  });

  it('rejects a repository-detected symlink escape before read or mutation', async () => {
    const { adapter, repo } = createAdapter();
    repo.escapedPath = 'link/secret.txt';
    await expect(adapter.readProjectFile({ projectId: 'p1', path: 'link/secret.txt' })).rejects.toThrow(/outside/i);
    await expect(adapter.writeProjectFiles({ projectId: 'p1', overwrite: true, files: [{ path: 'link/secret.txt', content: 'x' }] })).rejects.toThrow(/outside/i);
    expect(repo.writes).toEqual([]);
  });

  it('requires explicit overwrite permission and bounds writes before mutation', async () => {
    const { adapter, repo } = createAdapter();
    await expect(adapter.writeProjectFiles({
      projectId: 'p1', overwrite: false, files: [{ path: 'index.html', content: 'new' }],
    })).rejects.toThrow(/overwrite/i);
    const files = Array.from({ length: 33 }, (_, index) => ({ path: `f${index}.txt`, content: 'x' }));
    await expect(adapter.writeProjectFiles({ projectId: 'p1', overwrite: true, files })).rejects.toThrow(/32/);
    expect(repo.writes).toEqual([]);
  });

  it('rolls back all files on failure and refreshes app state only after success', async () => {
    const { adapter, repo } = createAdapter();
    repo.failPath = 'b.txt';
    await expect(adapter.writeProjectFiles({
      projectId: 'p1',
      overwrite: true,
      files: [
        { path: 'index.html', content: '<h1>new</h1>' },
        { path: 'a.txt', content: 'a' },
        { path: 'b.txt', content: 'b' },
      ],
    })).rejects.toThrow('disk full');
    expect(repo.files.get('p1:index.html')?.content).toBe('<h1>old</h1>');
    expect(repo.files.has('p1:a.txt')).toBe(false);
    expect(repo.refreshes).toBe(0);

    repo.failPath = null;
    await adapter.writeProjectFiles({ projectId: 'p1', overwrite: true, files: [{ path: 'index.html', content: '<h1>new</h1>' }] });
    expect(repo.files.get('p1:index.html')?.content).toBe('<h1>new</h1>');
    expect(repo.refreshes).toBe(1);
  });

  it('appends a bounded agent-authored assistant/status message and refreshes chat', async () => {
    const { adapter, repo } = createAdapter();
    await expect(adapter.appendProjectMessage({
      projectId: 'p1', message: 'Finished the requested edits.', status: 'completed', agentName: 'Hermes',
    })).resolves.toEqual({ ok: true, messageId: 'agent-message-1' });
    expect(repo.messages).toEqual([{
      id: 'agent-message-1', role: 'assistant', text: '[Hermes · completed] Finished the requested edits.', createdAt: 1234,
    }]);
    expect(repo.chatRefreshes).toBe(1);
  });
});
