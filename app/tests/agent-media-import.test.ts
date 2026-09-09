import {it,expect,vi} from 'vitest';
import {importAgentImageResult,importAgentMedia,type ImageResultImportAdapter,type MediaImportAdapter} from '../src/lib/agent-connect/media-import';
import {encodeProjectSnapshot,decodeProjectSnapshot} from '../src/lib/sync/project-snapshot';
const raw=encodeProjectSnapshot({meta:{id:'p1',name:'Test',description:'',emoji:'✨',createdAt:1,updatedAt:2},chat:[],files:[]});
function fixture(){
 let current=raw;
 const read=vi.fn().mockResolvedValue(new Uint8Array([1,2,3]));
 const adapter:MediaImportAdapter & ImageResultImportAdapter & {snapshot:()=>Promise<string>;replace:(next:string,expected:string)=>Promise<void>}={list:async()=>[{id:'a1',kind:'image',title:'sprite',prompt:'',createdAt:1,fileName:'sprite.png',mimeType:'image/png',bytes:3,providerLabel:'local',serverUrl:'https://mine.test'}],read,project:async()=>decodeProjectSnapshot(current).meta,commit:async(id,path,bytes,createdAt)=>{
 const snapshot=decodeProjectSnapshot(current);if(snapshot.meta.id!==id||snapshot.meta.createdAt!==createdAt)throw new Error('Project changed');
 const existing=snapshot.files.find(file=>file.path===path),content=Buffer.from(bytes).toString('base64');
 if(existing){if(existing.content!==content)throw new Error('different content');return {alreadyImported:true};}
 snapshot.files.push({path,content,encoding:'base64'});current=encodeProjectSnapshot(snapshot);return {alreadyImported:false};
 },snapshot:async()=>current,replace:async(next,expected)=>{if(current!==expected)throw new Error('Project changed');current=next;},busy:()=>false,refresh:vi.fn()};
 return {adapter,read,current:()=>current,edit:()=>{current=encodeProjectSnapshot({...decodeProjectSnapshot(raw),files:[{path:'index.html',content:'concurrent edit'}]});}};
}
it('imports exact media bytes into a new project path',async()=>{
 const f=fixture();expect(await importAgentMedia(f.adapter,{projectId:'p1',assetId:'a1',path:'assets/sprite.png'})).toMatchObject({path:'assets/sprite.png',bytes:3});
 expect(decodeProjectSnapshot(f.current()).files).toEqual([{path:'assets/sprite.png',content:'AQID',encoding:'base64'}]);
 expect(await importAgentMedia(f.adapter,{projectId:'p1',assetId:'a1',path:'assets/sprite.png'})).toMatchObject({alreadyImported:true});expect(f.read).toHaveBeenCalledTimes(2);
 expect(f.adapter.refresh).toHaveBeenCalledTimes(2);
});
it('preserves a concurrent edit made during media download',async()=>{
 const f=fixture();f.read.mockImplementation(async()=>{f.edit();return new Uint8Array([1,2,3]);});
 await importAgentMedia(f.adapter,{projectId:'p1',assetId:'a1',path:'assets/sprite.png'});
 expect(decodeProjectSnapshot(f.current()).files.map(file=>file.path)).toEqual(['assets/sprite.png','index.html']);expect(f.adapter.refresh).toHaveBeenCalledOnce();
});
it('rejects unsafe paths, unknown assets and extension changes without downloading',async()=>{
 const f=fixture();
 for(const input of [{projectId:'p1',assetId:'a1',path:'../escape.png'},{projectId:'p1',assetId:'missing',path:'assets/sprite.png'},{projectId:'p1',assetId:'a1',path:'assets/code.js'}])await expect(importAgentMedia(f.adapter,input)).rejects.toThrow();
 expect(f.read).not.toHaveBeenCalled();expect(f.current()).toBe(raw);
});
it('does not write truncated media or write over a now-busy project',async()=>{
 const f=fixture();f.read.mockResolvedValueOnce(new Uint8Array([1]));await expect(importAgentMedia(f.adapter,{projectId:'p1',assetId:'a1',path:'assets/sprite.png'})).rejects.toThrow('changed');
 let calls=0;f.adapter.busy=()=>++calls>1;await expect(importAgentMedia(f.adapter,{projectId:'p1',assetId:'a1',path:'assets/sprite.png'})).rejects.toThrow('busy');expect(f.current()).toBe(raw);
});

it('imports a generated PNG without overwriting and preserves concurrent edits',async()=>{
 const bytes=Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jZ1kAAAAASUVORK5CYII=','base64'));
 const input={projectId:'p1',requestId:'stable-request-0001',path:'assets/result.png'};
 const f=fixture(),read=vi.fn(async()=>bytes);
 expect(await importAgentImageResult(f.adapter,input,read)).toMatchObject({requestId:input.requestId,bytes:bytes.length,path:input.path});
 expect(decodeProjectSnapshot(f.current()).files[0].content).toBe(Buffer.from(bytes).toString('base64'));
 await expect(importAgentImageResult(f.adapter,input,read)).resolves.toMatchObject({alreadyImported:true});expect(read).toHaveBeenCalledTimes(2);
 const changed=fixture();
 await importAgentImageResult(changed.adapter,input,async()=>{changed.edit();return bytes;});
 expect(decodeProjectSnapshot(changed.current()).files.map(file=>file.path)).toEqual(['assets/result.png','index.html']);
});
it('rejects invalid generated image paths before download and rejects invalid or oversized PNG bytes',async()=>{
 const f=fixture(),read=vi.fn(async()=>new Uint8Array([1,2,3]));
 for(const path of ['../escape.png','assets/../escape.png','assets/code.js']) {
  await expect(importAgentImageResult(f.adapter,{projectId:'p1',requestId:'id',path},read)).rejects.toThrow();
 }
 expect(read).not.toHaveBeenCalled();
 await expect(importAgentImageResult(f.adapter,{projectId:'p1',requestId:'id',path:'assets/result.png'},read)).rejects.toThrow('PNG');
 read.mockResolvedValueOnce(new Uint8Array(16*1024*1024+1));
 await expect(importAgentImageResult(f.adapter,{projectId:'p1',requestId:'id',path:'assets/result.png'},read)).rejects.toThrow('16 MiB');
 expect(f.current()).toBe(raw);
});

it('rejects a mismatched project snapshot before reading asset bytes',async()=>{
 const f=fixture();
 f.adapter.project=async()=>({...decodeProjectSnapshot(raw).meta,id:'other-project'});
 await expect(importAgentMedia(f.adapter,{projectId:'p1',assetId:'a1',path:'assets/sprite.png'})).rejects.toThrow('identity changed');
 expect(f.read).not.toHaveBeenCalled();
});

it('a retry cannot replace different bytes or hide a concurrent project change',async()=>{
 const input={projectId:'p1',assetId:'a1',path:'assets/sprite.png'};
 const f=fixture();await importAgentMedia(f.adapter,input);const saved=f.current();
 f.read.mockResolvedValueOnce(new Uint8Array([9,8,7]));
 await expect(importAgentMedia(f.adapter,input)).rejects.toThrow('different content');expect(f.current()).toBe(saved);
 f.read.mockImplementationOnce(async()=>{f.edit();return new Uint8Array([1,2,3]);});
 await importAgentMedia(f.adapter,input);
 expect(decodeProjectSnapshot(f.current()).files.map(file=>file.path)).toEqual(['assets/sprite.png','index.html']);
});
it('passes a 26 MiB video to the single-file commit without creating a project snapshot',async()=>{
 const f=fixture(),bytes=new Uint8Array(26*1024*1024),commit=vi.fn(async(_id:string,_path:string,_bytes:Uint8Array,_createdAt:number)=>({alreadyImported:false}));
 f.adapter.list=async()=>[{id:'a1',kind:'video',title:'Video',prompt:'',createdAt:1,fileName:'video.mp4',mimeType:'video/mp4',bytes:bytes.length,providerLabel:'local',serverUrl:'https://mine.test'}];
 f.read.mockResolvedValue(bytes);f.adapter.commit=commit;f.adapter.snapshot=vi.fn(async()=>{throw new Error('Whole-project snapshot must not be used');});
 await expect(importAgentMedia(f.adapter,{projectId:'p1',assetId:'a1',path:'assets/video.mp4'})).resolves.toMatchObject({bytes:bytes.length});
 expect(commit).toHaveBeenCalledOnce();expect(commit.mock.calls[0]?.[2]).toBe(bytes);expect(f.adapter.snapshot).not.toHaveBeenCalled();
});
