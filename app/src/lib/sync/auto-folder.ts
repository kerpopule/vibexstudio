import AsyncStorage from '@react-native-async-storage/async-storage';
import {desktopFolderAvailable,folderCommand,syncDesktopFolder,desktopFolderBusy} from '@/lib/sync/desktop-folder';
import type {FolderSyncResult} from '@/lib/sync/folder-engine';
const key='vibex.desktop-folder-auto.v1';
type Status={message:string;result?:FolderSyncResult};
let status:Status={message:''};
const listeners=new Set<()=>void>();
export const getAutoFolderStatus=()=>status;
export const subscribeAutoFolder=(listener:()=>void)=>{listeners.add(listener);return ()=>{listeners.delete(listener);};};
function report(value:Status){status=value;for(const listener of listeners)listener();}
export async function autoFolderEnabled(folder:string){return await AsyncStorage.getItem(key)===folder;}
export async function setAutoFolder(folder:string,enabled:boolean){
 if(enabled)await AsyncStorage.setItem(key,folder);else await AsyncStorage.removeItem(key);
 report({message:enabled?'Automatic sync is on while Studio is open.':'Automatic sync is off. Any sync already running will finish.'});
}
/** Serialized polling also picks up changes arriving through the user's storage app. */
export function startPollingSync(run:()=>Promise<void>,interval=30_000){
 let stopped=false,timer:ReturnType<typeof setTimeout>;
 const tick=async()=>{try{await run();}finally{if(!stopped)timer=setTimeout(()=>void tick(),interval);}};
 timer=setTimeout(()=>void tick(),0);
 return ()=>{stopped=true;clearTimeout(timer);};
}
export function initDesktopFolderSync(){
 if(!desktopFolderAvailable())return ()=>{};
 return startPollingSync(async()=>{
  try{
   const enabled=await AsyncStorage.getItem(key);if(!enabled||desktopFolderBusy())return;
   const selected=await folderCommand('status');if(selected.path!==enabled)return;
   const result=await syncDesktopFolder(enabled);
   report({result,message:`Automatic sync: ${result.pushed} saved · ${result.pulled} received${result.busy?` · ${result.busy} busy projects waiting`:''}${result.conflicts.length?` · ${result.conflicts.length} conflicts need review`:''}${result.failures.length?` · ${result.failures.length} projects could not sync`:''}`});
  }catch(error){report({message:`Automatic sync will retry: ${error instanceof Error?error.message:String(error)}`});}
 });
}
