import {contentSyncAction} from '@/lib/sync/content-plan';
import {decodeProjectSnapshot,encodeProjectSnapshot} from '@/lib/sync/project-snapshot';
export interface FolderState {heads:string[];revisions:{revision:string;payload:string}[]}
export interface FolderSyncAdapter {
 localIds():Promise<string[]>;remoteIds():Promise<string[]>;
 local(id:string):Promise<string|null>;remote(id:string):Promise<FolderState>;
 replace(raw:string,expected:string|null):Promise<void>;
 append(id:string,raw:string,heads:string[]):Promise<unknown>;
 baseline(id:string):Promise<string|null>;acknowledge(id:string,digest:string):Promise<void>;
 digest(raw:string):Promise<string>;busy(id:string):boolean;
}
export interface FolderSyncResult {pushed:number;pulled:number;unchanged:number;busy:number;conflicts:string[];failures:{id:string;message:string}[]}
export async function syncProjectFolder(adapter:FolderSyncAdapter):Promise<FolderSyncResult>{
 const result:FolderSyncResult={pushed:0,pulled:0,unchanged:0,busy:0,conflicts:[],failures:[]};
 const ids=new Set([...await adapter.localIds(),...await adapter.remoteIds()]);
 for(const id of ids){
  try{
   if(adapter.busy(id)){result.busy++;continue;}
   const local=await adapter.local(id),remote=await adapter.remote(id);
   if(remote.heads.length>1){result.conflicts.push(id);continue;}
   let other:string|null=null;
   if(remote.heads.length){
    const head=remote.revisions.find(r=>r.revision===remote.heads[0]);if(!head)throw new Error('The folder revision is incomplete.');
    const snapshot=decodeProjectSnapshot(head.payload);if(snapshot.meta.id!==id)throw new Error('Folder project identity does not match.');
    other=encodeProjectSnapshot(snapshot);
   }
   const left=local===null?null:await adapter.digest(local),right=other===null?null:await adapter.digest(other);
   const action=contentSyncAction(left,right,await adapter.baseline(id));
   if(action==='conflict'){result.conflicts.push(id);continue;}
   if(action==='equal'){if(left)await adapter.acknowledge(id,left);result.unchanged++;continue;}
   if(adapter.busy(id)||await adapter.local(id)!==local){result.conflicts.push(id);continue;}
   if(action==='push'&&local!==null){
    await adapter.append(id,local,remote.heads);
    const saved=await adapter.remote(id);
    if(saved.heads.length!==1){result.conflicts.push(id);continue;}
    const payload=saved.revisions.find(r=>r.revision===saved.heads[0])?.payload;
    if(!payload||await adapter.digest(encodeProjectSnapshot(decodeProjectSnapshot(payload)))!==left)throw new Error('Could not verify the folder copy.');
    await adapter.acknowledge(id,left!);result.pushed++;
   }else if(action==='pull'&&other!==null){
    await adapter.replace(other,local);
    await adapter.acknowledge(id,right!);result.pulled++;
   }
  }catch(error){result.failures.push({id,message:error instanceof Error?error.message:String(error)});}
 }
 return result;
}

/** Preserve each folder version as a separate project before advancing the original. */
export async function keepBothFolderVersions(adapter:FolderSyncAdapter,id:string):Promise<string[]>{
 if(adapter.busy(id))throw new Error('Wait for this project’s AI turn to finish.');
 const local=await adapter.local(id),remote=await adapter.remote(id);
 if(local===null||!remote.heads.length)throw new Error('One copy is missing. Reconnect its storage before resolving this conflict.');
 const localDigest=await adapter.digest(local);const copies:string[]=[];const seen=new Set<string>([localDigest]);
 for(const head of remote.heads){
  const revision=remote.revisions.find(r=>r.revision===head);if(!revision)throw new Error('A folder copy has not arrived yet. Retry after storage finishes syncing.');
  const snapshot=decodeProjectSnapshot(revision.payload);if(snapshot.meta.id!==id)throw new Error('Folder project identity does not match.');
  const sourceDigest=await adapter.digest(encodeProjectSnapshot(snapshot));if(seen.has(sourceDigest))continue;seen.add(sourceDigest);
  // Stable identity makes retry after interrupted preservation idempotent.
  const copyId=`${id.slice(0,80)}-copy-${sourceDigest.slice(0,32)}`;
  snapshot.meta={...snapshot.meta,id:copyId,name:`${snapshot.meta.name.slice(0,180)} (folder copy)`};
  const payload=encodeProjectSnapshot(snapshot),copyDigest=await adapter.digest(payload);
  const existing=await adapter.local(copyId);
  if(existing!==null&&existing!==payload)throw new Error('A preserved copy has since been edited. Keep that project and review this conflict again.');
  if(existing===null)await adapter.replace(payload,null);
  let saved=await adapter.remote(copyId);
  if(saved.heads.length===0){await adapter.append(copyId,payload,[]);saved=await adapter.remote(copyId);}
  const savedPayload=saved.revisions.find(r=>r.revision===saved.heads[0])?.payload;
  if(saved.heads.length!==1||!savedPayload||await adapter.digest(encodeProjectSnapshot(decodeProjectSnapshot(savedPayload)))!==copyDigest)throw new Error('Could not verify the preserved folder copy. Originals remain unchanged.');
  await adapter.acknowledge(copyId,copyDigest);copies.push(copyId);
 }
 if(adapter.busy(id)||await adapter.local(id)!==local)throw new Error('Your original changed while copies were being saved. Review the conflict again.');
 await adapter.append(id,local,remote.heads);
 const saved=await adapter.remote(id);const payload=saved.revisions.find(r=>r.revision===saved.heads[0])?.payload;
 if(saved.heads.length!==1||!payload||await adapter.digest(encodeProjectSnapshot(decodeProjectSnapshot(payload)))!==localDigest)throw new Error('Copies were preserved, but another device saved again. Sync to review the remaining conflict.');
 await adapter.acknowledge(id,localDigest);return copies;
}
