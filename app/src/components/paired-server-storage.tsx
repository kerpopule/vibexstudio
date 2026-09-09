import {useEffect,useRef,useState,useSyncExternalStore} from 'react';
import {ThemedText} from '@/components/themed-text';
import {Glass} from '@/components/ui/glass';
import {Button} from '@/components/ui/button';
import {Spacing} from '@/constants/theme';
import {useApp} from '@/lib/store';
import {inspectPairedSync,syncPairedServer,keepPairedServerCopies} from '@/lib/sync/paired-server';
import {autoServerEnabled,setAutoServer,getAutoServerStatus,subscribeAutoServer} from '@/lib/sync/auto-server';
export function PairedServerStorage({pairedHere=false}:{pairedHere?:boolean}={}){
 const projects=useApp(state=>state.projects),lock=useRef(false);
 const [busy,setBusy]=useState(false),[url,setUrl]=useState<string|null>(null),[message,setMessage]=useState(''),[conflicts,setConflicts]=useState<string[]>([]);
 const [identity,setIdentity]=useState<string|null>(null),[automatic,setAutomatic]=useState(false);
 const autoStatus=useSyncExternalStore(subscribeAutoServer,getAutoServerStatus,getAutoServerStatus);
 useEffect(()=>{if(identity&&autoStatus.identity===identity&&autoStatus.result)setConflicts(autoStatus.result.conflicts);},[identity,autoStatus]);
 async function run(action:()=>Promise<void>){if(lock.current)return;lock.current=true;setBusy(true);try{await action();}catch(error){setMessage(error instanceof Error?error.message:String(error));}finally{lock.current=false;setBusy(false);}}
 return <Glass style={{padding:Spacing.three,gap:Spacing.two}}>
  <ThemedText type="heading">Sync through your paired server</ThemedText>
  <ThemedText themeColor="textSecondary">{pairedHere ? 'Your computer is connected. Check whether it can also store and sync your projects.' : 'Use your own computer or server to exchange projects between devices. Connect it using the pairing button above.'} Its owner must enable project storage separately from building apps.</ThemedText>
  <Button title="Check my paired server" variant="secondary" disabled={busy} onPress={()=>void run(async()=>{setUrl(null);setIdentity(null);setAutomatic(false);setConflicts([]);const result=await inspectPairedSync();setUrl(result.available?result.url:null);if(result.available&&result.identity){setIdentity(result.identity);setAutomatic(await autoServerEnabled(result.identity));}setMessage(!result.url?(pairedHere?'This computer is no longer paired. Return to Setup and connect it again.':'No server paired. Use Connect my computer or server above, then check again.'):result.available?'The server supports project sync. Review what will be sent below.':'Connected for builds, but project sync is not enabled on this server.');})}/>
  {url?<>
   <ThemedText selectable>{url}</ThemedText>
   <ThemedText themeColor="textSecondary">Sync now sends all local projects, chats and embedded assets to this server and receives its projects. Anyone with this server’s pairing token can access its shared projects. AI keys and account connections stay on each device. Different edits are kept for review. Turn on automatic sync to check every 30 seconds while Studio is active. Your server must stay on; your phone can connect directly to it. Conflicts never overwrite either version automatically.</ThemedText>
   <Button title="Sync projects now" disabled={busy} onPress={()=>void run(async()=>{const result=await syncPairedServer(url,identity??undefined);setConflicts(result.conflicts);setMessage(`${result.pushed} sent · ${result.pulled} received · ${result.unchanged} already match · ${result.busy} busy projects skipped${result.conflicts.length?`\n${result.conflicts.length} conflicts preserved. Keep both copies below.`:''}${result.failures.length?'\n'+result.failures.map(f=>`${f.id}: ${f.message}`).join('\n'):''}`);})}/>
   {identity?<Button title={automatic?'Turn off automatic sync':'Keep my devices in sync'} variant="secondary" disabled={busy} onPress={()=>void run(async()=>{await setAutoServer(identity,!automatic);setAutomatic(!automatic);})}/>:null}
   {autoStatus.message&&(!autoStatus.identity||autoStatus.identity===identity)?<ThemedText>{autoStatus.message}</ThemedText>:null}
   {autoStatus.identity===identity?autoStatus.result?.failures.map(failure=><ThemedText key={failure.id} accessibilityRole="alert">{`${projects.find(project=>project.id===failure.id)?.name??failure.id}: ${failure.message}`}</ThemedText>):null}
   {conflicts.map(id=><Button key={id} title={`Keep both copies · ${projects.find(p=>p.id===id)?.name??id}`} disabled={busy} variant="secondary" onPress={()=>void run(async()=>{const copies=await keepPairedServerCopies(url,id,identity??undefined);setConflicts(ids=>ids.filter(value=>value!==id));setMessage(`Kept your project and ${copies.length} separate server copies.`);})}/>)}
  </>:null}
  {message?<ThemedText accessibilityRole="alert">{message}</ThemedText>:null}
 </Glass>;
}
