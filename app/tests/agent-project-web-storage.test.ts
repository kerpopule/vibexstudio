import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {ProjectAgentAdapter} from '../src/lib/agent-connect/project-adapter';
const modulePath=process.env.VIBEX_TEST_INDEXEDDB_MODULE;
const integration=it.skipIf(!modulePath);
beforeEach(async()=>{
 if(!modulePath)return;
 const database=await import(/* @vite-ignore */ modulePath);
 vi.stubGlobal('indexedDB',new database.IDBFactory());vi.stubGlobal('IDBKeyRange',database.IDBKeyRange);vi.resetModules();
});
afterEach(()=>vi.unstubAllGlobals());
integration('uses actual desktop storage for agent manifests, text reads and file mutations',async()=>{
 const storage=await import('../src/lib/storage/projects.web');
 await storage.writeProject({id:'p1',name:'Native parity',description:'',emoji:'✨',createdAt:1,updatedAt:1});
 await storage.writeFileWithoutTouch('p1','index.html','hello 🌎');
 await storage.writeBinaryFile('p1','assets/sprite.png','AQIDBA==');
 const adapter=new ProjectAgentAdapter({createProject:storage.createProject,listProjects:storage.listProjects,listFileManifest:storage.listProjectFileManifest,getFileInfo:storage.getProjectFileInfo,readFile:storage.readAgentUtf8File,writeFile:storage.writeFileWithoutTouch,deleteFile:storage.deleteFileWithoutTouch,appendMessage:async()=>{},removeMessage:async()=>{},refreshProjects:async()=>{},refreshChat:async()=>{},assertPathContained:storage.assertProjectFilePathContained});
 const created=await adapter.createProject({name:'Agent-created build'});
 expect(await storage.readProject(created.project.id)).toMatchObject({name:'Agent-created build'});
 expect(await storage.readChat(created.project.id)).toEqual([]);
 await adapter.writeProjectFiles({projectId:created.project.id,overwrite:false,files:[{path:'index.html',content:'<h1>New build</h1>'}]});
 expect(await storage.readFile(created.project.id,'index.html')).toBe('<h1>New build</h1>');
 const manifest=await adapter.getProject({projectId:'p1'});
 expect(manifest.files).toEqual([{path:'assets/sprite.png',encoding:'base64',bytes:4},{path:'index.html',encoding:'utf-8',bytes:10}]);
 expect(JSON.stringify(manifest)).not.toContain('AQIDBA');
 expect(await adapter.readProjectFile({projectId:'p1',path:'index.html'})).toMatchObject({content:'hello 🌎'});
 await expect(adapter.readProjectFile({projectId:'p1',path:'assets/sprite.png'})).rejects.toThrow();
 await adapter.writeProjectFiles({projectId:'p1',overwrite:false,files:[{path:'new.html',content:'new'}]});
 expect(await storage.readFile('p1','new.html')).toBe('new');
 await expect(adapter.writeProjectFiles({projectId:'p1',overwrite:false,files:[{path:'new.html',content:'replacement'}]})).rejects.toThrow();
 await storage.deleteFileWithoutTouch('p1','new.html');expect(await storage.getProjectFileInfo('p1','new.html')).toBeNull();
 for(const path of ['../escape','assets/../escape','/absolute','folder\\escape'])await expect(storage.getProjectFileInfo('p1',path)).rejects.toThrow();
 await expect(storage.getProjectFileInfo('p1:other','index.html')).rejects.toThrow();
});
integration('imports a video larger than the snapshot limit without replacing other project data',async()=>{
 const storage=await import('../src/lib/storage/projects.web');
 const meta={id:'large',name:'Large media',description:'',emoji:'🎬',createdAt:1,updatedAt:1};
 await storage.writeProject(meta);await storage.writeFileWithoutTouch('large','index.html','keep me');
 const bytes=new Uint8Array(26*1024*1024);bytes[0]=17;bytes[bytes.length-1]=23;
 expect(await storage.importBinaryAssetExclusive('large','assets/video.mp4',bytes,1)).toEqual({alreadyImported:false});
 expect(await storage.getProjectFileInfo('large','assets/video.mp4')).toMatchObject({bytes:bytes.length,encoding:'base64'});
 expect(await storage.readFile('large','index.html')).toBe('keep me');
 expect(await storage.importBinaryAssetExclusive('large','assets/video.mp4',bytes,1)).toEqual({alreadyImported:true});
 const {importAgentImageResult}=await import('../src/lib/agent-connect/media-import');
 const png=Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jZ1kAAAAASUVORK5CYII=','base64'));
 const adapter={project:storage.readProject,commit:storage.importBinaryAssetExclusive,busy:()=>false,refresh:async()=>{}};
 const input={projectId:'large',requestId:'background-result',path:'assets/sprite.png'};
 expect(await importAgentImageResult(adapter,input,async()=>png)).toMatchObject({bytes:png.length,path:'assets/sprite.png'});
 expect(await importAgentImageResult(adapter,input,async()=>png)).toMatchObject({alreadyImported:true});
 expect(await storage.getProjectFileInfo('large','assets/video.mp4')).toMatchObject({bytes:bytes.length});
 expect(await storage.readFile('large','assets/sprite.png')).toBe(Buffer.from(png).toString('base64'));

});
integration('serializes competing asset inserts and rejects path collisions without overwrite',async()=>{
 const storage=await import('../src/lib/storage/projects.web');
 await storage.writeProject({id:'p1',name:'Atomic',description:'',emoji:'✨',createdAt:1,updatedAt:1});
 const attempts=await Promise.allSettled([
  storage.importBinaryAssetExclusive('p1','assets/a.png',new Uint8Array([1]),1),
  storage.importBinaryAssetExclusive('p1','assets/a.png',new Uint8Array([2]),1),
 ]);
 expect(attempts.filter(result=>result.status==='fulfilled')).toHaveLength(1);
 expect(attempts.filter(result=>result.status==='rejected')).toHaveLength(1);
 const original=await storage.readFile('p1','assets/a.png');
 for(const path of ['assets/A.png','assets/a.png/child','assets'])await expect(storage.importBinaryAssetExclusive('p1',path,new Uint8Array([3]),1)).rejects.toThrow();
 await expect(storage.importBinaryAssetExclusive('p1','assets/new.png',new Uint8Array([3]),2)).rejects.toThrow(/changed/);
 expect(await storage.readFile('p1','assets/a.png')).toBe(original);
 expect(await storage.getProjectFileInfo('p1','assets/new.png')).toBeNull();
});
