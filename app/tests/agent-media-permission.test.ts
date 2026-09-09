import {expect,it,vi} from 'vitest';
import {AgentConnectCore} from '../src/lib/agent-connect/core';
import {createMediaConnectTools} from '../src/lib/agent-connect/media-tools';
it('requires explicit media approval and persists it across restart', async () => {
  for (const grant of [false,true]) {
    let saved='[]'; const tokens=new Map<string,string>(); const list=vi.fn().mockResolvedValue([]);
    const options={metadata:{load:async()=>saved,save:async(v:string)=>{saved=v;}},credentials:{get:async(id:string)=>tokens.get(id)??null,set:async(id:string,v:string)=>{tokens.set(id,v);},remove:async(id:string)=>{tokens.delete(id);}},tools:createMediaConnectTools(list)};
    const core=new AgentConnectCore(options); const ticket=core.issueTicket();
    const pending=core.route({method:'POST',path:'/pair',headers:{},body:JSON.stringify({code:ticket.code,agentName:'Test'}),remoteAddress:'192.168.1.2'});
    await core.resolveApproval(true,grant);
    const token=JSON.parse((await pending).body).token;
    const restored=new AgentConnectCore(options);await restored.load();
    const request=(method:string,params?:unknown)=>restored.route({method:'POST',path:'/mcp',headers:{authorization:`Bearer ${token}`},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params}),remoteAddress:'192.168.1.2'});
    expect(JSON.parse((await request('tools/list')).body).result.tools.length).toBe(grant?1:0);
    const result=JSON.parse((await request('tools/call',{name:'list_media_assets',arguments:{}})).body);
    expect(Boolean(result.error)).toBe(!grant);expect(list).toHaveBeenCalledTimes(grant?1:0);
  }
});
it('bounds metadata and excludes server URLs and undeclared fields',async()=>{
 const assets=Array.from({length:101},(_,createdAt)=>({id:String(createdAt),kind:'image' as const,title:'x'.repeat(300),prompt:'p'.repeat(2000),createdAt,fileName:'sprite.png',mimeType:'image/png',bytes:10,providerLabel:'local',serverUrl:'https://private.example',token:'secret'}));
 const result=await createMediaConnectTools(async()=>assets)[0].handler({}, {id:'a',name:'A',pairedAt:'now',mediaRead:true}) as {assets:Record<string,unknown>[];truncated:boolean};
 expect(result.assets).toHaveLength(100);expect(result.truncated).toBe(true);expect(result.assets[0].id).toBe('100');
 expect(String(result.assets[0].title)).toHaveLength(200);expect(String(result.assets[0].prompt)).toHaveLength(1000);
 expect(JSON.stringify(result)).not.toMatch(/private\.example|secret|serverUrl/);
});
it('does not expand an older saved agent grant',async()=>{
 const list=vi.fn().mockResolvedValue([]);
 const core=new AgentConnectCore({metadata:{load:async()=>JSON.stringify([{id:'old',name:'Old agent',pairedAt:'2026-01-01'}]),save:async()=>{}},credentials:{get:async()=> 'old-token',set:async()=>{},remove:async()=>{}},tools:createMediaConnectTools(list)});
 await core.load();
 const response=await core.route({method:'POST',path:'/mcp',headers:{authorization:'Bearer old-token'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'list_media_assets',arguments:{}}}),remoteAddress:'192.168.1.2'});
 expect(JSON.parse(response.body).error).toBeDefined();expect(list).not.toHaveBeenCalled();
});
it('requires separate import consent and preserves that distinction after reload',async()=>{
 for(const allowImport of [false,true]){
  let saved='[]';const tokens=new Map<string,string>(),copy=vi.fn().mockResolvedValue({path:'assets/sprite.png'});
  const options={metadata:{load:async()=>saved,save:async(v:string)=>{saved=v;}},credentials:{get:async(id:string)=>tokens.get(id)??null,set:async(id:string,v:string)=>{tokens.set(id,v);},remove:async(id:string)=>{tokens.delete(id);}},tools:createMediaConnectTools(async()=>[],copy)};
  const core=new AgentConnectCore(options),ticket=core.issueTicket();
  const pending=core.route({method:'POST',path:'/pair',headers:{},body:JSON.stringify({code:ticket.code,agentName:'Test'}),remoteAddress:'127.0.0.1'});
  await core.resolveApproval(true,true,allowImport);const token=JSON.parse((await pending).body).token;
  const restored=new AgentConnectCore(options);await restored.load();
  const response=await restored.route({method:'POST',path:'/mcp',headers:{authorization:`Bearer ${token}`},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'import_media_asset',arguments:{projectId:'p1',assetId:'a1',path:'assets/sprite.png'}}}),remoteAddress:'127.0.0.1'});
  expect(Boolean(JSON.parse(response.body).error)).toBe(!allowImport);expect(copy).toHaveBeenCalledTimes(allowImport?1:0);
 }
});
