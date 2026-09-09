import {createHash} from 'node:crypto';
import {createServer} from 'node:http';
import {expect,it,vi} from 'vitest';
import {createAgentMediaJobTools} from '../src/lib/agent-connect/media-jobs';
import {AgentConnectCore} from '../src/lib/agent-connect/core';
import {prepareAgentBackgroundRequest,findBackgroundRequest,advanceBackgroundRequest} from '../src/lib/background-workflow';
import {importAgentImageResult} from '../src/lib/agent-connect/media-import';
import {encodeProjectSnapshot,decodeProjectSnapshot} from '../src/lib/sync/project-snapshot';
import {listBackgroundEngines,readBackgroundResult} from '../src/lib/remote-generation';
import type {RemoteLibraryAsset} from '../src/lib/library-core';

const state=vi.hoisted(()=>({storage:new Map<string,string>(),connections:new Map<string,string>()}));
vi.mock('@react-native-async-storage/async-storage',()=>({default:{
  getItem:async(key:string)=>state.storage.get(key)??null,
  setItem:async(key:string,value:string)=>{state.storage.set(key,value);},
  getAllKeys:async()=>[...state.storage.keys()],multiGet:async(keys:string[])=>keys.map(key=>[key,state.storage.get(key)??null]),
}}));
vi.mock('@/lib/storage/secrets',()=>({
  getGenerationConnection:async(origin:string)=>state.connections.get(origin)??null,
  getLibraryToken:async()=> 'mlab-library-v1.fixture',
}));
vi.mock('expo-crypto',()=>({CryptoDigestAlgorithm:{SHA256:'SHA-256'},digest:async(_algorithm:string,buffer:ArrayBuffer)=>Uint8Array.from(createHash('sha256').update(new Uint8Array(buffer)).digest()).buffer}));

it('pairs an approved agent and recovers an accepted HTTP job after a lost response without changing its request',async()=>{
  const engine={id:'birefnet-cpu',revision:'fixture-revision',operation:'remove-background'};
  const input={version:1,id:'b'.repeat(32),sha256:'c'.repeat(64),bytes:100,width:4,height:3};
  const job={id:'d'.repeat(32),kind:'image',status:'queued',createdAt:1,updatedAt:1};
  const png=Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jZ1kAAAAASUVORK5CYII=','base64'));
  const requests:{path:string;body:string}[]=[];
  const submissions:string[]=[];
  let token='';
  const host=createServer(async(req,res)=>{
    let body='';for await(const chunk of req)body+=chunk;
    requests.push({path:req.url!,body});
    if(req.headers.authorization!==`Bearer ${token}`){res.writeHead(401);res.end();return;}
    res.setHeader('Content-Type','application/json');
    if(req.url==='/api/studio/engines'){res.end(JSON.stringify({version:1,engines:[engine]}));return;}
    if(req.url==='/api/studio/inputs/library'){
      if(req.headers['x-library-authorization']!=='Bearer mlab-library-v1.fixture'){res.writeHead(403);res.end();return;}
      res.end(JSON.stringify(input));return;
    }
    if(req.url==='/api/studio/jobs'){
      submissions.push(body);
      if(submissions.length===1){req.socket.destroy();return;}
      res.end(JSON.stringify(job));return;
    }
    if(req.url===`/api/studio/jobs/${job.id}/content`){
      res.setHeader('Content-Type','image/png');res.setHeader('Content-Length',String(png.length));res.setHeader('X-Content-SHA256',createHash('sha256').update(png).digest('hex'));res.end(png);return;
    }
    if(req.url===`/api/studio/jobs/${job.id}`){res.end(JSON.stringify({...job,status:'succeeded'}));return;}
    res.writeHead(404);res.end();
  });
  await new Promise<void>(resolve=>host.listen(0,'127.0.0.1',resolve));
  try {
    const address=host.address();if(!address||typeof address==='string')throw new Error('Missing fixture address');
    const origin=`http://127.0.0.1:${address.port}`;
    const device='e'.repeat(32);
    token=`mlab-render-v1.user.1788554000.${device}.${'f'.repeat(64)}`;
    state.connections.set(origin,JSON.stringify({deviceId:device,token}));
    const asset={id:'image-one',serverUrl:origin,mimeType:'image/png',title:'Fixture image'} as RemoteLibraryAsset;
    let project=encodeProjectSnapshot({meta:{id:'p1',name:'HTTP fixture',description:'',emoji:'✨',createdAt:1,updatedAt:1},files:[],chat:[]});
    const tools=createAgentMediaJobTools({server:()=>origin,identity:async value=>createHash('sha256').update(value).digest('hex').slice(0,32),list:async()=>[asset],engines:listBackgroundEngines,find:findBackgroundRequest,prepare:prepareAgentBackgroundRequest,advance:advanceBackgroundRequest,
      importResult:(input,server,id,assertConnection)=>importAgentImageResult({project:async()=>decodeProjectSnapshot(project).meta,commit:async(id,path,bytes,createdAt)=>{const snapshot=decodeProjectSnapshot(project);if(snapshot.meta.id!==id||snapshot.meta.createdAt!==createdAt)throw new Error('Project changed');const content=Buffer.from(bytes).toString('base64'),existing=snapshot.files.find(file=>file.path===path);if(existing){if(existing.content!==content)throw new Error('File exists');return {alreadyImported:true};}snapshot.files.push({path,content,encoding:'base64'});project=encodeProjectSnapshot(snapshot);return {alreadyImported:false};},busy:()=>false,refresh:async()=>{}},input,async()=>{assertConnection();const bytes=await readBackgroundResult(server,id,16*1024*1024);assertConnection();return bytes;}),
    });
    let metadata='[]';const credentials=new Map<string,string>();
    const options={metadata:{load:async()=>metadata,save:async(value:string)=>{metadata=value;}},credentials:{get:async(id:string)=>credentials.get(id)??null,set:async(id:string,value:string)=>{credentials.set(id,value);},remove:async(id:string)=>{credentials.delete(id);}},tools};
    const core=new AgentConnectCore(options),ticket=core.issueTicket();
    const pairing=core.route({method:'POST',path:'/pair',headers:{},body:JSON.stringify({code:ticket.code,agentName:'HTTP job fixture'}),remoteAddress:'127.0.0.1'});
    await core.resolveApproval(true,true,true,true);
    const agentToken=JSON.parse((await pairing).body).token;
    const call=async(target:AgentConnectCore,name:string,args:unknown)=>JSON.parse((await target.route({method:'POST',path:'/mcp',headers:{authorization:`Bearer ${agentToken}`},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',params:{name,arguments:args}}),remoteAddress:'127.0.0.1'})).body);
    const args={requestId:'http-fixture-request-01',assetId:asset.id,engineId:engine.id,revision:engine.revision};
    expect((await call(core,'remove_media_background',args)).result.isError).toBe(true);
    expect(submissions).toHaveLength(1);
    const resumed=new AgentConnectCore(options);await resumed.load();
    expect((await call(resumed,'get_agent_media_request',{requestId:args.requestId})).result.structuredContent.status).toBe('acceptance-unknown');
    expect(submissions).toHaveLength(1);
    const result=await call(resumed,'remove_media_background',args);
    expect(result.result.structuredContent).toMatchObject({status:'succeeded',jobId:job.id});
    expect(submissions).toHaveLength(2);expect(submissions[1]).toBe(submissions[0]);
    expect(JSON.parse(submissions[0])).toMatchObject({engineId:engine.id,revision:engine.revision,settings:{inputId:input.id,inputSha256:input.sha256}});
    expect(requests.filter(request=>request.path==='/api/studio/inputs/library')).toHaveLength(1);
    expect([...state.storage.values()].join('')).not.toContain(token);
    expect(JSON.stringify(result)).not.toContain(origin);
    const imported=await call(resumed,'import_agent_media_result',{requestId:args.requestId,projectId:'p1',path:'assets/character.png'});
    expect(imported.result.structuredContent).toMatchObject({path:'assets/character.png',bytes:png.length});
    expect(decodeProjectSnapshot(project).files).toEqual([{path:'assets/character.png',content:Buffer.from(png).toString('base64'),encoding:'base64'}]);
    const repeated=await call(resumed,'import_agent_media_result',{requestId:args.requestId,projectId:'p1',path:'assets/character.png'});
    expect(repeated.result.isError).toBe(false);expect(repeated.result.structuredContent.alreadyImported).toBe(true);
    expect(requests.filter(request=>request.path.endsWith('/content'))).toHaveLength(2);
    await resumed.revokeAgent(resumed.agents[0].id);
  } finally {
    host.closeAllConnections();await new Promise<void>((resolve,reject)=>host.close(error=>error?reject(error):resolve()));
    state.storage.clear();state.connections.clear();
  }
});

it.each([true,false])('persists cancellation across a lost HTTP response without creating work (known job: %s)',async(known)=>{
 const owner='a'.repeat(24),requestId='cancel-http-request-0001';
 const id=createHash('sha256').update(`vibex-agent-background-v1\n${owner}\n${requestId}`).digest('hex').slice(0,32);
 const job={id:'d'.repeat(32),kind:'image',status:'running',createdAt:1,updatedAt:1};
 const route=known ? `/api/studio/jobs/${job.id}/cancel` : '/api/studio/requests/cancel';
 const seen:string[]=[];
 const host=createServer((req,res)=>{
  seen.push(req.method+' '+req.url);
  if(req.headers.authorization!=='Bearer cancel-fixture-token'){res.writeHead(401);res.end();return;}
  if(req.method!=='POST'||req.url!==route){res.writeHead(404);res.end();return;}
  if(seen.length===1){req.socket.destroy();return;}
  res.setHeader('Content-Type','application/json');res.end(JSON.stringify({...job,status:'cancelled'}));
 });
 await new Promise<void>(resolve=>host.listen(0,'127.0.0.1',resolve));
 try{
  const address=host.address();if(!address||typeof address==='string')throw new Error('Missing fixture address');
  const origin=`http://127.0.0.1:${address.port}`;
  state.connections.set(origin,JSON.stringify({deviceId:'e'.repeat(32),token:'cancel-fixture-token'}));
  state.storage.set('vibex.background.v1.'+id,JSON.stringify({version:1,requestId:id,agentOwner:owner,origin,assetId:'image-one',title:'Test',createdAt:1,engine:{id:'birefnet-cpu',revision:'fixture-revision',operation:'remove-background'},input:{id:'b'.repeat(32),sha256:'c'.repeat(64),bytes:1,width:1,height:1},job:known?job:null,cancelRequested:false}));
  const tools=createAgentMediaJobTools({server:()=>origin,identity:async value=>createHash('sha256').update(value).digest('hex').slice(0,32),list:async()=>[],engines:listBackgroundEngines,find:findBackgroundRequest,prepare:prepareAgentBackgroundRequest,advance:advanceBackgroundRequest,cancel:id=>advanceBackgroundRequest(id,true)});
  const core=new AgentConnectCore({metadata:{load:async()=>JSON.stringify([{id:owner,name:'Cancel test',pairedAt:'2026-01-01',mediaBackground:true}]),save:async()=>{}},credentials:{get:async()=> 'agent-token',set:async()=>{},remove:async()=>{}},tools});
  await core.load();
  const call=async(name:string)=>JSON.parse((await core.route({method:'POST',path:'/mcp',headers:{authorization:'Bearer agent-token'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',params:{name,arguments:{requestId}}}),remoteAddress:'127.0.0.1'})).body).result;
  expect((await call('cancel_agent_media_request')).isError).toBe(true);
  expect((await findBackgroundRequest(id))?.cancelRequested).toBe(true);
  expect((await call('get_agent_media_request')).structuredContent).toMatchObject({status:'cancelled',cancellationRequested:true});
  expect(seen).toEqual([`POST ${route}`,`POST ${route}`]);
  expect((await call('cancel_agent_media_request')).structuredContent.status).toBe('cancelled');
  expect(seen).toHaveLength(2);
 }finally{
  host.closeAllConnections();await new Promise<void>((resolve,reject)=>host.close(error=>error?reject(error):resolve()));
  state.storage.clear();state.connections.clear();
 }
});
