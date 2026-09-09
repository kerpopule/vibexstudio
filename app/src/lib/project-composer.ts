import {create} from 'zustand';
export type ComposeMode='chat'|'image'|'video';
export type Composer={text:string;mode:ComposeMode;pending:boolean;error:string};
export const EMPTY_COMPOSER:Composer={text:'',mode:'chat',pending:false,error:''};
/** Project drafts survive navigation and responsive view remounts. */
export const useProjectComposer=create<{
 drafts:Record<string,Composer>;
 storageError:boolean;
 forgotten:ReadonlySet<string>;
 forget:(id:string)=>void;
 patch:(id:string,change:Partial<Composer>)=>void;
 begin:(id:string)=>boolean;
 propose:(id:string,text:string)=>boolean;
}>((set,get)=>({
 drafts:{},
 storageError:false,
 forgotten:new Set(),
 forget:(id)=>set(state=>{
  const drafts={...state.drafts};delete drafts[id];
  return {drafts,forgotten:new Set([...state.forgotten,id])};
 }),
 patch:(id,change)=>set(state=>state.forgotten.has(id)?state:({drafts:{...state.drafts,[id]:{...EMPTY_COMPOSER,...state.drafts[id],...change}}})),
 propose:(id,text)=>{
  const state=get(),draft=state.drafts[id];
  if(state.forgotten.has(id)||draft?.pending||draft?.text.trim()||!text.trim())return false;
  state.patch(id,{text,mode:'chat',error:''});
  return true;
 },
 begin:(id)=>{
  if(get().forgotten.has(id)||get().drafts[id]?.pending)return false;
  get().patch(id,{pending:true,error:''});
  return true;
 },
}));

let persistence:Promise<{flush:()=>Promise<void>}|undefined>|undefined;
export function restoreProjectComposers(){
 persistence??=Promise.all([import('@react-native-async-storage/async-storage'),import('./composer-persistence')])
 .then(([storage,{persistComposer}])=>persistComposer(useProjectComposer,storage.default,()=>useProjectComposer.setState({storageError:true})))
 .catch(()=>{persistence=undefined;useProjectComposer.setState({storageError:true});return undefined;});
 return persistence;
}

/** Called only after the user's project deletion succeeds. */
export async function forgetProjectComposer(id:string){
 const binding=await restoreProjectComposers();
 useProjectComposer.getState().forget(id);
 await binding?.flush();
}
