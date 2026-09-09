import type {MediaHostCapabilities} from '../media-host-probe';
import type { BackgroundEngine, ModelEngine, SpeechEngine, MusicEngine, VideoEngine, ImageEngine } from '../remote-generation';

type Dependencies = {
  server: () => string | null;
  inspect?: (server:string)=>Promise<MediaHostCapabilities|null>;
  permitted: (server: string) => Promise<boolean>;
  engines: (server: string) => Promise<(BackgroundEngine | ModelEngine | SpeechEngine | MusicEngine | VideoEngine | ImageEngine)[]>;
};

/** Read-only discovery. No pairing, downloads, jobs, server addresses or credentials. */
export async function readAgentMediaCapabilities(deps: Dependencies) {
  const server = deps.server();
  const host=server&&deps.inspect?await deps.inspect(server):null;
  if(deps.server()!==server)throw new Error('The connected Media Lab changed. Check capabilities again.');
  const base = {agentCanSubmitJobs:false as const,
    generation:{agentGenerateTool:'generate_media',agentGenerateStatusTool:'get_agent_generation_request',agentGenerateSaveTool:'save_agent_generation_to_library',agentGeneratePermission:'separate-approval-required'},...(deps.inspect?{editing:{
    availability:host?'checked':'unknown',drafts:host?.editingDrafts===true,
    preview:host?.editingPreview===true,export:host?.editingExport===true,
    addSources:host?.editingAddSources===true,
    agentSaveExportTool:'save_editing_export_to_library',agentRenderTool:'start_editing_export',agentRenderStatusTool:'read_editing_export_job',agentRenderPermission:'separate-approval-required',
    agentEditingTool:'apply_editing_commands',agentDraftTool:'create_editing_draft',agentStoryboardTool:'create_storyboard_editing_copy',agentEditPermission:'separate-approval-required',
    nextStep:'Use list_editing_drafts and read_editing_timeline to inspect edits with media-read permission and an editing connection. Check tools/list for separately approved apply_editing_commands. Use Studio to preview or export. Saved exports in Library can be found with list_media_assets and copied with separately approved import_media_asset.',
  }}:{})};
  if (!server) return {...base, state:'not-connected', operations:[], nextStep:'Connect Media Lab in Studio.'};
  if (!await deps.permitted(server)) return {...base, state:'generation-connection-required', operations:[],
    nextStep:'Connect generation in Studio to inspect this server’s supported operations. Library access alone does not enable generation.'};
  if (deps.server() !== server) throw new Error('The connected Media Lab changed. Check capabilities again.');
  const engines = await deps.engines(server);
  if (deps.server() !== server) throw new Error('The connected Media Lab changed. Check capabilities again.');
  return {...base, state:'connected', operations:engines.map(engine => ({
    id:engine.id, revision:engine.revision, operation:engine.operation,
    ...(engine.operation === 'image-to-3d' ? {variant:engine.variant} : {}),
    ...(engine.operation === 'speak' ? {voice:engine.voice, language:engine.language, experimental:true} : {}),
    ...(engine.operation === 'compose' ? {maxSeconds:engine.maxSeconds, experimental:true} : {}),
    ...(engine.operation === 'text-to-video' ? {maxFrames:engine.maxFrames, fps:engine.fps, sizes:engine.sizes, experimental:true} : {}),
    ...(engine.operation === 'text-to-image' ? {sizes:engine.sizes, experimental:true} : {}),
  })), nextStep:engines.length ? 'These operations are advertised by the connected server and supported in Studio. Use Studio to submit a job, or check tools/list for separately approved agent operations.'
    : 'No supported operations are advertised by this server. Finish engine setup on your own server, then check again.'};
}
