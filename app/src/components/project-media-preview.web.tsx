import {useState} from 'react';
import {Image} from 'expo-image';
import {ThemedText} from '@/components/themed-text';
import {mimeFor} from '@/lib/media-mime';

export function ProjectMediaPreview({path,base64}:{path:string;base64:string}) {
  const [error,setError]=useState(false);
  const mime=mimeFor(path);
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(base64) || base64.length % 4 !== 0) return <ThemedText accessibilityRole="alert">This file does not contain valid preview data.</ThemedText>;
  const uri=`data:${mime};base64,${base64}`;
  if (error) return <ThemedText accessibilityRole="alert">This browser could not preview the media. The original file is still saved in your project.</ThemedText>;
  if (mime.startsWith('image/')) return <Image source={{uri}} contentFit="contain" style={{width:'100%',height:260}} accessibilityLabel={`Preview of ${path}`} onError={()=>setError(true)} />;
  if (mime.startsWith('audio/')) return <audio controls preload="metadata" src={uri} aria-label={`Play ${path}`} style={{width:'100%'}} onError={()=>setError(true)} />;
  if (mime.startsWith('video/')) return <video controls playsInline preload="metadata" src={uri} aria-label={`Play ${path}`} style={{width:'100%',maxHeight:360}} onError={()=>setError(true)} />;
  return null;
}
