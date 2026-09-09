import {useCallback,useRef,useState} from 'react';
import {router,useFocusEffect} from 'expo-router';
import {View} from 'react-native';
import {Button} from '@/components/ui/button';
import {ThemedText} from '@/components/themed-text';
import {readEditingExportJob,startEditingExportJob,saveExportToLibrary,type EditingExportReceipt} from '@/lib/remote-editing';
import {saveEditingExport} from '@/lib/save-editing-export';
export function EditingExport({origin,id,revision,disabled,librarySave}:{librarySave:boolean;origin:string;id:string;revision:number;disabled:boolean}){
 const [receipt,setReceipt]=useState<EditingExportReceipt|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const [jobState,setJobState]=useState('');
 const [libraryAsset,setLibraryAsset]=useState<string|null>(null);
 const epoch=useRef(0),lock=useRef(false);
 useFocusEffect(useCallback(()=>()=>{epoch.current++;},[]));
 useFocusEffect(useCallback(()=>{
  if(jobState!=='running'||disabled)return;
  const timer=setInterval(()=>void checkSaved(),4000);
  return ()=>clearInterval(timer);
 },[jobState,disabled,origin,id,revision]));
 async function checkSaved(){
  if(lock.current)return;lock.current=true;setBusy(true);setError('');const current=epoch.current;
  try{const value=await readEditingExportJob(origin,id,revision);if(current===epoch.current){setReceipt(value.receipt);setJobState(value.state);}}
  catch(e){if(current===epoch.current)setError(e instanceof Error?e.message:'Could not check this export.');}
  finally{lock.current=false;setBusy(false);}
 }
 async function run(save:boolean,library=false){
  if(lock.current)return;lock.current=true;setBusy(true);setError('');const current=epoch.current;
  try{if(library&&receipt){const asset=await saveExportToLibrary(origin,id,receipt.revision);if(current===epoch.current)setLibraryAsset(asset);}else if(save&&receipt){await saveEditingExport(origin,receipt);}else{const value=await startEditingExportJob(origin,id,revision);if(current===epoch.current){setReceipt(value.receipt);setJobState(value.state);}}}
  catch(e){if(current===epoch.current&&!(save&&e instanceof Error&&e.name==='AbortError'))setError(e instanceof Error?e.message:'Could not export this revision. Retry to check for a completed file.');}
  finally{lock.current=false;setBusy(false);}
 }
 return <View style={{gap:12}}>
  <ThemedText type="heading">Export your video</ThemedText>
  <ThemedText type="small">High-quality MP4 with your captions and audio. Up to 10 minutes and 1080p at the timeline’s original size. Your server does the work; nothing is published. Rendering can take several minutes. Retry checks the same revision.</ThemedText>
  {jobState==='running'?<ThemedText type="small">Your server is rendering this revision. You can leave this screen and check back later.</ThemedText>:null}
  {jobState==='failed'||jobState==='interrupted'?<ThemedText accessibilityRole="alert">The export did not finish or no longer verifies. Prepare it again to retry.</ThemedText>:null}
  {jobState==='not-ready'?<ThemedText type="small">No export is saved for this revision yet.</ThemedText>:null}
  <Button title={receipt?'Check completed export':jobState==='running'?'Rendering on your server':'Prepare high-quality export'} variant="secondary" disabled={disabled||busy||jobState==='running'} loading={busy} onPress={()=>void run(false)}/>
  <Button title="Check export progress" variant="secondary" disabled={disabled||busy} onPress={()=>void checkSaved()}/>
  {receipt?<><ThemedText type="small">Ready · {receipt.width} × {receipt.height} · {(receipt.bytes/1024**2).toFixed(1)} MB</ThemedText><Button title="Save exported video" disabled={disabled||busy} onPress={()=>void run(true)}/></>:null}
  {receipt&&librarySave?<>
   <ThemedText type="small">Save a copy in your server Library to reuse it in apps, websites or games. Other devices paired to that Library can use it too. Up to 256 MB.</ThemedText>
   <Button title={libraryAsset?'Saved in server Library':'Save to server Library'} variant="secondary" disabled={disabled||busy||receipt.bytes>256*1024**2||!!libraryAsset} onPress={()=>void run(false,true)}/>
   {libraryAsset?<Button title="Use this video from Library" onPress={()=>router.push({pathname:'/library',params:{assetId:`server-${libraryAsset}`}})}/>:null}
  </>:null}
  {receipt&&!librarySave?<ThemedText type="small">This server does not advertise saving exports to Library. You can still save the video to your device. Update your server to enable direct Library saves.</ThemedText>:null}
  {error?<ThemedText accessibilityRole="alert">{error}</ThemedText>:null}
 </View>;
}
