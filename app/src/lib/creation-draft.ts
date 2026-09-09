import {create} from 'zustand';

export type CreationTask = 'image' | 'video' | 'audio' | 'game';
type GenerationKind = 'image' | 'video';
type Draft = {prompt: string; providerId: string | null};
interface CreationDraftState {
  storageError:boolean;
  task: CreationTask;
  drafts: Record<GenerationKind, Draft>;
  setTask: (task: CreationTask) => void;
  setPrompt: (kind: GenerationKind, prompt: string) => void;
  setProvider: (kind: GenerationKind, providerId: string) => void;
}

// Session drafts outlive the Create screen when setup or server tools replace it.
// Prompts are restored from device storage; these are not queued jobs.
export const useCreationDraft = create<CreationDraftState>((set) => ({
  storageError:false,
  task: 'image',
  drafts: {image: {prompt: '', providerId: null}, video: {prompt: '', providerId: null}},
  setTask: (task) => set({task}),
  setPrompt: (kind, prompt) => set((state) => ({drafts: {
    ...state.drafts, [kind]: {...state.drafts[kind], prompt: prompt.slice(0, 4000)},
  }})),
  setProvider: (kind, providerId) => set((state) => ({drafts: {
    ...state.drafts, [kind]: {...state.drafts[kind], providerId},
  }})),
}));

type DraftStorage={getItem:(key:string)=>Promise<string|null>;setItem:(key:string,value:string)=>Promise<void>};
/** Persist prompts and chosen task, never a running job or provider credentials. */
export async function persistCreationDraft(storage:DraftStorage,onError:()=>void){
 const key='vibex.creationDraft.v1';
 const initial=useCreationDraft.getState();
 try{
  const raw=await storage.getItem(key);
  const saved=raw?JSON.parse(raw):null;
  const current=useCreationDraft.getState();
  if(saved&&typeof saved==='object'){
   const drafts={...current.drafts};
   for(const kind of ['image','video'] as const){
    if(current.drafts[kind]===initial.drafts[kind]&&typeof saved[kind]==='string')
     drafts[kind]={...drafts[kind],prompt:saved[kind].slice(0,4000),providerId:typeof saved[kind+'Provider']==='string'?saved[kind+'Provider']:null};
   }
   useCreationDraft.setState({drafts,...(current.task===initial.task&&['image','video','audio','game'].includes(saved.task)?{task:saved.task}:{})});
  }
 }catch{onError();}
 let writes=Promise.resolve();let previous='';
 const save=(state:CreationDraftState)=>{
  const next=JSON.stringify({task:state.task,image:state.drafts.image.prompt,video:state.drafts.video.prompt,imageProvider:state.drafts.image.providerId,videoProvider:state.drafts.video.providerId});
  if(next===previous)return;previous=next;
  writes=writes.then(()=>storage.setItem(key,next)).catch(onError);
 };
 save(useCreationDraft.getState());
 return {unsubscribe:useCreationDraft.subscribe(save),flush:()=>writes};
}
let persistence:Promise<unknown>|undefined;
export function restoreCreationDraft(){
 persistence??=import('@react-native-async-storage/async-storage')
 .then(({default:storage})=>persistCreationDraft(storage,()=>useCreationDraft.setState({storageError:true})))
 .catch(()=>{persistence=undefined;useCreationDraft.setState({storageError:true});});
 return persistence;
}

/** A previously chosen provider must never silently become a different one. */
export function selectedCreationProvider<T extends {id:string}>(providers:T[],id:string|null):T|null{
 return id===null?(providers[0]??null):(providers.find(provider=>provider.id===id)??null);
}

export function clearCompletedCreationDraft(kind:GenerationKind,prompt:string,providerId:string|null){
 const current=useCreationDraft.getState().drafts[kind];
 if(current.prompt===prompt&&current.providerId===providerId)useCreationDraft.getState().setPrompt(kind,'');
}
