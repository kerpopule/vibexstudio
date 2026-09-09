import {decodeProjectSnapshot} from '@/lib/sync/project-snapshot';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {digestStringAsync,CryptoDigestAlgorithm} from 'expo-crypto';
import {syncProjectFolder,keepBothFolderVersions,type FolderSyncAdapter,type FolderState} from '@/lib/sync/folder-engine';
import {useChat} from '@/lib/chat-engine';
import {useApp} from '@/lib/store';
type Invoke=(command:string,args?:Record<string,unknown>)=>Promise<unknown>;
function bridge():Invoke|undefined{return (globalThis as unknown as {__TAURI_INTERNALS__?:{invoke?:Invoke}}).__TAURI_INTERNALS__?.invoke;}
export const desktopFolderAvailable=()=>typeof bridge()==='function';
export async function folderCommand(command:'pick'|'status'|'disconnect'){
 const invoke=bridge();if(!invoke)throw new Error('Folder sync requires the desktop app.');
 return await invoke('sync_folder_'+command) as {path?:string|null;cancelled?:boolean};
}
let running=false;
export const desktopFolderBusy=()=>running;
async function runFolderOperation<T>(operation:(adapter:FolderSyncAdapter)=>Promise<T>,expectedFolder?:string){
 const changed=new Set<string>();
 if(running)throw new Error('A folder sync is already running.');running=true;
 try{
  const invoke=bridge();if(!invoke)throw new Error('Folder sync requires the desktop app.');
  const {path:folder}=await folderCommand('status');if(!folder)throw new Error('Choose a folder first.');
  if(expectedFolder!==undefined&&folder!==expectedFolder)throw new Error('The selected folder changed.');
  const storage=await import('@/lib/storage/projects.web');
  const call=(request:Record<string,unknown>)=>invoke('sync_folder_request',{request:{...request,folder}});
  const key=(id:string)=>`vibex.desktop-sync.base.v1:${encodeURIComponent(folder)}:${id}`;
  const result=await operation({
   localIds:async()=>(await storage.listProjects()).map(p=>p.id),
   remoteIds:async()=>((await call({operation:'list'})) as {projects:string[]}).projects,
   local:id=>storage.readSyncSnapshot(id),
   remote:async id=>await call({operation:'read',projectId:id}) as FolderState,
   replace:async(raw,expected)=>{await storage.replaceSyncedProject(raw,expected);changed.add(decodeProjectSnapshot(raw).meta.id);},
   append:async(id,payload,expectedHeads)=>call({operation:'append',projectId:id,payload,expectedHeads}),
   baseline:id=>AsyncStorage.getItem(key(id)),acknowledge:(id,value)=>AsyncStorage.setItem(key(id),value),
   digest:raw=>digestStringAsync(CryptoDigestAlgorithm.SHA256,raw),busy:id=>!!useChat.getState().sessions[id]?.busy,
  });
  return result;
 }finally{
  try{
   if(changed.size){
    await useApp.getState().refreshProjects();
    for(const id of changed){
     if(!useChat.getState().sessions[id]?.busy)await useChat.getState().reload(id);
     useChat.getState().bumpFiles(id);
    }
   }
  }finally{running=false;}
 }
}

export const syncDesktopFolder=(expectedFolder?:string)=>runFolderOperation(syncProjectFolder,expectedFolder);
export const keepDesktopFolderCopies=(id:string)=>runFolderOperation(adapter=>keepBothFolderVersions(adapter,id));

export async function configureFolderServer(folder:string,enabled:boolean){
 const invoke=bridge();if(!invoke)throw new Error('This requires the desktop app.');
 return await invoke('sync_server_configure',{folder,enabled}) as {enabled:boolean;restartRequired:boolean};
}

export async function showFolderPairing(){const invoke=bridge();if(!invoke)throw new Error('This requires the desktop app.');await invoke('show_pair_window');}
