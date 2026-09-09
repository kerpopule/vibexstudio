import AsyncStorage from '@react-native-async-storage/async-storage';
import {libraryOrigin} from './library-core';
export type EditingSelection={title:string;assetIds:string[]};
type Storage={getItem:(key:string)=>Promise<string|null>;setItem:(key:string,value:string)=>Promise<void>;removeItem:(key:string)=>Promise<void>};
function validate(value:unknown):EditingSelection{
 const v=value as EditingSelection;
 if(!v||typeof v.title!=='string'||v.title.length>160||!Array.isArray(v.assetIds)||v.assetIds.length>8||new Set(v.assetIds).size!==v.assetIds.length||v.assetIds.some(id=>typeof id!=='string'||!/^[-A-Za-z0-9_]{1,128}$/.test(id)))throw new Error('Saved editing choices could not be read. Your server drafts are unchanged.');
 return {title:v.title,assetIds:[...v.assetIds]};
}
function decode(raw:string){
 try{return validate(JSON.parse(raw));}catch{throw new Error('Saved editing choices could not be read. Your server drafts are unchanged.');}
}
/** Device-only choices. Never sends a job or resumes a pending request. */
export function editingSelectionStorage(storage:Storage){
 const queues=new Map<string,Promise<unknown>>();
 const key=(origin:string,musicVideo:boolean)=>'vibex.editing.selection.v1:'+JSON.stringify([libraryOrigin(origin),musicVideo?'music-video':'editor']);
 function enqueue<T>(key:string,action:()=>Promise<T>):Promise<T>{
  const work=(queues.get(key)??Promise.resolve()).catch(()=>{}).then(action);
  queues.set(key,work);
  void work.finally(()=>{if(queues.get(key)===work)queues.delete(key);}).catch(()=>{});
  return work;
 }
 return {
  read:(origin:string,musicVideo:boolean)=>{const k=key(origin,musicVideo);return enqueue(k,async()=>{const raw=await storage.getItem(k);return raw===null?null:decode(raw);});},
  save:(origin:string,musicVideo:boolean,value:EditingSelection)=>{const k=key(origin,musicVideo),raw=JSON.stringify(validate(value));return enqueue(k,()=>storage.setItem(k,raw));},
  clear:(origin:string,musicVideo:boolean,expected?:EditingSelection)=>{
   const k=key(origin,musicVideo),snapshot=expected?JSON.stringify(validate(expected)):null;
   return enqueue(k,async()=>{
    if(snapshot!==null){const raw=await storage.getItem(k);if(raw===null||JSON.stringify(decode(raw))!==snapshot)return false;}
    await storage.removeItem(k);return true;
   });
  },
 };
}
export const editingSelections=editingSelectionStorage(AsyncStorage);
