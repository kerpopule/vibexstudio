import {editingSelections,type EditingSelection} from '@/lib/editing-selection';
import {MusicVideoMediaPicker} from '@/components/music-video-media-picker';
import {musicVideoSelection} from '@/lib/music-video-plan';
import {editingLibraryHandoff} from '@/lib/editing-library-handoff';
import {Alert} from '@/lib/app-alert';
import {useCallback,useRef,useState} from 'react';
import {router,Stack,useFocusEffect,useLocalSearchParams} from 'expo-router';
import {ScrollView,View} from 'react-native';
import {ThemedView} from '@/components/themed-view';
import {ThemedText} from '@/components/themed-text';
import {TextField} from '@/components/ui/text-field';
import {Button} from '@/components/ui/button';
import {Glass} from '@/components/ui/glass';
import {EditingMediaPicker} from '@/components/editing-media-picker';
import {useApp} from '@/lib/store';
import {listRemoteLibrary} from '@/lib/remote-library';
import type {RemoteLibraryAsset} from '@/lib/library-core';
import {createEditingDraft,pendingEditingDraft,forgetEditingDraftRequest,type PendingEditingDraft} from '@/lib/remote-editing';

const SAVE_SELECTION_ERROR='Your choices could not be saved on this device. Keep this screen open and try again.';
export default function NewEditingDraft(){
 const {assetId,sourceOrigin,intent}=useLocalSearchParams<{assetId?:string;sourceOrigin?:string;intent?:string}>();
 const musicVideo=intent==='music-video';
 const [musicReady,setMusicReady]=useState(false);
 const origin=useApp(state=>state.mediaLab?.url);
 const [title,setTitle]=useState('My video'),[selected,setSelected]=useState<string[]>([]),[assets,setAssets]=useState<RemoteLibraryAsset[]>([]);
 const [pending,setPending]=useState<PendingEditingDraft|null>(null),[ready,setReady]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),[created,setCreated]=useState<string|null>(null);
 const epoch=useRef(0),locked=useRef(false),choiceVersion=useRef(0);
 const [refresh,setRefresh]=useState(0),[selectionSaveFailed,setSelectionSaveFailed]=useState(false);
 const [handoffChoice,setHandoffChoice]=useState<EditingSelection|null>(null);
 function remember(next:EditingSelection){
  choiceVersion.current++;
  setTitle(next.title);setSelected(next.assetIds);
  if(origin){const current=epoch.current;void editingSelections.save(origin,musicVideo,next).then(()=>{if(current===epoch.current){setSelectionSaveFailed(false);setError(previous=>previous===SAVE_SELECTION_ERROR?'':previous);}}).catch(()=>{if(current===epoch.current){setSelectionSaveFailed(true);setError(SAVE_SELECTION_ERROR);}});}
 }
 useFocusEffect(useCallback(()=>{
  const selectionVersion=choiceVersion.current;
  const current=++epoch.current;setReady(false);setPending(null);setHandoffChoice(null);setSelected([]);setAssets([]);setError('');setCreated(null);setTitle(musicVideo?'My music video':'My video');setBusy(false);setMusicReady(false);
  if(origin)void (async()=>{
   const saved=await pendingEditingDraft(origin);
   const choices=saved?null:await editingSelections.read(origin,musicVideo);
   if(current!==epoch.current)return;
   setPending(saved);if(saved){setTitle(saved.title);setSelected(saved.assetIds);}else if(choices){setTitle(choices.title);setSelected(choices.assetIds);}
   setReady(!!saved);
   const rows=await listRemoteLibrary(origin);
   if(current===epoch.current){
    setReady(true);
    setAssets(rows.filter(row=>['image','video','audio'].includes(row.kind)&&row.bytes<=256*1024**2));
    if(!saved){const handoff=editingLibraryHandoff(origin,sourceOrigin,assetId,rows);if(handoff){if(choiceVersion.current!==selectionVersion||(choices&&(choices.assetIds.length||choices.title.trim())))setHandoffChoice(handoff);else remember(handoff);}}
   }
  })().catch(e=>{if(current===epoch.current)setError(e instanceof Error?e.message:'Could not read your Library.');});
  return ()=>{epoch.current++;};
 },[origin,assetId,sourceOrigin,musicVideo,refresh]));
 async function startOver(){
  if(!origin||locked.current)return;
  locked.current=true;setBusy(true);const current=++epoch.current;
  try{await forgetEditingDraftRequest(origin);if(current===epoch.current){setPending(null);remember({title:musicVideo?'My music video':'My video',assetIds:[]});setError('');}}
  catch{if(current===epoch.current)setError('Could not clear the saved request. Try again.');}
  finally{locked.current=false;if(current===epoch.current)setBusy(false);}
 }
 async function create(){
  if(!origin||!ready||locked.current)return;
  locked.current=true;setBusy(true);setError('');const current=++epoch.current;
  try{
   const submitted=pending?{title:pending.title,assetIds:pending.assetIds}:{title,assetIds:[...selected]};
   const id=await createEditingDraft(origin,pending?undefined:{title,assetIds:musicVideo?musicVideoSelection(selected,assets).assetIds:selected});
   if(current===epoch.current){setPending(null);setCreated(id);}
   try{await editingSelections.clear(origin,musicVideo,submitted);}catch{if(current===epoch.current)setError('Your server draft is saved, but the old choices could not be cleared on this device. Open the saved draft rather than creating another copy.');}
  }catch(e){
   if(current===epoch.current){setError(e instanceof Error?e.message:'Could not prepare this draft.');
    try{const saved=await pendingEditingDraft(origin);if(current===epoch.current){setPending(saved);if(saved){setTitle(saved.title);setSelected(saved.assetIds);}}}catch{if(current===epoch.current)setReady(false);}
   }
  }finally{locked.current=false;if(current===epoch.current)setBusy(false);}
 }
 return <ThemedView style={{flex:1}}><Stack.Screen options={{title:musicVideo?'New music video':'New editing draft'}}/><ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{padding:24,gap:20,maxWidth:1000,width:'100%',alignSelf:'center'}}>
  <ThemedText type="title">{musicVideo?'Make a music video':'Start with your media'}</ThemedText>
  <ThemedText>Choose up to eight items from your server’s Library. Pictures and clips appear in selection order. Songs go on the music track. Your original files stay unchanged.</ThemedText>
  {origin?<ThemedText type="small" themeColor="textSecondary">{origin}</ThemedText>:<Button title="Connect Media Lab" onPress={()=>router.push('/connect-media-lab')}/>}
  {created?<><ThemedText accessibilityRole="alert">Draft saved on your server.</ThemedText><Button title="Open video editor" onPress={()=>router.replace({pathname:'/editor-timeline',params:{id:created}})}/><Button title="View my drafts" onPress={()=>router.replace('/editor')}/></>:<>
   <TextField label="Draft name" accessibilityLabel="Draft name" value={title} onChangeText={value=>remember({title:value,assetIds:selected})} maxLength={160} editable={ready&&!busy&&!pending}/>
   {handoffChoice&&!pending?<Glass style={{padding:16,gap:8}}><ThemedText>Your saved choices are still here. Use the Library item you just opened instead?</ThemedText><Button title="Use this Library item" disabled={busy||!ready} onPress={()=>{remember(handoffChoice);setHandoffChoice(null);}}/><Button title="Keep my saved choices" variant="secondary" disabled={busy} onPress={()=>setHandoffChoice(null)}/></Glass>:null}
   {pending?<Glass style={{padding:20,gap:12}}><ThemedText type="heading">Finish your saved request</ThemedText><ThemedText>{pending.title} · {pending.assetIds.length} selected items. Resume checks the same request so a dropped connection does not create another draft.</ThemedText></Glass>:<>
    <>{musicVideo?<MusicVideoMediaPicker key={origin} assets={assets} selected={selected} onChange={ids=>remember({title,assetIds:ids})} disabled={busy||!ready} onReady={setMusicReady}/>:<EditingMediaPicker key={origin} assets={assets} selected={selected} onChange={ids=>remember({title,assetIds:ids})} disabled={busy||!ready}/>}</>
    {!assets.length&&ready?<ThemedText>No supported items loaded. Connect Library with your server code, or add media there first.</ThemedText>:null}
   </>}
   <Button title={pending?'Resume saved draft':musicVideo?'Create music video draft':'Create editing draft'} loading={busy} disabled={!ready||!origin||(!pending&&(!title.trim()||!selected.length||(musicVideo&&!musicReady)))} onPress={()=>void create()}/>
   {pending?<Button title="Start over with another selection" variant="secondary" disabled={busy} onPress={()=>Alert.alert('Stop tracking this draft request?', 'Your server may already have saved a draft. Starting over does not cancel server work or delete that draft. Check your draft list before creating another copy.', [{text:'Keep request',style:'cancel'},{text:'Start over',onPress:()=>void startOver()}])}/>:null}
   <Button title="Open Library" variant="secondary" disabled={busy} onPress={()=>router.push('/library')}/>
  </>}
  {error?<><ThemedText accessibilityRole="alert">{error}</ThemedText>{!created?<Button title={selectionSaveFailed?"Retry saving my choices":"Reload saved choices and Library"} variant="secondary" disabled={busy} onPress={()=>{if(selectionSaveFailed)remember({title,assetIds:selected});else setRefresh(value=>value+1);}}/>:null}</>:null}
  <ThemedText type="small" themeColor="textSecondary">This prepares an editing draft on your own server. FFprobe must be installed there. Files up to 256 MB are supported in this preview. Rendering is not started.</ThemedText>
  <Button title="Back to drafts" variant="secondary" disabled={busy} onPress={()=>router.replace('/editor')}/>
 </ScrollView></ThemedView>;
}
