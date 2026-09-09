import {it,expect} from 'vitest';
import {mkdtemp,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import {createHash} from 'node:crypto';
import {syncProjectFolder,keepBothFolderVersions,type FolderSyncAdapter} from '../src/lib/sync/folder-engine';
import {encodeProjectSnapshot,decodeProjectSnapshot} from '../src/lib/sync/project-snapshot';
// Exercise the desktop filesystem implementation directly.
import {appendProjectRevision,readProjectRevisions,listFolderProjects} from '../../desktop/workbench/project-sync-folder.mjs';
const raw=(content:string)=>encodeProjectSnapshot({meta:{id:'p1',name:'Test',description:'',emoji:'✨',createdAt:1,updatedAt:1},chat:[],files:[{path:'index.html',content}]});
function device(folder:string){
 const projects=new Map<string,string>(),base=new Map<string,string>();
 const adapter:FolderSyncAdapter={
  localIds:async()=>[...projects.keys()],remoteIds:()=>listFolderProjects(folder),local:async id=>projects.get(id)??null,
  remote:id=>readProjectRevisions(folder,id),append:(id,value,heads)=>appendProjectRevision(folder,id,value,heads),
  replace:async(value,expected)=>{const id=decodeProjectSnapshot(value).meta.id;if((projects.get(id)??null)!==expected)throw new Error('Local changed');projects.set(id,value);},
  baseline:async id=>base.get(id)??null,acknowledge:async(id,value)=>{base.set(id,value);},digest:async value=>createHash('sha256').update(value).digest('hex'),busy:()=>false,
 };return {projects,base,adapter};
}
it('two devices exchange a project and later edits through real folder revisions',async()=>{
 const folder=await mkdtemp(tmpdir()+'/vibex-engine-');
 try{
  const a=device(folder),b=device(folder);a.projects.set('p1',raw('first'));
  expect((await syncProjectFolder(a.adapter)).pushed).toBe(1);
  expect((await syncProjectFolder(b.adapter)).pulled).toBe(1);expect(b.projects.get('p1')).toBe(raw('first'));
  b.projects.set('p1',raw('edited on B'));expect((await syncProjectFolder(b.adapter)).pushed).toBe(1);
  expect((await syncProjectFolder(a.adapter)).pulled).toBe(1);expect(a.projects.get('p1')).toBe(raw('edited on B'));
  expect((await syncProjectFolder(a.adapter)).unchanged).toBe(1);
 }finally{await rm(folder,{recursive:true,force:true});}
});
it('divergent local edits remain intact and busy projects do not publish',async()=>{
 const folder=await mkdtemp(tmpdir()+'/vibex-engine-');
 try{
  const a=device(folder),b=device(folder);a.projects.set('p1',raw('first'));await syncProjectFolder(a.adapter);await syncProjectFolder(b.adapter);
  a.projects.set('p1',raw('A'));b.projects.set('p1',raw('B'));await syncProjectFolder(a.adapter);
  const conflict=await syncProjectFolder(b.adapter);expect(conflict.conflicts).toEqual(['p1']);expect(b.projects.get('p1')).toBe(raw('B'));
  const busy=await syncProjectFolder({...b.adapter,busy:()=>true});expect(busy.busy).toBe(1);expect(busy.pushed).toBe(0);
 }finally{await rm(folder,{recursive:true,force:true});}
});
it('failed local replacement does not acknowledge a new sync baseline',async()=>{
 const folder=await mkdtemp(tmpdir()+'/vibex-engine-');
 try{
  const a=device(folder),b=device(folder);a.projects.set('p1',raw('first'));await syncProjectFolder(a.adapter);
  const result=await syncProjectFolder({...b.adapter,replace:async()=>{throw new Error('Disk full');}});
  expect(result.failures[0].message).toBe('Disk full');expect(b.base.size).toBe(0);expect(b.projects.size).toBe(0);
 }finally{await rm(folder,{recursive:true,force:true});}
});

it('keeps both divergent versions as projects and releases the original conflict',async()=>{
 const folder=await mkdtemp(tmpdir()+'/vibex-engine-');
 try{
  const a=device(folder),b=device(folder);a.projects.set('p1',raw('first'));await syncProjectFolder(a.adapter);await syncProjectFolder(b.adapter);
  a.projects.set('p1',raw('A'));b.projects.set('p1',raw('B'));await syncProjectFolder(a.adapter);
  const copies=await keepBothFolderVersions(b.adapter,'p1');expect(copies).toHaveLength(1);
  expect(b.projects.get('p1')).toBe(raw('B'));
  expect(decodeProjectSnapshot(b.projects.get(copies[0])!).files[0].content).toBe('A');
  expect((await syncProjectFolder(b.adapter)).conflicts).toEqual([]);
  const c=device(folder);expect((await syncProjectFolder(c.adapter)).pulled).toBe(2);
  expect(decodeProjectSnapshot(c.projects.get('p1')!).files[0].content).toBe('B');
 }finally{await rm(folder,{recursive:true,force:true});}
});
it('interrupted copy save preserves originals and retry reuses the same copy identity',async()=>{
 const folder=await mkdtemp(tmpdir()+'/vibex-engine-');
 try{
  const a=device(folder),b=device(folder);a.projects.set('p1',raw('first'));await syncProjectFolder(a.adapter);await syncProjectFolder(b.adapter);
  a.projects.set('p1',raw('A'));b.projects.set('p1',raw('B'));await syncProjectFolder(a.adapter);
  const before=await b.adapter.remote('p1');
  await expect(keepBothFolderVersions({...b.adapter,append:async()=>{throw new Error('Offline');}},'p1')).rejects.toThrow('Offline');
  expect((await b.adapter.remote('p1')).heads).toEqual(before.heads);expect(b.projects.get('p1')).toBe(raw('B'));expect(b.projects.size).toBe(2);
  await keepBothFolderVersions(b.adapter,'p1');expect(b.projects.size).toBe(2);
 }finally{await rm(folder,{recursive:true,force:true});}
});
