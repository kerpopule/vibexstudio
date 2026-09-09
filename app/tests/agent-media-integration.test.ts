import {createServer, type Server} from 'node:http';
import {afterEach, beforeEach, expect, it, vi} from 'vitest';
import {AgentConnectCore} from '../src/lib/agent-connect/core';
import {createMediaConnectTools} from '../src/lib/agent-connect/media-tools';
import {importAgentMedia} from '../src/lib/agent-connect/media-import';
import {listRemoteLibrary, readRemoteAsset} from '../src/lib/remote-library';

// Real HTTP and project implementation; isolated IndexedDB and credential fixture.
vi.mock('../src/lib/storage/secrets',()=>({getLibraryToken:async()=> 'fixture-library-token',setLibraryToken:async()=>{}}));
const modulePath=process.env.VIBEX_TEST_INDEXEDDB_MODULE;
const integration=it.skipIf(!modulePath);
let server:Server|undefined;
beforeEach(async()=>{
 if(!modulePath)return;
 const database=await import(/* @vite-ignore */ modulePath);
 vi.stubGlobal('indexedDB',new database.IDBFactory());
 vi.stubGlobal('IDBKeyRange',database.IDBKeyRange);vi.resetModules();
});
afterEach(async()=>{
 if(server){const owned=server;server=undefined;await new Promise<void>((resolve,reject)=>{owned.close(error=>error?reject(error):resolve());owned.closeAllConnections();});}
 vi.unstubAllGlobals();vi.restoreAllMocks();
});
async function fixture(allowImport:boolean){
 const storage=await import('../src/lib/storage/projects.web');
 await storage.writeProject({id:'p1',name:'Game',description:'',emoji:'✨',createdAt:1,updatedAt:1,ai:{connectionId:'device-only',model:'mine'}});
 await storage.writeChat('p1',[]);await storage.writeFile('p1','index.html','original');
 const bytes=Buffer.from([137,80,78,71,0,255,1,2]);
 let downloads=0;let beforeDownload:undefined|(()=>Promise<void>);
 server=createServer(async(req,res)=>{
  if(req.headers.authorization!=='Bearer fixture-library-token'){res.writeHead(401).end();return;}
  if(req.url==='/api/studio/library'){
   res.setHeader('Content-Type','application/json');res.end(JSON.stringify({version:1,assets:[{id:'sprite1',kind:'image',title:'Winning sprite',fileName:'sprite.png',mimeType:'image/png',bytes:bytes.length,createdAt:1}]}));return;
  }
  if(req.url==='/api/studio/library/sprite1/content'){
   downloads++;try{await beforeDownload?.();res.setHeader('Content-Type','image/png');res.end(bytes);}catch{res.writeHead(500).end();}return;
  }
  res.writeHead(404).end();
 });
 await new Promise<void>(resolve=>server!.listen(0,'127.0.0.1',resolve));
 const address=server.address();if(!address||typeof address==='string')throw new Error('Missing fixture address');
 const origin=`http://127.0.0.1:${address.port}`,refresh=vi.fn().mockResolvedValue(undefined);
 const list=()=>listRemoteLibrary(origin),tokens=new Map<string,string>();
 const core=new AgentConnectCore({metadata:{load:async()=> '[]',save:async()=>{}},credentials:{get:async(id:string)=>tokens.get(id)??null,set:async(id:string,value:string)=>{tokens.set(id,value);},remove:async(id:string)=>{tokens.delete(id);}},tools:createMediaConnectTools(list,input=>importAgentMedia({list,read:readRemoteAsset,project:storage.readProject,commit:storage.importBinaryAssetExclusive,busy:()=>false,refresh},input))});
 const ticket=core.issueTicket();
 const pending=core.route({method:'POST',path:'/pair',headers:{},body:JSON.stringify({code:ticket.code,agentName:'Fixture agent'}),remoteAddress:'127.0.0.1'});
 await core.resolveApproval(true,true,allowImport);
 const token=JSON.parse((await pending).body).token;
 const call=async(name:string,args:Record<string,unknown>={})=>JSON.parse((await core.route({method:'POST',path:'/mcp',headers:{authorization:`Bearer ${token}`},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',params:{name,arguments:args}}),remoteAddress:'127.0.0.1'})).body);
 return {storage,bytes,refresh,call,downloads:()=>downloads,onDownload:(hook:()=>Promise<void>)=>{beforeDownload=hook;}};
}
const input={projectId:'p1',assetId:'sprite1',path:'assets/sprite.png'};
integration('imports HTTP library bytes through approved MCP into project storage',async()=>{
 const f=await fixture(true);
 const listed=await f.call('list_media_assets');expect(listed.result.structuredContent.assets[0].id).toBe('sprite1');
 expect(JSON.stringify(listed)).not.toMatch(/fixture-library-token|127\.0\.0\.1|serverUrl/);
 const result=await f.call('import_media_asset',input);
 expect(result.result.isError).toBe(false);expect(result.result.structuredContent).toMatchObject({...input,bytes:f.bytes.length});
 expect(await f.storage.readFile('p1',input.path)).toBe(f.bytes.toString('base64'));
 expect((await f.storage.listFiles('p1')).find(file=>file.path===input.path)?.encoding).toBe('base64');
 expect((await f.storage.readProject('p1'))?.ai?.connectionId).toBe('device-only');
 expect(await f.storage.readFile('p1','index.html')).toBe('original');expect(f.refresh).toHaveBeenCalledWith('p1');
 const beforeRepeat=await f.storage.readSyncSnapshot('p1');
 const repeat=await f.call('import_media_asset',input);expect(repeat.result.isError).toBe(false);expect(repeat.result.structuredContent.alreadyImported).toBe(true);expect(f.downloads()).toBe(2);
 expect(await f.storage.readSyncSnapshot('p1')).toBe(beforeRepeat);expect(f.refresh).toHaveBeenCalledTimes(2);
});
integration('denies an agent with metadata-only permission before any download or write',async()=>{
 const f=await fixture(false),before=await f.storage.readSyncSnapshot('p1');
 expect((await f.call('import_media_asset',input)).error).toBeDefined();
 expect(f.downloads()).toBe(0);expect(await f.storage.readSyncSnapshot('p1')).toBe(before);expect(f.refresh).not.toHaveBeenCalled();
});
integration('preserves a project edit made while the HTTP asset is downloading',async()=>{
 const f=await fixture(true);f.onDownload(()=>f.storage.writeFile('p1','index.html','edited during download'));
 const result=await f.call('import_media_asset',input);expect(result.result.isError).toBe(false);
 expect(await f.storage.readFile('p1','index.html')).toBe('edited during download');
 expect(await f.storage.readFile('p1',input.path)).toBe(f.bytes.toString('base64'));expect(f.refresh).toHaveBeenCalledOnce();
});
