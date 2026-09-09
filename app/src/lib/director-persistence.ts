import type {Conversation} from './director-session';
type Conversations=Record<string,Conversation>;
type Store={getState:()=>{conversations:Conversations};setState:(s:{conversations:Conversations})=>void;subscribe:(f:(s:{conversations:Conversations})=>void)=>()=>void};
type Storage={getAllKeys:()=>Promise<readonly string[]>;getItem:(k:string)=>Promise<string|null>;setItem:(k:string,v:string)=>Promise<void>;removeItem:(k:string)=>Promise<void>};
const PREFIX='vibex.director.v1:';
function decode(raw:string):Conversation{
 const value=JSON.parse(raw);
 if(!value||typeof value.draft!=='string'||value.draft.length>4000||!Array.isArray(value.messages)||value.messages.length>20||
   !value.messages.every((m:unknown)=>m&&typeof m==='object'&&'role' in m&&'content' in m&&
    (m.role==='user'||m.role==='assistant')&&typeof m.content==='string'))throw new Error('Invalid saved conversation');
 return {draft:value.draft,messages:value.messages.map((m:{role:'user'|'assistant';content:string})=>({role:m.role,content:m.content}))};
}
/** Separate records avoid the native storage limit for a single growing history.
 * Reads merge before subscription, preserving edits made while storage loads.
 * Writes and deletions serialize; a failed write is retried on the next edit.
 * Invalid records are retained for recovery, never silently overwritten at startup.
 */
export async function persistDirector(store:Store,storage:Storage,onError:(failed:boolean)=>void){
 const saved:Conversations=Object.create(null),persisted=new Map<string,string>(),invalid=new Set<string>();
 let readFailed=false;
 try{
  for(const storageKey of await storage.getAllKeys()){
   if(!storageKey.startsWith(PREFIX))continue;
   const key=storageKey.slice(PREFIX.length);
   try{
    const raw=await storage.getItem(storageKey);if(raw===null)continue;
    saved[key]=decode(raw);persisted.set(key,JSON.stringify(saved[key]));
   }catch{invalid.add(key);}
  }
 }catch{readFailed=true;}
 const current=store.getState().conversations;
 store.setState({conversations:{...saved,...Object.fromEntries(Object.entries(current).map(([key,value])=>[
  key,{...value,messages:value.messages.length?value.messages:(saved[key]?.messages??value.messages)},
 ]))}});
 let previous:Conversations|undefined,writes=Promise.resolve();
 const save=({conversations}:{conversations:Conversations})=>{
  if(conversations===previous)return;previous=conversations;
  // Serialize now, so later caller mutations cannot change queued snapshots.
  const snapshot=new Map(Object.entries(conversations).map(([key,value])=>[key,JSON.stringify({draft:value.draft,messages:value.messages})]));
  writes=writes.then(async()=>{
   let failed=false;
   for(const [key,value] of snapshot){
    if(persisted.get(key)===value)continue;
    try{await storage.setItem(PREFIX+key,value);persisted.set(key,value);invalid.delete(key);}catch{failed=true;}
   }
   for(const key of persisted.keys()){
    if(snapshot.has(key))continue;
    try{await storage.removeItem(PREFIX+key);persisted.delete(key);}catch{failed=true;}
   }
   onError(failed||readFailed||invalid.size>0);
  });
 };
 save(store.getState());
 return {unsubscribe:store.subscribe(save),flush:()=>writes};
}
