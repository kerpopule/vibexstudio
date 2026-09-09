import AsyncStorage from '@react-native-async-storage/async-storage';
import {digestStringAsync,CryptoDigestAlgorithm} from 'expo-crypto';
import {getWorkbenchPairing} from '@/lib/workbench';
import * as storage from '@/lib/storage/projects';
import {useApp} from '@/lib/store';
import {useChat} from '@/lib/chat-engine';
import {decodeProjectSnapshot} from '@/lib/sync/project-snapshot';
import {requestProjectSync} from '@/lib/sync/server-transport';
import {syncProjectFolder,keepBothFolderVersions,type FolderSyncAdapter,type FolderState} from '@/lib/sync/folder-engine';
const digest=(value:string)=>digestStringAsync(CryptoDigestAlgorithm.SHA256,value);
export async function pairedSyncConnection(){
 const pairing=await getWorkbenchPairing();
 if(!pairing)return null;
 const identity=await digest(pairing.url+'\n'+pairing.token);
 return {url:pairing.url,identity};
}
export const pairedServerBusy=()=>running;
export async function inspectPairedSync(){
 const pairing=await getWorkbenchPairing();if(!pairing)return {url:null,available:false};
 const result=await requestProjectSync(pairing);
 return {url:pairing.url,identity:await digest(pairing.url+'\n'+pairing.token),available:result?.projectSync?.version===1};
}
let running=false;
async function operate<T>(expectedUrl:string,action:(adapter:FolderSyncAdapter)=>Promise<T>,expectedIdentity?:string){
 if(running)throw new Error('Server sync is already running.');running=true;const changed=new Set<string>();
 try{
  const pairing=await getWorkbenchPairing();if(!pairing||pairing.url!==expectedUrl)throw new Error('The paired server changed. Check its connection again.');
  if(expectedIdentity && await digest(pairing.url+'\n'+pairing.token)!==expectedIdentity)throw new Error('The paired server changed. Check its connection again.');
  const stillPaired=async()=>{const current=await getWorkbenchPairing();if(!current||current.url!==pairing.url||current.token!==pairing.token)throw new Error('The paired server changed. Check its connection again.');};
  const capability=await requestProjectSync(pairing);if(capability?.projectSync?.version!==1)throw new Error('Project sync is not enabled on this server.');
  const identity=await digest(pairing.url+'\n'+pairing.token),key=(id:string)=>`vibex.server-sync.base.v1:${identity}:${id}`;
  const call=async(body:Record<string,unknown>)=>{await stillPaired();return requestProjectSync(pairing,body);};
  return await action({
   localIds:async()=>(await storage.listProjects()).map(project=>project.id),
   remoteIds:async()=>{const result=await call({operation:'list'});if(!Array.isArray(result.projects)||result.projects.length>10000||result.projects.some((id:unknown)=>typeof id!=='string'||!/^[A-Za-z0-9_-]{1,128}$/.test(id)))throw new Error('Invalid server project list.');return result.projects;},
   local:async id=>storage.readSyncSnapshot(id),
   remote:async id=>await call({operation:'read',projectId:id}) as FolderState,
   replace:async(raw,expected)=>{await stillPaired();await storage.replaceSyncedProject(raw,expected);changed.add(decodeProjectSnapshot(raw).meta.id);},
   append:(id,payload,expectedHeads)=>call({operation:'append',projectId:id,payload,expectedHeads}),
   baseline:id=>AsyncStorage.getItem(key(id)),acknowledge:(id,value)=>AsyncStorage.setItem(key(id),value),digest,busy:id=>!!useChat.getState().sessions[id]?.busy,
  });
 }finally{
  try{if(changed.size){await useApp.getState().refreshProjects();for(const id of changed){if(!useChat.getState().sessions[id]?.busy)await useChat.getState().reload(id);useChat.getState().bumpFiles(id);}}}finally{running=false;}
 }
}
export const syncPairedServer=(url:string,identity?:string)=>operate(url,syncProjectFolder,identity);
export const keepPairedServerCopies=(url:string,id:string,identity?:string)=>operate(url,adapter=>keepBothFolderVersions(adapter,id),identity);
