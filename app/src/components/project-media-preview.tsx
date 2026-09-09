import {Image} from 'expo-image';
import {useState} from 'react';
import {View} from 'react-native';
import {WebView} from 'react-native-webview';
import {ThemedText} from '@/components/themed-text';
import {mimeFor} from '@/lib/media-mime';

export function ProjectMediaPreview({path,base64}:{path:string;base64:string}) {
  const [error,setError]=useState(false);
  const mime=mimeFor(path);
  const kind=mime.split('/')[0];
  if (!['image','audio','video'].includes(kind)) return null;
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(base64) || base64.length % 4 !== 0) return <ThemedText accessibilityRole="alert">This file does not contain valid preview data.</ThemedText>;
  const uri=`data:${mime};base64,${base64}`;
  if (kind==='image') return <Image source={{uri}} contentFit="contain" style={{width:'100%',height:260}} accessibilityLabel={`Preview of ${path}`} />;
  // Only app-owned markup and base64 bytes enter this view. Playback is user initiated.
  const html=`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0;background:#171717;display:flex;align-items:center;min-height:100vh}audio,video{width:100%;max-height:100vh}</style><${kind} controls playsinline preload="metadata" src="${uri}"></${kind}>`;
  return <View style={{height:kind==='audio'?90:280}}>
    {error ? <ThemedText accessibilityRole="alert">This device could not preview the media. The original file is still saved in your project.</ThemedText> :
      <WebView source={{html}} javaScriptEnabled={false} domStorageEnabled={false}
        originWhitelist={['about:*','data:*']} mediaPlaybackRequiresUserAction allowsInlineMediaPlayback
        onShouldStartLoadWithRequest={request=>request.url==='about:blank'||request.url.startsWith('data:')}
        onError={()=>setError(true)} accessibilityLabel={`Playback controls for ${path}`} />}
  </View>;
}
