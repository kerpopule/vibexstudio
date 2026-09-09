import type {ConnectTool, PairedAgent} from './core';
import {libraryOrigin} from '../library-core';
import type {BackgroundEngine, ImageEngine, ModelEngine, MusicEngine, SpeechEngine, VideoEngine} from '../remote-generation';

type AnyEngine = BackgroundEngine | ModelEngine | ImageEngine | VideoEngine | MusicEngine | SpeechEngine;
type Saved = {requestId:string; origin:string; agentOwner?:string; prompt?:string; text?:string;
  engine:{id:string; revision:string; operation:string}; job:{id:string; status:string}|null; cancelRequested:boolean; libraryAssetId?:string};

export type GenerationKind = 'image' | 'video' | 'music' | 'speech';

type Workflow = {
  find: (id:string) => Promise<Saved|null>;
  prepare: (origin:string, engine:AnyEngine, settings:Record<string, unknown>, options:{requestId:string; agentOwner:string}) => Promise<Saved>;
  advance: (id:string, cancel?:boolean) => Promise<Saved>;
  markSaved: (id:string, assetId:string) => Promise<Saved>;
  /** Reject a retry whose arguments changed, so one requestId can never mean two different jobs. */
  matches: (saved:Saved, settings:Record<string, unknown>) => boolean;
};

type Dependencies = {
  server: () => string | null;
  identity: (value:string) => Promise<string>;
  engines: (origin:string) => Promise<AnyEngine[]>;
  workflows: Record<GenerationKind, Workflow>;
  saveResult?: (origin:string, jobId:string) => Promise<string>;
};

const OPERATIONS: Record<GenerationKind, string> = {image:'text-to-image', video:'text-to-video', music:'compose', speech:'speak'};

function argument(args:Record<string, unknown>, name:string, pattern:RegExp):string {
  const value=args[name];
  if(typeof value!=='string'||!pattern.test(value))throw new Error(`Invalid ${name}.`);
  return value;
}

function publicRequest(kind:GenerationKind, requestId:string, value:Saved) {
  const status=value.job?.status ?? 'acceptance-unknown';
  return {requestId, kind, operation:OPERATIONS[kind], status, cancellationRequested:value.cancelRequested,
    ...(value.job ? {jobId:value.job.id} : {}),
    ...(value.libraryAssetId ? {libraryAssetId:value.libraryAssetId} : {}),
    nextStep:status==='succeeded' ? (value.libraryAssetId
        ? 'This result is already in Library. Find it with list_media_assets; copying it into a project needs separately approved import_media_asset.'
        : 'Use save_agent_generation_to_library with this requestId to keep the result in Library.')
      : status==='cancelled' ? 'This request is cancelled. No further polling is needed.'
      : status==='failed' ? 'This request failed. Review it in Studio before starting a new request.'
      : !value.job && value.cancelRequested ? 'Cancellation is saved locally. Call get_agent_generation_request to retry cancellation without submitting work.'
      : !value.job ? 'Retry generate_media with the same requestId and original arguments to recover acceptance safely.'
      : value.cancelRequested ? 'Cancellation has been requested. Call get_agent_generation_request until the server reports a terminal status.'
      : 'Call get_agent_generation_request with this requestId to check progress.'};
}

/** Prompt-driven generation on the user's own server, behind its own approval. No provider keys, no installs. */
export function createAgentGenerationTools(deps:Dependencies):ConnectTool[] {
  const locate=async(args:Record<string, unknown>, agent:PairedAgent, kind:GenerationKind)=>{
    if(agent.mediaGenerate!==true)throw new Error('Generating media requires separate approval.');
    const requestId=argument(args,'requestId',/^[A-Za-z0-9_-]{16,80}$/);
    const origin=deps.server();
    if(!origin)throw new Error('Connect Media Lab in Studio first.');
    const id=await deps.identity(`vibex-agent-generation-v1\n${kind}\n${agent.id}\n${requestId}`);
    const current=await deps.workflows[kind].find(id);
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
  const kindProperty={type:'string',enum:['image','video','music','speech'],description:'Which advertised operation to run.'};
  return [{
    name:'generate_media',requiredPermission:'mediaGenerate',
    description:'Create an image, video clip, song or spoken line on the connected Media Lab server using an exact advertised engine ID and revision from get_media_capabilities. Requires separate media-generation approval. Uses the user’s own server only: no model installation, no paid provider, no fallback engine. Save a unique requestId before calling and reuse it with identical arguments after any lost response. Results also appear in Studio.',
    inputSchema:{type:'object',additionalProperties:false,required:['requestId','kind','engineId','revision','prompt'],properties:{
      requestId:requestProperty,kind:kindProperty,engineId:{type:'string'},revision:{type:'string'},
      prompt:{type:'string',minLength:1,maxLength:600,description:'For speech this is the text to speak.'},
      size:{type:'string',description:'Image or video size the engine advertises, e.g. 1024*1024.'},
      frames:{type:'integer',description:'Video length in frames (4n+1) within the engine’s maxFrames.'},
      seconds:{type:'integer',description:'Song length in seconds within the engine’s maxSeconds.'},
      lyrics:{type:'string',maxLength:4000,description:'Song lyrics; omit for an instrumental.'},
      seed:{type:'integer',minimum:0,maximum:4294967295},
    }},
    handler:async(args,agent)=>{
      const kind=argument(args,'kind',/^(image|video|music|speech)$/) as GenerationKind;
      const engineId=argument(args,'engineId',/^[A-Za-z0-9_-]{1,80}$/);
      const revision=argument(args,'revision',/^[A-Za-z0-9._-]{1,128}$/);
      const prompt=argument(args,'prompt',/^[\s\S]{1,600}$/);
      const settings:Record<string, unknown>={prompt,
        ...(args.size!==undefined?{size:args.size}:{}), ...(args.frames!==undefined?{frames:args.frames}:{}),
        ...(args.seconds!==undefined?{seconds:args.seconds}:{}), ...(args.lyrics!==undefined?{lyrics:args.lyrics}:{}),
        ...(args.seed!==undefined?{seed:args.seed}:{})};
      const {requestId,id,origin,current,assertConnection}=await locate(args,agent,kind);
      const workflow=deps.workflows[kind];
      if(current){
        if(current.engine.id!==engineId||current.engine.revision!==revision||!workflow.matches(current,settings)) {
          throw new Error('This requestId already has different settings. Use its original arguments or a new requestId.');
        }
      } else {
        const engines=await deps.engines(origin);
        assertConnection();
        const engine=engines.find(item=>item.id===engineId&&item.revision===revision&&item.operation===OPERATIONS[kind]);
        if(!engine)throw new Error('This exact engine is unavailable for that kind. Check get_media_capabilities.');
        await workflow.prepare(origin,engine,settings,{requestId:id,agentOwner:agent.id});
        assertConnection();
      }
      const value=await workflow.advance(id);
      return publicRequest(kind,requestId,value);
    },
  },{
    name:'get_agent_generation_request',requiredPermission:'mediaGenerate',
    description:'Check, or cancel, one of this agent’s own generation requests by its requestId. Never reveals other requests or other agents’ work.',
    inputSchema:{type:'object',additionalProperties:false,required:['requestId','kind'],properties:{requestId:requestProperty,kind:kindProperty,cancel:{type:'boolean'}}},
    handler:async(args,agent)=>{
      const kind=argument(args,'kind',/^(image|video|music|speech)$/) as GenerationKind;
      const {requestId,id,current}=await locate(args,agent,kind);
      if(!current)throw new Error('No saved request has that requestId on this connection.');
      return publicRequest(kind,requestId,await deps.workflows[kind].advance(id,args.cancel===true));
    },
  },{
    name:'save_agent_generation_to_library',requiredPermission:'mediaGenerate',
    description:'Save this agent’s own finished generation into the connected server’s Library. Only the agent’s own successful request can be saved, and only once.',
    inputSchema:{type:'object',additionalProperties:false,required:['requestId','kind'],properties:{requestId:requestProperty,kind:kindProperty}},
    handler:async(args,agent)=>{
      const kind=argument(args,'kind',/^(image|video|music|speech)$/) as GenerationKind;
      const {requestId,id,origin,current,assertConnection}=await locate(args,agent,kind);
      if(!current?.job||current.job.status!=='succeeded')throw new Error('This request has no finished result to save.');
      if(current.libraryAssetId)return publicRequest(kind,requestId,current);
      if(!deps.saveResult)throw new Error('Saving to Library is unavailable on this device.');
      const assetId=await deps.saveResult(origin,current.job.id);
      assertConnection();
      return publicRequest(kind,requestId,await deps.workflows[kind].markSaved(id,assetId));
    },
  }];
}
