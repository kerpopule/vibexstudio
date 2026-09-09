import {useCallback,useRef,useState} from 'react';
import {useFocusEffect} from 'expo-router';
import {View} from 'react-native';
import {Button} from '@/components/ui/button';
import {ThemedText} from '@/components/themed-text';
import {AudioAttachmentPlayer} from '@/components/chat-audio-attachment';
import {VideoAttachmentPlayer} from '@/components/chat-video-attachment';
import {readRemoteAsset} from '@/lib/remote-library';
import {libraryPlaybackFile} from '@/lib/library-playback-file';
import {playbackFormat} from '@/lib/library-playback-format';
import type {RemoteLibraryAsset} from '@/lib/library-core';

type PlaybackFile={uri:string;dispose:()=>void};
/** Fetch only on request with Library authorization; never put credentials in a media URL. */
export function LibraryPlayback({asset}:{asset:RemoteLibraryAsset}){
 const [file,setFile]=useState<PlaybackFile|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const saved=useRef<PlaybackFile|null>(null),request=useRef<AbortController|null>(null);
 const close=useCallback(()=>{
  request.current?.abort();request.current=null;
  saved.current?.dispose();saved.current=null;setFile(null);setBusy(false);
 },[]);
 useFocusEffect(useCallback(()=>()=>close(),[close]));
 async function open(){
  if(request.current)return;
  const controller=new AbortController();request.current=controller;setBusy(true);setError('');
  try{
   playbackFormat(asset.mimeType,asset.bytes);
   const bytes=await readRemoteAsset(asset,controller.signal);
   if(controller.signal.aborted)return;
   const prepared=await libraryPlaybackFile(bytes,asset.mimeType);
   if(controller.signal.aborted){prepared.dispose();return;}
   saved.current=prepared;setFile(prepared);
  }catch(e){if(!controller.signal.aborted)setError(e instanceof Error?e.message:'This media could not be loaded. Try again.');}
  finally{if(request.current===controller){request.current=null;setBusy(false);}}
 }
 return <View style={{gap:8}}>
  {file?<>
   {asset.kind==='audio'?<AudioAttachmentPlayer key={file.uri} uri={file.uri}/>:<VideoAttachmentPlayer key={file.uri} uri={file.uri}/>}
   <Button title="Close player" variant="secondary" onPress={close}/>
  </>:<>
   <Button title={asset.kind==='audio'?'Listen to audio':'Watch video'} variant="secondary" loading={busy} onPress={()=>void open()}/>
   {busy?<Button title="Cancel loading" variant="secondary" onPress={close}/>:null}
   <ThemedText type="small" themeColor="textSecondary">{busy?'Loading a temporary playback copy…':`Loads ${Math.max(0.1,asset.bytes/1024/1024).toFixed(1)} MB from your server when opened.`}</ThemedText>
  </>}
  {error?<ThemedText accessibilityRole="alert">{error}</ThemedText>:null}
 </View>;
}
