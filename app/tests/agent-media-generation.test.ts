import {createHash} from 'node:crypto';
import {expect,it,vi} from 'vitest';
import {createAgentGenerationTools} from '../src/lib/agent-connect/media-generation';
import type {PairedAgent} from '../src/lib/agent-connect/core';

const origin='https://private.example';
const agent:PairedAgent={id:'a'.repeat(24),name:'Test',pairedAt:'2026-01-01',mediaGenerate:true};
const denied:PairedAgent={...agent,mediaGenerate:false};
const image={id:'zimage-turbo-gpu',revision:'rev-1',operation:'text-to-image' as const,sizes:['1024*1024']};
const video={id:'wan22-ti2v-5b-gpu',revision:'rev-2',operation:'text-to-video' as const,maxFrames:121,fps:24,sizes:['704*1280']};

type Saved={requestId:string;origin:string;agentOwner?:string;prompt?:string;size?:string;frames?:number;
  engine:{id:string;revision:string;operation:string};job:{id:string;status:string}|null;cancelRequested:boolean;libraryAssetId?:string};

function fixture(){
  let server:string|null=origin;
  const saved=new Map<string,Saved>();
  const make=(operation:string)=>({
    find:vi.fn(async(id:string)=>saved.get(id)??null),
    prepare:vi.fn(async(host:string,engine:{id:string;revision:string},settings:Record<string,unknown>,options:{requestId:string;agentOwner:string})=>{
      const value:Saved={requestId:options.requestId,origin:host,agentOwner:options.agentOwner,prompt:String(settings.prompt).trim(),
        size:settings.size as string|undefined,frames:settings.frames as number|undefined,
        engine:{id:engine.id,revision:engine.revision,operation},job:null,cancelRequested:false};
      saved.set(options.requestId,value);return value;
    }),
    advance:vi.fn(async(id:string,cancel=false)=>{
      const value=saved.get(id)!;
      const updated={...value,cancelRequested:value.cancelRequested||cancel,job:{id:'d'.repeat(32),status:cancel?'cancel_requested':'succeeded'}};
      saved.set(id,updated);return updated;
    }),
    markSaved:vi.fn(async(id:string,assetId:string)=>{
      const updated={...saved.get(id)!,libraryAssetId:assetId};saved.set(id,updated);return updated;
    }),
    matches:(value:Saved,settings:Record<string,unknown>)=>value.prompt===String(settings.prompt).trim() &&
      (settings.size===undefined||value.size===settings.size) && (settings.frames===undefined||value.frames===settings.frames),
  });
  const workflows={image:make('text-to-image'),video:make('text-to-video'),music:make('compose'),speech:make('speak')};
  const deps={server:()=>server,identity:async(value:string)=>createHash('sha256').update(value).digest('hex').slice(0,32),
    engines:vi.fn(async()=>[image,video]),workflows,saveResult:vi.fn(async()=>'import-abc-png')};
  const tools=createAgentGenerationTools(deps as never);
  const call=(name:string,args:Record<string,unknown>,who:PairedAgent=agent)=>tools.find(tool=>tool.name===name)!.handler(args,who);
  return {deps,tools,saved,call,setServer:(value:string|null)=>{server=value;}};
}

const request={requestId:'my-stable-request-0001',kind:'image',engineId:image.id,revision:image.revision,prompt:'a lighthouse'};

it('exposes generation tools only with the separate media-generation permission', async () => {
  const {tools,call,deps}=fixture();
  expect(tools.map(tool=>tool.name).sort()).toEqual(['generate_media','get_agent_generation_request','save_agent_generation_to_library']);
  expect(tools.every(tool=>tool.requiredPermission==='mediaGenerate')).toBe(true);
  await expect(call('generate_media',request,denied)).rejects.toThrow('separate approval');
  expect(deps.workflows.image.prepare).not.toHaveBeenCalled();
});

it('refuses an engine the server does not advertise for that kind', async () => {
  const {call}=fixture();
  await expect(call('generate_media',{...request,kind:'video',engineId:image.id,revision:image.revision})).rejects.toThrow('unavailable');
  await expect(call('generate_media',{...request,revision:'other'})).rejects.toThrow('unavailable');
});

it('is idempotent for one requestId and refuses changed arguments', async () => {
  const {call,deps,saved}=fixture();
  const first=await call('generate_media',request) as {status:string;requestId:string};
  expect(first.requestId).toBe(request.requestId);
  expect(first.status).toBe('succeeded');
  expect(deps.workflows.image.prepare).toHaveBeenCalledTimes(1);
  await call('generate_media',request);
  expect(deps.workflows.image.prepare).toHaveBeenCalledTimes(1);
  await expect(call('generate_media',{...request,prompt:'a different thing'})).rejects.toThrow('different settings');
  expect([...saved.values()][0].agentOwner).toBe(agent.id);
});

it('keeps one agent out of another agent’s saved request and off a changed server', async () => {
  const {call,setServer}=fixture();
  await call('generate_media',request);
  await expect(call('get_agent_generation_request',{requestId:request.requestId,kind:'image'},{...agent,id:'b'.repeat(24)}))
    .rejects.toThrow('No saved request');
  setServer('https://other.example');
  await expect(call('generate_media',request)).rejects.toThrow(/different connection|Retry on the original/);
  setServer(null);
  await expect(call('generate_media',request)).rejects.toThrow('Connect Media Lab');
});

it('saves a finished result to Library once and reports the asset id', async () => {
  const {call,deps}=fixture();
  await call('generate_media',request);
  const saved=await call('save_agent_generation_to_library',{requestId:request.requestId,kind:'image'}) as {libraryAssetId:string};
  expect(saved.libraryAssetId).toBe('import-abc-png');
  await call('save_agent_generation_to_library',{requestId:request.requestId,kind:'image'});
  expect(deps.saveResult).toHaveBeenCalledTimes(1);
});

it('cancels its own request through the status tool', async () => {
  const {call,deps}=fixture();
  await call('generate_media',{...request,kind:'video',engineId:video.id,revision:video.revision,frames:25});
  const result=await call('get_agent_generation_request',{requestId:request.requestId,kind:'video',cancel:true}) as {cancellationRequested:boolean};
  expect(result.cancellationRequested).toBe(true);
  expect(deps.workflows.video.advance).toHaveBeenLastCalledWith(expect.any(String),true);
});
