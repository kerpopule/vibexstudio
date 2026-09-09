import {validateProjectSnapshot} from '../sync/project-snapshot';
import {assertSafePath} from './bundle';
import type {ChatAttachment,ChatMessage} from '../types';
/** Resolve only archived project-relative files; never fetch an attachment URL. */
export function archivedAttachmentPath(uri:string,sourceId:string):string|null{
 if(typeof uri!=='string'||!/^[A-Za-z0-9_-]{1,128}$/.test(sourceId))return null;
 let path:string|null=null;
 try{
  const idb=`vibex-idb://${sourceId}/files/`;
  if(uri.startsWith(idb))path='files/'+uri.slice(idb.length);
  else if(uri.startsWith('vibex-project-file:'))path='files/'+decodeURIComponent(uri.slice('vibex-project-file:'.length));
  else if(uri.startsWith('file:')){
   // URI text is used only to locate an entry in this archive, never as a file read.
   const decoded=decodeURIComponent(uri.slice('file://'.length));
   if(decoded.split('/').some(p=>p==='.'||p==='..'))return null;
   const url=new URL(uri);if(url.protocol!=='file:'||url.hostname||url.search||url.hash)return null;
   const marker=`/projects/${sourceId}/`,pathname=decodeURIComponent(url.pathname),index=pathname.lastIndexOf(marker);
   if(index>=0)path=pathname.slice(index+marker.length);
  }
  if(!path||!/^(files|media)\//.test(path)||assertSafePath(path)!==path)return null;
  return path;
 }catch{return null;}
}
export async function prepareArchivedProjectMetadata(meta:unknown,chat:unknown,newId:string,
 resolve:(attachment:ChatAttachment,sourceId:string)=>Promise<string>){
 if(!Array.isArray(chat)||chat.length>10000)throw new Error('The archive has invalid chat history.');
 // Existing validator whitelists project/chat fields and strips account links.
 const raw=chat as ChatMessage[];
 const plain=raw.map(message=>{
  if(!message||typeof message!=='object')throw new Error('The archive has an invalid chat message.');
  const {attachments,...rest}=message;return rest;
 });
 const validated=validateProjectSnapshot({meta,chat:plain,files:[]});
 if(!/^[A-Za-z0-9_-]{1,128}$/.test(newId)||newId===validated.meta.id)throw new Error('Restore requires a fresh project identity.');
 const messages:ChatMessage[]=[];
 for(let i=0;i<validated.chat.length;i++){
  const message={...validated.chat[i]},attachments=raw[i].attachments;
  if(attachments!==undefined){
   if(!Array.isArray(attachments)||attachments.length>100)throw new Error('The archive has invalid attachments.');
   message.attachments=[];
   for(const attachment of attachments){
    if(!attachment||!['image','video','audio'].includes(attachment.kind)||typeof attachment.uri!=='string'||(attachment.prompt!==undefined&&(typeof attachment.prompt!=='string'||attachment.prompt.length>25_000_000)))throw new Error('The archive has an invalid attachment.');
    const uri=await resolve(attachment,validated.meta.id);
    message.attachments.push({kind:attachment.kind,uri,...(attachment.prompt===undefined?{}:{prompt:attachment.prompt})});
   }
  }
  messages.push(message);
 }
 return {meta:{...validated.meta,id:newId,name:`${validated.meta.name.slice(0,180)} (restored)`},chat:messages};
}
