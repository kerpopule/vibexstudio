import {useCallback,useRef,useState} from 'react';
import {useFocusEffect} from 'expo-router';
import {EditingMediaPicker} from '@/components/editing-media-picker';
import {Button} from '@/components/ui/button';
import {Glass} from '@/components/ui/glass';
import {ThemedText} from '@/components/themed-text';
import {listRemoteLibrary} from '@/lib/remote-library';
import type {RemoteLibraryAsset} from '@/lib/library-core';
import {addTimelineSources,type TimelineCommand} from '@/lib/editing-timeline';
export function EditingAddMedia({origin,disabled,onAdd}:{origin:string;disabled:boolean;onAdd:(commands:TimelineCommand[])=>void}){
 const [open,setOpen]=useState(false),[loading,setLoading]=useState(false),[items,setItems]=useState<RemoteLibraryAsset[]>([]),[selected,setSelected]=useState<string[]>([]),[error,setError]=useState('');
 const epoch=useRef(0);
 useFocusEffect(useCallback(()=>()=>{epoch.current++;},[]));
 async function show(){
  const current=++epoch.current;setOpen(true);setLoading(true);setError('');setSelected([]);
  try{const rows=await listRemoteLibrary(origin);if(current===epoch.current)setItems(rows.filter(row=>['image','video','audio'].includes(row.kind)&&row.bytes<=256*1024**2));}
  catch(e){if(current===epoch.current)setError(e instanceof Error?e.message:'Could not load Library.');}
  finally{if(current===epoch.current)setLoading(false);}
 }
 function add(){try{onAdd(addTimelineSources(selected));}catch(e){setError(e instanceof Error?e.message:'Check your selection.');}}
 if(!open)return <Button title="Add media from Library" variant="secondary" disabled={disabled} onPress={()=>void show()}/>;
 return <Glass style={{padding:20,gap:12}}>
  <ThemedText type="heading">Add to this draft</ThemedText>
  <ThemedText>Choose up to eight items. Pictures and videos go at the end of the video track; songs go at the end of the music track. Originals stay in Library.</ThemedText>
  <EditingMediaPicker assets={items} selected={selected} onChange={setSelected} disabled={disabled||loading}/>
  {!items.length&&!loading&&!error?<ThemedText>No supported media found in this server’s Library.</ThemedText>:null}
  <Button title="Add selected media" loading={loading} disabled={disabled||loading||!selected.length} onPress={add}/>
  {error?<><ThemedText accessibilityRole="alert">{error}</ThemedText><Button title="Reload Library choices" variant="secondary" disabled={disabled||loading} onPress={()=>void show()}/></>:null}
  <Button title="Close media choices" variant="secondary" disabled={disabled} onPress={()=>{epoch.current++;setLoading(false);setOpen(false);}}/>
 </Glass>;
}
