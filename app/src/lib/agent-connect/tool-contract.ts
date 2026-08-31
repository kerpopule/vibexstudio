import type { ConnectTool } from '@/lib/agent-connect/core';
import type { AgentMessageStatus, AgentFileWrite } from '@/lib/agent-connect/project-adapter';

export interface ProjectToolAdapter {
  listProjects(): Promise<unknown>;
  getProject(input: { projectId: string }): Promise<unknown>;
  readProjectFile(input: { projectId: string; path: string }): Promise<unknown>;
  writeProjectFiles(input: { projectId: string; overwrite: boolean; files: AgentFileWrite[] }): Promise<unknown>;
  appendProjectMessage(input: {
    projectId: string;
    message: string;
    status: AgentMessageStatus;
    agentName: string;
  }): Promise<unknown>;
}

function stringArg(args: Record<string, unknown>, key: string): string {
  const value = args[key];
  if (typeof value !== 'string' || !value) throw new Error(`${key} is required.`);
  return value;
}

function booleanArg(args: Record<string, unknown>, key: string): boolean {
  const value = args[key];
  if (typeof value !== 'boolean') throw new Error(`${key} must be true or false.`);
  return value;
}

export function createProjectConnectTools(adapter: ProjectToolAdapter): ConnectTool[] {
  return [
    {
      name: 'list_projects',
      description: 'List bounded summaries of VibeX projects stored in this app. Returns project ids and human-facing metadata, never device paths.',
      inputSchema: { type: 'object', additionalProperties: false, properties: {} },
      handler: () => adapter.listProjects(),
    },
    {
      name: 'get_project',
      description: 'Get bounded metadata and a content-free file manifest for one VibeX project by id.',
      inputSchema: {
        type: 'object', additionalProperties: false, required: ['projectId'],
        properties: { projectId: { type: 'string', minLength: 1, maxLength: 128 } },
      },
      handler: (args) => adapter.getProject({ projectId: stringArg(args, 'projectId') }),
    },
    {
      name: 'read_project_file',
      description: 'Read one bounded UTF-8 text file inside a VibeX project. Binary files and paths outside the project root are rejected.',
      inputSchema: {
        type: 'object', additionalProperties: false, required: ['projectId', 'path'],
        properties: {
          projectId: { type: 'string', minLength: 1, maxLength: 128 },
          path: { type: 'string', minLength: 1, maxLength: 180 },
        },
      },
      handler: (args) => adapter.readProjectFile({
        projectId: stringArg(args, 'projectId'),
        path: stringArg(args, 'path'),
      }),
    },
    {
      name: 'write_project_files',
      description: 'Atomically write 1-32 UTF-8 files inside one VibeX project, up to 256 KiB total. Set overwrite explicitly; all paths remain project-relative.',
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        required: ['projectId', 'overwrite', 'files'],
        properties: {
          projectId: { type: 'string', minLength: 1, maxLength: 128 },
          overwrite: { type: 'boolean', description: 'When false, reject if any target exists. When true, replace existing targets.' },
          files: {
            type: 'array', minItems: 1, maxItems: 32,
            items: {
              type: 'object', additionalProperties: false, required: ['path', 'content'],
              properties: {
                path: { type: 'string', minLength: 1, maxLength: 180 },
                content: { type: 'string' },
              },
            },
          },
        },
      },
      handler: (args) => adapter.writeProjectFiles({
        projectId: stringArg(args, 'projectId'),
        overwrite: booleanArg(args, 'overwrite'),
        files: args.files as AgentFileWrite[],
      }),
    },
    {
      name: 'append_project_message',
      description: 'Append a bounded agent-authored assistant/status message to a selected project chat so the user sees context.',
      inputSchema: {
        type: 'object', additionalProperties: false, required: ['projectId', 'message', 'status'],
        properties: {
          projectId: { type: 'string', minLength: 1, maxLength: 128 },
          message: { type: 'string', minLength: 1, maxLength: 16384 },
          status: { type: 'string', enum: ['info', 'completed', 'failed'] },
        },
      },
      handler: (args, agent) => adapter.appendProjectMessage({
        projectId: stringArg(args, 'projectId'),
        message: stringArg(args, 'message'),
        status: stringArg(args, 'status') as AgentMessageStatus,
        agentName: agent.name,
      }),
    },
  ];
}
