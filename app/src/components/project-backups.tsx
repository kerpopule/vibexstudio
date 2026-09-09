import {LargeProjectBackups} from './large-project-backups';
import {useRef,useState} from 'react';
import {router} from 'expo-router';
import * as DocumentPicker from 'expo-document-picker';
import {ThemedText} from '@/components/themed-text';
import {Button} from '@/components/ui/button';
import {Glass} from '@/components/ui/glass';
import {Spacing} from '@/constants/theme';
import {useApp} from '@/lib/store';
import {useChat} from '@/lib/chat-engine';
import {prepareProjectBackup,restoreProjectBackup} from '@/lib/share/project-backup';
import {saveBackupFile} from '@/lib/share/save-backup';
import {readBundleFile} from '@/lib/share/read-bundle-file';
import {decodeProjectSnapshot} from '@/lib/sync/project-snapshot';

export function ProjectBackups(){
 const projects=useApp(s=>s.projects),lock=useRef(false);
 const [busy,setBusy]=useState(false),[message,setMessage]=useState('');
 const [pending,setPending]=useState<{raw:string;name:string;messages:number;files:number;assets:number}|null>(null);
 const [restoredId,setRestoredId]=useState<string|null>(null);
 async function run(operation:()=>Promise<void>){
  if(lock.current)return;lock.current=true;setBusy(true);setMessage('');
  try{await operation();}catch(error){setMessage(error instanceof Error?error.message:'Could not complete the backup operation.');}
  finally{lock.current=false;setBusy(false);}
 }
 return <Glass style={{padding:Spacing.three,gap:Spacing.two}}>
  <ThemedText type="heading">Back up or move a whole project</ThemedText>
  <ThemedText themeColor="textSecondary">Keep a copy of your code, chat history and embedded media, including images, video and audio. Choose Files, iCloud Drive, Google Drive, or another installed destination in your device’s share sheet. Browsers download the file. This is a manual backup, not automatic sync.</ThemedText>
  <ThemedText themeColor="textSecondary">Backups contain your conversations and code. Account connections and media outside this project are excluded. Restoring creates a new project; connect its AI again when you’re ready.</ThemedText>
  {!projects.length?<ThemedText>No projects on this device yet. Restore a backup below, or create your first project in Build.</ThemedText>:null}
  {projects.map(project=><Button key={project.id} title={`Back up · ${project.name}`} variant="secondary" disabled={busy} onPress={()=>void run(async()=>{
   if(useChat.getState().sessions[project.id]?.busy)throw new Error('Wait for this project’s AI to finish, then back it up.');
   await saveBackupFile(await prepareProjectBackup(project.id));
   setMessage('Backup handed to your device. Check your chosen destination to confirm it was saved.');
  })}/>)}
  <Button title={busy?'Working…':pending?'Choose a different backup':'Restore a backup'} variant="secondary" disabled={busy} onPress={()=>void run(async()=>{
   const picked=await DocumentPicker.getDocumentAsync({type:'application/json',copyToCacheDirectory:true});
   if(picked.canceled)return;const asset=picked.assets[0];
   if(asset.size!==undefined&&asset.size>25_000_000)throw new Error('This backup exceeds the current 25 MB import limit.');
   const raw=await readBundleFile(asset.uri);
   const snapshot=decodeProjectSnapshot(raw);
   setPending({raw,name:snapshot.meta.name,messages:snapshot.chat.length,files:snapshot.files.length,assets:snapshot.files.filter(file=>file.encoding==='base64').length});
   setRestoredId(null);
  })}/>
  {pending?<Glass style={{padding:Spacing.three,gap:Spacing.two}}>
   <ThemedText type="heading">Restore {pending.name}?</ThemedText>
   <ThemedText>{pending.messages} chat messages · {pending.files} files, including {pending.assets} embedded media or binary files.</ThemedText>
   <ThemedText themeColor="textSecondary">This creates a separate project. It does not replace your current work, run its code, or connect an AI account. Only media included in this backup is restored.</ThemedText>
   <Button title="Restore as a new project" disabled={busy} onPress={()=>void run(async()=>{
    const id=await restoreProjectBackup(pending.raw);
    // Clear the actionable backup before refreshing the list: a failed refresh
    // must not leave a restore button that creates a duplicate on retry.
    setPending(null);setRestoredId(id);
    try{await useApp.getState().refreshProjects();setMessage('Restored as a new project. Open it below to continue.');}
    catch{setMessage('Your project was restored, but the project list could not refresh. Open it below or reopen Studio. Do not restore the same backup again.');}
   })}/>
   <Button title="Cancel restore" variant="secondary" disabled={busy} onPress={()=>{setPending(null);setMessage('');}}/>
  </Glass>:null}
  {restoredId?<Button title="Open restored project" disabled={busy} onPress={()=>router.push({pathname:'/project/[id]',params:{id:restoredId}})}/>:null}
  <LargeProjectBackups/>
  {message?<ThemedText accessibilityRole="alert">{message}</ThemedText>:null}
 </Glass>;
}
