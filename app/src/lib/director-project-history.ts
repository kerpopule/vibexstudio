import type {Conversation} from './director-session';
import {DIRECTOR_HISTORY_PATH} from './private-project-files';
export {DIRECTOR_HISTORY_PATH} from './private-project-files';
const LIMIT=1024*1024;
export function decodeDirectorHistory(raw:string):Conversation[]{
 if(raw.length>LIMIT)throw new Error('Saved Sparky plans exceed the current 1 MiB limit. Keep the original project.');
 let value;try{value=JSON.parse(raw);}catch{throw new Error('Notes/Sparky.json is not a readable Sparky history. Keep the original file.');}
 if(value?.format!=='vibex/sparky-history'||value.version!==1||!Array.isArray(value.conversations))throw new Error('Notes/Sparky.json is already used by another file. Rename that file before saving Sparky plans.');
 return value.conversations.map((chat:unknown)=>{
  if(!chat||typeof chat!=='object'||!('draft' in chat)||typeof chat.draft!=='string'||chat.draft.length>4000||
    !('messages' in chat)||!Array.isArray(chat.messages)||chat.messages.length>20)throw new Error('Invalid saved Sparky conversation.');
  return {draft:chat.draft,messages:chat.messages.map((message:unknown)=>{
   if(!message||typeof message!=='object'||!('role' in message)||(message.role!=='user'&&message.role!=='assistant')||
     !('content' in message)||typeof message.content!=='string')throw new Error('Invalid saved Sparky message.');
   return {role:message.role as 'user'|'assistant',content:message.content};
  })};
 });
}
/** Preserve prior plans; deduplicate identical snapshots without exporting connection identities. */
export function encodeDirectorHistory(existing:string|null,current:Conversation[]):string|null{
 const conversations=existing===null?[]:decodeDirectorHistory(existing);
 const seen=new Set(conversations.map(chat=>JSON.stringify(chat)));
 for(const chat of current){
  const clean={draft:chat.draft,messages:chat.messages.map(({role,content})=>({role,content}))};
  const key=JSON.stringify(clean);if((clean.draft||clean.messages.length)&&!seen.has(key)){conversations.push(clean);seen.add(key);}
 }
 if(!conversations.length)return existing;
 const raw=JSON.stringify({format:'vibex/sparky-history',version:1,conversations},null,2);
 decodeDirectorHistory(raw);return raw;
}
export async function readDirectorProjectHistory(id:string):Promise<Conversation[]>{
 const {readFile}=await import('./storage/projects');
 const raw=await readFile(id,DIRECTOR_HISTORY_PATH);return raw===null?[]:decodeDirectorHistory(raw);
}
/** Called before manual backups. Adds a portable project file; originals/earlier plans stay intact. */
export async function checkpointDirectorProject(id:string){
 const [{restoreDirectorConversations,useDirectorSession},{readFile,writeFile,readProject}]=await Promise.all([
  import('./director-session'),import('./storage/projects'),
 ]);
 const binding=await restoreDirectorConversations();
 await binding?.flush();
 if(useDirectorSession.getState().storageError)throw new Error('Sparky history could not be fully restored. Reopen the app and resolve its storage error before backing up.');
 if(!await readProject(id))throw new Error('Project not found.');
 const current=Object.entries(useDirectorSession.getState().conversations).flatMap(([key,chat])=>{
  try{const parsed=JSON.parse(key);return Array.isArray(parsed)&&parsed[1]===id?[chat]:[];}catch{return [];}
 });
 const existing=await readFile(id,DIRECTOR_HISTORY_PATH);
 const next=encodeDirectorHistory(existing,current);
 if(next!==null&&next!==existing)await writeFile(id,DIRECTOR_HISTORY_PATH,next);
}
