import {useCallback,useEffect,useState} from 'react';
import {AppState,StyleSheet,View} from 'react-native';
import {useEvent} from 'expo';
import {useFocusEffect} from 'expo-router';
import {useVideoPlayer,VideoView} from 'expo-video';
import {Button} from '@/components/ui/button';
import {ThemedText} from '@/components/themed-text';
import {Radii} from '@/constants/theme';

/** Only allocate a video player when the user opens this attachment. */
export function ChatVideoAttachment({uri}:{uri:string}){
 const [open,setOpen]=useState(false);
 return <View style={styles.shell}>
  {open?<>
   <VideoAttachmentPlayer key={uri} uri={uri}/>
   <Button title="Close video" variant="secondary" onPress={()=>setOpen(false)}/>
  </>:<Button title="Open video player" variant="secondary" onPress={()=>setOpen(true)}/>}
 </View>;
}
export function VideoAttachmentPlayer({uri}:{uri:string}){
 const player=useVideoPlayer(uri);
 const {status}=useEvent(player,'statusChange',{status:player.status});
 const {isPlaying}=useEvent(player,'playingChange',{isPlaying:player.playing});
 const [playError,setPlayError]=useState(false);
 useFocusEffect(useCallback(()=>()=>player.pause(),[player]));
 useEffect(()=>{
  const subscription=AppState.addEventListener('change',state=>{if(state!=='active')player.pause();});
  return ()=>subscription.remove();
 },[player]);
 return <>
  <VideoView player={player} nativeControls contentFit="contain" fullscreenOptions={{enable:true}} style={styles.video} accessibilityLabel="Video player"/>
  <Button title={isPlaying?'Pause video':'Play video'} variant="secondary" disabled={status!=='readyToPlay'} onPress={()=>{
   setPlayError(false);
   try{if(player.playing)player.pause();else if(player.duration>0&&player.currentTime>=player.duration)player.replay();else player.play();}
   catch{setPlayError(true);}
  }}/>
  {status==='loading'?<ThemedText type="small">Loading video…</ThemedText>:null}
  {status==='error'||playError?<ThemedText accessibilityRole="alert" type="small">This video could not be played. The saved file is still available; close the player and try again.</ThemedText>:null}
 </>;
}
const styles=StyleSheet.create({shell:{width:280,maxWidth:'100%',gap:8},video:{width:'100%',aspectRatio:16/9,borderRadius:Radii.md,backgroundColor:'#000'}});
