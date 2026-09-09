import {useCallback,useState} from 'react';
import {router,useFocusEffect} from 'expo-router';
import {Linking,ScrollView,View} from 'react-native';
import {ThemedView} from '@/components/themed-view';
import {ThemedText} from '@/components/themed-text';
import {TextField} from '@/components/ui/text-field';
import {Button} from '@/components/ui/button';
import {Glass} from '@/components/ui/glass';
import {Spacing} from '@/constants/theme';
import {useApp} from '@/lib/store';
import {useSongStudio} from '@/lib/song-studio';
import {useSongDraft,restoreSongDraft} from '@/lib/song-draft';

export default function SongScreen(){
 const providers=useApp(state=>state.providers).filter(row=>row.kind==='fal'&&row.auth==='apiKey');
 const {draft,update,storageError}=useSongDraft();
 const {providerId:selected,prompt,instrumental,duration}=draft;
 const [error,setError]=useState(''),[removing,setRemoving]=useState<string|null>(null);
 const [optionsOpen,setOptionsOpen]=useState(false);
 const provider=selected===null?providers[0]:providers.find(row=>row.id===selected);
 const {jobs,savedId,hydrate,start,resume,dismiss}=useSongStudio();
 const busy=jobs.some(row=>row.status==='running');
 useFocusEffect(useCallback(()=>{void restoreSongDraft();void hydrate().catch(()=>setError('Saved song requests could not be read. Try reopening this screen.'));},[hydrate]));
 return <ThemedView style={{flex:1}}><ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{padding:Spacing.three,gap:Spacing.three,maxWidth:800,width:'100%',alignSelf:'center'}}>
  <ThemedText type="title">Make a song</ThemedText>
  <ThemedText>Describe a mood, style and subject. ACE-Step uses your prompt to create music and lyrics. Choose vocals or an instrumental, and a length that suits your project.</ThemedText>
  <ThemedText type="small" themeColor="textSecondary">Uses your fal.ai credits. Your prompt goes directly to fal.ai; finished audio saves on this device. No computer or Media Lab server is needed.</ThemedText>
  {!providers.length?<Button title="Connect my fal.ai key" onPress={()=>router.push('/fal-setup')}/>:<>
   {providers.map(row=><Button key={row.id} title={`${row.id===provider?.id?'Selected · ':''}${row.label}`} variant="secondary" disabled={busy} onPress={()=>update({providerId:row.id})}/>)}
   <TextField label="Your song idea" value={prompt} onChangeText={prompt=>update({prompt})} multiline maxLength={8000} editable={!busy} placeholder="An upbeat folk song about exploring a new world"/>
   <ThemedText type="small">{duration} seconds · {instrumental?'Instrumental':'Vocals'}</ThemedText>
   <Button title={optionsOpen?'Hide song options':'Song options'} variant="secondary" disabled={busy} onPress={()=>setOptionsOpen(value=>!value)}/>
   {optionsOpen?<Glass style={{padding:Spacing.three,gap:Spacing.two}}>
    <ThemedText type="heading">Sound</ThemedText>
    <View style={{flexDirection:'row',flexWrap:'wrap',gap:Spacing.two}}>{[false,true].map(value=><Button key={String(value)} title={`${instrumental===value?'Selected · ':''}${value?'Instrumental':'Vocals'}`} variant="secondary" disabled={busy} onPress={()=>update({instrumental:value})}/>)}</View>
    <ThemedText type="heading">Length</ThemedText>
    <ThemedText type="small">Longer songs use more of your fal.ai credits.</ThemedText>
    <View style={{flexDirection:'row',flexWrap:'wrap',gap:Spacing.two}}>{([30,60,120] as const).map(value=><Button key={value} title={`${duration===value?'Selected · ':''}${value} seconds`} variant="secondary" disabled={busy} onPress={()=>update({duration:value})}/>)}</View>
   </Glass>:null}
   {storageError?<ThemedText accessibilityRole="alert">This device could not save or restore your song draft. Keep a copy of your idea before closing the app.</ThemedText>:<ThemedText type="small" themeColor="textSecondary">Your idea and song options are kept on this device as you edit.</ThemedText>}
   <Button title="Make song with my fal.ai credits" disabled={busy||!provider||!prompt.trim()} onPress={()=>{setError('');void start(provider!.id,prompt,{duration,instrumental}).catch(e=>setError(e instanceof Error?e.message:'Could not start the song.'));}}/>
  </>}
  <Button title="View fal.ai model and pricing" variant="secondary" onPress={()=>void Linking.openURL('https://fal.ai/models/fal-ai/ace-step/prompt-to-audio')}/>
  {error?<ThemedText accessibilityRole="alert">{error}</ThemedText>:null}
  {savedId?<Glass style={{padding:Spacing.three,gap:Spacing.two}}><ThemedText>Song saved on this device.</ThemedText><Button title="Listen and use in a project" onPress={()=>router.push({pathname:'/library',params:{assetId:`device-${savedId}`}})}/></Glass>:null}
  {jobs.map(job=><Glass key={job.id} style={{padding:Spacing.three,gap:Spacing.two}}>
   <ThemedText type="heading">{job.prompt}</ThemedText><ThemedText type="small">{job.providerLabel}</ThemedText>
   {job.songOptions?<ThemedText type="small">{job.songOptions.duration} seconds · {job.songOptions.instrumental?'Instrumental':'Vocals'}</ThemedText>:null}
   {job.status==='running'?<ThemedText>Making or saving your song… You can leave this screen. If the app closes, return here to resume the saved request.</ThemedText>:<>
    <ThemedText accessibilityRole="alert">{job.error}</ThemedText>
    <Button title={job.review?'Check fal.ai queue':'Resume saved song'} disabled={busy} onPress={()=>job.review?void Linking.openURL('https://fal.ai/dashboard'):void resume(job.id)}/>
    {removing===job.id?<View style={{gap:Spacing.two}}><ThemedText>Stopping tracking does not cancel work or charges at fal.ai. Unsaved audio must be recovered through fal.ai.</ThemedText><Button title="Stop tracking on this device" disabled={busy} onPress={()=>{setRemoving(null);void dismiss(job.id);}}/><Button title="Keep tracking" variant="secondary" onPress={()=>setRemoving(null)}/></View>:<Button title="Stop tracking…" variant="secondary" disabled={busy} onPress={()=>setRemoving(job.id)}/>}
   </>}
  </Glass>)}
 </ScrollView></ThemedView>;
}
