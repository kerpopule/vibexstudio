import AsyncStorage from '@react-native-async-storage/async-storage';
import {libraryOrigin} from './library-core';
export type StoryboardSelection={musicAssetId?:string;title:string;scenes:{assetId:string;seconds:string}[]};
type Storage={getItem:(key:string)=>Promise<string|null>;setItem:(key:string,value:string)=>Promise<void>;removeItem:(key:string)=>Promise<void>};
function validate(value:unknown):StoryboardSelection{
 const v=value as StoryboardSelection;
 if(!v||(v.musicAssetId!==undefined&&(typeof v.musicAssetId!=='string'||!/^[-A-Za-z0-9_]{1,128}$/.test(v.musicAssetId)))||typeof v.title!=='string'||v.title.length>160||!Array.isArray(v.scenes)||v.scenes.length>128||v.scenes.some(scene=>!scene||typeof scene.assetId!=='string'||(scene.assetId!==''&&!/^[-A-Za-z0-9_]{1,128}$/.test(scene.assetId))||typeof scene.seconds!=='string'||scene.seconds.length>64))throw new Error('Saved storyboard choices could not be read. Your server drafts are unchanged.');
 return {...(v.musicAssetId?{musicAssetId:v.musicAssetId}:{}),title:v.title,scenes:v.scenes.map(scene=>({...scene}))};
}
function decode(raw:string){
 try{return validate(JSON.parse(raw));}catch{throw new Error('Saved storyboard choices could not be read. Your server drafts are unchanged.');}
}
/** Device-only choices. Never sends a job or resumes a pending request. */
export function storyboardSelectionStorage(storage:Storage){
 const queues=new Map<string,Promise<unknown>>();
 const key=(origin:string,storyboardId:string,digest:string)=>{if(!storyboardId||storyboardId.length>240||!/^[a-f0-9]{64}$/.test(digest))throw new Error('Reload the saved storyboard first.');return 'vibex.storyboard.selection.v1:'+JSON.stringify([libraryOrigin(origin),storyboardId,digest]);};
 function enqueue<T>(key:string,action:()=>Promise<T>):Promise<T>{
  const work=(queues.get(key)??Promise.resolve()).catch(()=>{}).then(()=>{
   const locks=typeof navigator!=='undefined'?navigator.locks:undefined;
   return locks?locks.request(key,action):action();
  });
  queues.set(key,work);
  void work.finally(()=>{if(queues.get(key)===work)queues.delete(key);}).catch(()=>{});
  return work;
 }
 return {
  read:(origin:string,storyboardId:string,digest:string)=>{const k=key(origin,storyboardId,digest);return enqueue(k,async()=>{const raw=await storage.getItem(k);return raw===null?null:decode(raw);});},
  save:(origin:string,storyboardId:string,digest:string,value:StoryboardSelection)=>{const k=key(origin,storyboardId,digest),raw=JSON.stringify(validate(value));return enqueue(k,()=>storage.setItem(k,raw));},
  clear:(origin:string,storyboardId:string,digest:string,expected?:StoryboardSelection)=>{
   const k=key(origin,storyboardId,digest),snapshot=expected?JSON.stringify(validate(expected)):null;
   return enqueue(k,async()=>{
    if(snapshot!==null){const raw=await storage.getItem(k);if(raw===null||JSON.stringify(decode(raw))!==snapshot)return false;}
    await storage.removeItem(k);return true;
   });
  },
 };
}
export const storyboardSelections=storyboardSelectionStorage(AsyncStorage);
