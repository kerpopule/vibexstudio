import {it,expect,vi} from 'vitest';
import {createHash} from 'node:crypto';
const modulePath=process.env.VIBEX_TEST_INDEXEDDB_MODULE;
it.skipIf(!modulePath)('freezes large project bytes before concurrent edits and disposes temporary records',async()=>{
 const database=await import(/* @vite-ignore */ modulePath!);
 vi.stubGlobal('indexedDB',new database.IDBFactory());vi.stubGlobal('IDBKeyRange',database.IDBKeyRange);
 const held=new Set<string>();
 vi.stubGlobal('navigator',{locks:{request:async(name:string,options:any,callback?:any)=>{const fn=callback??options;if(callback&&held.has(name))return fn(null);held.add(name);try{return await fn({name});}finally{held.delete(name);}}}});
 try{
  const storage=await import('../src/lib/storage/projects.web');
  const p=await storage.createProject('Archive test','');
  const bytes=Buffer.alloc(26*1024*1024,43),expected=createHash('sha256').update(bytes).digest('hex');
  await storage.writeBinaryFile(p.id,'assets/video.mp4',bytes.toString('base64'));
  await storage.writeFile(p.id,'index.html','before');
  // Place a surrogate pair across the encoder's chunk boundary.
  const unicode='x'.repeat(65535)+'🎬';await storage.writeFile(p.id,'unicode.txt',unicode);
  await storage.writeProject({...p,ai:{connectionId:'private-link',model:'private-model'}});
  const staged=await storage.stageProjectDirectoryArchive(p.id);
  expect(await storage.cleanupAbandonedProjectArchives()).toBe(0);
  await storage.writeFile(p.id,'index.html','after');
  await storage.writeBinaryFile(p.id,'assets/video.mp4','AQID');
  const found=new Map<string,{size:number;hash:string;text?:string}>();
  try{
   for await(const file of staged.entries){
    const hash=createHash('sha256');let size=0;const text:Buffer[]=[];
    for await(const chunk of file.chunks){expect(chunk.length).toBeLessThanOrEqual(1024*1024);hash.update(chunk);size+=chunk.length;if(file.path!=='files/assets/video.mp4')text.push(Buffer.from(chunk));}
    found.set(file.path,{size,hash:hash.digest('hex'),text:Buffer.concat(text).toString('utf8')});
   }
  }finally{await staged.dispose();}
  expect(found.get('files/assets/video.mp4')).toMatchObject({size:bytes.length,hash:expected});
  expect(found.get('files/index.html')?.text).toBe('before');
  expect(JSON.parse(found.get('project.json')!.text!).ai).toBeUndefined();
  expect(found.get('files/unicode.txt')?.text).toBe(unicode);
  expect(await storage.readFile(p.id,'index.html')).toBe('after');
  expect(await storage.readFile(p.id,'assets/video.mp4')).toBe('AQID');
  const db=await new Promise<IDBDatabase>((resolve,reject)=>{const r=indexedDB.open('vibex-projects');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
  const keys=await new Promise<IDBValidKey[]>((resolve,reject)=>{const r=db.transaction('kv').objectStore('kv').getAllKeys();r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
  expect(keys.some(k=>String(k).startsWith('archive:'))).toBe(false);db.close();
  await staged.dispose();
  await expect(storage.stageProjectDirectoryArchive('missing')).rejects.toThrow('not found');
  expect(held.size).toBe(0);
  const abandoned=await storage.stageProjectDirectoryArchive(p.id);
  held.clear(); // simulate browser releasing the dead page's lock
  expect(await storage.cleanupAbandonedProjectArchives()).toBe(1);
  await expect(abandoned.entries[Symbol.asyncIterator]().next()).rejects.toThrow('missing');
  await abandoned.dispose();
  expect(await storage.readFile(p.id,'index.html')).toBe('after');
 }finally{vi.unstubAllGlobals();}
},15000);
