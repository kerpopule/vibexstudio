import {useEffect,useRef,useState} from 'react';
import {View} from 'react-native';
import {router} from 'expo-router';
import {Button} from '@/components/ui/button';
import {ThemedText} from '@/components/themed-text';
import {listEditingDrafts,importPreservedEdit,type EditingDraft} from '@/lib/remote-editing';
export function PreservedEdits({origin}:{origin:string}){
 const [rows,setRows]=useState<EditingDraft[]|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const active=useRef(true),locked=useRef(false);
 useEffect(()=>{active.current=true;return()=>{active.current=false;};},[]);
 async function run(id?:string){
  if(locked.current)return;locked.current=true;setBusy(true);setError('');
  try{
   if(id){const imported=await importPreservedEdit(origin,id);if(active.current)router.push({pathname:'/editor-timeline',params:{id:imported}});}
   else{const list=await listEditingDrafts(origin,true);if(active.current)setRows(list);}
  }catch(e){if(active.current)setError(e instanceof Error?e.message:'Could not open preserved edits.');}
  finally{locked.current=false;if(active.current)setBusy(false);}
 }
 return <View style={{gap:10}}>
  <Button title="Find preserved edits" variant="secondary" loading={busy} onPress={()=>void run()}/>
  {rows?<ThemedText themeColor="textSecondary">Import a copy into this device’s editing list. Your preserved original stays saved.</ThemedText>:null}
  {rows?.map(row=><View key={row.id} style={{gap:6}}><ThemedText numberOfLines={2}>{row.title}</ThemedText><ThemedText type="small" themeColor="textSecondary">{row.clips} clips · {row.seconds.toFixed(1)} seconds</ThemedText><Button title="Import edit" disabled={busy} onPress={()=>void run(row.id)}/></View>)}
  {rows?.length===0?<ThemedText>No preserved edits are available on this server.</ThemedText>:null}
  {error?<><ThemedText accessibilityRole="alert">{error}</ThemedText><Button title="Connect Library" variant="secondary" onPress={()=>router.push('/connect-media-lab')}/></>:null}
 </View>;
}
