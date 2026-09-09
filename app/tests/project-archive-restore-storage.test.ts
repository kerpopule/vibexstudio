import {it,expect,vi} from 'vitest';
import {createHash} from 'node:crypto';
import {writeProjectDirectoryArchive} from '../src/lib/share/project-directory-archive';
const modulePath=process.env.VIBEX_TEST_INDEXEDDB_MODULE;
async function archive(meta:unknown,chat:unknown,large=false){
 const pieces:Uint8Array[]=[];
 const content=async function*(text:string){yield new TextEncoder().encode(text);};
 await writeProjectDirectoryArchive((async function*(){
  yield {path:'project.json',chunks:content(JSON.stringify(meta))};yield {path:'chat.json',chunks:content(JSON.stringify(chat))};
  yield {path:'files/index.html',chunks:content('<video src="assets/win.mp4"></video>')};
  yield {path:'files/assets/win.mp4',chunks:(async function*(){for(let i=0;i<(large?26:1);i++)yield new Uint8Array(large?1024*1024:3).fill(43);})()};
  yield {path:'media/song.wav',chunks:(async function*(){yield new Uint8Array([1,2,3]);})()};
 })(),{write:async b=>{pieces.push(new Uint8Array(b));},finish:async()=>{},abort:async()=>{}});
 return new Blob(pieces.map(p=>new Uint8Array(p)));
}
it.skipIf(!modulePath)('publishes verified large archives as fresh projects and refuses partial restores',async()=>{
 const database=await import(/* @vite-ignore */ modulePath!);vi.stubGlobal('indexedDB',new database.IDBFactory());vi.stubGlobal('IDBKeyRange',database.IDBKeyRange);
 const locks=new Set<string>();vi.stubGlobal('navigator',{locks:{request:async(name:string,options:any,cb?:any)=>{const fn=cb??options;if(cb&&locks.has(name))return fn(null);locks.add(name);try{return await fn({name});}finally{locks.delete(name);}}}});
 try{
  const storage=await import('../src/lib/storage/projects.web');
  const original=await storage.createProject('Original','');await storage.writeFile(original.id,'index.html','leave untouched');
  const meta={...original,ai:{connectionId:'secret',model:'private'},github:{repo:'private'}};
  const chat=[{id:'message',role:'user',text:'Use this',createdAt:1,attachments:[{kind:'audio',uri:`file:///old/container/projects/${original.id}/media/song.wav`}]}];
  const input=await archive(meta,chat,true),id=await storage.restoreProjectDirectoryArchive(input);
  expect(id).not.toBe(original.id);expect(await storage.readProject(id)).toMatchObject({name:'Original (restored)'});
  expect((await storage.readProject(id))?.ai).toBeUndefined();expect((await storage.readProject(id))?.github).toBeUndefined();
  expect(await storage.readFile(original.id,'index.html')).toBe('leave untouched');
  const bytes=Buffer.from((await storage.readFile(id,'assets/win.mp4'))!,'base64');
  expect(bytes.length).toBe(26*1024*1024);expect(createHash('sha256').update(bytes).digest('hex')).toBe(createHash('sha256').update(Buffer.alloc(bytes.length,43)).digest('hex'));
  expect(await storage.readFile(id,'assets/Media/song.wav')).toBe('AQID');
  expect((await storage.readChat(id))[0].attachments?.[0].uri).toBe('data:audio/wav;base64,AQID');
  const before=(await storage.listProjects()).map(p=>p.id).sort();
  const missing=await archive(meta,[{...chat[0],attachments:[{kind:'audio',uri:'https://example.com/missing.wav'}]}]);
  await expect(storage.restoreProjectDirectoryArchive(missing)).rejects.toThrow('no matching');
  expect((await storage.listProjects()).map(p=>p.id).sort()).toEqual(before);
  const corrupted=new Uint8Array(await (await archive(meta,[])).arrayBuffer());corrupted[30+'project.json'.length]^=1;
  await expect(storage.restoreProjectDirectoryArchive(new Blob([corrupted]))).rejects.toThrow('checksum');
  expect((await storage.listProjects()).map(p=>p.id).sort()).toEqual(before);
  vi.spyOn(Date,'now').mockReturnValue(123456789);vi.spyOn(Math,'random').mockReturnValue(.125);
  const collision=await storage.createProject('Collision survivor','');await storage.writeFile(collision.id,'keep.txt','keep');
  const count=(await storage.listProjects()).length;
  await expect(storage.restoreProjectDirectoryArchive(await archive({...meta,id:'another-source'},[]))).rejects.toThrow();
  expect((await storage.listProjects()).length).toBe(count);expect(await storage.readFile(collision.id,'keep.txt')).toBe('keep');
  expect(await storage.readFile(collision.id,'index.html')).toBeNull();
  expect(locks.size).toBe(0);expect(await storage.cleanupAbandonedProjectArchives()).toBe(0);
 }finally{vi.restoreAllMocks();vi.unstubAllGlobals();}
},20000);
