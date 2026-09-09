import {createSaveEditingExportTool,createEditingRenderTools} from './editing-render';
import {createEditingExportStatusTool,createEditingReadTools} from './editing-tools';
import {createEditingMutationTools} from './editing-mutations';
import {createAgentDraftTool} from './editing-create';
import {createAgentStoryboardTool} from './storyboard-create';
import {createAgentStoryboardDraft} from '../remote-editing';
import {saveExportToLibrary,startEditingExportJob,readEditingExportJob,readEditingExportStatus,createAgentEditingDraft,applyAgentTimelineEdit,listEditingDrafts,readEditingTimeline} from '../remote-editing';
import {createCollectionTools} from './collection-tools';
import {listSavedCollection} from '../remote-library';
import {probeMediaHost} from '../media-host-probe';
import * as Crypto from 'expo-crypto';
import {createAgentMediaJobTools} from './media-jobs';
import {createAgentGenerationTools} from './media-generation';
import {prepareAgentBackgroundRequest,findBackgroundRequest,advanceBackgroundRequest} from '../background-workflow';
import { readAgentMediaCapabilities } from './media-capabilities';
import { saveBackgroundToLibrary, hasRemoteGenerationPermission, listSupportedStudioEngines, listBackgroundEngines, readBackgroundResult, saveResultToLibrary } from '../remote-generation';
import type { ImageEngine, VideoEngine, MusicEngine, SpeechEngine } from '../remote-generation';
import {prepareImageRequest,findImageRequest,advanceImageRequest,markImageSaved} from '../image-workflow';
import {prepareVideoRequest,findVideoRequest,advanceVideoRequest,markVideoSaved} from '../video-workflow';
import {prepareMusicRequest,findMusicRequest,advanceMusicRequest,markMusicSaved} from '../music-workflow';
import {prepareSpeechRequest,findSpeechRequest,advanceSpeechRequest,markSpeechSaved} from '../speech-workflow';
import { createMediaConnectTools } from '@/lib/agent-connect/media-tools';
import {importAgentMedia,importAgentImageResult} from '@/lib/agent-connect/media-import';
import { listRemoteLibrary, readRemoteAsset } from '@/lib/remote-library';
import { useChat } from '@/lib/chat-engine';
import { ProjectAgentAdapter } from '@/lib/agent-connect/project-adapter';
import { createProjectConnectTools } from '@/lib/agent-connect/tool-contract';
import * as projectStore from '@/lib/storage/projects';
import { useApp } from '@/lib/store';

const projectAdapter = new ProjectAgentAdapter({
  createProject: projectStore.createProject,
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
}, {
  // Hermes on native has no browser globalThis.crypto; use Expo on every platform.
  newId: () => Crypto.randomUUID(),
});

const listConnectedMedia=async()=>{
  const server = useApp.getState().mediaLab;
  if (!server) throw new Error('Connect a Media Lab library in Studio first.');
  return listRemoteLibrary(server.url);
};
export const projectConnectTools = [
  createAgentStoryboardTool({server:()=>useApp.getState().mediaLab?.url??null,identity:value=>Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256,value),create:createAgentStoryboardDraft}),
  createSaveEditingExportTool({server:()=>useApp.getState().mediaLab?.url??null,save:saveExportToLibrary}),
  ...createEditingRenderTools({server:()=>useApp.getState().mediaLab?.url??null,start:startEditingExportJob,read:readEditingExportJob}),
  createEditingExportStatusTool({server:()=>useApp.getState().mediaLab?.url??null,status:readEditingExportStatus}),
  createAgentDraftTool({server:()=>useApp.getState().mediaLab?.url??null,identity:value=>Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256,value),create:createAgentEditingDraft}),
  ...createEditingMutationTools({server:()=>useApp.getState().mediaLab?.url??null,identity:value=>Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256,value),apply:applyAgentTimelineEdit}),
  ...createEditingReadTools({server:()=>useApp.getState().mediaLab?.url??null,list:listEditingDrafts,read:readEditingTimeline}),
  ...createCollectionTools(async name=>{
    const origin=useApp.getState().mediaLab?.url;
    if(!origin)throw new Error('Connect a Media Lab library in Studio first.');
    const records=await listSavedCollection(origin,name);
    if(useApp.getState().mediaLab?.url!==origin)throw new Error('The connected server changed. Retry on the current server.');
    return records;
  }),
  ...createProjectConnectTools(projectAdapter),
  ...createAgentMediaJobTools({
    server:() => useApp.getState().mediaLab?.url ?? null,
    identity:async value => (await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256,value)).slice(0,32),
    list:listConnectedMedia,
    engines:listBackgroundEngines,
    find:findBackgroundRequest,
    prepare:prepareAgentBackgroundRequest,
    advance:advanceBackgroundRequest,
    cancel:id => advanceBackgroundRequest(id,true),
    saveResult:saveBackgroundToLibrary,
    importResult:async(input,origin,jobId,assertConnection) => importAgentImageResult({
      project:projectStore.readProject,
      commit:projectStore.importBinaryAssetExclusive,
      busy:id => !!useChat.getState().sessions[id]?.busy,
      refresh:async id => {await useApp.getState().refreshProjects();useChat.getState().bumpFiles(id);},
    },input,async()=>{
      assertConnection();
      const bytes=await readBackgroundResult(origin,jobId,16*1024*1024);
      assertConnection();
      return bytes;
    }),
  }),
  ...createAgentGenerationTools({
    server:() => useApp.getState().mediaLab?.url ?? null,
    identity:async value => (await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256,value)).slice(0,32),
    engines:listSupportedStudioEngines,
    saveResult:saveResultToLibrary,
    workflows:{
      image:{find:findImageRequest,advance:advanceImageRequest,markSaved:markImageSaved,
        prepare:(origin,engine,settings,options)=>prepareImageRequest(origin,engine as ImageEngine,String(settings.prompt),String(settings.size ?? '1024*1024'),Number(settings.seed ?? 7),options),
        matches:(saved,settings)=>saved.prompt===String(settings.prompt).trim() && (settings.size===undefined || (saved as {size?:string}).size===settings.size)},
      video:{find:findVideoRequest,advance:advanceVideoRequest,markSaved:markVideoSaved,
        prepare:(origin,engine,settings,options)=>prepareVideoRequest(origin,engine as VideoEngine,String(settings.prompt),Number(settings.frames ?? 25),String(settings.size ?? '704*1280'),Number(settings.seed ?? 7),options),
        matches:(saved,settings)=>saved.prompt===String(settings.prompt).trim() && (settings.frames===undefined || (saved as {frames?:number}).frames===settings.frames)},
      music:{find:findMusicRequest,advance:advanceMusicRequest,markSaved:markMusicSaved,
        prepare:(origin,engine,settings,options)=>prepareMusicRequest(origin,engine as MusicEngine,String(settings.prompt),String(settings.lyrics ?? ''),Number(settings.seconds ?? 20),Number(settings.seed ?? 7),options),
        matches:(saved,settings)=>saved.prompt===String(settings.prompt).trim() && (settings.seconds===undefined || (saved as {seconds?:number}).seconds===settings.seconds)},
      speech:{find:findSpeechRequest,advance:advanceSpeechRequest,markSaved:markSpeechSaved,
        prepare:(origin,engine,settings,options)=>prepareSpeechRequest(origin,engine as SpeechEngine,String(settings.prompt),Number(settings.seed ?? 7),options),
        matches:(saved,settings)=>saved.text===String(settings.prompt).trim()},
    },
  }),
  ...createMediaConnectTools(
    listConnectedMedia,
    input => importAgentMedia({
      list:listConnectedMedia,
      read:readRemoteAsset,
      project:projectStore.readProject,
      commit:projectStore.importBinaryAssetExclusive,
      busy:id => !!useChat.getState().sessions[id]?.busy,
      refresh:async id => {
        await useApp.getState().refreshProjects();
        useChat.getState().bumpFiles(id);
      },
    }, input),
    () => readAgentMediaCapabilities({
      inspect:probeMediaHost,
      server:() => useApp.getState().mediaLab?.url ?? null,
      permitted:hasRemoteGenerationPermission,
      engines:listSupportedStudioEngines,
    }),
  ),
];
