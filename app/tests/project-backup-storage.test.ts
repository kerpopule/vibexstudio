// These fixtures have no Sparky state; portable history has separate integration coverage.
vi.mock('../src/lib/director-project-history',()=>({checkpointDirectorProject:async()=>{}}));
import {afterEach,it,expect,vi} from 'vitest';
import {encodeProjectSnapshot} from '../src/lib/sync/project-snapshot';
vi.mock('@/lib/storage/projects',()=>import('../src/lib/storage/projects.web'));
const modulePath=process.env.VIBEX_TEST_INDEXEDDB_MODULE;
const backupPath=process.env.VIBEX_TEST_BACKUP_FILE;
afterEach(()=>vi.unstubAllGlobals());
it.skipIf(!modulePath)('round-trips a full backup through IndexedDB while retaining the original and embedded chat media',async()=>{
 const database=await import(/* @vite-ignore */ modulePath!);
 vi.stubGlobal('indexedDB',new database.IDBFactory());vi.stubGlobal('IDBKeyRange',database.IDBKeyRange);
 const storage=await import('../src/lib/storage/projects.web');
 const backup=await import('../src/lib/share/project-backup');
 const raw=encodeProjectSnapshot({meta:{id:'original-project',name:'Original',description:'',emoji:'✨',createdAt:1,updatedAt:2},
  files:[{path:'index.html',content:'<audio src="audio.mp3"></audio>'},{path:'audio.mp3',content:'AQIDBA==',encoding:'base64'}],
  chat:[{id:'original-message',role:'user',text:'Use this recording',createdAt:1,attachments:[{kind:'audio',uri:'vibex-project-file:audio.mp3'}]}]});
 await storage.replaceSyncedProject(raw,null);
 const exported=await backup.prepareProjectBackup('original-project');
 const restored=await backup.restoreProjectBackup(exported);
 expect(restored).not.toBe('original-project');
 expect(await storage.readSyncSnapshot('original-project')).toBe(raw);
 expect(await storage.readFile(restored,'index.html')).toBe('<audio src="audio.mp3"></audio>');
 expect(await storage.readFile(restored,'audio.mp3')).toBe('AQIDBA==');
 const messages=await storage.readChat(restored);
 expect(messages[0].id).toBe('original-message');
 expect(messages[0].attachments?.[0].uri).toBe('data:audio/mpeg;base64,AQIDBA==');
 expect((await storage.readProject(restored))?.name).toBe('Original (restored)');
});

it.skipIf(!modulePath||!backupPath)('restores an actual exported backup into isolated storage without changing its contents',async()=>{
 const {readFile}=await import('node:fs/promises');
 const {decodeProjectSnapshot}=await import('../src/lib/sync/project-snapshot');
 const raw=await readFile(backupPath!,'utf8');
 const original=decodeProjectSnapshot(raw);
 const database=await import(/* @vite-ignore */ modulePath!);
 vi.stubGlobal('indexedDB',new database.IDBFactory());vi.stubGlobal('IDBKeyRange',database.IDBKeyRange);
 const storage=await import('../src/lib/storage/projects.web');
 const backup=await import('../src/lib/share/project-backup');
 await storage.replaceSyncedProject(raw,null);
 const id=await backup.restoreProjectBackup(raw);
 expect(id).not.toBe(original.meta.id);
 const restored=decodeProjectSnapshot(await backup.prepareProjectBackup(id));
 expect(restored.files).toEqual(original.files);
 expect(restored.chat).toEqual(original.chat);
 expect(restored.meta).toEqual({...original.meta,id,name:`${original.meta.name.slice(0,180)} (restored)`});
 expect(await storage.readSyncSnapshot(original.meta.id)).toBe(raw);
});
