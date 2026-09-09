import type {Composer} from './project-composer';
type Drafts=Record<string,Composer>;
type Store={getState:()=>{drafts:Drafts};setState:(s:{drafts:Drafts})=>void;subscribe:(f:(s:{drafts:Drafts})=>void)=>()=>void};
type Storage={getItem:(k:string)=>Promise<string|null>;setItem:(k:string,v:string)=>Promise<void>};
const KEY='vibex.projectComposer.v1';
/** Edits during loading win; only text and mode survive restart. */
export async function persistComposer(store:Store,storage:Storage,onError:()=>void){
 let saved:Drafts={};
 try{
  const raw=await storage.getItem(KEY);const value:unknown=raw?JSON.parse(raw):{};
  if(value&&typeof value==='object'&&!Array.isArray(value))saved=Object.fromEntries(Object.entries(value).flatMap(([id,d])=>
   d&&typeof d==='object'&&typeof d.text==='string'&&['chat','image','video'].includes(d.mode)?[[id,{text:d.text,mode:d.mode,pending:false,error:''}]]:[]));
 }catch{onError();}
 store.setState({drafts:{...saved,...store.getState().drafts}});
 let previous='';let writes=Promise.resolve();
 const save=({drafts}:{drafts:Drafts})=>{
  const next=JSON.stringify(Object.fromEntries(Object.entries(drafts).map(([id,d])=>[id,{text:d.text,mode:d.mode}])));
  if(next===previous)return;previous=next;
  writes=writes.then(()=>storage.setItem(KEY,next)).catch(()=>{onError();});
 };
 save(store.getState());return{unsubscribe:store.subscribe(save),flush:()=>writes};
}
