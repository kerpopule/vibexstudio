import {Alert} from '@/lib/app-alert';
import {savedSceneDuration} from '@/lib/saved-collections';
import {useCallback,useEffect,useRef,useState} from 'react';
import {storyboardSelections} from '@/lib/storyboard-selection';
import {router,Stack,useFocusEffect,useLocalSearchParams} from 'expo-router';
import {ScrollView,View} from 'react-native';
import {ThemedView} from '@/components/themed-view';
import {ThemedText} from '@/components/themed-text';
import {Button} from '@/components/ui/button';
import {TextField} from '@/components/ui/text-field';
import {Glass} from '@/components/ui/glass';
import {EditingMediaPicker} from '@/components/editing-media-picker';
import {useApp} from '@/lib/store';
import {listSavedCollection,listRemoteLibrary} from '@/lib/remote-library';
import {createStoryboardDraft,pendingStoryboardDraft,forgetStoryboardDraft,hasEditingMediaPermission} from '@/lib/remote-editing';
import {validateStoryboardInput,type StoryboardDraftRequest} from '@/lib/storyboard-draft-create';
import type {SavedRecord} from '@/lib/saved-collections';
import type {RemoteLibraryAsset} from '@/lib/library-core';

export default function StoryboardEdit(){
 const {id,sourceOrigin}=useLocalSearchParams<{id?:string;sourceOrigin?:string}>();
 const origin=useApp(state=>state.mediaLab?.url);
 const [record,setRecord]=useState<SavedRecord|null>(null),[assets,setAssets]=useState<RemoteLibraryAsset[]>([]);
 const [choices,setChoices]=useState<{assetId:string;seconds:string}[]>([]),[title,setTitle]=useState(''),[open,setOpen]=useState(0);
 const [pending,setPending]=useState<StoryboardDraftRequest|null>(null),[connected,setConnected]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),[created,setCreated]=useState<string|null>(null);
 const epoch=useRef(0),lock=useRef(false);
 const [refresh,setRefresh]=useState(0);
 const [musicAssetId,setMusicAssetId]=useState(''),[musicOpen,setMusicOpen]=useState(false);
 const [saveError,setSaveError]=useState('');
 useFocusEffect(useCallback(()=>{
  const current=++epoch.current;setError('');setCreated(null);setRecord(null);setPending(null);setChoices([]);setAssets([]);setConnected(false);setMusicAssetId('');
  if(!origin||origin!==sourceOrigin){setError('Return to Library and open this storyboard from its original server.');return;}
  setBusy(true);
  void (async()=>{
   const allowed=await hasEditingMediaPermission(origin);
   if(current!==epoch.current)return;setConnected(allowed);if(!allowed)return;
   const saved=await pendingStoryboardDraft(origin);
   if(current!==epoch.current)return;setPending(saved);if(saved)return;
   const [records,rows]=await Promise.all([listSavedCollection(origin,'storyboards'),listRemoteLibrary(origin)]);
   if(current!==epoch.current)return;
   const board=records.find(row=>row.id===id);if(!board?.sourceSha256)throw new Error('Update your server to import this storyboard.');
   if(!board.beats.length||board.beats.length>128)throw new Error('This editor supports one to 128 scenes.');
   const available=rows.filter(row=>['video','image','audio'].includes(row.kind)&&row.bytes<=256*1024**2);
   const review=await storyboardSelections.read(origin,board.id,board.sourceSha256);
   if(current!==epoch.current)return;
   if(review&&review.scenes.length!==board.beats.length)throw new Error('Saved review choices do not match this storyboard. Keep this device’s data and check the original.');
   setRecord(board);setTitle(review?.title??board.title.slice(0,160));setAssets(available);setMusicAssetId(review?review.musicAssetId||'':available.find(asset=>asset.id===board.soundtrackAsset?.id&&asset.kind==='audio')?.id||'');
   setChoices(review?.scenes??board.beats.map(beat=>({assetId:beat.mediaLinks?.find(link=>link.field==='clip_url'&&available.some(row=>row.id===link.id&&row.kind==='video'))?.id||'',seconds:beat.duration?.toString()||''})));
  })().catch(e=>{if(current===epoch.current)setError(e instanceof Error?e.message:'Could not load this storyboard.');}).finally(()=>{if(current===epoch.current)setBusy(false);});
  return ()=>{epoch.current++;};
 },[origin,sourceOrigin,id,refresh]));
 useEffect(()=>{
  if(!origin||origin!==sourceOrigin||!record?.sourceSha256||created||pending)return;
  let active=true;
  void storyboardSelections.save(origin,record.id,record.sourceSha256,{...(musicAssetId?{musicAssetId}:{}),title,scenes:choices}).then(()=>{if(active)setSaveError('');}).catch(()=>{if(active)setSaveError('Your review choices could not be saved on this device. Keep this screen open and try again.');});
  return ()=>{active=false;};
 },[origin,sourceOrigin,record,title,choices,musicAssetId,created,pending]);
 const input=record?{...(musicAssetId?{musicAssetId}:{}),storyboardId:record.id,sourceSha256:record.sourceSha256!,title:title.trim(),fps:24,scenes:choices.map(choice=>({assetId:choice.assetId,seconds:savedSceneDuration(choice.seconds)??0}))}:null;
 let valid=false;try{if(input){validateStoryboardInput(input);valid=true;}}catch{}
 function change(index:number,patch:Partial<{assetId:string;seconds:string}>){setChoices(values=>values.map((value,i)=>i===index?{...value,...patch}:value));}
 async function create(){
  if(!origin||origin!==sourceOrigin||lock.current)return;lock.current=true;setBusy(true);setError('');const current=epoch.current;
  try{const result=await createStoryboardDraft(origin,pending?undefined:input!);if(current===epoch.current){setCreated(result);setPending(null);setSaveError('');}
   if(record?.sourceSha256)try{await storyboardSelections.clear(origin,record.id,record.sourceSha256,{...(musicAssetId?{musicAssetId}:{}),title,scenes:choices});}catch{if(current===epoch.current)setSaveError('Your editing copy is saved, but this device could not clear the old review choices. Open the saved timeline.');}
  }
  catch(e){if(current===epoch.current){setError(e instanceof Error?e.message:'Could not create this draft.');try{setPending(await pendingStoryboardDraft(origin));}catch{setError('The saved request could not be read. Keep this device’s data and check server drafts.');}}}
  finally{lock.current=false;if(current===epoch.current)setBusy(false);}
 }
 return <ThemedView style={{flex:1}}><Stack.Screen options={{title:'Edit a storyboard'}}/><ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{padding:24,gap:16,maxWidth:1100,width:'100%',alignSelf:'center'}}>
  <ThemedText type="title">Make an editing copy</ThemedText>
  <ThemedText>Review each scene, then create a new timeline. Your saved storyboard and original files stay unchanged. Existing scene clips are suggested; missing clips need your choice.</ThemedText>
  <ThemedText themeColor="textSecondary">Timing uses 24 frames per second. This copies scene visuals and their embedded sound. You can add a soundtrack below. Transitions, captions and other finishing edits are added in the editor.</ThemedText>
  {!connected?<Button title="Connect media and editor" onPress={()=>router.push('/editor')}/>:null}
  {created?<><ThemedText accessibilityRole="alert">Your editing copy is saved.</ThemedText><Button title="Open timeline" onPress={()=>router.replace({pathname:'/editor-timeline',params:{id:created}})}/></>:pending?<Glass style={{padding:16,gap:12}}><ThemedText type="heading">Resume {pending.title}</ThemedText><ThemedText>{pending.scenes.length} scenes. Your request was saved before sending. Resume checks the same draft.</ThemedText><Button title="Resume storyboard import" loading={busy} onPress={()=>void create()}/><Button title="Review different choices" variant="secondary" disabled={busy} onPress={()=>Alert.alert('Stop tracking this request?', 'Your server may already have created the copy. Check editing drafts first. This clears only the request on this device; it does not delete a server draft.', [{text:'Keep request',style:'cancel'},{text:'Review again',onPress:()=>{if(origin)void forgetStoryboardDraft(origin).then(()=>setRefresh(v=>v+1)).catch(e=>setError(e instanceof Error?e.message:'Could not clear the request.'));}}])}/></Glass>:record?<>
   <TextField label="Editing copy name" value={title} onChangeText={setTitle} editable={!busy} maxLength={160}/>
   {record.beats.map((beat,i)=><Glass key={i} style={{padding:16,gap:10}}>
    <Button title={`${i+1}. ${beat.title} · ${choices[i]?.assetId&&Number(choices[i]?.seconds)>0?'Ready to review':'Needs a choice'}`} variant="secondary" disabled={busy} onPress={()=>setOpen(i)}/>
    {open===i?<><ThemedText>{beat.description}</ThemedText><TextField label={`Scene ${i+1} length in seconds`} value={choices[i]?.seconds||''} onChangeText={seconds=>change(i,{seconds})} keyboardType="decimal-pad" editable={!busy}/>
     <ThemedText>Selected: {assets.find(asset=>asset.id===choices[i]?.assetId)?.title||'Choose an image or video below'}</ThemedText>
     <EditingMediaPicker key={i} assets={assets.filter(asset=>asset.kind!=='audio')} selected={choices[i]?.assetId?[choices[i].assetId]:[]} onChange={ids=>change(i,{assetId:ids[0]||''})} disabled={busy} maxSelected={1} kinds={['video','image']}/>
     {i<record.beats.length-1?<Button title="Next scene" variant="secondary" disabled={busy} onPress={()=>setOpen(i+1)}/>:null}
    </>:null}
   </Glass>)}
   <Glass style={{padding:16,gap:10}}><Button title={musicAssetId?'Soundtrack: '+(assets.find(asset=>asset.id===musicAssetId)?.title||'Saved audio'):'Add a soundtrack (optional)'} variant="secondary" disabled={busy} onPress={()=>setMusicOpen(value=>!value)}/>
    {musicOpen?<><ThemedText>The soundtrack starts with scene one and stops when the visuals end. A shorter song ends naturally. Clip audio stays in the mix; adjust volumes in the editor.</ThemedText><EditingMediaPicker assets={assets.filter(asset=>asset.kind==='audio')} selected={musicAssetId?[musicAssetId]:[]} onChange={ids=>setMusicAssetId(ids[0]||'')} disabled={busy} maxSelected={1} kinds={['audio']}/>{!assets.some(asset=>asset.kind==='audio')?<ThemedText>Add an audio file to your server Library to choose it here.</ThemedText>:null}</>:null}
   </Glass>
   <Button title="Create editing copy" disabled={!valid||busy} loading={busy} onPress={()=>void create()}/>
  </>:null}
  {saveError?<><ThemedText accessibilityRole="alert">{saveError}</ThemedText>{!created&&!pending?<Button title="Retry saving review choices" variant="secondary" disabled={busy} onPress={()=>setChoices(values=>[...values])}/>:null}</>:null}
  {error?<ThemedText accessibilityRole="alert">{error}</ThemedText>:null}
  <Button title="View editing drafts" variant="secondary" disabled={busy} onPress={()=>router.push('/editor')}/>
 </ScrollView></ThemedView>;
}
