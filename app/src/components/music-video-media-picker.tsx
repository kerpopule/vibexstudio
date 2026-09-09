import {useEffect,useState} from 'react';
import {View} from 'react-native';
import {EditingMediaPicker} from './editing-media-picker';
import {Button} from './ui/button';
import {ThemedText} from './themed-text';
import type {RemoteLibraryAsset} from '@/lib/library-core';
import {musicVideoSelection} from '@/lib/music-video-plan';
export function MusicVideoMediaPicker({assets,selected,onChange,disabled,onReady}:{assets:RemoteLibraryAsset[];selected:string[];onChange:(ids:string[])=>void;disabled:boolean;onReady:(ready:boolean)=>void}){
 const [step,setStep]=useState(0);
 const audio=assets.filter(row=>row.kind==='audio'),visuals=assets.filter(row=>row.kind==='image'||row.kind==='video');
 const songIds=selected.filter(id=>audio.some(row=>row.id===id)),sceneIds=selected.filter(id=>visuals.some(row=>row.id===id));
 let plan:ReturnType<typeof musicVideoSelection>|undefined;
 try{plan=musicVideoSelection(selected,assets);}catch{/* Selection guidance is shown at each step. */}
 const ready=step===2&&!!plan;
 useEffect(()=>{onReady(ready);},[ready,onReady]);
 return <View style={{gap:16}}>
  <ThemedText type="heading">{step+1} of 3 · {['Choose your song','Choose your scenes','Review your music video'][step]}</ThemedText>
  {step===0?<>
   <ThemedText>Pick one song from Library. It will play underneath your scenes.</ThemedText>
   <EditingMediaPicker key="song" assets={audio} selected={songIds} maxSelected={1} kinds={['audio']} disabled={disabled} onChange={ids=>onChange([...ids,...sceneIds])}/>
   {!audio.length?<ThemedText>Add or generate a song in Library first, then return here.</ThemedText>:null}
   <Button title="Next · choose scenes" disabled={disabled||songIds.length!==1} onPress={()=>setStep(1)}/>
  </>:step===1?<>
   <ThemedText>Choose up to seven pictures or clips in playback order. You can adjust their timing and order in the editor.</ThemedText>
   <EditingMediaPicker key="scenes" assets={visuals} selected={sceneIds} maxSelected={7} kinds={['video','image']} disabled={disabled} onChange={ids=>onChange([...songIds,...ids])}/>
   {!visuals.length?<ThemedText>Add pictures or clips to Library first, then return here.</ThemedText>:null}
   <Button title="Next · review" disabled={disabled||!plan} onPress={()=>setStep(2)}/>
  </>:plan?<>
   <ThemedText type="smallBold">Soundtrack · {plan.song.title}</ThemedText>
   {plan.scenes.map((scene,index)=><ThemedText key={scene.id}>{index+1}. {scene.title}</ThemedText>)}
   <ThemedText>The editor will place your scenes in this order and add the song as a separate audio track. Adjust scene lengths and trim the soundtrack before previewing and exporting. Videos keep their original sound; mute that in the editor if you only want the song. This does not generate new footage or lip-sync performers.</ThemedText>
  </>:<ThemedText>Your selection changed. Go back and choose your song and scenes again.</ThemedText>}
  {step>0?<Button title="Back" variant="secondary" disabled={disabled} onPress={()=>setStep(value=>value-1)}/>:null}
 </View>;
}
