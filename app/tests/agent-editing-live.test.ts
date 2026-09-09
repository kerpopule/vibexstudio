/** Opt-in: supplied credentials must target an isolated, disposable editing draft. */
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {it,expect,vi} from 'vitest';
const fixture=vi.hoisted(()=>({value:null as null|{origin:string;deviceId:string;token:string;libraryToken:string;draftId:string;sourceAssetId?:string}}));
const pending=vi.hoisted(()=>new Map([['human-pending-edit','leave untouched']]));
vi.mock('@react-native-async-storage/async-storage',()=>({default:{getItem:async(key:string)=>pending.get(key)??null,setItem:async(key:string,value:string)=>{pending.set(key,value)},removeItem:async(key:string)=>{pending.delete(key)}}}));
vi.mock('@/lib/storage/secrets',()=>({getEditingConnection:async()=>JSON.stringify({deviceId:fixture.value!.deviceId,token:fixture.value!.token}),getLibraryToken:async()=>fixture.value!.libraryToken}));
vi.mock('expo-crypto',()=>({CryptoDigestAlgorithm:{SHA256:'SHA-256'},digestStringAsync:async(_:string,value:string)=>createHash('sha256').update(value).digest('hex')}));
import {applyAgentTimelineEdit,readEditingTimeline} from '../src/lib/remote-editing';
import {createEditingMutationTools} from '../src/lib/agent-connect/editing-mutations';
import {AgentConnectCore} from '../src/lib/agent-connect/core';
it.skipIf(!process.env.VIBEX_AGENT_EDIT_LIVE_FILE)('applies, retries, rejects collisions and undoes through real server transactions',async()=>{
 fixture.value=JSON.parse(readFileSync(process.env.VIBEX_AGENT_EDIT_LIVE_FILE!,'utf8'));
 const f=fixture.value!;
 expect(f.origin).toBe('http://127.0.0.1:61968');
 const before=await readEditingTimeline(f.origin,f.draftId);
 expect(before.title).toBe('Agent transaction verification 20z');expect(before.revision).toBe(0);
 const core=new AgentConnectCore({metadata:{load:async()=>JSON.stringify([{id:'20z-agent',name:'Isolated verification',pairedAt:'now',mediaRead:true,mediaEdit:true}]),save:async()=>{}},credentials:{get:async()=> 'local-protocol-fixture',set:async()=>{},remove:async()=>{}},tools:createEditingMutationTools({server:()=>f.origin,identity:async value=>createHash('sha256').update(value).digest('hex'),apply:applyAgentTimelineEdit})});
 await core.load();
 const call=async(args:Record<string,unknown>)=>{
 const reply=await core.route({method:'POST',path:'/mcp',headers:{authorization:'Bearer local-protocol-fixture'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'apply_editing_commands',arguments:args}}),remoteAddress:'127.0.0.1'});
 return JSON.parse(reply.body).result;
 };
 const change={draftId:f.draftId,requestId:'agent-caption-20z-01',revision:0,commands:[{id:'caption',type:'caption.add',payload:{caption_id:'agent-caption',text:'Agent edit verification',start_frame:0,end_frame:24}}]};
 const applied=await call(change);expect(applied.isError).toBe(false);expect(applied.structuredContent.revision).toBe(1);
 const repeated=await call(change);expect(repeated.isError).toBe(false);expect(repeated.structuredContent.revision).toBe(1);
 const collision=await call({...change,commands:[{...change.commands[0],payload:{...change.commands[0].payload,text:'Do not apply'}}]});expect(collision.isError).toBe(true);
 const conflict=await call({...change,requestId:'agent-caption-20z-02'});expect(conflict.isError).toBe(true);
 const edited=await readEditingTimeline(f.origin,f.draftId);expect(edited.revision).toBe(1);expect(edited.captions).toEqual([{id:'agent-caption',text:'Agent edit verification',start:0,end:24}]);
 const undone=await call({draftId:f.draftId,requestId:'agent-undo-20z-0001',revision:1,commands:[{id:'undo',type:'undo',payload:{}}]});expect(undone.isError).toBe(false);
 const restored=await readEditingTimeline(f.origin,f.draftId);expect(restored.revision).toBe(2);expect(restored.captions).toEqual(before.captions);expect(restored.tracks).toEqual(before.tracks);
 expect([...pending]).toEqual([['human-pending-edit','leave untouched']]);
},30000);
it.skipIf(!process.env.VIBEX_AGENT_CREATE_LIVE_FILE)('creates the same live draft on retry and rejects changed inputs',async()=>{
 fixture.value=JSON.parse(readFileSync(process.env.VIBEX_AGENT_CREATE_LIVE_FILE!,'utf8'));
 const f=fixture.value!;expect(f.origin).toBe('http://127.0.0.1:61968');
 const {createAgentDraftTool}=await import('../src/lib/agent-connect/editing-create');
 const {createAgentEditingDraft,listEditingDrafts}=await import('../src/lib/remote-editing');
 const core=new AgentConnectCore({metadata:{load:async()=>JSON.stringify([{id:'20aa-agent',name:'Test',pairedAt:'now',mediaRead:true,mediaEdit:true}]),save:async()=>{}},credentials:{get:async()=> 'local-protocol-fixture',set:async()=>{},remove:async()=>{}},tools:[createAgentDraftTool({server:()=>f.origin,identity:async value=>createHash('sha256').update(value).digest('hex'),create:createAgentEditingDraft})]});
 await core.load();
 const call=async(args:Record<string,unknown>)=>JSON.parse((await core.route({method:'POST',path:'/mcp',headers:{authorization:'Bearer local-protocol-fixture'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'create_editing_draft',arguments:args}}),remoteAddress:'127.0.0.1'})).body).result;
 const input={requestId:'draft-create-20aa-01',title:'Agent draft creation verification 20aa',assetIds:[f.sourceAssetId]};
 const first=await call(input);expect(first.isError).toBe(false);
 const retry=await call(input);expect(retry.isError).toBe(false);expect(retry.structuredContent.draftId).toBe(first.structuredContent.draftId);
 expect((await call({...input,title:'Must not replace original'})).isError).toBe(true);
 const drafts=await listEditingDrafts(f.origin);expect(drafts).toHaveLength(1);expect(drafts[0].title).toBe(input.title);
 const timeline=await readEditingTimeline(f.origin,first.structuredContent.draftId);expect(timeline.revision).toBe(0);expect(timeline.tracks.flatMap(t=>t.clips)).toHaveLength(1);
 expect([...pending]).toEqual([['human-pending-edit','leave untouched']]);
},30000);
it.skipIf(!process.env.VIBEX_AGENT_RENDER_LIVE_FILE)('renders and recovers the same export through the MCP dispatcher and real server',async()=>{
 fixture.value=JSON.parse(readFileSync(process.env.VIBEX_AGENT_RENDER_LIVE_FILE!,'utf8'));
 const f=fixture.value!;expect(f.origin).toBe('http://127.0.0.1:61969');
 const {createEditingRenderTools,createSaveEditingExportTool}=await import('../src/lib/agent-connect/editing-render');
 const {startEditingExportJob,readEditingExportJob,saveExportToLibrary}=await import('../src/lib/remote-editing');
 expect((await readEditingTimeline(f.origin,f.draftId)).title).toBe('Agent render verification 20ai');
 const core=new AgentConnectCore({metadata:{load:async()=>JSON.stringify([{id:'20ai-agent',name:'Test',pairedAt:'now',mediaRead:true,mediaRender:true}]),save:async()=>{}},credentials:{get:async()=> 'local-protocol-fixture',set:async()=>{},remove:async()=>{}},tools:[...createEditingRenderTools({server:()=>f.origin,start:startEditingExportJob,read:readEditingExportJob}),createSaveEditingExportTool({server:()=>f.origin,save:saveExportToLibrary})]});
 await core.load();
 const call=async(name:string)=>JSON.parse((await core.route({method:'POST',path:'/mcp',headers:{authorization:'Bearer local-protocol-fixture'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',params:{name,arguments:{draftId:f.draftId,revision:0}}}),remoteAddress:'127.0.0.1'})).body).result;
 const started=await call('start_editing_export');expect(started.isError).toBe(false);
 expect(['running','ready']).toContain(started.structuredContent.state);
 let result=started;
 for(let i=0;i<40&&result.structuredContent.state==='running';i++){
  await new Promise(resolve=>setTimeout(resolve,250));result=await call('read_editing_export_job');expect(result.isError).toBe(false);
 }
 expect(result.structuredContent.state).toBe('ready');expect(result.structuredContent.receipt.bytes).toBeGreaterThan(0);
 const repeated=await call('start_editing_export');expect(repeated.structuredContent).toEqual(result.structuredContent);
 const saved=await call('save_editing_export_to_library');expect(saved.isError).toBe(false);
 expect((await call('save_editing_export_to_library')).structuredContent.assetId).toBe(saved.structuredContent.assetId);
 const {listRemoteLibrary,readRemoteAsset}=await import('../src/lib/remote-library');
 const assets=await listRemoteLibrary(f.origin),asset=assets.find(a=>a.id===saved.structuredContent.assetId)!;
 expect(asset.folder).toBe('Videos/Edits');expect(assets.filter(a=>a.id===asset.id)).toHaveLength(1);
 const {importAgentMedia}=await import('../src/lib/agent-connect/media-import');
 const {encodeProjectSnapshot,decodeProjectSnapshot}=await import('../src/lib/sync/project-snapshot');
 let snapshot=encodeProjectSnapshot({meta:{id:'p1',name:'Game',description:'',emoji:'',createdAt:1,updatedAt:1},chat:[],files:[]});
 await importAgentMedia({list:()=>listRemoteLibrary(f.origin),read:readRemoteAsset,project:async()=>decodeProjectSnapshot(snapshot).meta,commit:async(_id,path,bytes)=>{const value=decodeProjectSnapshot(snapshot);value.files.push({path,content:Buffer.from(bytes).toString('base64'),encoding:'base64'});snapshot=encodeProjectSnapshot(value);return {alreadyImported:false};},busy:()=>false,refresh:async()=>{}},{projectId:'p1',assetId:asset.id,path:'assets/win.mp4'});
 const file=decodeProjectSnapshot(snapshot).files[0];expect(file.path).toBe('assets/win.mp4');
 expect(createHash('sha256').update(Buffer.from(file.content,'base64')).digest('hex')).toBe(result.structuredContent.receipt.sha256);

 expect([...pending]).toEqual([['human-pending-edit','leave untouched']]);
},20000);
