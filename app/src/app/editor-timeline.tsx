import {EditingAddMedia} from '@/components/editing-add-media';
import {probeMediaHost,type MediaHostCapabilities} from '@/lib/media-host-probe';
import {EditingExport} from '@/components/editing-export';
import {EditingPreview} from '@/components/editing-preview';
import {useCallback,useRef,useState} from 'react';
import {router,Stack,useFocusEffect,useLocalSearchParams} from 'expo-router';
import {ScrollView,View} from 'react-native';
import {ThemedView} from '@/components/themed-view';
import {ThemedText} from '@/components/themed-text';
import {TextField} from '@/components/ui/text-field';
import {Button} from '@/components/ui/button';
import {Glass} from '@/components/ui/glass';
import {Alert} from '@/lib/app-alert';
import {useApp} from '@/lib/store';
import {useTheme} from '@/hooks/use-theme';
import {removeTimeline,TRANSITION_STYLES,transitionTimeline,audioTimeline,captionTimeline,trimTimeline,splitTimeline,moveTimeline,type EditingTimeline,type TimelineClip,type TimelineCommand} from '@/lib/editing-timeline';
import {readEditingTimeline,applyTimelineEdit,pendingTimelineEdit,forgetTimelineEdit} from '@/lib/remote-editing';

export default function EditorTimelineScreen(){
 const {id}=useLocalSearchParams<{id:string}>(),origin=useApp(state=>state.mediaLab?.url),theme=useTheme();
 const [project,setProject]=useState<EditingTimeline|null>(null),[selected,setSelected]=useState<string|null>(null),[start,setStart]=useState(''),[end,setEnd]=useState(''),[splitAt,setSplitAt]=useState('');
 const [busy,setBusy]=useState(false),[pending,setPending]=useState(false),[error,setError]=useState('');
 const [captionOpen,setCaptionOpen]=useState(false),[captionId,setCaptionId]=useState<string|undefined>(),[captionText,setCaptionText]=useState(''),[captionStart,setCaptionStart]=useState('0'),[captionEnd,setCaptionEnd]=useState('');
 const [clipPanel,setClipPanel]=useState<'timing'|'audio'|'transition'>('timing');
 const [transitionKind,setTransitionKind]=useState<keyof typeof TRANSITION_STYLES|'none'>('dissolve'),[transitionSeconds,setTransitionSeconds]=useState('0.5');
 const [audioGain,setAudioGain]=useState('0'),[audioMuted,setAudioMuted]=useState(false);
 const [capabilities,setCapabilities]=useState<MediaHostCapabilities|null>(null);
 const epoch=useRef(0),lock=useRef(false);
 useFocusEffect(useCallback(()=>{
  const current=++epoch.current;setProject(null);setCapabilities(null);setSelected(null);setCaptionOpen(false);setPending(false);setError('');setBusy(true);
  if(origin&&id)void (async()=>{
   const [saved,value,host]=await Promise.all([pendingTimelineEdit(origin,id),readEditingTimeline(origin,id),probeMediaHost(origin)]);
   if(current===epoch.current){setPending(Boolean(saved));setProject(value);setCapabilities(host);}
  })().catch(e=>{if(current===epoch.current)setError(e instanceof Error?e.message:'Could not load the draft.');}).finally(()=>{if(current===epoch.current)setBusy(false);});
  else setBusy(false);
  return ()=>{epoch.current++;};
 },[origin,id]));
 function choose(clip:TimelineClip){if(!project)return;setSelected(clip.id);setClipPanel('timing');const transition=project.transitions?.find(t=>t.from===clip.id);setTransitionKind(transition?.kind??'none');setTransitionSeconds(String(transition?transition.duration/project.fps:0.5));setAudioGain(String(clip.audio?.gain??0));setAudioMuted(clip.audio?.muted??false);setStart(String(clip.trimIn/project.fps));setEnd(String(clip.trimOut/project.fps));setSplitAt(String(clip.duration/(2*project.fps)));}
 async function execute(commands?:TimelineCommand[]){
  if(!origin||!id||!project||lock.current)return;
  lock.current=true;setBusy(true);setError('');const current=++epoch.current;
  try{const updated=await applyTimelineEdit(origin,id,commands?{revision:project.revision,commands}:undefined);
   if(current===epoch.current){setProject(updated);setPending(false);setSelected(null);setCaptionOpen(false);}
  }catch(e){if(current===epoch.current){setError(e instanceof Error?e.message:'Could not save this edit.');try{const saved=await pendingTimelineEdit(origin,id);if(current===epoch.current)setPending(Boolean(saved));}catch{if(current===epoch.current)setPending(true);}}}
  finally{lock.current=false;if(current===epoch.current)setBusy(false);}
 }
 async function discard(){
  if(!origin||!id||lock.current)return;lock.current=true;setBusy(true);const current=++epoch.current;
  try{await forgetTimelineEdit(origin,id);const updated=await readEditingTimeline(origin,id);if(current===epoch.current){setProject(updated);setPending(false);setSelected(null);setCaptionOpen(false);setError('');}}
  catch{if(current===epoch.current)setError('Could not refresh the saved draft. Return to drafts and open it again.');}
  finally{lock.current=false;if(current===epoch.current)setBusy(false);}
 }
 function move(direction:'earlier'|'later'){if(!project||!selected)return;try{void execute(moveTimeline(project,selected,direction));}catch(e){setError(e instanceof Error?e.message:'Could not change the clip order.');}}
 const selectedTrack=project?.tracks.find(track=>track.clips.some(clip=>clip.id===selected));
 const selectedClip=selectedTrack?.clips.find(clip=>clip.id===selected);
 const selectedIndex=selectedTrack?.clips.findIndex(clip=>clip.id===selected)??-1;
 function remove(){if(!project||!selected)return;try{const commands=removeTimeline(project,selected);Alert.alert('Remove this clip from the draft?', 'Later clips on this track move earlier to close its space. Transitions attached to it are removed. Captions and other tracks keep their timeline positions. Your original file stays in Library. Undo restores this edit.',[{text:'Keep clip',style:'cancel'},{text:'Remove clip',onPress:()=>void execute(commands)}]);}catch(e){setError(e instanceof Error?e.message:'Could not remove this clip.');}}
 function split(){if(!project||!selected)return;try{void execute(splitTimeline(project,selected,splitAt));}catch(e){setError(e instanceof Error?e.message:'Check the split point.');}}
 function saveTransition(){if(!project||!selected)return;try{void execute(transitionTimeline(project,selected,transitionKind,transitionSeconds));}catch(e){setError(e instanceof Error?e.message:'Check the transition.');}}
 function saveAudio(){if(!project||!selected)return;try{void execute(audioTimeline(project,selected,audioGain,audioMuted));}catch(e){setError(e instanceof Error?e.message:'Check the audio settings.');}}
 function saveCaption(){if(!project)return;try{void execute(captionTimeline(project,captionText,captionStart,captionEnd,captionId));}catch(e){setError(e instanceof Error?e.message:'Check the caption.');}}
 function trim(){if(!project||!selected)return;try{void execute(trimTimeline(project,selected,start,end));}catch(e){setError(e instanceof Error?e.message:'Check the clip timing.');}}
 return <ThemedView style={{flex:1}}><Stack.Screen options={{title:'Timeline'}}/><ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{padding:24,gap:20,maxWidth:1200,width:'100%',alignSelf:'center'}}>
  <ThemedText type="title">{project?.title??'Your timeline'}</ThemedText>
  {project?<>
   {origin&&capabilities?.editingPreview?<EditingPreview key={`${origin}:${project.id}:${project.revision}`} origin={origin} id={project.id} revision={project.revision} title={project.title} disabled={busy||pending}/>:null}
   {origin&&capabilities?.editingExport?<EditingExport librarySave={capabilities.editingLibrarySave===true} key={`export:${origin}:${project.id}:${project.revision}`} origin={origin} id={project.id} revision={project.revision} disabled={busy||pending}/>:null}
   {!capabilities?<View style={{gap:8}}><ThemedText type="small">Could not check which rendering tools this server supports. Your saved timeline is still available.</ThemedText><Button title="Check server tools" variant="secondary" disabled={busy} onPress={()=>{if(origin){const current=epoch.current;void probeMediaHost(origin).then(host=>{if(current===epoch.current)setCapabilities(host);});}}}/></View>:!capabilities.editingPreview||!capabilities.editingExport?<ThemedText type="small">Update your Media Lab server to enable {capabilities.editingPreview?'high-quality exports':'preview playback and exports'} here.</ThemedText>:null}
   <ThemedText type="small" themeColor="textSecondary">Saved revision {project.revision} · {project.fps} frames per second</ThemedText>
   {pending?<Glass style={{padding:20,gap:12}}>
    <ThemedText type="heading">An edit is waiting for confirmation</ThemedText><ThemedText>Resume checks the same edit. If the server rejected it, discard this request and review the latest saved timeline.</ThemedText>
    <Button title="Resume saved edit" loading={busy} onPress={()=>void execute()}/>
    <Button title="Discard request and refresh" variant="secondary" disabled={busy} onPress={()=>Alert.alert('Discard the saved request?', 'This stops tracking the request. It does not undo an edit the server already saved. The latest timeline will be loaded.',[{text:'Keep request',style:'cancel'},{text:'Discard request',onPress:()=>void discard()}])}/>
   </Glass>:<View style={{flexDirection:'row',flexWrap:'wrap',gap:12}}>
    <Button title="Undo" variant="secondary" disabled={busy||!project.canUndo} onPress={()=>void execute([{id:'undo',type:'undo',payload:{}}])}/>
    <Button title="Redo" variant="secondary" disabled={busy||!project.canRedo} onPress={()=>void execute([{id:'redo',type:'redo',payload:{}}])}/>
   </View>}
   {origin&&capabilities?.editingAddSources?<EditingAddMedia key={`sources:${origin}:${project.id}:${project.revision}`} origin={origin} disabled={busy||pending} onAdd={commands=>void execute(commands)}/>:capabilities?<ThemedText type="small">Update your Media Lab server to add Library items to this draft.</ThemedText>:null}
   {project.tracks.filter(track=>track.clips.length).map(track=><View key={track.id} style={{gap:12}}>
    <ThemedText type="heading">{track.name}</ThemedText>
    <View style={{flexDirection:'row',flexWrap:'wrap',gap:12}}>{track.clips.map((clip,index)=><Glass key={clip.id} style={{padding:20,gap:12,flexBasis:260,flexGrow:1,borderWidth:1,borderColor:selected===clip.id?theme.tint:theme.glassBorder}}>
     <ThemedText type="smallBold">{clip.label}</ThemedText>
     <ThemedText>{(clip.start/project.fps).toFixed(2)}s → {((clip.start+clip.duration)/project.fps).toFixed(2)}s</ThemedText>
     <ThemedText type="small" themeColor="textSecondary">Duration {(clip.duration/project.fps).toFixed(2)} seconds</ThemedText>
     <Button title={`Edit clip ${index+1}: ${clip.label}`} variant="secondary" disabled={busy||pending} onPress={()=>choose(clip)}/>
    </Glass>)}</View>
   </View>)}
   <Glass style={{padding:20,gap:12}}>
    <ThemedText type="heading">Captions</ThemedText>
    <ThemedText>Put words on screen. Times are measured from the start of the whole video. Render a new preview to see your changes.</ThemedText>
    {(project.captions??[]).map(caption=><View key={caption.id} style={{gap:8}}>
     <ThemedText>{caption.text}</ThemedText><ThemedText type="small">{(caption.start/project.fps).toFixed(2)}s → {(caption.end/project.fps).toFixed(2)}s</ThemedText>
     <Button title={`Edit caption: ${caption.text.slice(0,40)}`} variant="secondary" disabled={busy||pending} onPress={()=>{setCaptionId(caption.id);setCaptionText(caption.text);setCaptionStart(String(caption.start/project.fps));setCaptionEnd(String(caption.end/project.fps));setCaptionOpen(true);}}/>
    </View>)}
    <Button title="Add caption" variant="secondary" disabled={busy||pending} onPress={()=>{setCaptionId(undefined);setCaptionText('');setCaptionStart('0');setCaptionEnd(String(Math.min(3,Math.max(0,...project.tracks.flatMap(track=>track.clips.map(clip=>(clip.start+clip.duration)/project.fps))))));setCaptionOpen(true);}}/>
    {captionOpen&&!pending?<View style={{gap:12}}>
     <TextField label="Caption text" accessibilityLabel="Caption text" value={captionText} onChangeText={setCaptionText} multiline maxLength={2000} editable={!busy}/>
     <TextField label="Caption starts (seconds)" accessibilityLabel="Caption starts (seconds)" value={captionStart} onChangeText={setCaptionStart} keyboardType="decimal-pad" editable={!busy}/>
     <TextField label="Caption ends (seconds)" accessibilityLabel="Caption ends (seconds)" value={captionEnd} onChangeText={setCaptionEnd} keyboardType="decimal-pad" editable={!busy}/>
     <Button title="Save caption" loading={busy} onPress={saveCaption}/>
     {captionId?<Button title="Remove caption" variant="secondary" disabled={busy} onPress={()=>void execute([{id:'remove-caption',type:'caption.remove',payload:{caption_id:captionId}}])}/>:null}
     <Button title="Cancel caption changes" variant="secondary" disabled={busy} onPress={()=>setCaptionOpen(false)}/>
    </View>:null}
   </Glass>
   {selected&&!pending?<Glass style={{padding:20,gap:16}}>
    <ThemedText type="heading">{selectedClip?.label}</ThemedText>
    <View style={{flexDirection:'row',flexWrap:'wrap',gap:8}}>
     <Button title="Timing and order" variant={clipPanel==='timing'?'primary':'secondary'} disabled={busy} onPress={()=>setClipPanel('timing')}/>
     {selectedClip?.audio?.linked?<Button title="Audio" variant={clipPanel==='audio'?'primary':'secondary'} disabled={busy} onPress={()=>setClipPanel('audio')}/>:null}
     {selectedTrack?.type==='video'&&selectedIndex<selectedTrack.clips.length-1?<Button title="Transition" variant={clipPanel==='transition'?'primary':'secondary'} disabled={busy} onPress={()=>setClipPanel('transition')}/>:null}
     <Button title="Close clip controls" variant="secondary" disabled={busy} onPress={()=>setSelected(null)}/>
    </View>
    {clipPanel==='audio'&&selectedClip?.audio?.linked?<View style={{gap:12}}>
     <ThemedText type="heading">Clip audio</ThemedText>
     <ThemedText>Zero keeps the original volume. Negative numbers make it quieter; positive numbers make it louder. Very loud settings can distort.</ThemedText>
     <TextField label="Volume change (dB)" accessibilityLabel="Volume change (dB)" value={audioGain} onChangeText={setAudioGain} keyboardType="numbers-and-punctuation" editable={!busy}/>
     <Button title={audioMuted?'Sound off — tap to unmute':'Sound on — tap to mute'} variant="secondary" disabled={busy} onPress={()=>setAudioMuted(!audioMuted)}/>
     <Button title="Save clip audio" disabled={busy} onPress={saveAudio}/>
    </View>:null}
    {clipPanel==='transition'&&selectedTrack?.type==='video'&&selectedIndex<selectedTrack.clips.length-1?<View style={{gap:12}}>
     <ThemedText type="heading">Transition to the next clip</ThemedText>
     <ThemedText>A straight cut switches instantly. Other transitions overlap the clips, shortening the finished video by the transition length. Captions and music follow the adjusted timing.</ThemedText>
     <View style={{flexDirection:'row',flexWrap:'wrap',gap:8}}>
      {(['none',...Object.keys(TRANSITION_STYLES)] as (keyof typeof TRANSITION_STYLES|'none')[]).map(kind=><Button key={kind} title={kind==='none'?'Straight cut':TRANSITION_STYLES[kind]} variant={transitionKind===kind?'primary':'secondary'} disabled={busy} onPress={()=>setTransitionKind(kind)}/>)}
     </View>
     {transitionKind!=='none'?<TextField label="Transition length (seconds)" accessibilityLabel="Transition length (seconds)" value={transitionSeconds} onChangeText={setTransitionSeconds} keyboardType="decimal-pad" editable={!busy}/>:null}
     <Button title="Save transition" disabled={busy} onPress={saveTransition}/>
    </View>:null}
    {clipPanel==='timing'?<View style={{gap:12}}>
    <ThemedText type="heading">Clip order</ThemedText>
    <ThemedText>Swap this clip with its neighbor. Clip lengths and the gap between them stay the same.</ThemedText>
    <View style={{flexDirection:'row',flexWrap:'wrap',gap:12}}>
     <Button title="Move earlier" variant="secondary" disabled={busy||selectedIndex<=0} onPress={()=>move('earlier')}/>
     <Button title="Move later" variant="secondary" disabled={busy||!selectedTrack||selectedIndex>=selectedTrack.clips.length-1} onPress={()=>move('later')}/>
    </View>
    <ThemedText type="heading">Clip timing</ThemedText><ThemedText>Choose the part of this source to keep. Later clips on this track move with the new length. Other tracks stay in place.</ThemedText>
    <TextField label="Keep from (seconds)" accessibilityLabel="Keep from (seconds)" keyboardType="decimal-pad" value={start} onChangeText={setStart} editable={!busy}/>
    <TextField label="Keep until (seconds)" accessibilityLabel="Keep until (seconds)" keyboardType="decimal-pad" value={end} onChangeText={setEnd} editable={!busy}/>
    <Button title="Save trim" loading={busy} onPress={trim}/>
    <ThemedText type="heading">Split into two clips</ThemedText>
    <ThemedText>Choose how many seconds into this clip to cut. Both parts stay in place, and the total length stays the same.</ThemedText>
    <TextField label="Split after (seconds)" accessibilityLabel="Split after (seconds)" keyboardType="decimal-pad" value={splitAt} onChangeText={setSplitAt} editable={!busy}/>
    <Button title="Split clip" variant="secondary" disabled={busy} onPress={split}/>
    <Button title="Remove clip from draft" variant="secondary" disabled={busy} onPress={remove}/>
    </View>:null}
   </Glass>:null}
  </>:null}
  {error?<ThemedText accessibilityRole="alert">{error}</ThemedText>:null}
  <ThemedText type="small" themeColor="textSecondary">Edits and captions are saved on your server. Render a new preview after changing your timeline.</ThemedText>
  <Button title="Back to drafts" variant="secondary" disabled={busy} onPress={()=>router.replace('/editor')}/>
 </ScrollView></ThemedView>;
}
