import {useEffect,useMemo,useRef,useState} from 'react';
import {View} from 'react-native';
import {WebView} from 'react-native-webview';
import {ThemedText} from '@/components/themed-text';
import {Button} from '@/components/ui/button';
import type {ModelRotation} from '@/lib/model-placement';
import {modelInspectorDocument,modelInspectorMessage} from '@/lib/model-inspector-document';

/** Offline native inspection. Orientation is saved separately from model bytes. */
export function ModelInspector({base64,initialRotation,onSave}:{base64:string;initialRotation?:ModelRotation;onSave?:(rotation:ModelRotation)=>Promise<void>}){
 const web=useRef<WebView>(null),rotation=useRef<ModelRotation>([0,0,0,1]);
 const [ready,setReady]=useState(false),[failed,setFailed]=useState(false),[saving,setSaving]=useState(false),[message,setMessage]=useState('');
 const document=useMemo(()=>{try{return modelInspectorDocument(base64,initialRotation);}catch{return null;}},[base64,initialRotation]);
 useEffect(()=>{setReady(false);setFailed(false);setMessage('');},[document]);
 const action=(name:'turn'|'tip'|'reset')=>{setMessage('');setReady(false);web.current?.injectJavaScript(`window.vibexModelAction?.(${JSON.stringify(name)});true;`);};
 return <View style={{gap:12}}>
  {document&&!failed?<View pointerEvents="none" style={{height:320,overflow:'hidden',borderRadius:12}}><WebView ref={web} source={{html:document}} style={{flex:1,backgroundColor:'#10121a'}} scrollEnabled={false}
   originWhitelist={['*']} javaScriptEnabled allowFileAccess={false} allowFileAccessFromFileURLs={false} allowUniversalAccessFromFileURLs={false}
   onShouldStartLoadWithRequest={request=>request.url==='about:blank'}
   onError={()=>{setFailed(true);setReady(false);}} onContentProcessDidTerminate={()=>{setFailed(true);setReady(false);}}
   onMessage={event=>{
    const value=modelInspectorMessage(event.nativeEvent.data);if(!value)return;
    if(value.type==='error'){setFailed(true);setReady(false);return;}
    rotation.current=value.rotation;setReady(true);
   }}/></View>:null}
  <ThemedText accessibilityLiveRegion="polite">{!document||failed?'This model could not be previewed here. Your saved file is unchanged and can still be used or exported.':ready?'Preview stays on this device. Save its orientation to use it in your project.':'Loading 3D preview…'}</ThemedText>
  <View style={{flexDirection:'row',flexWrap:'wrap',gap:8}}>
   <Button title="Turn 90°" disabled={!ready} onPress={()=>action('turn')}/>
   <Button title="Tip 90°" disabled={!ready} onPress={()=>action('tip')}/>
   <Button title="Reset view" variant="secondary" disabled={!ready} onPress={()=>action('reset')}/>
  </View>
  {onSave?<Button title={saving?'Saving orientation…':'Save orientation for builder'} disabled={!ready||saving} onPress={()=>{
   setSaving(true);setMessage('');void onSave([...rotation.current]).then(()=>setMessage('Orientation saved with this project. Ask the builder to use it.')).catch(()=>setMessage('Could not save orientation. Try again.')).finally(()=>setSaving(false));
  }}/>:null}
  {message?<ThemedText accessibilityLiveRegion="polite">{message}</ThemedText>:null}
 </View>;
}
