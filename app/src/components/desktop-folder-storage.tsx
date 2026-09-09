import {autoFolderEnabled,setAutoFolder,getAutoFolderStatus,subscribeAutoFolder} from '@/lib/sync/auto-folder';
import {useEffect,useState,useSyncExternalStore} from 'react';
import {View} from 'react-native';
import {useApp} from '@/lib/store';
import {Glass} from '@/components/ui/glass';
import {Button} from '@/components/ui/button';
import {ThemedText} from '@/components/themed-text';
import {showFolderPairing,configureFolderServer,desktopFolderAvailable,folderCommand,syncDesktopFolder,keepDesktopFolderCopies} from '@/lib/sync/desktop-folder';
export function DesktopFolderStorage(){
 const [folder,setFolder]=useState<string|null>(null),[busy,setBusy]=useState(false),[message,setMessage]=useState('');
 const [automatic,setAutomatic]=useState(false);
 const autoStatus=useSyncExternalStore(subscribeAutoFolder,getAutoFolderStatus,getAutoFolderStatus);
 const [conflicts,setConflicts]=useState<string[]>([]);
 const projects=useApp(state=>state.projects);
 const available=desktopFolderAvailable();
 useEffect(()=>{if(available)void folderCommand('status').then(result=>setFolder(result.path??null)).catch(error=>setMessage(String(error)));},[available]);
 useEffect(()=>{let active=true;setAutomatic(false);if(folder)void autoFolderEnabled(folder).then(value=>{if(active)setAutomatic(value);}).catch(()=>{});return ()=>{active=false;};},[folder]);
 useEffect(()=>{if(automatic&&autoStatus.result)setConflicts(autoStatus.result.conflicts);},[automatic,autoStatus]);
 if(!available)return null;
 const run=async(action:()=>Promise<void>)=>{setBusy(true);setMessage('');try{await action();}catch(error){setMessage(error instanceof Error?error.message:String(error));}finally{setBusy(false);}};
 return <Glass style={{padding:20,gap:12}}>
  <ThemedText type="heading">Sync with a folder you own</ThemedText>
  <ThemedText themeColor="textSecondary">Choose a local folder, a mounted server folder, or a folder managed by your iCloud Drive or Google Drive desktop app. Your storage app moves the files between computers; Studio does not upload them to its own cloud.</ThemedText>
  <ThemedText themeColor="textSecondary">Use the same folder on each desktop, wait for your storage app to finish, then select Sync now, or turn on automatic sync while Studio is open. This syncs code, chats and embedded project assets, including image and video attachments stored in the project. AI keys and GitHub connections stay on each device. Attachments pointing outside the project must be added before syncing.</ThemedText>
  <ThemedText themeColor="textSecondary">Desktop preview: cloud-folder compatibility is still being tested. Folder sync is separate from the mobile app’s current sync format.</ThemedText>
  <ThemedText selectable>{folder??'No folder connected'}</ThemedText>
  <View style={{gap:10}}>
   <Button title={folder?'Choose a different folder':'Choose my folder'} variant="secondary" disabled={busy} onPress={()=>void run(async()=>{const result=await folderCommand('pick');if(!result.cancelled){setFolder(result.path??null);setConflicts([]);}})}/>
   {folder?<>
    <Button title={automatic?'Turn off automatic sync':'Turn on automatic sync'} variant="secondary" disabled={busy} onPress={()=>void run(async()=>{await setAutoFolder(folder,!automatic);setAutomatic(!automatic);})}/>
    <ThemedText themeColor="textSecondary">Automatic sync checks every 30 seconds while Studio is open. It waits for busy AI projects and keeps conflicting versions for you to review. It does not run when Studio is closed.</ThemedText>
    <Button title="Sync now" loading={busy} onPress={()=>void run(async()=>{
     const result=await syncDesktopFolder();setConflicts(result.conflicts);
     setMessage(`${result.pushed} saved to folder · ${result.pulled} received · ${result.unchanged} already match${result.busy?` · ${result.busy} busy projects skipped`:''}${result.conflicts.length?`\n${result.conflicts.length} conflicts kept unchanged. Keep both copies below to continue without discarding either version.`:''}${result.failures.length?`\n${result.failures.map(f=>`${f.id}: ${f.message}`).join('\n')}`:''}`);
    })}/>
    <ThemedText type="heading">Let your other devices use this folder</ThemedText>
    <ThemedText themeColor="textSecondary">Share this folder through this computer’s build server. Paired devices can read and add its projects, chats and embedded media. This uses your computer, not a VibeX cloud. Restart Studio after changing this setting; finish active builds first.</ThemedText>
    <Button title="Enable sharing on next launch" variant="secondary" disabled={busy} onPress={()=>void run(async()=>{await configureFolderServer(folder,true);setMessage('Folder sharing configured. Restart Studio, then use the desktop pairing QR to connect your other device.');})}/>
    <Button title="Disable sharing on next launch" variant="secondary" disabled={busy} onPress={()=>void run(async()=>{await configureFolderServer(folder,false);setMessage('Folder sharing will be disabled after Studio restarts. Existing project files are kept.');})}/>
    <Button title="Show pairing QR" variant="secondary" disabled={busy} onPress={()=>void run(showFolderPairing)}/>
    <ThemedText themeColor="textSecondary">Disconnect folder only stops this app’s folder connection. To stop access from paired devices, disable sharing and restart Studio.</ThemedText>
    <Button title="Disconnect folder" variant="secondary" disabled={busy} onPress={()=>void run(async()=>{await setAutoFolder(folder,false);await folderCommand('disconnect');setFolder(null);setConflicts([]);setMessage('Disconnected. Files already saved in that folder are still there.');})}/>
   </>:null}
  </View>
  {conflicts.length?<ThemedText themeColor="textSecondary">Keep your current project and add each different folder version as a separate project. Both are saved to your folder; no version is discarded.</ThemedText>:null}
  {conflicts.map(id=><Button key={id} title={`Keep both copies · ${projects.find(project=>project.id===id)?.name??id}`} variant="secondary" disabled={busy} onPress={()=>void run(async()=>{
   const copies=await keepDesktopFolderCopies(id);setConflicts(current=>current.filter(value=>value!==id));setMessage(`Kept your project and ${copies.length} separate folder ${copies.length===1?'copy':'copies'}.`);
  })}/>)}
  {automatic&&autoStatus.message?<ThemedText accessibilityLiveRegion="polite">{autoStatus.message}</ThemedText>:null}
  {message?<ThemedText accessibilityLiveRegion="polite">{message}</ThemedText>:null}
 </Glass>;
}
