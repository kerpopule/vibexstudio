import {beforeEach,expect,it,vi} from 'vitest';
const fs=vi.hoisted(()=>({entries:new Map<string,'file'|'dir'>()}));
vi.mock('expo-file-system',()=>{
 const path=(parts:any[])=>parts.map(p=>typeof p==='string'?p:p.uri).join('/');
 class File{
  uri:string;constructor(...parts:any[]){this.uri=path(parts);}
  get name(){return this.uri.split('/').pop()!;}get exists(){return fs.entries.get(this.uri)==='file';}
  create(){if(fs.entries.has(this.uri))throw new Error('exists');fs.entries.set(this.uri,'file');}
  delete(){fs.entries.delete(this.uri);}
  move(target:File){fs.entries.delete(this.uri);this.uri=target.uri;fs.entries.set(this.uri,'file');}
 }
 class Directory{
  uri:string;constructor(...parts:any[]){this.uri=path(parts);}
  get exists(){return fs.entries.get(this.uri)==='dir';}
  list(){const prefix=this.uri+'/';return [...fs.entries].filter(([p])=>p.startsWith(prefix)&&!p.slice(prefix.length).includes('/')).map(([p,type])=>type==='file'?new File(p):new Directory(p));}
 }
 return {File,Directory,Paths:{document:'document'}};
});
import {Directory,File} from 'expo-file-system';
import {beginNativeAssetImport,cleanupNativeAssetImports} from '../src/lib/storage/asset-import-recovery.native';
beforeEach(()=>{
 fs.entries.clear();
 for(const [path,type] of [['document/projects','dir'],['document/projects/p1','dir'],['document/projects/p1/project.json','file'],['document/projects/p1/files','dir']] as const)fs.entries.set(path,type);
});
it('removes only recognized abandoned root staging files in existing projects',()=>{
 const orphan='document/projects/p1/.asset-import-abc-def';
 const kept=['document/projects/p1/files/.asset-import-abc-def','document/projects/p1/.asset-import-not-a-token','document/projects/p1/project.json'];
 fs.entries.set(orphan,'file');for(const path of kept)fs.entries.set(path,'file');
 fs.entries.set('document/projects/p1/.asset-import-dir-token','dir');
 cleanupNativeAssetImports();expect(fs.entries.has(orphan)).toBe(false);
 for(const path of kept)expect(fs.entries.has(path)).toBe(true);
 expect(fs.entries.has('document/projects/p1/.asset-import-dir-token')).toBe(true);
});
it('leaves active stages intact and disposes the original path after publication',()=>{
 const stage=beginNativeAssetImport(new Directory('document/projects/p1')),original=stage.file.uri;
 cleanupNativeAssetImports();expect(fs.entries.has(original)).toBe(true);
 const target=new File('document/projects/p1/files/video.mp4');stage.file.move(target);
 stage.dispose();cleanupNativeAssetImports();expect(fs.entries.has(target.uri)).toBe(true);expect(fs.entries.has(original)).toBe(false);
});
it('disposes a failed stage without touching completed files',()=>{
 const stage=beginNativeAssetImport(new Directory('document/projects/p1')),original=stage.file.uri;
 fs.entries.set('document/projects/p1/files/video.mp4','file');stage.dispose();
 expect(fs.entries.has(original)).toBe(false);expect(fs.entries.has('document/projects/p1/files/video.mp4')).toBe(true);
});
