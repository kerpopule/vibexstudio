import {create} from 'zustand';
import type {DirectorMessage} from '@/lib/remote-director';

export type Conversation = {draft:string; messages:DirectorMessage[]};
export const emptyDirectorConversation:Conversation = {draft:'',messages:[]};
export function directorSessionKey(origin:string|undefined,projectId:string|undefined){
  return JSON.stringify([origin ?? '',projectId ?? null]);
}
let nextRequest = 0;
/** Device-local history; in-flight requests are never persisted. */
export const useDirectorSession = create<{
  conversations:Record<string,Conversation>;
  pending:Record<string,number>;
  storageError:boolean;
  forgotten:ReadonlySet<string>;
  clear:(key:string)=>void;
  forgetProject:(id:string)=>void;
  begin:(key:string)=>number|null;
  end:(key:string,ticket:number)=>void;
  setDraft:(key:string,draft:string)=>void;
  complete:(key:string,submittedDraft:string,messages:DirectorMessage[])=>void;
}>((set,get)=>({
  conversations:{},
  pending:{},
  storageError:false,
  forgotten:new Set(),
  clear:(key)=>set(state=>state.pending[key]!==undefined?state:({conversations:{...state.conversations,[key]:{draft:'',messages:[]}}})),
  forgetProject:(id)=>set(state=>({
    forgotten:new Set([...state.forgotten,id]),
    conversations:Object.fromEntries(Object.entries(state.conversations).filter(([key])=>sessionProject(key)!==id)),
  })),
  begin:(key)=>{
    if(get().pending[key]!==undefined||get().forgotten.has(sessionProject(key)??''))return null;
    const ticket=++nextRequest;
    set(state=>({pending:{...state.pending,[key]:ticket}}));
    return ticket;
  },
  end:(key,ticket)=>set(state=>{
    if(state.pending[key]!==ticket)return state;
    const pending={...state.pending};delete pending[key];return {pending};
  }),
  setDraft:(key,draft)=>set(state=>state.forgotten.has(sessionProject(key)??'')?state:({conversations:{...state.conversations,
    [key]:{...(state.conversations[key]??emptyDirectorConversation),draft:draft.slice(0,4000)},
  }})),
  complete:(key,submittedDraft,messages)=>set(state=>{
    if(state.forgotten.has(sessionProject(key)??''))return state;
    const current=state.conversations[key]??emptyDirectorConversation;
    return {conversations:{...state.conversations,[key]:{
      draft:current.draft===submittedDraft?'':current.draft,
      messages:messages.slice(-20),
    }}};
  }),
}));

function sessionProject(key:string):string|null{
  try{const parsed=JSON.parse(key);return Array.isArray(parsed)&&typeof parsed[1]==='string'?parsed[1]:null;}catch{return null;}
}
let persistence:Promise<{flush:()=>Promise<void>}|undefined>|undefined;
export function restoreDirectorConversations(){
  persistence??=Promise.all([import('@react-native-async-storage/async-storage'),import('./director-persistence')])
    .then(([storage,{persistDirector}])=>persistDirector(useDirectorSession,storage.default,
      failed=>useDirectorSession.setState({storageError:failed})))
    .catch(()=>{persistence=undefined;useDirectorSession.setState({storageError:true});return undefined;});
  return persistence;
}
export async function forgetDirectorProject(id:string){
  const binding=await restoreDirectorConversations();
  useDirectorSession.getState().forgetProject(id);
  await binding?.flush();
}
