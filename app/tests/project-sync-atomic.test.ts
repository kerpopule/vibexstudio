import {beforeEach,afterEach,it,expect,vi} from 'vitest';
import {encodeProjectSnapshot} from '../src/lib/sync/project-snapshot';
// Opt-in IndexedDB implementation; native/browser acceptance is a separate gate.
const modulePath=process.env.VIBEX_TEST_INDEXEDDB_MODULE;
const atomic=it.skipIf(!modulePath);
let database:any;
beforeEach(async()=>{
 if(!modulePath)return;
 database=await import(/* @vite-ignore */ modulePath);
 vi.stubGlobal('indexedDB',new database.IDBFactory());vi.stubGlobal('IDBKeyRange',database.IDBKeyRange);vi.resetModules();
});
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllGlobals();});
const snapshot={meta:{id:'p1',name:'Synced',description:'',emoji:'✨',createdAt:1,updatedAt:2},chat:[{id:'m1',role:'user' as const,text:'hello',createdAt:1}],files:[{path:'index.html',content:'new'}]};
async function setup(){
 const storage=await import('../src/lib/storage/projects.web');
 await storage.writeProject({...snapshot.meta,name:'Original',ai:{connectionId:'local-only',model:'mine'}});
 await storage.writeChat('p1',[]);await storage.writeFile('p1','old.txt','original');
 const expected=encodeProjectSnapshot({meta:(await storage.readProject('p1'))!,chat:await storage.readChat('p1'),files:await storage.listFiles('p1')});
 return {storage,expected};
}
atomic('imports a missing project atomically without provider identities',async()=>{
 const storage=await import('../src/lib/storage/projects.web');
 await storage.replaceSyncedProject(encodeProjectSnapshot(snapshot),null);
 expect(await storage.readFile('p1','index.html')).toBe('new');expect(await storage.readChat('p1')).toEqual(snapshot.chat);
});
atomic('replaces old files and chat while preserving local AI binding',async()=>{
 const {storage,expected}=await setup();await storage.replaceSyncedProject(encodeProjectSnapshot(snapshot),expected);
 expect(await storage.readFile('p1','old.txt')).toBeNull();expect(await storage.readFile('p1','index.html')).toBe('new');
 expect((await storage.readProject('p1'))?.ai?.connectionId).toBe('local-only');
});
atomic('rejects a local edit made after reading the sync baseline',async()=>{
 const {storage,expected}=await setup();await storage.writeFile('p1','old.txt','edited while syncing');
 await expect(storage.replaceSyncedProject(encodeProjectSnapshot(snapshot),expected)).rejects.toThrow('changed while syncing');
 expect(await storage.readFile('p1','old.txt')).toBe('edited while syncing');expect(await storage.readFile('p1','index.html')).toBeNull();
});
atomic('rolls back deletion and replacement writes when a later write fails',async()=>{
 const {storage,expected}=await setup();const put=database.IDBObjectStore.prototype.put;
 vi.spyOn(database.IDBObjectStore.prototype,'put').mockImplementation(function(this:IDBObjectStore,value:any,key:any){
  if(key==='chat:p1')throw new Error('Simulated quota failure');return put.call(this,value,key);
 });
 await expect(storage.replaceSyncedProject(encodeProjectSnapshot(snapshot),expected)).rejects.toThrow('quota failure');
 expect(await storage.readFile('p1','old.txt')).toBe('original');expect(await storage.readFile('p1','index.html')).toBeNull();
 expect((await storage.readProject('p1'))?.name).toBe('Original');expect(await storage.readChat('p1')).toEqual([]);
});

atomic('imports attachment bytes and readable chat URI in the same transaction',async()=>{
 const storage=await import('../src/lib/storage/projects.web');
 const value={...snapshot,files:[{path:'image.png',content:'aGVsbG8=',encoding:'base64' as const}],chat:[{...snapshot.chat[0],attachments:[{kind:'image' as const,uri:'vibex-project-file:image.png'}]}]};
 const raw=encodeProjectSnapshot(value);await storage.replaceSyncedProject(raw,null);
 expect(await storage.readFile('p1','image.png')).toBe('aGVsbG8=');
 expect((await storage.readChat('p1'))[0].attachments?.[0].uri).toBe('data:image/png;base64,aGVsbG8=');
 expect(encodeProjectSnapshot({meta:(await storage.readProject('p1'))!,chat:await storage.readChat('p1'),files:await storage.listFiles('p1')})).toBe(raw);
});

atomic('captures portable backup records consistently and reports missing projects',async()=>{
 const {storage,expected}=await setup();
 expect(await storage.readSyncSnapshot('p1')).toBe(expected);
 expect(await storage.readSyncSnapshot('missing')).toBeNull();
 await expect(storage.readSyncSnapshot('../other')).rejects.toThrow('identity');
});
