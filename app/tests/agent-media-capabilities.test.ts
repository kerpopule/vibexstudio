import {expect,it,vi} from 'vitest';
import {readAgentMediaCapabilities} from '../src/lib/agent-connect/media-capabilities';
import {createMediaConnectTools} from '../src/lib/agent-connect/media-tools';
import {AgentConnectCore} from '../src/lib/agent-connect/core';

it('does not contact a server or enroll a device without an existing generation connection',async()=>{
  const permitted=vi.fn().mockResolvedValue(false),engines=vi.fn();
  const deps={server:()=>null as string|null,permitted,engines};
  expect(await readAgentMediaCapabilities(deps)).toMatchObject({state:'not-connected',agentCanSubmitJobs:false,operations:[]});
  expect(permitted).not.toHaveBeenCalled();
  deps.server=()=> 'https://private.example';
  expect(await readAgentMediaCapabilities(deps)).toMatchObject({state:'generation-connection-required',operations:[]});
  expect(engines).not.toHaveBeenCalled();
});

it('reports only explicit engine fields, keeps unavailable distinct from offline, and detects connection changes',async()=>{
  let server='https://private.example';
  const engines=vi.fn().mockResolvedValue([{id:'birefnet-cpu',revision:'abc',operation:'remove-background',token:'secret',serverUrl:server,jobHistory:['private']}]);
  const deps={server:()=>server,permitted:async()=>true,engines};
  const result=await readAgentMediaCapabilities(deps);
  expect(result).toMatchObject({state:'connected',agentCanSubmitJobs:false,operations:[{id:'birefnet-cpu',revision:'abc',operation:'remove-background'}]});
  expect(JSON.stringify(result)).not.toMatch(/private|secret|serverUrl|jobHistory/);
  engines.mockResolvedValueOnce([]);
  expect(await readAgentMediaCapabilities(deps)).toMatchObject({state:'connected',operations:[]});
  engines.mockRejectedValueOnce(new Error('offline'));
  await expect(readAgentMediaCapabilities(deps)).rejects.toThrow('offline');
  engines.mockImplementationOnce(async()=>{server='https://different.example';return [];});
  await expect(readAgentMediaCapabilities(deps)).rejects.toThrow('changed');
});

it('enforces media approval for discovery after credential reload, including older project-only grants',async()=>{
  for(const mediaRead of [undefined,false,true]){
    const capabilities=vi.fn().mockResolvedValue({state:'connected',operations:[],agentCanSubmitJobs:false});
    const core=new AgentConnectCore({metadata:{load:async()=>JSON.stringify([{id:'a',name:'Agent',pairedAt:'2026-01-01',mediaRead}]),save:async()=>{}},credentials:{get:async()=> 'token',set:async()=>{},remove:async()=>{}},tools:createMediaConnectTools(async()=>[],undefined,capabilities)});
    await core.load();
    const call=(method:string,params?:unknown)=>core.route({method:'POST',path:'/mcp',headers:{authorization:'Bearer token'},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params}),remoteAddress:'127.0.0.1'});
    const listed=JSON.parse((await call('tools/list')).body).result.tools;
    expect(listed.some((tool:{name:string})=>tool.name==='get_media_capabilities')).toBe(mediaRead===true);
    const result=JSON.parse((await call('tools/call',{name:'get_media_capabilities',arguments:{}})).body);
    expect(Boolean(result.error)).toBe(mediaRead!==true);
    expect(capabilities).toHaveBeenCalledTimes(mediaRead?1:0);
  }
});

it('advertises submission only with background approval and a supported connected engine',async()=>{
  for(const allowed of [false,true])for(const ready of [false,true]){
    const tools=createMediaConnectTools(async()=>[],undefined,async()=>({state:'connected',operations:ready?[{operation:'remove-background'}]:[],agentCanSubmitJobs:false}));
    const tool=tools.find(item=>item.name==='get_media_capabilities')!;
    const result=await tool.handler({}, {id:'a',name:'A',pairedAt:'now',mediaRead:true,mediaBackground:allowed});
    expect(result).toMatchObject({agentCanSubmitJobs:allowed&&ready,agentApprovedOperations:allowed?['remove-background']:[]});
  }
});

it('reports editor availability separately from generation permission without granting execution',async()=>{
 const engines=vi.fn();
 const result=await readAgentMediaCapabilities({server:()=> 'https://private.example',permitted:async()=>false,engines,
  inspect:async()=>({integratedStudio:true,webInterface:false,editingDrafts:true,editingPreview:true,editingExport:true,editingAddSources:true}),
 });
 expect(result).toMatchObject({state:'generation-connection-required',editing:{availability:'checked',drafts:true,export:true,agentEditingTool:'apply_editing_commands',agentEditPermission:'separate-approval-required'}});
 expect(JSON.stringify(result)).not.toContain('private.example');
 expect(engines).not.toHaveBeenCalled();
});
