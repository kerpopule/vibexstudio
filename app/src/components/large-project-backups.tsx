import {useEffect,useRef,useState} from 'react';
import {router} from 'expo-router';
import {Button} from './ui/button';
import {Glass} from './ui/glass';
import {ThemedText} from './themed-text';
import {useApp} from '../lib/store';
import {useChat} from '../lib/chat-engine';
import {projectArchivesAvailable,saveProjectArchive,restoreProjectArchive,pickProjectArchive} from '../lib/share/project-archives';
import type {ArchiveProgressHandler} from '../lib/share/project-directory-archive';
export function LargeProjectBackups(){
 const [available,setAvailable]=useState(false),[expanded,setExpanded]=useState(false),[busy,setBusy]=useState(false),[message,setMessage]=useState('');
 const [pending,setPending]=useState<Awaited<ReturnType<typeof pickProjectArchive>>>(null),[restored,setRestored]=useState<string|null>(null);
 const [workingOn,setWorkingOn]=useState<string|null>(null);
 const projects=useApp(s=>s.projects),lock=useRef(false);
 useEffect(()=>setAvailable(projectArchivesAvailable()),[]);
 if(!available)return null;
 function progress(action:string):ArchiveProgressHandler{
  let updated=0;
  return value=>{
   const now=Date.now();if(now-updated<200&&value.bytes!==value.totalBytes)return;updated=now;
   const amount=(bytes:number)=>`${(bytes/(1024*1024)).toFixed(1)} MiB`;
   setMessage(`${action} · ${amount(value.bytes)}${value.totalBytes===undefined?'':` of ${amount(value.totalBytes)}`}. Keep the app open.`);
  };
 }
 async function run(operation:()=>Promise<void>){
  if(lock.current)return;lock.current=true;setBusy(true);setMessage('');
  try{await operation();}catch(error){if(!(error instanceof Error&&error.name==='AbortError'))setMessage(error instanceof Error?error.message:'Could not complete this archive operation.');}
  finally{lock.current=false;setBusy(false);setWorkingOn(null);}
 }
 return <Glass style={{padding:16,gap:12}}>
  <Button title={expanded?'Hide larger media backups':'Larger media backups'} variant="secondary" disabled={busy} onPress={()=>setExpanded(!expanded)}/>
  {expanded?<>
   <ThemedText type="heading">Keep larger project media</ThemedText>
   <ThemedText>For projects beyond the regular backup size. Saves code, chat and embedded media in a .vibexdir archive on this device. Choose where to keep it; nothing goes to a VibeX server.</ThemedText>
   <ThemedText>Up to 128 MiB per file and 64 MiB of chat. Keep extra free space for a temporary copy. Automatic sync still has its smaller limit.</ThemedText>
   {projects.map(project=><Button key={project.id} title={busy&&workingOn===`save:${project.id}`?message:`Save archive · ${project.name}`} variant="secondary" disabled={busy} onPress={()=>void run(async()=>{
    if(useChat.getState().sessions[project.id]?.busy)throw new Error('Wait for this project’s AI to finish before saving its archive.');
    setWorkingOn(`save:${project.id}`);setMessage('Preparing a temporary project copy. Keep the app open.');
    await new Promise<void>(resolve=>setTimeout(resolve,0));
    const receipt=await saveProjectArchive(project.id,progress('Saving archive'));
    setMessage(receipt.temporaryCleanupComplete?'Archive handed to your device. Check the chosen destination before removing any originals.':'Archive saved; temporary storage cleanup will retry the next time you use archives.');
   })}/>)}
   <Button title="Choose an archive to restore" variant="secondary" disabled={busy} onPress={()=>void run(async()=>{
    const picked=await pickProjectArchive();
    if(picked){setPending(picked);setRestored(null);}
   })}/>
   {pending?<>
    <ThemedText type="heading">Restore {pending.name}?</ThemedText>
    <ThemedText>Every file is checked before a new project appears. Your existing projects stay as they are. AI and GitHub connections are excluded; only included media can be relinked.</ThemedText>
    <Button title={busy&&workingOn==='restore'?message:'Restore archive as a new project'} disabled={busy} onPress={()=>void run(async()=>{
     setWorkingOn('restore');setMessage('Opening and checking the archive. Keep the app open.');
     const id=await restoreProjectArchive(pending.input,progress('Checking archive'));setPending(null);setRestored(id);
     try{await useApp.getState().refreshProjects();setMessage('Archive restored as a separate project.');}
     catch{setMessage('The project was restored. Open it below; do not restore the archive again.');}
    })}/>
    <Button title="Cancel archive restore" variant="secondary" disabled={busy} onPress={()=>setPending(null)}/>
   </>:null}
   {restored?<Button title="Open restored archive project" disabled={busy} onPress={()=>router.push({pathname:'/project/[id]',params:{id:restored}})}/>:null}
   {message?<ThemedText accessibilityRole="alert">{message}</ThemedText>:null}
  </>:null}
 </Glass>;
}
