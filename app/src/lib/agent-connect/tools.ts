import { useChat } from '@/lib/chat-engine';
import { ProjectAgentAdapter } from '@/lib/agent-connect/project-adapter';
import { createProjectConnectTools } from '@/lib/agent-connect/tool-contract';
import * as projectStore from '@/lib/storage/projects';
import { useApp } from '@/lib/store';

const projectAdapter = new ProjectAgentAdapter({
  listProjects: projectStore.listProjects,
  listFileManifest: projectStore.listProjectFileManifest,
  getFileInfo: projectStore.getProjectFileInfo,
  readFile: projectStore.readAgentUtf8File,
  writeFile: async (projectId, path, content) => projectStore.writeFileWithoutTouch(projectId, path, content),
  deleteFile: async (projectId, path) => projectStore.deleteFileWithoutTouch(projectId, path),
  appendMessage: async (projectId, message) => {
    const messages = await projectStore.readChat(projectId);
    await projectStore.writeChat(projectId, [...messages, message]);
  },
  removeMessage: async (projectId, messageId) => {
    const messages = await projectStore.readChat(projectId);
    await projectStore.writeChat(projectId, messages.filter((message) => message.id !== messageId));
  },
  refreshProjects: async (projectId) => {
    await projectStore.touchProject(projectId);
    await useApp.getState().refreshProjects();
    useChat.getState().bumpFiles(projectId);
  },
  refreshChat: async (projectId) => useChat.getState().reload(projectId),
  assertPathContained: projectStore.assertProjectFilePathContained,
});

export const projectConnectTools = createProjectConnectTools(projectAdapter);
