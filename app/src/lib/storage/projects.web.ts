import {validateBinaryImport,binaryImportBase64,conflictingImportPath} from './binary-import';
import {validateProjectSnapshot} from '../sync/project-snapshot';
import {holdArchiveLock,ifArchiveAbandoned} from './archive-lock.web';
import {assertSafePath} from '@/lib/share/bundle';
import { mimeFor } from '@/lib/media-mime';
/**
 * Web/desktop implementation of project storage (Metro resolves `.web.ts`
 * over `.ts` on the web platform). expo-file-system's `File`/`Directory`
 * class API has no web backend, so everything persists to IndexedDB instead:
 *
 *   meta:<id>          — ProjectMeta
 *   chat:<id>          — ChatMessage[]
 *   file:<id>:<path>   — { content, encoding }
 *
 * Same exported surface as projects.ts. `filesRootUri` returns a synthetic
 * scheme (there is no filesystem URI on web); the web preview builds blob
 * URLs from listFiles() instead of loading file:// paths.
 */
import type { ChatMessage, ProjectFile, ProjectMeta } from '@/lib/types';

const DB_NAME = 'vibex-projects';
const STORE = 'kv';

let dbPromise: Promise<IDBDatabase> | null = null;

function db(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbPromise;
}

function tx(mode: IDBTransactionMode): Promise<IDBObjectStore> {
  return db().then((d) => d.transaction(STORE, mode).objectStore(STORE));
}

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function get<T>(key: string): Promise<T | undefined> {
  return request((await tx('readonly')).get(key)) as Promise<T | undefined>;
}

async function put(key: string, value: unknown): Promise<void> {
  await request((await tx('readwrite')).put(value, key));
}

async function del(key: string): Promise<void> {
  await request((await tx('readwrite')).delete(key));
}

/** All entries whose key starts with `prefix`, as [key, value] pairs. */
async function scan<T>(prefix: string): Promise<[string, T][]> {
  const store = await tx('readonly');
  const range = IDBKeyRange.bound(prefix, `${prefix}￿`);
  const [keys, values] = await Promise.all([
    request(store.getAllKeys(range)),
    request(store.getAll(range)),
  ]);
  return keys.map((k, i) => [String(k), values[i] as T]);
}

type StoredFile = { content: string; encoding: 'utf-8' | 'base64' };

const fileKey = (id: string, path: string) => `file:${id}:${path}`;

export function filesRootUri(id: string): string {
  return `vibex-idb://${id}/files`;
}


export function newId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/** No filesystem on web — media lands in the files tree via writeMedia. */
export function mediaDir(id: string): { uri: string } {
  return { uri: `vibex-idb://${id}/media` };
}

// ---------------------------------------------------------------------------
// Meta
// ---------------------------------------------------------------------------

export async function listProjects(): Promise<ProjectMeta[]> {
  const rows = await scan<ProjectMeta>('meta:');
  return rows.map(([, meta]) => meta).sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function readProject(id: string): Promise<ProjectMeta | null> {
  return (await get<ProjectMeta>(`meta:${id}`)) ?? null;
}

export async function writeProject(meta: ProjectMeta): Promise<void> {
  await put(`meta:${meta.id}`, meta);
}

export async function createProject(name: string, emoji: string): Promise<ProjectMeta> {
  const now = Date.now();
  const meta: ProjectMeta = {
    id: newId(),
    name,
    emoji,
    description: '',
    createdAt: now,
    updatedAt: now,
  };
  await writeProject(meta);
  await writeChat(meta.id, []);
  return meta;
}

export async function projectSizeBytes(id: string): Promise<number> {
  const files = await scan<StoredFile>(fileKey(id, ''));
  const chat = (await get<ChatMessage[]>(`chat:${id}`)) ?? [];
  return (
    files.reduce((sum, [, f]) => sum + f.content.length, 0) + JSON.stringify(chat).length
  );
}

export async function deleteProject(id: string): Promise<void> {
  const files = await scan<StoredFile>(fileKey(id, ''));
  await Promise.all(files.map(([key]) => del(key)));
  await del(`chat:${id}`);
  await del(`meta:${id}`);
}

export async function touchProject(id: string): Promise<void> {
  const meta = await readProject(id);
  if (!meta) return;
  meta.updatedAt = Date.now();
  await writeProject(meta);
}

// ---------------------------------------------------------------------------
// Chat
// ---------------------------------------------------------------------------

export async function readChat(id: string): Promise<ChatMessage[]> {
  return (await get<ChatMessage[]>(`chat:${id}`)) ?? [];
}

export async function writeChat(id: string, messages: ChatMessage[]): Promise<void> {
  await put(`chat:${id}`, messages);
}

// ---------------------------------------------------------------------------
// App files
// ---------------------------------------------------------------------------

const BINARY_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'ico', 'mp3', 'mp4', 'wav', 'flac', 'ogg', 'm4a', 'webm', 'mov', 'mkv', 'glb', 'pdf', 'zip', 'avif', 'woff', 'woff2', 'ttf']);

export function isBinaryPath(path: string): boolean {
  const ext = path.split('.').pop()?.toLowerCase() ?? '';
  return BINARY_EXTENSIONS.has(ext);
}

export async function listFiles(id: string): Promise<ProjectFile[]> {
  const rows = await scan<StoredFile>(fileKey(id, ''));
  const prefix = fileKey(id, '');
  return rows
    .map(([key, f]) => ({ path: key.slice(prefix.length), content: f.content, encoding: f.encoding }))
    .sort((a, b) => a.path.localeCompare(b.path));
}

export async function readFile(id: string, path: string): Promise<string | null> {
  const f = await get<StoredFile>(fileKey(id, path));
  return f?.content ?? null;
}

export async function writeFile(id: string, path: string, content: string): Promise<void> {
  await put(fileKey(id, path), { content, encoding: 'utf-8' } satisfies StoredFile);
  await touchProject(id);
}

export async function deleteFile(id: string, path: string): Promise<void> {
  await del(fileKey(id, path));
  await touchProject(id);
}

export async function writeBinaryFile(id: string, path: string, base64: string): Promise<string> {
  await put(fileKey(id, path), { content: base64, encoding: 'base64' } satisfies StoredFile);
  await touchProject(id);
  return `data:${mimeFor(path)};base64,${base64}`;
}

export function writeMedia(id: string, name: string, base64: string): string {
  // Fire-and-forget parity with the sync native signature.
  void put(fileKey(id, `media/${name}`), { content: base64, encoding: 'base64' } satisfies StoredFile);
  return `${filesRootUri(id)}/media/${name}`;
}

export async function listProjectFilePaths(id: string): Promise<string[]> {
  const prefix = fileKey(id, '');
  const store = await tx('readonly');
  const keys = await request(store.getAllKeys(IDBKeyRange.bound(prefix, `${prefix}\uffff`)));
  return keys.map((key)=>String(key).slice(prefix.length));
}

/** Folder replacement recovery belongs to native filesystem sync. */
export async function withSyncRecovery(_id: string, _replace: () => Promise<void>): Promise<void> {
  throw new Error('Native folder synchronization is unavailable in this browser.');
}

/** Compare and replace one project in a single IndexedDB transaction. */
export async function replaceSyncedProject(raw:string,expected:string|null):Promise<void> {
  const {decodeProjectSnapshot,encodeProjectSnapshot,materializeSnapshotChat}=await import('@/lib/sync/project-snapshot');
  const incoming=decodeProjectSnapshot(raw);
  const id=incoming.meta.id;
  const incomingChat=materializeSnapshotChat(incoming);
  const database=await db();
  await new Promise<void>((resolve,reject)=>{
    const transaction=database.transaction(STORE,'readwrite');const store=transaction.objectStore(STORE);
    let failure:unknown;
    transaction.oncomplete=()=>resolve();
    transaction.onabort=()=>reject(failure??transaction.error??new Error('Project sync update was cancelled.'));
    transaction.onerror=()=>{ /* onabort reports failure after rollback */ };
    const prefix=fileKey(id,'');const range=IDBKeyRange.bound(prefix,`${prefix}\uffff`);
    const metaRequest=store.get(`meta:${id}`),chatRequest=store.get(`chat:${id}`),keysRequest=store.getAllKeys(range),filesRequest=store.getAll(range);
    let remaining=4;
    const ready=()=>{
      if(--remaining)return;
      try {
        const current=metaRequest.result as ProjectMeta|undefined;
        const keys=keysRequest.result;const values=filesRequest.result as StoredFile[];
        const currentText=current?encodeProjectSnapshot({meta:current,chat:chatRequest.result??[],files:keys.map((key,index)=>({path:String(key).slice(prefix.length),...values[index]}))}):null;
        if(currentText!==expected)throw new Error('This project changed while syncing. Review its copies again.');
        for(const key of keys)store.delete(key);
        for(const file of incoming.files)store.put({content:file.content,encoding:file.encoding??'utf-8'},fileKey(id,file.path));
        // Local provider/publishing bindings are device-owned, never imported.
        store.put({...incoming.meta,...(current?.ai?{ai:current.ai}:{}),...(current?.github?{github:current.github}:{})},`meta:${id}`);
        store.put(incomingChat,`chat:${id}`);
      }catch(error){failure=error;transaction.abort();}
    };
    for(const request of [metaRequest,chatRequest,keysRequest,filesRequest])request.onsuccess=ready;
  });
}

/** Capture all project records in one consistent readonly transaction. */
export async function readSyncSnapshot(id:string):Promise<string|null> {
 if(!/^[A-Za-z0-9_-]{1,128}$/.test(id))throw new Error('Invalid sync project identity.');
 const {encodeProjectSnapshot}=await import('@/lib/sync/project-snapshot');
 const database=await db();
 return new Promise((resolve,reject)=>{
  const transaction=database.transaction(STORE,'readonly'),store=transaction.objectStore(STORE);
  const prefix=fileKey(id,''),range=IDBKeyRange.bound(prefix,`${prefix}\uffff`);
  const meta=store.get(`meta:${id}`),chat=store.get(`chat:${id}`),keys=store.getAllKeys(range),files=store.getAll(range);
  transaction.onabort=()=>reject(transaction.error??new Error('Could not read this project.'));
  transaction.onerror=()=>{};
  transaction.oncomplete=()=>{
   try{resolve(meta.result?encodeProjectSnapshot({meta:meta.result,chat:chat.result??[],files:keys.result.map((key,index)=>({path:String(key).slice(prefix.length),...files.result[index]}))}):null);}catch(error){reject(error);}
  };
 });
}


export interface ProjectFileManifestEntry {path:string;encoding:'utf-8'|'base64';bytes:number}
export function assertProjectFilePathContained(id:string,path:string):void {
 if(!/^[A-Za-z0-9_-]{1,128}$/.test(id))throw new Error('Invalid project identity.');
 if(assertSafePath(path)!==path)throw new Error('Project path resolves outside the project root.');
}
function fileInfo(path:string,file:StoredFile):ProjectFileManifestEntry {
 const encoding=file.encoding==='base64'?'base64':'utf-8';
 const bytes=encoding==='base64' ? Math.floor(file.content.length*3/4)-(file.content.endsWith('==')?2:file.content.endsWith('=')?1:0)
   : new TextEncoder().encode(file.content).byteLength;
 return {path,encoding,bytes};
}
/** The current IndexedDB schema stores metadata with content; never return content to the agent manifest. */
export async function listProjectFileManifest(id:string):Promise<ProjectFileManifestEntry[]> {
 assertProjectFilePathContained(id,'manifest');
 const prefix=fileKey(id,'');
 return (await scan<StoredFile>(prefix)).map(([key,file])=>{
   const path=key.slice(prefix.length);assertProjectFilePathContained(id,path);return fileInfo(path,file);
 }).sort((a,b)=>a.path.localeCompare(b.path));
}
export async function getProjectFileInfo(id:string,path:string):Promise<ProjectFileManifestEntry|null> {
 assertProjectFilePathContained(id,path);const file=await get<StoredFile>(fileKey(id,path));
 return file?fileInfo(path,file):null;
}
export async function readAgentUtf8File(id:string,path:string):Promise<string|null> {
 assertProjectFilePathContained(id,path);const file=await get<StoredFile>(fileKey(id,path));
 if(!file)return null;
 if(file.encoding==='base64')throw new Error('read_project_file supports valid UTF-8 text files only.');
 return file.content;
}
export async function writeFileWithoutTouch(id:string,path:string,content:string):Promise<void> {
 assertProjectFilePathContained(id,path);await put(fileKey(id,path),{content,encoding:'utf-8'} satisfies StoredFile);
}
export async function deleteFileWithoutTouch(id:string,path:string):Promise<void> {
 assertProjectFilePathContained(id,path);await del(fileKey(id,path));
}

/** Freeze one project in a single IndexedDB transaction before streaming its archive.
 * The temporary records are private to this export and removed by dispose().
 */
export async function stageProjectDirectoryArchive(id:string):Promise<{entries:AsyncIterable<import('../share/project-directory-archive').ArchiveEntry>;dispose:()=>Promise<void>}>{
 assertProjectFilePathContained(id,'archive');
 await cleanupAbandonedProjectArchives();
 const database=await db(),prefix=`archive:${crypto.randomUUID()}:`,paths:string[]=[];
 const release=await holdArchiveLock(prefix);
 try{await new Promise<void>((resolve,reject)=>{
  const transaction=database.transaction(STORE,'readwrite'),store=transaction.objectStore(STORE);
  let failure:Error|null=null,characters=0,found=false;
  const fail=(message:string)=>{failure=new Error(message);transaction.abort();};
  const put=(name:string,file:StoredFile)=>{
   if(typeof file.content!=='string'||file.content.length>1024**3||!['utf-8','base64'].includes(file.encoding)){fail('Unsupported or oversized project content.');return;}
   characters+=file.content.length;
   if(characters>4*1024**3||paths.length>=10000){fail('This project exceeds archive staging limits.');return;}
   paths.push(name);store.put(file,prefix+name);
  };
  const meta=store.get(`meta:${id}`);
  meta.onsuccess=()=>{if(!meta.result||meta.result.id!==id){fail('Project not found.');return;}try{const clean=validateProjectSnapshot({meta:meta.result,chat:[],files:[]}).meta;found=true;put('project.json',{content:JSON.stringify(clean),encoding:'utf-8'});}catch{fail('The project metadata is invalid.');}};
  const chat=store.get(`chat:${id}`);chat.onsuccess=()=>put('chat.json',{content:JSON.stringify(chat.result??[]),encoding:'utf-8'});
  const filePrefix=fileKey(id,''),cursor=store.openCursor(IDBKeyRange.bound(filePrefix,filePrefix+'\uffff'));
  cursor.onsuccess=()=>{
   const current=cursor.result;if(!current)return;
   const path=String(current.key).slice(filePrefix.length);
   try{assertProjectFilePathContained(id,path);}catch{fail('Invalid project archive path.');return;}
   put('files/'+path,current.value);if(!failure)current.continue();
  };
  transaction.oncomplete=()=>found?resolve():reject(new Error('Project not found.'));
  transaction.onabort=()=>reject(failure??transaction.error??new Error('Could not stage the project.'));
  transaction.onerror=()=>{failure??=new Error('Could not stage the project. Check available storage.');};
 });}catch(error){await release();throw error;}
 let disposed=false;
 const dispose=async()=>{
  if(disposed)return;
  await new Promise<void>((resolve,reject)=>{
   const transaction=database.transaction(STORE,'readwrite');
   transaction.objectStore(STORE).delete(IDBKeyRange.bound(prefix,prefix+'\uffff'));
   transaction.oncomplete=()=>resolve();transaction.onabort=()=>reject(transaction.error);
  });disposed=true;await release();
 };
 const entries=(async function*(){
  for(const path of paths.sort()){
   if(disposed)throw new Error('The staged archive was released.');
   const file=await get<StoredFile>(prefix+path);if(!file)throw new Error('A staged archive file is missing.');
   yield {path,chunks:(async function*(){
    if(file.encoding==='base64'){
     for(let offset=0;offset<file.content.length;offset+=65536){
      const binary=atob(file.content.slice(offset,offset+65536));
      yield Uint8Array.from(binary,c=>c.charCodeAt(0));
     }
    }else{
     for(let offset=0;offset<file.content.length;){
      let end=Math.min(file.content.length,offset+65536);
      if(end<file.content.length&&file.content.charCodeAt(end-1)>=0xd800&&file.content.charCodeAt(end-1)<=0xdbff)end--;
      yield new TextEncoder().encode(file.content.slice(offset,end));offset=end;
     }
    }
   })()};
  }
 })();
 return {entries,dispose};
}

/** Reclaim only staging prefixes with no live exporter holding their Web Lock. */
export async function cleanupAbandonedProjectArchives():Promise<number>{
 const database=await db();
 const store=database.transaction(STORE,'readonly').objectStore(STORE);
 const keys=await request(store.getAllKeys(IDBKeyRange.bound('archive:','archive:\uffff')));
 const prefixes=new Set<string>();
 for(const key of keys){const match=/^archive:([a-f0-9-]{36}):/.exec(String(key));if(match)prefixes.add(`archive:${match[1]}:`);}
 let cleaned=0;
 for(const prefix of prefixes){
  const removed=await ifArchiveAbandoned(prefix,()=>new Promise<void>((resolve,reject)=>{
   const transaction=database.transaction(STORE,'readwrite');
   transaction.objectStore(STORE).delete(IDBKeyRange.bound(prefix,prefix+'\uffff'));
   transaction.oncomplete=()=>resolve();transaction.onabort=()=>reject(transaction.error);
  }));
  if(removed)cleaned++;
 }
 return cleaned;
}

/** Verify in private staging, then publish a fresh project in one transaction. */
export async function restoreProjectDirectoryArchive(input:import('../share/project-directory-archive').ArchiveInput,onProgress?:import('../share/project-directory-archive').ArchiveProgressHandler):Promise<string>{
 const {readProjectDirectoryArchive}=await import('../share/project-directory-archive');
 const {prepareArchivedProjectMetadata,archivedAttachmentPath}=await import('../share/archive-project-metadata');
 await cleanupAbandonedProjectArchives();
 const database=await db(),prefix=`archive:${crypto.randomUUID()}:`,release=await holdArchiveLock(prefix);
 const mapped=new Map<string,{path:string;bytes:number;encoding:'utf-8'|'base64'}>(),names=new Set<string>();
 let metadata:unknown=null,chat:unknown=[];
 try{
  await readProjectDirectoryArchive(input,async(path,chunks)=>{
   const parts:Uint8Array[]=[];let size=0;
   const limit=path==='project.json'?1024*1024:path==='chat.json'?64*1024*1024:128*1024*1024;
   for await(const chunk of chunks){size+=chunk.length;if(size>limit)throw new Error('This archive exceeds the current per-file restore limit (128 MiB media, 64 MiB chat).');parts.push(chunk);}
   const bytes=new Uint8Array(size);let offset=0;for(const part of parts){bytes.set(part,offset);offset+=part.length;}
   if(path==='project.json'||path==='chat.json'){
    const value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));if(path==='project.json')metadata=value;else chat=value;return;
   }
   const target=path.startsWith('files/')?path.slice(6):'assets/Media/'+path.slice(6);
   assertProjectFilePathContained('restore',target);
   const key=target.normalize('NFKC').toLowerCase().replace(/ß/g,'ss').replace(/ς/g,'σ');
   if(names.has(key)||[...names].some(p=>p.startsWith(key+'/')||key.startsWith(p+'/')))throw new Error('Archive media paths conflict with project files.');names.add(key);
   let content:string|undefined,encoding:'utf-8'|'base64'='utf-8';
   if(!isBinaryPath(target)){try{content=new TextDecoder('utf-8',{fatal:true}).decode(bytes);}catch{/* preserve unknown binary content as bytes */}}
   if(content===undefined){
    encoding='base64';let binary='';for(let p=0;p<bytes.length;p+=8192)binary+=String.fromCharCode(...bytes.subarray(p,p+8192));content=btoa(binary);
   }
   await put(prefix+path,{content,encoding} satisfies StoredFile);mapped.set(path,{path:target,bytes:size,encoding});
  },onProgress);
  const id=newId();
  const prepared=await prepareArchivedProjectMetadata(metadata,chat,id,async(attachment,sourceId)=>{
   let source=archivedAttachmentPath(attachment.uri,sourceId);
   if(!source&&attachment.uri.startsWith('data:')){
    for(const [name,info] of mapped){
     if(info.encoding!=='base64'||!mimeFor(info.path).startsWith(attachment.kind+'/'))continue;
     const lead=`data:${mimeFor(info.path)};base64,`;
     if(!attachment.uri.startsWith(lead)||attachment.uri.length!==lead.length+4*Math.ceil(info.bytes/3))continue;
     const file=await get<StoredFile>(prefix+name);
     if(file&&attachment.uri===lead+file.content){source=name;break;}
    }
   }
   const info=source?mapped.get(source):undefined;
   if(!source||!info||info.encoding!=='base64'||!mimeFor(info.path).startsWith(attachment.kind+'/'))throw new Error('A chat attachment has no matching media inside this archive. Existing projects are unchanged.');
   const file=await get<StoredFile>(prefix+source);if(!file)throw new Error('An archived attachment is missing.');
   return `data:${mimeFor(info.path)};base64,${file.content}`;
  });
  await new Promise<void>((resolve,reject)=>{
   const transaction=database.transaction(STORE,'readwrite'),store=transaction.objectStore(STORE);
   store.add(prepared.meta,`meta:${id}`);store.add(prepared.chat,`chat:${id}`);
   let count=0;const cursor=store.openCursor(IDBKeyRange.bound(prefix,prefix+'\uffff'));
   cursor.onsuccess=()=>{
    const row=cursor.result;if(!row){if(count!==mapped.size)transaction.abort();return;}
    const info=mapped.get(String(row.key).slice(prefix.length));
    if(!info){transaction.abort();return;}
    store.add(row.value,fileKey(id,info.path));count++;row.continue();
   };
   transaction.oncomplete=()=>resolve();
   transaction.onabort=()=>reject(transaction.error??new Error('Could not restore the project; existing copies were preserved.'));
  });
  return id;
 }finally{
  try{
   await new Promise<void>((resolve,reject)=>{
    const transaction=database.transaction(STORE,'readwrite');transaction.objectStore(STORE).delete(IDBKeyRange.bound(prefix,prefix+'\uffff'));
    transaction.oncomplete=()=>resolve();transaction.onabort=()=>reject(transaction.error);
   });
  }catch{/* abandoned staging is reclaimed under its released lock next time */}
  finally{await release();}
 }
}

/** Insert one binary asset without snapshotting or replacing unrelated project files. */
export async function importBinaryAssetExclusive(id:string,path:string,bytes:Uint8Array,createdAt:number):Promise<{alreadyImported:boolean}> {
 validateBinaryImport(id,path,bytes,createdAt);
 const content=binaryImportBase64(bytes),database=await db();
 return new Promise((resolve,reject)=>{
  const transaction=database.transaction(STORE,'readwrite'),store=transaction.objectStore(STORE);
  let failure:Error|null=null,alreadyImported=false;
  const fail=(message:string)=>{failure=new Error(message);transaction.abort();};
  const meta=store.get(`meta:${id}`);
  meta.onsuccess=()=>{
   if(!meta.result||meta.result.id!==id||meta.result.createdAt!==createdAt){fail('The project changed or was removed.');return;}
   const prefix=fileKey(id,''),cursor=store.openCursor(IDBKeyRange.bound(prefix,prefix+'\uffff'));
   cursor.onsuccess=()=>{
    const entry=cursor.result;
    if(entry){
     const existing=String(entry.key).slice(prefix.length);
     if(conflictingImportPath(existing,path)){
      if(existing!==path||entry.value.encoding!=='base64'||entry.value.content!==content){fail('That project file already exists. Choose a new path.');return;}
      alreadyImported=true;
     }
     entry.continue();return;
    }
    if(!alreadyImported)store.add({content,encoding:'base64'} satisfies StoredFile,fileKey(id,path));
    if(!alreadyImported)store.put({...meta.result,updatedAt:Date.now()},`meta:${id}`);
   };
  };
  transaction.oncomplete=()=>resolve({alreadyImported});
  transaction.onabort=()=>reject(failure??transaction.error??new Error('Could not import the asset.'));
  transaction.onerror=()=>{failure??=new Error('Could not import the asset. Check available storage.');};
 });
}
