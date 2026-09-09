import {create} from 'zustand';

type Draft={prompt:string;providerId:string|null;duration:30|60|120;instrumental:boolean};
const empty=():Draft=>({prompt:'',providerId:null,duration:60,instrumental:false});
interface State{draft:Draft;storageError:boolean;update:(patch:Partial<Draft>)=>void;clear:()=>void}
export const useSongDraft=create<State>(set=>({
 draft:empty(),storageError:false,
 update:patch=>set(state=>({draft:{...state.draft,...patch,...(patch.prompt!==undefined?{prompt:patch.prompt.slice(0,8000)}:{})}})),
 clear:()=>set({draft:empty()}),
}));
type Storage={getItem:(key:string)=>Promise<string|null>;setItem:(key:string,value:string)=>Promise<void>};
const key='vibex.songDraft.v1';
function decode(raw:string):Draft{
 const value=JSON.parse(raw);
 if(!value||typeof value!=='object'||typeof value.prompt!=='string'||
 !(value.providerId===null||typeof value.providerId==='string')||
 ![30,60,120].includes(value.duration)||typeof value.instrumental!=='boolean')throw new Error('Invalid song draft');
 return {prompt:value.prompt.slice(0,8000),providerId:value.providerId,duration:value.duration,instrumental:value.instrumental};
}
/** Drafts stay on this device. Loading them never starts or resumes paid work. */
export async function persistSongDraft(storage:Storage){
 const initial=useSongDraft.getState().draft;
 let readable=true;
 try{
  const raw=await storage.getItem(key);
  if(raw!==null){const saved=decode(raw);if(useSongDraft.getState().draft===initial)useSongDraft.setState({draft:saved});}
 }catch{readable=false;useSongDraft.setState({storageError:true});}
 let writes=Promise.resolve();
 let previous=JSON.stringify(useSongDraft.getState().draft);
 const save=()=>{
  const next=JSON.stringify(useSongDraft.getState().draft);
  if(next===previous)return;
  previous=next;
  writes=writes.then(()=>storage.setItem(key,next)).then(()=>{useSongDraft.setState({storageError:false});}).catch(()=>{useSongDraft.setState({storageError:true});});
 };
 // Keep edits made while reading. Never replace unreadable stored data with defaults.
 if(readable&&useSongDraft.getState().draft!==initial){previous='';save();}
 const unsubscribe=useSongDraft.subscribe(save);
 return {unsubscribe,flush:()=>writes};
}
let persistence:Promise<unknown>|undefined;
export function restoreSongDraft(){
 persistence??=import('@react-native-async-storage/async-storage')
 .then(({default:storage})=>persistSongDraft(storage))
 .catch(()=>{persistence=undefined;useSongDraft.setState({storageError:true});});
 return persistence;
}
