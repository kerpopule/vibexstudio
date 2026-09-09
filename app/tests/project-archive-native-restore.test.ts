// These fixtures have no Sparky state; portable history has separate integration coverage.
vi.mock('../src/lib/director-project-history',()=>({checkpointDirectorProject:async()=>{}}));
import {afterEach,expect,it,vi} from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {tmpdir} from 'node:os';
import {pathToFileURL} from 'node:url';
const state=vi.hoisted(()=>({root:'',id:'restored-native',output:[] as Uint8Array[],onPick:()=>{},aborted:false,finished:false}));
vi.mock('../src/lib/editing-export-sink',()=>({editingExportSink:async()=>{
 state.onPick();return {async write(bytes:Uint8Array){state.output.push(bytes.slice());},async finish(){state.finished=true;},async abort(){state.aborted=true;state.output=[];}};
}}));
vi.mock('../src/lib/storage/projects',()=>({newId:()=>state.id}));
vi.mock('expo-file-system',async()=>{
 const fs=await import('node:fs'),path=await import('node:path'),url=await import('node:url');
 class Entry{
  uri:string;
  constructor(...parts:(string|Entry)[]){this.uri=url.pathToFileURL(path.join(...parts.map(p=>{const s=typeof p==='string'?p:p.uri;return s.startsWith('file:')?url.fileURLToPath(s):s;}))).href;}
  get local(){return url.fileURLToPath(this.uri);}
  get exists(){return fs.existsSync(this.local);}
  get name(){return path.basename(this.local);}
  copySync(target:Entry){if(target.exists)throw new Error('Destination exists');fs.cpSync(this.local,target.local,{recursive:true,errorOnExist:true,force:false});}
  delete(){fs.rmSync(this.local,{recursive:true});}
  moveSync(target:Entry){if(target.exists)throw new Error('Destination exists');fs.renameSync(this.local,target.local);this.uri=target.uri;}
 }
 class Directory extends Entry{
  create(options?:{intermediates?:boolean}){fs.mkdirSync(this.local,{recursive:!!options?.intermediates});}
  list(){return fs.readdirSync(this.local,{withFileTypes:true}).map(entry=>entry.isDirectory()?new Directory(this,entry.name):new File(this,entry.name));}
 }
 class File extends Entry{
  get parentDirectory(){return new Directory(path.dirname(this.local));}
  get size(){return fs.statSync(this.local).size;}
  create(){fs.closeSync(fs.openSync(this.local,'wx'));}
  write(data:string){fs.writeFileSync(this.local,data);}
  textSync(){return fs.readFileSync(this.local,'utf8');}
  async text(){return this.textSync();}
  async base64(){return fs.readFileSync(this.local).toString('base64');}
  open(){const fd=fs.openSync(this.local,'r');return {offset:0,size:fs.fstatSync(fd).size,readBytes(length:number){const b=new Uint8Array(length),n=fs.readSync(fd,b,0,length,this.offset);this.offset+=n;return b.subarray(0,n);},close(){fs.closeSync(fd);}};}
  slice(start:number,end:number){const file=this.local;return {async arrayBuffer(){const fd=fs.openSync(file,'r');try{const bytes=new Uint8Array(end-start);fs.readSync(fd,bytes,0,bytes.length,start);return bytes.buffer;}finally{fs.closeSync(fd);}}};}
  writableStream(){const local=this.local;return new WritableStream<Uint8Array>({write(bytes){fs.appendFileSync(local,bytes);}});}
 }
 return {File,Directory,FileMode:{ReadOnly:'r'},Paths:{get document(){return new Directory(state.root,'documents');},get cache(){return new Directory(state.root,'cache');}}};
});
import {restoreNativeProjectArchive} from '../src/lib/share/restore-project-archive.native';
import {File,Directory} from 'expo-file-system';
import {beginNativeArchive,cleanupNativeArchives} from '../src/lib/share/archive-recovery.native';
import {nativeArchiveInput} from '../src/lib/share/archive-input.native';
import {saveNativeProjectArchive} from '../src/lib/share/save-project-archive.native';
import {writeProjectDirectoryArchive} from '../src/lib/share/project-directory-archive';
async function fixture(attachment:string='vibex-idb://source/files/assets/audio.wav',size=26*1024*1024){
 state.root=fs.mkdtempSync(path.join(tmpdir(),'vibex-native-archive-'));
 fs.mkdirSync(path.join(state.root,'cache'));fs.mkdirSync(path.join(state.root,'documents'));
 const media=new Uint8Array(size);media.fill(42);
 const meta={id:'source',name:'Original',emoji:'🎵',description:'',createdAt:1,updatedAt:2,aiConnectionId:'private-link'};
 const chat=[{id:'message',role:'assistant',text:'Audio',createdAt:3,attachments:[{kind:'audio',uri:attachment}]}];
 const rows:[string,Uint8Array][]=[['project.json',new TextEncoder().encode(JSON.stringify(meta))],['chat.json',new TextEncoder().encode(JSON.stringify(chat))],['files/assets/audio.wav',media],['files/index.html',new TextEncoder().encode('<h1>Original</h1>')]];
 const parts:Uint8Array[]=[];
 await writeProjectDirectoryArchive((async function*(){for(const [name,bytes]of rows)yield {path:name,chunks:(async function*(){for(let p=0;p<bytes.length;p+=1024*1024)yield bytes.subarray(p,p+1024*1024);})()};})(),{async write(b){parts.push(b.slice());},async finish(){},async abort(){}});
 return {input:new Blob(parts as BlobPart[]),media};
}
afterEach(()=>{if(state.root)fs.rmSync(state.root,{recursive:true,force:true});state.id='restored-native';state.output=[];state.onPick=()=>{};state.aborted=false;state.finished=false;});
it('restores large media exactly and relinks chat to fresh native paths',async()=>{
 const {input,media}=await fixture();
 const id=await restoreNativeProjectArchive(input),root=path.join(state.root,'documents/projects',id);
 expect(fs.readFileSync(path.join(root,'files/assets/audio.wav')).equals(Buffer.from(media))).toBe(true);
 const meta=JSON.parse(fs.readFileSync(path.join(root,'project.json'),'utf8'));
 expect(meta.id).toBe(id);expect(meta.aiConnectionId).toBeUndefined();
 const chat=JSON.parse(fs.readFileSync(path.join(root,'chat.json'),'utf8'));
 expect(chat[0].attachments[0].uri).toBe(pathToFileURL(path.join(root,'files/assets/audio.wav')).href);
 expect(fs.readdirSync(path.join(state.root,'cache/project-archive-operations'))).toEqual([]);
});
it('rejects missing attachment references without publishing or changing originals',async()=>{
 const {input}=await fixture('file:///old/projects/source/media/missing.wav');
 const original=path.join(state.root,'documents/projects/existing');fs.mkdirSync(original,{recursive:true});fs.writeFileSync(path.join(original,'project.json'),'original');
 await expect(restoreNativeProjectArchive(input)).rejects.toThrow('no matching media');
 expect(fs.readdirSync(path.dirname(original))).toEqual(['existing']);
 expect(fs.readFileSync(path.join(original,'project.json'),'utf8')).toBe('original');
 expect(fs.readdirSync(path.join(state.root,'cache/project-archive-operations'))).toEqual([]);
});
it('refuses an existing destination before touching its contents',async()=>{
 const {input}=await fixture();const target=path.join(state.root,'documents/projects',state.id);
 fs.mkdirSync(target,{recursive:true});fs.writeFileSync(path.join(target,'keep'),'original');
 await expect(restoreNativeProjectArchive(input)).rejects.toThrow();
 expect(fs.readFileSync(path.join(target,'keep'),'utf8')).toBe('original');
});
it('does not publish checksum-damaged media',async()=>{
 const {input}=await fixture();const bytes=new Uint8Array(await input.arrayBuffer());
 // Mutate a byte in the middle of the large stored media entry.
 bytes[2*1024*1024]^=1;
 await expect(restoreNativeProjectArchive(new Blob([bytes]))).rejects.toThrow('checksum');
 expect(fs.readdirSync(path.join(state.root,'documents/projects'))).toEqual([]);
});
it('matches embedded browser attachments only to identical archived bytes',async()=>{
 const uri='data:audio/wav;base64,'+Buffer.alloc(6,42).toString('base64');
 const {input}=await fixture(uri,6);const id=await restoreNativeProjectArchive(input);
 const chat=JSON.parse(fs.readFileSync(path.join(state.root,'documents/projects',id,'chat.json'),'utf8'));
 expect(chat[0].attachments[0].uri).toContain(`/projects/${id}/files/assets/audio.wav`);
});
it('relinks a native attachment after its source app container moved',async()=>{
 const {input}=await fixture('file:///previous-container/Documents/projects/source/files/assets/audio.wav',6);
 const id=await restoreNativeProjectArchive(input);
 const chat=JSON.parse(fs.readFileSync(path.join(state.root,'documents/projects',id,'chat.json'),'utf8'));
 expect(chat[0].attachments[0].uri).not.toContain('previous-container');
 expect(chat[0].attachments[0].uri).toContain(`/projects/${id}/files/assets/audio.wav`);
});
it('exports and restores a frozen native project with large media and no account links',async()=>{
 const {input,media}=await fixture();const originalId=await restoreNativeProjectArchive(input);
 const source=path.join(state.root,'documents/projects',originalId),metadata=path.join(source,'project.json');
 const meta=JSON.parse(fs.readFileSync(metadata,'utf8'));meta.aiConnectionId='private';fs.writeFileSync(metadata,JSON.stringify(meta));
 // A live edit after staging must not change the exported snapshot.
 state.onPick=()=>fs.writeFileSync(path.join(source,'files/index.html'),'later edit');
 const receipt=await saveNativeProjectArchive(originalId);
 expect(state.finished).toBe(true);expect(receipt.temporaryCleanupComplete).toBe(true);
 state.id='second-restored';const archivePath=path.join(state.root,'saved.vibexdir');
 fs.writeFileSync(archivePath,Buffer.concat(state.output));
 const id=await restoreNativeProjectArchive(nativeArchiveInput(new File(archivePath)));
 const target=path.join(state.root,'documents/projects',id);
 expect(fs.readFileSync(path.join(target,'files/assets/audio.wav')).equals(Buffer.from(media))).toBe(true);
 expect(fs.readFileSync(path.join(target,'files/index.html'),'utf8')).toBe('<h1>Original</h1>');
 expect(fs.readFileSync(path.join(source,'files/index.html'),'utf8')).toBe('later edit');
 expect(JSON.parse(fs.readFileSync(path.join(target,'project.json'),'utf8')).aiConnectionId).toBeUndefined();
 expect(fs.readdirSync(path.join(state.root,'cache/project-archive-operations'))).toEqual([]);
});
it('does not silently omit unknown native project folders during export',async()=>{
 const {input}=await fixture(undefined,6);const id=await restoreNativeProjectArchive(input);
 const extra=path.join(state.root,'documents/projects',id,'extra');fs.mkdirSync(extra);fs.writeFileSync(path.join(extra,'keep'),'original');
 await expect(saveNativeProjectArchive(id)).rejects.toThrow('unsupported folder');
 expect(state.finished).toBe(false);expect(state.output).toEqual([]);
 expect(fs.readFileSync(path.join(extra,'keep'),'utf8')).toBe('original');
 expect(fs.readdirSync(path.join(state.root,'cache/project-archive-operations'))).toEqual([]);
});

it('reclaims interrupted restores and staging while preserving completed and live projects',async()=>{
 await fixture(undefined,6);
 const projects=path.join(state.root,'documents/projects');fs.mkdirSync(projects);
 for(const [id,completed] of [['abandoned',false],['completed',true]] as const){
  const target=path.join(projects,id);fs.mkdirSync(target);
  fs.writeFileSync(path.join(target,'.vibex-archive-pending.json'),JSON.stringify({version:1,projectId:id,token:'old-session'}));
  fs.writeFileSync(path.join(target,'media'),'preserved bytes');
  if(completed)fs.writeFileSync(path.join(target,'project.json'),'completed metadata');
 }
 const stage=path.join(state.root,'cache/project-archive-operations/old-session');fs.mkdirSync(stage,{recursive:true});fs.writeFileSync(path.join(stage,'partial'),'unfinished');
 cleanupNativeArchives();
 expect(fs.existsSync(path.join(projects,'abandoned'))).toBe(false);
 expect(fs.readFileSync(path.join(projects,'completed/media'),'utf8')).toBe('preserved bytes');
 expect(fs.existsSync(path.join(projects,'completed/.vibex-archive-pending.json'))).toBe(false);
 expect(fs.existsSync(stage)).toBe(false);
 const operation=beginNativeArchive(),live=new Directory(projects,'live');live.create();operation.markRestore(live);
 cleanupNativeArchives();expect(live.exists).toBe(true);expect(operation.directory.exists).toBe(true);
 operation.dispose();cleanupNativeArchives();expect(live.exists).toBe(false);
});
it('keeps projects with damaged or mismatched recovery markers',async()=>{
 await fixture(undefined,6);const target=path.join(state.root,'documents/projects/keep');fs.mkdirSync(target,{recursive:true});
 const marker=path.join(target,'.vibex-archive-pending.json');
 fs.writeFileSync(marker,'invalid JSON');cleanupNativeArchives();expect(fs.existsSync(target)).toBe(true);
 fs.writeFileSync(marker,JSON.stringify({version:1,projectId:'different',token:'old-session'}));
 cleanupNativeArchives();expect(fs.existsSync(target)).toBe(true);
});
