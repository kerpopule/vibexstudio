import {PreservedEdits} from '@/components/preserved-edits';
import {useCallback,useRef,useState} from 'react';
import {router,Stack,useFocusEffect,useLocalSearchParams} from 'expo-router';
import {ScrollView,View} from 'react-native';
import {ThemedView} from '@/components/themed-view';
import {ThemedText} from '@/components/themed-text';
import {TextField} from '@/components/ui/text-field';
import {Button} from '@/components/ui/button';
import {Glass} from '@/components/ui/glass';
import {useApp} from '@/lib/store';
import {connectEditing,disconnectEditing,hasEditingMediaPermission,listEditingDrafts,type EditingDraft} from '@/lib/remote-editing';

export default function EditorScreen(){
 const {intent}=useLocalSearchParams<{intent?:string}>();
 const musicVideo=intent==='music-video';
 const origin=useApp(state=>state.mediaLab?.url);
 const [code,setCode]=useState(''),[busy,setBusy]=useState(false),[connected,setConnected]=useState(false),[error,setError]=useState('');
 const [drafts,setDrafts]=useState<EditingDraft[]>([]);
 const epoch=useRef(0),locked=useRef(false);
 useFocusEffect(useCallback(()=>{
  const current=++epoch.current;setDrafts([]);setError('');setCode('');setConnected(false);setBusy(false);
  if(origin){setBusy(true);void hasEditingMediaPermission(origin).then(async allowed=>{
   if(epoch.current!==current)return;setConnected(allowed);
   if(allowed){const rows=await listEditingDrafts(origin);if(epoch.current===current)setDrafts(rows);}
  }).catch(()=>{if(epoch.current===current)setError('Could not load editing drafts. Check your server connection and refresh.');}).finally(()=>{if(epoch.current===current)setBusy(false);});}
  return ()=>{epoch.current++;};
 },[origin]));
 async function run(action:'connect'|'refresh'|'disconnect'){
  if(!origin||locked.current)return;locked.current=true;setBusy(true);setError('');const current=++epoch.current;
  try{
   if(action==='disconnect'){
    await disconnectEditing(origin);if(current===epoch.current){setConnected(false);setDrafts([]);}return;
   }
   if(action==='connect'){await connectEditing(origin,code.trim(),{includeLibrary:true});if(current===epoch.current){setCode('');setConnected(true);}}
   const rows=await listEditingDrafts(origin);if(current===epoch.current)setDrafts(rows);
  }catch(e){if(current===epoch.current)setError(e instanceof Error?e.message:'Could not reach your editor.');}
  finally{locked.current=false;if(current===epoch.current)setBusy(false);}
 }
 return <ThemedView style={{flex:1}}><Stack.Screen options={{title:'Editing drafts'}}/><ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{padding:24,paddingTop:56,gap:20,maxWidth:1000,width:'100%',alignSelf:'center'}}>
  <ThemedText type="title">Your editing drafts</ThemedText>
  <ThemedText>Saved on your Media Lab server. Originals stay unchanged.</ThemedText>
  {origin?<>
   <ThemedText type="small" themeColor="textSecondary">{origin}</ThemedText>
   {!connected?<Glass style={{padding:20,gap:16}}>
    <ThemedText type="heading">Connect media and editor</ThemedText>
    <ThemedText>This lets this device browse your server’s Library and work with its own editing drafts. It does not grant generation or publishing permission.</ThemedText>
    <TextField label="Media Lab access code" accessibilityLabel="Media Lab access code" secureTextEntry autoCapitalize="none" autoCorrect={false} value={code} onChangeText={setCode} editable={!busy}/>
    <Button title="Connect media and editor" disabled={!code.trim()} loading={busy} onPress={()=>void run('connect')}/>
   </Glass>:<>
    <View style={{flexDirection:'row',flexWrap:'wrap',gap:12}}><Button title={musicVideo?"New music video":"New draft from Library"} disabled={busy} onPress={()=>router.push({pathname:'/editor-new',params:musicVideo?{intent:'music-video'}:{}})}/><Button title="Refresh drafts" loading={busy} onPress={()=>void run('refresh')}/><Button title="Disconnect editor" disabled={busy} variant="secondary" onPress={()=>void run('disconnect')}/></View>
    <PreservedEdits key={origin} origin={origin}/>
    {!drafts.length&&!busy?<ThemedText>No editing drafts yet on this device.</ThemedText>:null}
    <View style={{flexDirection:'row',flexWrap:'wrap',gap:16}}>{drafts.map(draft=><Glass key={draft.id} style={{padding:20,gap:8,flexGrow:1,flexBasis:280}}>
     <ThemedText type="heading">{draft.title}</ThemedText><ThemedText>{draft.clips} clips · {draft.seconds.toFixed(1)} seconds</ThemedText>
     <ThemedText type="small" themeColor="textSecondary">Saved revision {draft.revision}</ThemedText>
     <Button title={`Open ${draft.title}`} disabled={busy} onPress={()=>router.push({pathname:'/editor-timeline',params:{id:draft.id}})}/>
    </Glass>)}</View>
   </>}
   <ThemedText type="small" themeColor="textSecondary">Open a draft to trim, split, reorder, add captions, adjust audio or set transitions. Preview and export tools appear when your server supports them.</ThemedText>
  </>:<Button title="Connect Media Lab" onPress={()=>router.push('/connect-media-lab')}/>}
  {error?<><ThemedText accessibilityRole="alert">{error}</ThemedText>{connected?<Button title="Reconnect media and editor" variant="secondary" disabled={busy} onPress={()=>{setConnected(false);setError('');}}/>:null}</>:null}
  <Button title="Back to Create" variant="secondary" onPress={()=>router.replace('/(tabs)/media-lab')}/>
 </ScrollView></ThemedView>;
}
