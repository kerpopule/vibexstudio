import {useEffect,useRef,useState} from 'react';
import {View} from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import {TextField} from '@/components/ui/text-field';
import {connectRemoteLibrary} from '@/lib/remote-library';
import {Button} from '@/components/ui/button';
import {ThemedText} from '@/components/themed-text';
import {readImportSource} from '@/lib/storage/import-source';
import {hasLibraryUploadPermission,connectEditing,uploadLibraryFile} from '@/lib/remote-editing';

export function LibraryUpload({origin,onUploaded}:{origin:string;onUploaded:()=>void}){
 const [open,setOpen]=useState(false),[busy,setBusy]=useState(false),[message,setMessage]=useState('');
 const [permission,setPermission]=useState<boolean|null>(null),[code,setCode]=useState('');
 const alive=useRef(true),locked=useRef(false);
 useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
 useEffect(()=>{
  if(!open)return;
  let active=true;setPermission(null);
  void hasLibraryUploadPermission(origin).then(value=>{if(active)setPermission(value);}).catch(()=>{if(active)setPermission(false);});
  return()=>{active=false;};
 },[open,origin]);
 async function connect(){
  if(locked.current||!code.trim())return;
  locked.current=true;setBusy(true);setMessage('');
  try{
   await connectRemoteLibrary(origin,code.trim());
   await connectEditing(origin,code.trim());
   if(alive.current){setCode('');setPermission(true);setMessage('Connected. Choose the file you want to add.');}
  }catch(error){if(alive.current)setMessage(error instanceof Error?error.message:'Could not connect. Check the code.');}
  finally{locked.current=false;if(alive.current)setBusy(false);}
 }
 async function upload(){
  if(locked.current||permission!==true)return;locked.current=true;setBusy(true);setMessage('');
  try{
   // Invoke the picker directly in the click handler, preserving browser activation.
   const result=await DocumentPicker.getDocumentAsync({type:['image/*','video/*','audio/*'],multiple:false,copyToCacheDirectory:true});
   if(result.canceled||!alive.current)return;
   const file=result.assets[0];
   if(!file.size||file.size>64*1024**2)throw new Error('Choose a file up to 64 MB.');
   const bytes=await readImportSource(file.uri);
   if(!alive.current)return;
   await uploadLibraryFile(origin,file.name,bytes);
   if(alive.current){setMessage('Added to your server Library.');onUploaded();}
  }catch(error){if(alive.current)setMessage(error instanceof Error?error.message:'Upload failed. Check your server connection.');}
  finally{locked.current=false;if(alive.current)setBusy(false);}
 }
 return <View style={{gap:10}}>
  <Button title={open?'Hide file upload':'Add a file to server Library'} variant="secondary" disabled={busy} onPress={()=>setOpen(!open)}/>
  {open?<>
   <ThemedText>Your selected file will be copied to {origin}. The original stays on this device. Images, videos and audio up to 64 MB are supported here.</ThemedText>
   {permission===null?<ThemedText>Checking server access…</ThemedText>:permission===false?<>
    <ThemedText>Enter your server’s access code once to read its Library, add files, and edit drafts from this device.</ThemedText>
    <TextField label="Server access code" accessibilityLabel="Server access code" secureTextEntry value={code} onChangeText={setCode} autoCapitalize="none" autoCorrect={false} editable={!busy}/>
    <Button title="Connect for uploads and editing" loading={busy} disabled={busy||!code.trim()} onPress={()=>void connect()}/>
   </>:<>
    <Button title="Choose file and upload" loading={busy} disabled={busy} onPress={()=>void upload()}/>
    <Button title="Change access code" variant="secondary" disabled={busy} onPress={()=>{setPermission(false);setMessage('');}}/>
   </>}
   {message?<ThemedText accessibilityRole="alert">{message}</ThemedText>:null}
  </>:null}
 </View>;
}
