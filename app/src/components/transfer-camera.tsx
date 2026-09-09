import {useEffect,useState} from 'react';
import {CameraView,useCameraPermissions} from 'expo-camera';
import {AppState,Linking,StyleSheet,View} from 'react-native';
import {Button} from './ui/button';
import {ThemedText} from './themed-text';
export function TransferCamera({onRead,onCancel}:{onRead:(value:string)=>void;onCancel:()=>void}){
 const [permission,request,checkPermission]=useCameraPermissions();
 const [cameraError,setCameraError]=useState(false),[message,setMessage]=useState(''),[requesting,setRequesting]=useState(false);
 useEffect(()=>{
  const subscription=AppState.addEventListener('change',state=>{
   if(state==='active')void checkPermission().then(result=>{if(result.granted)setMessage('');}).catch(()=>setMessage('Camera permission could not be refreshed. Cancel scanning and try again.'));
  });
  return ()=>subscription.remove();
 },[checkPermission]);
 async function allowCamera(){
  if(requesting)return;setRequesting(true);setMessage('');
  try{await request();}
  catch{setMessage('Camera permission could not be checked. Try again, or use the encrypted file/text option.');}
  finally{setRequesting(false);}
 }
 return <View style={{gap:12}}>
  <ThemedText>Point at the AI transfer QR on your other device. You will review the connections before adding them.</ThemedText>
  {permission?.granted?cameraError?<>
   <ThemedText accessibilityRole="alert">The camera could not start. Close other camera apps and try again, or cancel scanning and use the encrypted file/text option.</ThemedText>
   <Button title="Try camera again" variant="secondary" onPress={()=>setCameraError(false)}/>
  </>:<View style={{height:300,overflow:'hidden',borderRadius:16}}>
   <CameraView style={StyleSheet.absoluteFill} facing="back" barcodeScannerSettings={{barcodeTypes:['qr']}} onMountError={()=>setCameraError(true)} onBarcodeScanned={({data})=>onRead(data)}/>
  </View>:<>
   <ThemedText>Camera access is only used to read the code. Nothing is recorded.</ThemedText>
   {permission?.canAskAgain===false?<>
    <ThemedText>Camera access is off. In Settings, find VibeX Studio and turn on Camera, then return here. If Settings opens its main page, search for VibeX Studio. You can also cancel scanning and use the encrypted file/text option.</ThemedText>
    <Button title="Open device settings" variant="secondary" onPress={()=>void Linking.openSettings().catch(()=>setMessage('Open your device’s Settings manually and allow camera access for VibeX Studio.'))}/>
   </>:<Button title={requesting?'Checking camera permission…':'Allow camera to scan'} disabled={requesting} onPress={()=>void allowCamera()}/>}
  </>}
  {message?<ThemedText accessibilityRole="alert">{message}</ThemedText>:null}
  <Button title="Cancel scan" variant="secondary" onPress={onCancel}/>
 </View>;
}
