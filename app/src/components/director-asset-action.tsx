import {useEffect,useRef,useState} from 'react';
import {Modal,ScrollView,View} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {useTheme} from '@/hooks/use-theme';
import {Button} from './ui/button';
import {ThemedText} from './themed-text';
import {reviewDirectorAsset,importDirectorAsset,type DirectorAssetReview} from '@/lib/director-asset-import';
import {useApp} from '@/lib/store';
import {useChat} from '@/lib/chat-engine';
import type {ProjectMeta} from '@/lib/types';
export function DirectorAssetAction({assetId,project,origin,disabled,onImported}:{assetId:string;project:ProjectMeta;origin?:string;disabled:boolean;onImported:(path:string)=>void}){
 const theme=useTheme(),insets=useSafeAreaInsets();
 const [review,setReview]=useState<DirectorAssetReview|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[saved,setSaved]=useState('');
 const active=useRef(true),working=useRef(false);
 useEffect(()=>{active.current=true;return()=>{active.current=false;};},[]);
 const available=()=>active.current&&useApp.getState().mediaLab?.url===origin&&!useChat.getState().sessions[project.id]?.busy&&useApp.getState().projects.some(p=>p.id===project.id&&p.createdAt===project.createdAt);
 async function run(copy:boolean){
  if(working.current||disabled)return;working.current=true;setBusy(true);setError('');
  try{
   if(copy&&review){
    const result=await importDirectorAsset(review,available);
    if(active.current){setSaved(result.path);onImported(result.path);}
    useChat.getState().bumpFiles(project.id);
    await useApp.getState().refreshProjects();
   }else{const result=await reviewDirectorAsset(project.id,assetId,origin);if(active.current)setReview(result);}
  }catch(e){if(active.current)setError(e instanceof Error?e.message:'The item could not be copied. Try again.');}
  finally{working.current=false;if(active.current)setBusy(false);}
 }
 return <View style={{gap:8}}>
  {saved?<ThemedText>Added to this project: {saved}. Review the plan in the builder to decide how to use it.</ThemedText>:<Button title="Review suggested Library item" variant="secondary" loading={busy} disabled={disabled||busy} onPress={()=>void run(false)}/>}
  {!review&&error?<ThemedText accessibilityRole="alert">{error}</ThemedText>:null}
  <Modal visible={Boolean(review&&!saved)} transparent animationType="fade" onRequestClose={()=>{if(!busy)setReview(null);}}>
   <View style={{flex:1,backgroundColor:'rgba(0,0,0,.65)',paddingTop:insets.top+16,paddingBottom:insets.bottom+16,paddingHorizontal:16,justifyContent:'center',alignItems:'center'}}>
    <View accessibilityViewIsModal style={{width:'100%',maxWidth:520,maxHeight:'100%',backgroundColor:theme.background,borderColor:theme.border,borderWidth:1,borderRadius:20,padding:20,gap:16}}>
     <ThemedText type="heading">Add this Library item?</ThemedText>
     <ScrollView style={{flexShrink:1}} contentContainerStyle={{gap:12}}>
      <ThemedText type="smallBold">{review?.entry.prompt||'Untitled creation'}</ThemedText>
      <ThemedText>{review?.entry.kind} · {review?.entry.remote?'Your Media Lab server':'This device'}{review?.entry.remote?` · ${review.entry.remote.bytes<1024?`${review.entry.remote.bytes} bytes`:`${(review.entry.remote.bytes/1024).toFixed(1)} KiB`}`:''}</ThemedText>
      <ThemedText>Copy into {project.name}.</ThemedText>
      <ThemedText type="small" selectable>{review?.path}</ThemedText>
      <ThemedText>The original stays in Library. No AI generation is started.</ThemedText>
      {error?<ThemedText accessibilityRole="alert">{error}</ThemedText>:null}
     </ScrollView>
     <Button title="Add to this project" loading={busy} disabled={disabled||busy} onPress={()=>void run(true)}/>
     {error?<Button title="Refresh item details" variant="secondary" disabled={disabled||busy} onPress={()=>void run(false)}/>:null}
     <Button title="Cancel" variant="secondary" disabled={busy} onPress={()=>setReview(null)}/>
    </View>
   </View>
  </Modal>
 </View>;
}
