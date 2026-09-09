import {useCallback,useEffect,useRef,useState} from 'react';
import {AppState,View} from 'react-native';
import {useFocusEffect} from 'expo-router';
import {useAudioPlayer,useAudioPlayerStatus} from 'expo-audio';
import {Button} from '@/components/ui/button';
import {ThemedText} from '@/components/themed-text';

/** Load project audio only after the user requests a player; never autoplay. */
export function ChatAudioAttachment({uri}:{uri:string}){
 const [open,setOpen]=useState(false);
 return <View style={{width:280,maxWidth:'100%',gap:8}}>
  {open?<>
   <AudioAttachmentPlayer key={uri} uri={uri}/>
   <Button title="Close audio player" variant="secondary" onPress={()=>setOpen(false)}/>
  </>:<Button title="Open audio player" variant="secondary" onPress={()=>setOpen(true)}/>}
 </View>;
}
function time(seconds:number):string{
 const value=Number.isFinite(seconds)?Math.max(0,Math.floor(seconds)):0;
 return `${Math.floor(value/60)}:${String(value%60).padStart(2,'0')}`;
}
export function AudioAttachmentPlayer({uri}:{uri:string}){
 const player=useAudioPlayer(uri);
 const focused=useRef(false),operation=useRef(false);
 const status=useAudioPlayerStatus(player);
 const [error,setError]=useState(false);
 const [working,setWorking]=useState(false);
 useFocusEffect(useCallback(()=>{focused.current=true;return ()=>{focused.current=false;player.pause();};},[player]));
 useEffect(()=>{
  const subscription=AppState.addEventListener('change',state=>{if(state!=='active')player.pause();});
  return ()=>subscription.remove();
 },[player]);
 async function play(){
  if(operation.current)return;operation.current=true;
  setError(false);setWorking(true);
  try{
   if(status.playing)player.pause();
   else{
    if(status.didJustFinish||(status.duration>0&&status.currentTime>=status.duration))await player.seekTo(0);
    if(focused.current&&(!AppState.currentState||AppState.currentState==='active'))player.play();
   }
  }catch{setError(true);}finally{operation.current=false;setWorking(false);}
 }
 return <>
  <ThemedText type="small">{time(status.currentTime)} / {time(status.duration)}</ThemedText>
  <Button title={status.playing?'Pause audio':'Play audio'} variant="secondary" disabled={working||!status.isLoaded} onPress={()=>void play()}/>
  {!status.isLoaded&&!status.error?<ThemedText type="small">Loading audio…</ThemedText>:null}
  {error||status.error?<ThemedText accessibilityRole="alert" type="small">This audio could not be played. The saved file is still available. Close the player and try again.</ThemedText>:null}
 </>;
}
