import {sameNativeProjectAttachment} from '@/lib/storage/native-attachment-path';
import {mimeFor} from '@/lib/media-mime';
import {assertSafePath} from '@/lib/share/bundle';
import {syncContent} from '@/lib/sync/content-plan';
import type {ChatAttachment,ChatMessage,ProjectFile,ProjectMeta} from '@/lib/types';
export interface ProjectSnapshot {meta:ProjectMeta;chat:ChatMessage[];files:ProjectFile[]}
const LIMIT=25_000_000;
function text(value:unknown,max:number):string {
 if(typeof value!=='string'||value.length>max)throw new Error('Project sync data contains an invalid text field.');return value;
}
function timestamp(value:unknown):number {
 if(typeof value!=='number'||!Number.isFinite(value)||value<0)throw new Error('Project sync data contains an invalid date.');return value;
}
/** Whitelist portable project content; device AI/GitHub connections never cross this boundary. */
export function validateProjectSnapshot(value:unknown):ProjectSnapshot {
 const input=value as ProjectSnapshot;
 if(!input||!input.meta||!Array.isArray(input.chat)||!Array.isArray(input.files)||input.chat.length>10000||input.files.length>500)throw new Error('Invalid project sync snapshot.');
 const m=input.meta;
 if(typeof m.id!=='string'||!/^[A-Za-z0-9_-]{1,128}$/.test(m.id))throw new Error('Invalid synced project identity.');
 const meta:ProjectMeta={id:m.id,name:text(m.name,200),description:text(m.description,5000),emoji:text(m.emoji,32),createdAt:timestamp(m.createdAt),updatedAt:timestamp(m.updatedAt)};
 const paths=new Set<string>();let total=0;
 const files=input.files.map(file=>{
  if(!file)throw new Error('Invalid synced project file.');
  const original=text(file.path,299),path=assertSafePath(original);
  if(path!==original)throw new Error('Sync paths must be relative and unambiguous.');
  const key=path.normalize('NFC').toLowerCase();if(paths.has(key))throw new Error('Conflicting sync file paths.');paths.add(key);
  if(file.encoding!==undefined&&file.encoding!=='utf-8'&&file.encoding!=='base64')throw new Error('Unsupported file encoding.');
  const content=text(file.content,LIMIT);total+=content.length;if(total>LIMIT)throw new Error('Project exceeds the folder-sync size limit.');
  if(file.encoding==='base64'&&(content.length%4!==0||!/^[A-Za-z0-9+/]*={0,2}$/.test(content)))throw new Error('Invalid binary asset encoding.');
  return {path,content,encoding:file.encoding??'utf-8'} as ProjectFile;
 });
 for(const path of paths){const segments=path.split('/');for(let i=1;i<segments.length;i++)if(paths.has(segments.slice(0,i).join('/')))throw new Error('Conflicting sync file and folder paths.');}
 const ids=new Set<string>();
 const chat=input.chat.map(message=>{
  if(!message||!['user','assistant'].includes(message.role))throw new Error('Invalid synced chat message.');
  const id=text(message.id,200);if(!id||ids.has(id))throw new Error('Invalid or duplicate chat identity.');ids.add(id);
  const result:ChatMessage={id,role:message.role,text:text(message.text,LIMIT),createdAt:timestamp(message.createdAt)};
  if(message.attachments!==undefined){
   if(!Array.isArray(message.attachments)||message.attachments.length>100)throw new Error('Invalid chat attachments.');
   result.attachments=message.attachments.map(attachment=>portableAttachment(attachment,files));
  }
  if(message.error!==undefined)result.error=text(message.error,10000);
  if(message.filesWritten!==undefined){if(!Array.isArray(message.filesWritten)||message.filesWritten.length>500)throw new Error('Invalid chat file references.');result.filesWritten=message.filesWritten.map(p=>assertSafePath(text(p,299)));}
  if(message.request){if(!['chat','image','video'].includes(message.request.mode))throw new Error('Invalid chat request.');result.request={mode:message.request.mode,prompt:text(message.request.prompt,LIMIT)};}
  return result;
 });
 const result={meta,chat,files};if(JSON.stringify(result).length>LIMIT)throw new Error('Project exceeds the folder-sync size limit.');return result;
}
export function encodeProjectSnapshot(value:ProjectSnapshot):string {
 const normalized={...value,chat:value.chat.map(message=>({...message,...(message.attachments?{attachments:message.attachments.map(attachment=>normalizeAttachment(attachment,value.meta.id,value.files))}:{})}))};
 const snapshot=validateProjectSnapshot(normalized);const raw=JSON.stringify({format:'vibex/project-snapshot',version:1,content:JSON.parse(syncContent(snapshot.meta,snapshot.chat,snapshot.files))});
 if(raw.length>LIMIT)throw new Error('Project exceeds the folder-sync size limit.');return raw;
}
export function decodeProjectSnapshot(raw:string):ProjectSnapshot {
 if(typeof raw!=='string'||raw.length>LIMIT)throw new Error('Project snapshot is too large.');
 let value;try{value=JSON.parse(raw);}catch{throw new Error('Project snapshot is incomplete.');}
 if(value?.format!=='vibex/project-snapshot'||value.version!==1)throw new Error('Unsupported project snapshot.');
 return validateProjectSnapshot(value.content);
}

const ASSET_PREFIX='vibex-project-file:';
function portableAttachment(attachment:ChatAttachment,files:ProjectFile[]):ChatAttachment {
 if(!attachment||!['image','video','audio'].includes(attachment.kind)||typeof attachment.uri!=='string'||!attachment.uri.startsWith(ASSET_PREFIX))throw new Error('Chat attachments must reference embedded project files.');
 let path:string;try{path=decodeURIComponent(attachment.uri.slice(ASSET_PREFIX.length));}catch{throw new Error('Invalid attachment path.');}
 if(assertSafePath(path)!==path||ASSET_PREFIX+encodeURIComponent(path)!==attachment.uri)throw new Error('Invalid attachment path.');
 const file=files.find(file=>file.path===path);
 if(!file||file.encoding!=='base64'||!mimeFor(path).startsWith(attachment.kind+'/'))throw new Error('A chat attachment is missing its matching media file.');
 return {kind:attachment.kind,uri:attachment.uri,...(attachment.prompt!==undefined?{prompt:text(attachment.prompt,LIMIT)}:{})};
}
function normalizeAttachment(attachment:ChatAttachment,id:string,files:ProjectFile[]):ChatAttachment {
 if(!attachment||typeof attachment.uri!=='string')throw new Error('Invalid chat attachments.');
 if(attachment.uri.startsWith(ASSET_PREFIX))return attachment;
 const prefix=`vibex-idb://${id}/files/`;
 let file:ProjectFile|undefined;
 if(attachment.uri.startsWith(prefix))file=files.find(file=>file.path===attachment.uri.slice(prefix.length));
 else if(attachment.uri.startsWith('data:')){
  // Resolve only bytes already present in the project; never fetch a remote URL
  // or read an arbitrary file merely because it appears in chat metadata.
  file=[...files].sort((a,b)=>a.path.localeCompare(b.path)).find(file=>file.encoding==='base64'&&attachment.uri===`data:${mimeFor(file.path)};base64,${file.content}`);
 }
 if(!file)throw new Error('Some chat attachments are not embedded in this project. Add their files to the project before syncing.');
 return {...attachment,uri:ASSET_PREFIX+encodeURIComponent(file.path)};
}
/** Reconstruct displayable desktop URIs from verified embedded bytes after import. */
export function materializeSnapshotChat(snapshot:ProjectSnapshot,localUri?:(path:string)=>string):ChatMessage[]{
 const validated=validateProjectSnapshot(snapshot);
 let expandedSize=JSON.stringify(validated).length;
 if(!localUri)for(const message of validated.chat)for(const attachment of message.attachments??[]){
  const path=decodeURIComponent(attachment.uri.slice(ASSET_PREFIX.length));expandedSize+=validated.files.find(file=>file.path===path)!.content.length;
  if(expandedSize>LIMIT)throw new Error('This project’s embedded chat media exceeds the current sync import limit. Reduce attachment sizes before syncing.');
 }
 return validated.chat.map(message=>({...message,...(message.attachments?{attachments:message.attachments.map(attachment=>{
  const path=decodeURIComponent(attachment.uri.slice(ASSET_PREFIX.length));const file=validated.files.find(file=>file.path===path)!;
  return {...attachment,uri:localUri?localUri(path):`data:${mimeFor(path)};base64,${file.content}`};
 })}:{})}));
}

/** Resolve native attachment URIs only against files already enumerated in this project. */
export function encodeFileBackedSnapshot(snapshot:ProjectSnapshot,localUri:(path:string)=>string):string {
 const chat=snapshot.chat.map(message=>({...message,...(message.attachments?{attachments:message.attachments.map(attachment=>{
  const file=snapshot.files.find(file=>sameNativeProjectAttachment(attachment.uri,localUri(file.path),snapshot.meta.id));
  return file?{...attachment,uri:ASSET_PREFIX+encodeURIComponent(file.path)}:attachment;
 })}:{})}));
 return encodeProjectSnapshot({...snapshot,chat});
}
