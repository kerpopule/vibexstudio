import {useCallback,useEffect,useRef,useState} from 'react';
import {router,useFocusEffect} from 'expo-router';
import {AppState,View} from 'react-native';
import {useVideoPlayer,VideoView} from 'expo-video';
import {useEvent} from 'expo';
import {Button} from '@/components/ui/button';
import {ThemedText} from '@/components/themed-text';
import {saveEditingPreview} from '@/lib/save-editing-preview';
import {renderEditingPreview,readEditingPreview,type EditingPreviewReceipt} from '@/lib/remote-editing';
import {editingPreviewFile} from '@/lib/editing-preview-file';

type PlaybackFile={uri:string;dispose:()=>void};
/** Parent keys this component by server/project/revision; it never plays stale edits. */
export function EditingPreview({origin,id,revision,title,disabled}:{title:string;origin:string;id:string;revision:number;disabled:boolean}){
 const [file,setFile]=useState<PlaybackFile|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[inLibrary,setInLibrary]=useState(false);
 const receiptRef=useRef<EditingPreviewReceipt|null>(null);
 const saved=useRef<PlaybackFile|null>(null),epoch=useRef(0),lock=useRef(false),focused=useRef(false);
 useFocusEffect(useCallback(()=>{focused.current=true;setBusy(lock.current);return ()=>{focused.current=false;epoch.current++;saved.current?.dispose();saved.current=null;setFile(null);};},[]));
 async function render(){
  if(lock.current)return;lock.current=true;setBusy(true);setError('');const current=++epoch.current;
  try{
   const receipt=await renderEditingPreview(origin,id,revision);
   if(epoch.current!==current)return;
   const bytes=await readEditingPreview(origin,receipt);
   if(epoch.current!==current)return;
   const prepared=await editingPreviewFile(bytes);
   if(epoch.current!==current){prepared.dispose();return;}
   saved.current?.dispose();saved.current=prepared;receiptRef.current=receipt;setFile(prepared);
  }catch(e){if(epoch.current===current)setError(e instanceof Error?e.message:'Could not load the preview.');}
  finally{lock.current=false;if(focused.current)setBusy(false);}
 }
 async function save(){
  if(lock.current||!receiptRef.current)return;lock.current=true;setBusy(true);setError('');const current=epoch.current;
  try{await saveEditingPreview(origin,receiptRef.current,title);if(epoch.current===current)setInLibrary(true);}
  catch(e){if(epoch.current===current)setError(e instanceof Error?e.message:'Could not save this preview. Retry when device storage is available.');}
  finally{lock.current=false;if(focused.current)setBusy(false);}
 }
 return <View style={{gap:12}}>
  <ThemedText type="heading">Watch this revision</ThemedText>
  <ThemedText type="small">Render a private preview on your server. Up to 60 seconds, 16 clips and 720p. Repeating this action reuses a completed preview.</ThemedText>
  <Button title={file?'Reload preview':'Render and watch preview'} disabled={disabled} loading={busy} onPress={()=>void render()}/>
  {file?<>
   <PreviewPlayer key={file.uri} uri={file.uri}/>
   {inLibrary?<Button title="Open saved preview in Library" variant="secondary" disabled={busy} onPress={()=>router.push('/library')}/>:<Button title="Save preview to Library" variant="secondary" disabled={busy||disabled} onPress={()=>void save()}/>}
   <ThemedText type="small">Save a copy on this device to reuse in projects. This is preview quality, not a full-quality export.</ThemedText>
  </>:null}
  {error?<ThemedText accessibilityRole="alert">{error}</ThemedText>:null}
 </View>;
}
function PreviewPlayer({uri}:{uri:string}){
 const player=useVideoPlayer(uri),{status}=useEvent(player,'statusChange',{status:player.status});
 useFocusEffect(useCallback(()=>()=>player.pause(),[player]));
 useEffect(()=>{const subscription=AppState.addEventListener('change',state=>{if(state!=='active')player.pause();});return ()=>subscription.remove();},[player]);
 return <><VideoView player={player} nativeControls contentFit="contain" style={{width:'100%',aspectRatio:16/9,backgroundColor:'#000'}} accessibilityLabel="Editing preview"/>
 {status==='error'?<ThemedText accessibilityRole="alert">The preview could not be played on this device.</ThemedText>:null}</>;
}
