import {createHash} from 'node:crypto';
import {expect,it,vi} from 'vitest';
import {createAgentMediaJobTools} from '../src/lib/agent-connect/media-jobs';
import {AgentConnectCore, type PairedAgent} from '../src/lib/agent-connect/core';
import type {BackgroundRequest} from '../src/lib/background-workflow';
import type {RemoteLibraryAsset} from '../src/lib/library-core';

const agent:PairedAgent={id:'a'.repeat(24),name:'Test',pairedAt:'2026-01-01',mediaBackground:true};
const asset={id:'source',serverUrl:'https://private.example',mimeType:'image/png',title:'Private title'} as RemoteLibraryAsset;
const engine={id:'birefnet-cpu',revision:'abc',operation:'remove-background' as const};
const args={requestId:'my-stable-request-0001',assetId:asset.id,engineId:engine.id,revision:engine.revision};
function fixture(){
  let server:string|null=asset.serverUrl;
  const saved=new Map<string,BackgroundRequest>();
  const deps={server:()=>server,identity:async(value:string)=>createHash('sha256').update(value).digest('hex').slice(0,32),
    list:vi.fn(async()=>[asset]),engines:vi.fn(async()=>[engine]),
    find:vi.fn(async(id:string)=>saved.get(id)??null),
    prepare:vi.fn(async(source:RemoteLibraryAsset,selected:typeof engine,owner:string,id:string)=>{
      const value:BackgroundRequest={version:1,requestId:id,agentOwner:owner,origin:source.serverUrl,assetId:source.id,title:source.title,createdAt:1,engine:selected,input:{id:'b'.repeat(32),sha256:'c'.repeat(64),bytes:1,width:1,height:1},job:null,cancelRequested:false};
      saved.set(id,value);return value;
    }),
    advance:vi.fn(async(id:string)=>{
      const value=saved.get(id)!;
      const updated={...value,job:{id:'d'.repeat(32),kind:'image' as const,status:'succeeded' as const,createdAt:1,updatedAt:2}};
      saved.set(id,updated);return updated;
    }),
  };
  const tools=createAgentMediaJobTools(deps);
  return {deps,tools,saved,setServer:(value:string|null)=>{server=value;}};
}
it('saves a request before submission, resumes without re-snapshotting, and returns no private metadata',async()=>{
  const f=fixture();
  f.deps.advance.mockRejectedValueOnce(new Error('lost response'));
  await expect(f.tools[0].handler(args,agent)).rejects.toThrow('lost response');
  expect(f.saved.size).toBe(1);
  const unknown=await f.tools[1].handler({requestId:args.requestId},agent);
  expect(unknown).toMatchObject({status:'acceptance-unknown'});
  expect(f.deps.advance).toHaveBeenCalledTimes(1);
  const restored=createAgentMediaJobTools(f.deps);
  const result=await restored[0].handler(args,agent);
  expect(result).toMatchObject({requestId:args.requestId,status:'succeeded',jobId:'d'.repeat(32)});
  expect(f.deps.prepare).toHaveBeenCalledTimes(1);
  expect(f.deps.advance.mock.calls[0]).toEqual(f.deps.advance.mock.calls[1]);
  expect(JSON.stringify(result)).not.toMatch(/private|Private|origin|input|sha256|engine/);
  await expect(restored[0].handler({...args,revision:'different'},agent)).rejects.toThrow('different media');
});
it('does not let another agent read this request or silently move it to another server',async()=>{
  const f=fixture();await f.tools[0].handler(args,agent);
  await expect(f.tools[1].handler({requestId:args.requestId},{...agent,id:'b'.repeat(24)})).rejects.toThrow('No saved request');
  f.setServer('https://different.example');
  await expect(f.tools[0].handler(args,agent)).rejects.toThrow('different connection');
  expect(f.deps.advance).toHaveBeenCalledTimes(1);
});
it('refuses unknown engines, non-images, missing permission, and a changed connection before submission',async()=>{
  const f=fixture();
  await expect(f.tools[0].handler(args,{...agent,mediaBackground:false})).rejects.toThrow('separate approval');
  await expect(f.tools[0].handler({...args,revision:'other'},agent)).rejects.toThrow('unavailable');
  f.deps.list.mockResolvedValueOnce([{...asset,mimeType:'video/mp4'}]);
  await expect(f.tools[0].handler(args,agent)).rejects.toThrow('PNG');
  f.deps.list.mockImplementationOnce(async()=>{f.setServer('https://different.example');return [asset];});
  await expect(f.tools[0].handler(args,agent)).rejects.toThrow('changed');
  expect(f.deps.prepare).not.toHaveBeenCalled();expect(f.deps.advance).not.toHaveBeenCalled();
});
it('never submits when saving preparation fails',async()=>{
  const f=fixture();f.deps.prepare.mockRejectedValueOnce(new Error('storage full'));
  await expect(f.tools[0].handler(args,agent)).rejects.toThrow('storage full');
  expect(f.deps.advance).not.toHaveBeenCalled();
});
it('requires a separately approved generation grant after pairing and reload, and revocation blocks further tools',async()=>{
  for(const grant of [false,true]){
    const f=fixture();let metadata='[]';const tokens=new Map<string,string>();
    const options={metadata:{load:async()=>metadata,save:async(value:string)=>{metadata=value;}},credentials:{get:async(id:string)=>tokens.get(id)??null,set:async(id:string,token:string)=>{tokens.set(id,token);},remove:async(id:string)=>{tokens.delete(id);}},tools:f.tools};
    const core=new AgentConnectCore(options),ticket=core.issueTicket();
    const pairing=core.route({method:'POST',path:'/pair',headers:{},body:JSON.stringify({code:ticket.code,agentName:'Test'}),remoteAddress:'127.0.0.1'});
    await core.resolveApproval(true,true,true,grant);
    const token=JSON.parse((await pairing).body).token;
    const restored=new AgentConnectCore(options);await restored.load();
    const call=(method:string,params?:unknown)=>restored.route({method:'POST',path:'/mcp',headers:{authorization:`Bearer ${token}`},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params}),remoteAddress:'127.0.0.1'});
    const list=JSON.parse((await call('tools/list')).body).result.tools;
    expect(list).toHaveLength(grant?2:0);
    const response=JSON.parse((await call('tools/call',{name:'remove_media_background',arguments:args})).body);
    expect(Boolean(response.error)).toBe(!grant);
    expect(f.deps.advance).toHaveBeenCalledTimes(grant?1:0);
    await restored.revokeAgent(restored.agents[0].id);
    expect((await call('tools/list')).status).toBe(401);
  }
});

it('only lists and imports owned completed results with both permissions',async()=>{
 for(const background of [false,true])for(const mediaImport of [false,true]){
  const f=fixture();await f.tools[0].handler(args,agent);
  const copy=vi.fn(async()=>({path:'assets/result.png'}));
  const tools=createAgentMediaJobTools({...f.deps,importResult:copy});
  const core=new AgentConnectCore({metadata:{load:async()=>JSON.stringify([{...agent,mediaBackground:background,mediaImport}]),save:async()=>{}},credentials:{get:async()=> 'token',set:async()=>{},remove:async()=>{}},tools});
  await core.load();
  const call=(method:string,params?:unknown)=>core.route({method:'POST',path:'/mcp',headers:{authorization:'Bearer token'},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params}),remoteAddress:'127.0.0.1'});
  const list=JSON.parse((await call('tools/list')).body).result.tools;
  expect(list.some((tool:{name:string})=>tool.name==='import_agent_media_result')).toBe(background&&mediaImport);
  const response=JSON.parse((await call('tools/call',{name:'import_agent_media_result',arguments:{requestId:args.requestId,projectId:'p1',path:'assets/result.png'}})).body);
  expect(Boolean(response.error)).toBe(!(background&&mediaImport));
  expect(copy).toHaveBeenCalledTimes(background&&mediaImport?1:0);
 }
});
it('does not import another agent’s result or a request that has not succeeded',async()=>{
 const f=fixture();await f.tools[0].handler(args,agent);
 const copy=vi.fn(),tools=createAgentMediaJobTools({...f.deps,importResult:copy}),tool=tools.find(tool=>tool.name==='import_agent_media_result')!;
 const input={requestId:args.requestId,projectId:'p1',path:'assets/result.png'};
 await expect(tool.handler(input,{...agent,id:'b'.repeat(24),mediaImport:true})).rejects.toThrow('wait');
 for(const [id,record] of f.saved)f.saved.set(id,{...record,job:{...record.job!,status:'running'}});
 await expect(tool.handler(input,{...agent,mediaImport:true})).rejects.toThrow('wait');
 expect(copy).not.toHaveBeenCalled();
});

it('cancels only an owned accepted request and preserves terminal results',async()=>{
 const f=fixture();await f.tools[0].handler(args,agent);
 const cancel=vi.fn(async(id:string)=>{
  const value=f.saved.get(id)!;
  const next={...value,cancelRequested:true,job:{...value.job!,status:'cancel_requested' as const}};
  f.saved.set(id,next);return next;
 });
 const tools=createAgentMediaJobTools({...f.deps,cancel}),tool=tools.find(tool=>tool.name==='cancel_agent_media_request')!;
 const input={requestId:args.requestId};
 expect(await tool.handler(input,agent)).toMatchObject({status:'succeeded',cancellationRequested:false});
 expect(cancel).not.toHaveBeenCalled();
 await expect(tool.handler(input,{...agent,id:'b'.repeat(24)})).rejects.toThrow('No saved request');
 await expect(tool.handler(input,{...agent,mediaBackground:false})).rejects.toThrow('separate approval');
 for(const [id,value] of f.saved)f.saved.set(id,{...value,job:{...value.job!,status:'running'}});
 expect(await tool.handler(input,agent)).toMatchObject({status:'cancel_requested',cancellationRequested:true});
 expect(cancel).toHaveBeenCalledOnce();
});
it('never submits a job just to cancel an unknown acceptance',async()=>{
 const f=fixture();f.deps.advance.mockRejectedValueOnce(new Error('lost response'));
 await expect(f.tools[0].handler(args,agent)).rejects.toThrow('lost response');
 const cancel=vi.fn(async(id:string)=>({...f.saved.get(id)!,cancelRequested:true,job:{id:'d'.repeat(32),kind:'image' as const,status:'cancelled' as const,createdAt:1,updatedAt:1}})),tools=createAgentMediaJobTools({...f.deps,cancel});
 expect(await tools.find(tool=>tool.name==='cancel_agent_media_request')!.handler({requestId:args.requestId},agent)).toMatchObject({status:'cancelled',cancellationRequested:true});
 expect(cancel).toHaveBeenCalledOnce();expect(f.deps.advance).toHaveBeenCalledOnce();
});


it('saves only the connected agent’s completed image and propagates failed saves',async()=>{
 const f=fixture(),saveResult=vi.fn(async()=>{});
 const tool=createAgentMediaJobTools({...f.deps,saveResult}).find(t=>t.name==='save_agent_image_to_library')!;
 await expect(tool.handler({requestId:args.requestId},agent)).rejects.toThrow('wait');
 await f.tools[0].handler(args,agent);
 await expect(tool.handler({requestId:args.requestId},{...agent,mediaBackground:false})).rejects.toThrow('approval');
 await expect(tool.handler({requestId:args.requestId},{...agent,id:'other'})).rejects.toThrow('wait');
 expect(saveResult).not.toHaveBeenCalled();
 expect(await tool.handler({requestId:args.requestId},agent)).toMatchObject({savedToLibrary:true});
 expect(saveResult).toHaveBeenCalledWith(asset.serverUrl,'d'.repeat(32));
 saveResult.mockRejectedValueOnce(new Error('disk full'));
 await expect(tool.handler({requestId:args.requestId},agent)).rejects.toThrow('disk full');
 f.setServer('https://another.example');
 await expect(tool.handler({requestId:args.requestId},agent)).rejects.toThrow('connection');
 expect(saveResult).toHaveBeenCalledTimes(2);
});

it('guides completed jobs to Library saving only when that tool exists',async()=>{
 const f=fixture();await f.tools[0].handler(args,agent);
 for(const enabled of [false,true]){
  const tools=createAgentMediaJobTools({...f.deps,...(enabled?{saveResult:async()=>{}}:{})});
  const response=await tools.find(tool=>tool.name==='get_agent_media_request')!.handler({requestId:args.requestId},agent) as {nextStep:string};
  expect(response.nextStep.includes('save_agent_image_to_library')).toBe(enabled);
 }
});
