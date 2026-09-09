import { Image } from 'expo-image';
import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { ThemedText } from '@/components/themed-text';
import type { RemoteLibraryAsset } from '@/lib/library-core';
import { readRemotePreview } from '@/lib/remote-library';

/** A bounded server-produced poster, never the full video or a token URL. */
export function LibraryPreview({asset}:{asset:RemoteLibraryAsset}) {
  const [uri,setUri]=useState<string|null>(null);
  useEffect(()=>{
    if (!asset.hasPreview) return;
    const controller=new AbortController();
    readRemotePreview(asset,controller.signal).then((bytes)=>{
      let binary='';
      for(let i=0;i<bytes.length;i+=8192) binary+=String.fromCharCode(...bytes.subarray(i,i+8192));
      if(!controller.signal.aborted) setUri(`data:image/png;base64,${globalThis.btoa(binary)}`);
    }).catch(()=>{});
    return ()=>controller.abort();
  },[asset]);
  return uri ? <Image source={{uri}} contentFit="contain" style={styles.preview} accessibilityLabel={asset.title} /> :
    <View style={styles.placeholder}><ThemedText type="heading">{asset.kind==='model'?'3D asset':asset.kind==='audio'?'Audio':asset.kind==='video'?'Video':'Image'}</ThemedText></View>;
}
const styles=StyleSheet.create({preview:{width:'100%',height:200},placeholder:{height:100,alignItems:'center',justifyContent:'center'}});
