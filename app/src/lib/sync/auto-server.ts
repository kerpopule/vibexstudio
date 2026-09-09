import AsyncStorage from '@react-native-async-storage/async-storage';
import {pairedSyncConnection,pairedServerBusy,syncPairedServer} from './paired-server';
import type {FolderSyncResult} from './folder-engine';

const key='vibex.server-sync.auto.v1';
type Status={identity?:string;message:string;result?:FolderSyncResult};
let status:Status={message:''};
const listeners=new Set<()=>void>();
export const getAutoServerStatus=()=>status;
export const subscribeAutoServer=(listener:()=>void)=>{listeners.add(listener);return()=>{listeners.delete(listener);};};
function report(value:Status){status=value;for(const listener of listeners)listener();}
export const autoServerEnabled=async(identity:string)=>await AsyncStorage.getItem(key)===identity;
export async function setAutoServer(identity:string,enabled:boolean){
 if(enabled){
  if((await pairedSyncConnection())?.identity!==identity)throw new Error('The paired server changed. Check its connection again.');
  await AsyncStorage.setItem(key,identity);
 }else await AsyncStorage.removeItem(key);
 report({identity,message:enabled?'Automatic sync is on while Studio is active.':'Automatic sync is off. Any transfer already running will finish.'});
}
export function initPairedServerSync(isActive:()=>boolean,interval=30_000){
 let stopped=false,timer:ReturnType<typeof setTimeout>;
 const tick=async()=>{
  let identity:string|null=null;
  try{
   if(stopped||!isActive()||pairedServerBusy())return;
   identity=await AsyncStorage.getItem(key);if(!identity||stopped)return;
   const connection=await pairedSyncConnection();
   if(!connection||connection.identity!==identity){report({message:'Automatic sync is paused. Check your paired server in Storage to enable it again.'});return;}
   if(stopped||!isActive()||!await autoServerEnabled(identity))return;
   const result=await syncPairedServer(connection.url,identity);
   if(!stopped)report({identity,result,message:`Automatic sync: ${result.pushed} sent · ${result.pulled} received${result.busy?` · ${result.busy} busy projects waiting`:''}${result.conflicts.length?` · ${result.conflicts.length} conflicts need review`:''}${result.failures.length?` · ${result.failures.length} projects could not sync`:''}`});
  }catch(error){if(!stopped)report({identity:identity??undefined,message:`Automatic sync will retry: ${error instanceof Error?error.message:String(error)}`});}
  finally{if(!stopped)timer=setTimeout(()=>void tick(),interval);}
 };
 timer=setTimeout(()=>void tick(),0);
 return()=>{stopped=true;clearTimeout(timer);};
}
