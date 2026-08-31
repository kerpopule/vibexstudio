import type { ChatMessage, ProjectMeta } from '@/lib/types';

export const MAX_AGENT_PROJECTS = 100;
export const MAX_AGENT_WRITE_FILES = 32;
export const MAX_AGENT_WRITE_BYTES = 256 * 1024;
export const MAX_AGENT_READ_BYTES = 256 * 1024;
export const MAX_AGENT_MANIFEST_FILES = 256;
export const MAX_AGENT_MANIFEST_BYTES = 2 * 1024 * 1024;
export const MAX_AGENT_PATH_CHARS = 180;
export const MAX_AGENT_MESSAGE_BYTES = 16 * 1024;

export type AgentMessageStatus = 'info' | 'completed' | 'failed';

export interface AgentProjectFileInfo {
  path: string;
  encoding: 'utf-8' | 'base64';
  bytes: number;
}

export interface ProjectAgentRepository {
  listProjects(): Promise<ProjectMeta[]>;
  listFileManifest(projectId: string): Promise<AgentProjectFileInfo[]>;
  getFileInfo(projectId: string, path: string): Promise<AgentProjectFileInfo | null>;
  readFile(projectId: string, path: string): Promise<string | null>;
  writeFile(projectId: string, path: string, content: string): Promise<void>;
  deleteFile(projectId: string, path: string): Promise<void>;
  appendMessage(projectId: string, message: ChatMessage): Promise<void>;
  removeMessage(projectId: string, messageId: string): Promise<void>;
  refreshProjects(projectId: string): Promise<void>;
  refreshChat(projectId: string): Promise<void>;
  /** Native repository boundary check, including any platform-detectable link escape. */
  assertPathContained(projectId: string, path: string): Promise<void> | void;
}

export interface AgentFileWrite {
  path: string;
  content: string;
}

interface AdapterOptions {
  now?: () => number;
  newId?: () => string;
}

function utf8Bytes(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function boundedText(value: string, maxChars: number): string {
  return value.slice(0, maxChars);
}

export function assertSafeProjectPath(path: string): void {
  if (
    !path ||
    path.length > MAX_AGENT_PATH_CHARS ||
    path.startsWith('/') ||
    path.includes('\\') ||
    /[\u0000-\u001f\u007f]/.test(path)
  ) {
    throw new Error('Invalid project-relative path.');
  }
  const parts = path.split('/');
  if (
    parts.length > 40 ||
    parts.some((part) => !part || part === '.' || part === '..') ||
    /^[A-Za-z]:/.test(path)
  ) {
    throw new Error('Invalid project-relative path.');
  }
}

function requireProjectId(projectId: unknown): asserts projectId is string {
  if (
    typeof projectId !== 'string' ||
    !projectId ||
    projectId.length > 128 ||
    projectId.includes('/') ||
    projectId.includes('\\') ||
    /[\u0000-\u001f\u007f]/.test(projectId)
  ) {
    throw new Error('A valid project id is required.');
  }
}

/**
 * Project-only adapter for the MCP surface. It deliberately has no API for
 * app settings, credentials, media directories, absolute paths, deletion,
 * deployment, or publication. Mutations are serialized and rolled back.
 */
export class ProjectAgentAdapter {
  private mutationQueue: Promise<void> = Promise.resolve();
  private readonly now: () => number;
  private readonly newId: () => string;

  constructor(private readonly repo: ProjectAgentRepository, options: AdapterOptions = {}) {
    this.now = options.now ?? Date.now;
    this.newId = options.newId ?? (() => globalThis.crypto.randomUUID());
  }

  private async requireProject(projectId: string): Promise<ProjectMeta> {
    requireProjectId(projectId);
    const project = (await this.repo.listProjects()).find((candidate) => candidate.id === projectId);
    if (!project) throw new Error('Unknown project.');
    return project;
  }

  private async requireContainedPath(projectId: string, path: string): Promise<void> {
    assertSafeProjectPath(path);
    await this.repo.assertPathContained(projectId, path);
  }

  async listProjects() {
    const all = await this.repo.listProjects();
    const projects = all.slice(0, MAX_AGENT_PROJECTS).map(({ id, name, emoji, updatedAt }) => ({
      id,
      name: boundedText(name, 120),
      emoji: boundedText(emoji, 16),
      updatedAt,
    }));
    return { projects, total: all.length, truncated: all.length > projects.length };
  }

  async getProject({ projectId }: { projectId: string }) {
    const project = await this.requireProject(projectId);
    const sourceFiles = await this.repo.listFileManifest(projectId);
    if (sourceFiles.length > MAX_AGENT_MANIFEST_FILES) {
      throw new Error(`Project exceeds the ${MAX_AGENT_MANIFEST_FILES}-file agent manifest limit.`);
    }
    let totalBytes = 0;
    const files = [] as { path: string; encoding: 'utf-8' | 'base64'; bytes: number }[];
    for (const file of sourceFiles) {
      await this.requireContainedPath(projectId, file.path);
      const encoding = file.encoding;
      const bytes = file.bytes;
      totalBytes += bytes;
      if (totalBytes > MAX_AGENT_MANIFEST_BYTES) {
        throw new Error(`Project exceeds the ${MAX_AGENT_MANIFEST_BYTES}-byte agent manifest limit.`);
      }
      files.push({ path: file.path, encoding, bytes });
    }
    return {
      project: {
        id: project.id,
        name: boundedText(project.name, 120),
        emoji: boundedText(project.emoji, 16),
        description: boundedText(project.description, 4_000),
        createdAt: project.createdAt,
        updatedAt: project.updatedAt,
      },
      files,
    };
  }

  async readProjectFile({ projectId, path }: { projectId: string; path: string }) {
    await this.requireProject(projectId);
    await this.requireContainedPath(projectId, path);
    const manifestEntry = await this.repo.getFileInfo(projectId, path);
    if (!manifestEntry) throw new Error('Project file not found.');
    if (manifestEntry.encoding === 'base64') throw new Error('read_project_file supports UTF-8 text files only.');
    if (manifestEntry.bytes > MAX_AGENT_READ_BYTES) {
      throw new Error(`File exceeds the ${MAX_AGENT_READ_BYTES}-byte agent read limit.`);
    }
    const content = await this.repo.readFile(projectId, path);
    if (content === null) throw new Error('Project file not found.');
    const bytes = utf8Bytes(content);
    if (bytes > MAX_AGENT_READ_BYTES) {
      throw new Error(`File exceeds the ${MAX_AGENT_READ_BYTES}-byte agent read limit.`);
    }
    return { path, content, encoding: 'utf-8' as const, bytes };
  }

  async writeProjectFiles(input: { projectId: string; overwrite: boolean; files: AgentFileWrite[] }) {
    return this.enqueueMutation(() => this.performWrite(input));
  }

  async appendProjectMessage(input: {
    projectId: string;
    message: string;
    status: AgentMessageStatus;
    agentName: string;
  }) {
    return this.enqueueMutation(() => this.performAppendMessage(input));
  }

  private enqueueMutation<T>(execute: () => Promise<T>): Promise<T> {
    const result = this.mutationQueue.then(execute, execute);
    this.mutationQueue = result.then(() => undefined, () => undefined);
    return result;
  }

  private async performWrite({ projectId, overwrite, files }: {
    projectId: string;
    overwrite: boolean;
    files: AgentFileWrite[];
  }) {
    await this.requireProject(projectId);
    if (typeof overwrite !== 'boolean') throw new Error('overwrite must be explicitly true or false.');
    if (!Array.isArray(files) || files.length === 0 || files.length > MAX_AGENT_WRITE_FILES) {
      throw new Error(`Write requires 1-${MAX_AGENT_WRITE_FILES} files.`);
    }
    const seen = new Set<string>();
    let bytes = 0;
    for (const file of files) {
      if (!file || typeof file.path !== 'string' || typeof file.content !== 'string') {
        throw new Error('Invalid file payload.');
      }
      await this.requireContainedPath(projectId, file.path);
      if (seen.has(file.path)) throw new Error('Duplicate project path.');
      seen.add(file.path);
      bytes += utf8Bytes(file.content);
      if (bytes > MAX_AGENT_WRITE_BYTES) {
        throw new Error(`Write exceeds ${MAX_AGENT_WRITE_BYTES} bytes.`);
      }
    }

    const before = new Map<string, string | null>();
    for (const file of files) {
      const previous = await this.repo.readFile(projectId, file.path);
      if (previous !== null && !overwrite) {
        throw new Error(`File already exists; set overwrite=true to replace it: ${file.path}`);
      }
      before.set(file.path, previous);
    }

    const attempted: string[] = [];
    try {
      for (const file of files) {
        attempted.push(file.path);
        await this.repo.writeFile(projectId, file.path, file.content);
      }
      await this.repo.refreshProjects(projectId);
    } catch (error) {
      const rollbackFailures: string[] = [];
      for (const path of attempted.reverse()) {
        try {
          const previous = before.get(path);
          if (previous === null || previous === undefined) await this.repo.deleteFile(projectId, path);
          else await this.repo.writeFile(projectId, path, previous);
        } catch {
          rollbackFailures.push(path);
        }
      }
      if (rollbackFailures.length) {
        throw new Error(`Write failed and rollback failed for: ${rollbackFailures.join(', ')}`, { cause: error });
      }
      throw error;
    }
    return { ok: true, filesWritten: files.length, bytesWritten: bytes, overwrite };
  }

  private async performAppendMessage({ projectId, message, status, agentName }: {
    projectId: string;
    message: string;
    status: AgentMessageStatus;
    agentName: string;
  }) {
    await this.requireProject(projectId);
    if (typeof message !== 'string' || !message.trim()) throw new Error('message is required.');
    if (!['info', 'completed', 'failed'].includes(status)) throw new Error('status must be info, completed, or failed.');
    if (utf8Bytes(message) > MAX_AGENT_MESSAGE_BYTES) {
      throw new Error(`Message exceeds the ${MAX_AGENT_MESSAGE_BYTES}-byte agent message limit.`);
    }
    const safeName = boundedText(agentName.replace(/[\u0000-\u001f\u007f]/g, '').trim() || 'Agent', 80);
    const chatMessage: ChatMessage = {
      id: this.newId(),
      role: 'assistant',
      text: `[${safeName} · ${status}] ${message.trim()}`,
      createdAt: this.now(),
    };
    try {
      await this.repo.appendMessage(projectId, chatMessage);
      await this.repo.refreshChat(projectId);
    } catch (error) {
      await this.repo.removeMessage(projectId, chatMessage.id).catch(() => {});
      throw error;
    }
    return { ok: true, messageId: chatMessage.id };
  }
}
