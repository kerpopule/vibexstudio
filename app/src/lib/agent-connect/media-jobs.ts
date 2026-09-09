import type {ConnectTool, PairedAgent} from './core';
import type {BackgroundRequest} from '../background-workflow';
import type {RemoteLibraryAsset} from '../library-core';
import {libraryOrigin} from '../library-core';
import type {BackgroundEngine} from '../remote-generation';

type Dependencies = {
  server: () => string | null;
  identity: (value:string) => Promise<string>;
  list: () => Promise<RemoteLibraryAsset[]>;
  engines: (origin:string) => Promise<BackgroundEngine[]>;
  find: (id:string) => Promise<BackgroundRequest|null>;
  prepare: (asset:RemoteLibraryAsset,engine:BackgroundEngine,owner:string,id:string) => Promise<BackgroundRequest>;
  advance: (id:string) => Promise<BackgroundRequest>;
  cancel?: (id:string) => Promise<BackgroundRequest>;
  saveResult?: (origin:string,jobId:string) => Promise<void>;
  importResult?: (input:{projectId:string;requestId:string;path:string},origin:string,jobId:string,assertConnection:()=>void) => Promise<unknown>;
};

function argument(args:Record<string,unknown>,name:string,pattern:RegExp):string {
  const value=args[name];
  if(typeof value!=='string'||!pattern.test(value))throw new Error(`Invalid ${name}.`);
  return value;
}
function publicRequest(requestId:string,value:BackgroundRequest,canSave=false) {
  return {requestId, operation:'remove-background', status:value.job?.status ?? 'acceptance-unknown', cancellationRequested:value.cancelRequested,
    ...(value.job ? {jobId:value.job.id} : {}),
    nextStep:value.job?.status==='succeeded' ? canSave ? 'Use save_agent_image_to_library with this requestId to keep the result in Library. To copy it into a project, use import_agent_media_result only if tools/list includes that separately approved tool.' : 'Open this result in Studio’s generation history, or use import_agent_media_result if tools/list includes that separately approved tool.'
      : value.job?.status==='cancelled' ? 'This request is cancelled. No further polling is needed.'
      : value.job?.status==='failed' ? 'This request failed. Review it in Studio before starting a new request.'
      : !value.job && value.cancelRequested ? 'Cancellation is saved locally. Call get_agent_media_request to retry cancellation without submitting work.'
      : !value.job ? 'Retry remove_media_background with the same requestId and original arguments to recover acceptance safely.'
      : value.cancelRequested ? 'Cancellation has been requested. Call get_agent_media_request until the server reports a terminal status.'
      : 'Call get_agent_media_request with this requestId to check progress.'};
}

export function createAgentMediaJobTools(deps:Dependencies):ConnectTool[] {
  const locate=async(args:Record<string,unknown>,agent:PairedAgent)=>{
    if(agent.mediaBackground!==true)throw new Error('Background removal requires separate approval.');
    const requestId=argument(args,'requestId',/^[A-Za-z0-9_-]{16,80}$/);
    const origin=deps.server();
    if(!origin)throw new Error('Connect Media Lab in Studio first.');
    const id=await deps.identity(`vibex-agent-background-v1\n${agent.id}\n${requestId}`);
    const current=await deps.find(id);
    if(current && (current.agentOwner!==agent.id || current.origin!==libraryOrigin(origin))) {
      throw new Error('This saved request belongs to a different connection. Reconnect its original Media Lab server.');
    }
    const assertConnection=()=>{
      if(deps.server()!==origin)throw new Error('The connected Media Lab changed. Retry on the original connection.');
    };
    assertConnection();
    return {requestId,id,origin,current,assertConnection};
  };
  const requestProperty={type:'string',minLength:16,maxLength:80,description:'A unique stable ID for this request. Reuse unchanged on retry; choose a new ID for a new operation.'};
  const tools:ConnectTool[] = [{
    name:'remove_media_background',requiredPermission:'mediaBackground',
    description:'Run background removal on an image from list_media_assets using an exact advertised engine ID and revision. Requires separate background-removal approval. Uses the user-connected server only; no model installation or paid-provider fallback. Save a unique requestId before calling and reuse it with identical arguments after any lost response. Results also appear in Studio.',
    inputSchema:{type:'object',additionalProperties:false,required:['requestId','assetId','engineId','revision'],properties:{requestId:requestProperty,assetId:{type:'string'},engineId:{type:'string'},revision:{type:'string'}}},
    handler:async(args,agent)=>{
      const assetId=argument(args,'assetId',/^[A-Za-z0-9_-]{1,128}$/);
      const engineId=argument(args,'engineId',/^[A-Za-z0-9_-]{1,80}$/);
      const revision=argument(args,'revision',/^[A-Za-z0-9._-]{1,128}$/);
      const {requestId,id,origin,current,assertConnection}=await locate(args,agent);
      if(current){
        if(current.assetId!==assetId || current.engine.id!==engineId || current.engine.revision!==revision) {
          throw new Error('This requestId already has different media or engine settings. Use its original arguments or a new requestId.');
        }
      } else {
        const engines=await deps.engines(origin);
        assertConnection();
        const engine=engines.find(item=>item.id===engineId&&item.revision===revision);
        if(!engine)throw new Error('This exact background-removal engine is unavailable. Check get_media_capabilities.');
        const assets=await deps.list();
        assertConnection();
        const asset=assets.find(item=>item.id===assetId && libraryOrigin(item.serverUrl)===libraryOrigin(origin));
        if(!asset)throw new Error('Choose an existing asset from list_media_assets.');
        if(!['image/png','image/jpeg','image/webp'].includes(asset.mimeType))throw new Error('Choose a PNG, JPEG or WebP image.');
        await deps.prepare(asset,engine,agent.id,id);
        assertConnection();
      }
      return publicRequest(requestId,await deps.advance(id),Boolean(deps.saveResult));
    },
  },{
    name:'get_agent_media_request',requiredPermission:'mediaBackground',
    description:'Check this agent’s own background-removal request by its original requestId. Does not start a new job or expose other agents’ or manually created requests. If acceptance is unknown, retry remove_media_background with the original arguments.',
    inputSchema:{type:'object',additionalProperties:false,required:['requestId'],properties:{requestId:requestProperty}},
    handler:async(args,agent)=>{
      const {requestId,id,current,assertConnection}=await locate(args,agent);
      if(!current)throw new Error('No saved request exists for this agent and requestId.');
      assertConnection();
      return publicRequest(requestId,(current.job || current.cancelRequested) ? await deps.advance(id) : current,Boolean(deps.saveResult));
    },
  }];
  if(deps.cancel)tools.push({
    name:'cancel_agent_media_request',requiredPermission:'mediaBackground',
    description:'Request cancellation of this agent’s own saved background-removal request using its original requestId. Does not delete results, interrupt other agents’ jobs, or submit a new job. If acceptance is unknown, cancellation prevents a late submission from starting work; this requires an updated Media Lab server. A cancellation request is not proof that execution has stopped; check status afterward.',
    inputSchema:{type:'object',additionalProperties:false,required:['requestId'],properties:{requestId:requestProperty}},
    handler:async(args,agent)=>{
      const {requestId,id,current,assertConnection}=await locate(args,agent);
      if(!current)throw new Error('No saved request exists for this agent and requestId.');
      if(current.job && ['succeeded','failed','cancelled'].includes(current.job.status))return publicRequest(requestId,current,Boolean(deps.saveResult));
      assertConnection();
      return publicRequest(requestId,await deps.cancel!(id),Boolean(deps.saveResult));
    },
  });
  if(deps.importResult)tools.push({
    name:'import_agent_media_result',requiredPermission:'mediaBackground',requiredPermissions:['mediaImport'],
    description:'Copy this agent’s own completed background-removal result into an existing project as assets/*.png (up to 16 MiB). Requires both background-removal and media-import approval. Never overwrites an existing file; an identical retry returns alreadyImported after verifying the result bytes. Use the original requestId; no arbitrary job IDs or server URLs are accepted.',
    inputSchema:{type:'object',additionalProperties:false,required:['requestId','projectId','path'],properties:{requestId:requestProperty,projectId:{type:'string'},path:{type:'string'}}},
    handler:async(args,agent)=>{
      if(agent.mediaImport!==true)throw new Error('Result import requires separate media-import approval.');
      const projectId=argument(args,'projectId',/^[A-Za-z0-9_-]{1,128}$/);
      const path=argument(args,'path',/^assets\/.{1,172}\.png$/i);
      const {requestId,origin,current,assertConnection}=await locate(args,agent);
      if(!current?.job || current.job.status!=='succeeded')throw new Error('Check this request first and wait for it to succeed.');
      assertConnection();
      return deps.importResult!({projectId,requestId,path},origin,current.job.id,assertConnection);
    },
  });
  if(deps.saveResult)tools.push({
    name:'save_agent_image_to_library',requiredPermission:'mediaBackground',
    description:'Save this agent’s own completed PNG background-removal result in the connected server Library for reuse. New files go to Images/Cutouts; an identical existing asset is reused. Use the original requestId. Does not publish, generate again, or delete the original image.',
    inputSchema:{type:'object',additionalProperties:false,required:['requestId'],properties:{requestId:requestProperty}},
    handler:async(args,agent)=>{
      const {requestId,origin,current,assertConnection}=await locate(args,agent);
      if(!current?.job || current.job.status!=='succeeded')throw new Error('Check this request first and wait for it to succeed.');
      assertConnection();
      await deps.saveResult!(origin,current.job.id);
      assertConnection();
      return {requestId,savedToLibrary:true,nextStep:'Use list_media_assets to find the saved image. New cutouts are in Images/Cutouts; an existing identical asset keeps its original folder.'};
    },
  });
  return tools;
}
