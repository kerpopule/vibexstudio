import {router} from 'expo-router';
import {useEffect,useState} from 'react';
import {View,TextInput} from 'react-native';
import {Button} from '@/components/ui/button';
import {Glass} from '@/components/ui/glass';
import {ThemedText} from '@/components/themed-text';
import {useTheme} from '@/hooks/use-theme';
import {listSavedCollection} from '@/lib/remote-library';
import {collectionIssueMessage} from '@/lib/saved-collections';
import type {CollectionName,SavedRecord} from '@/lib/saved-collections';

export function SavedCollections({origin}:{origin:string}) {
  const theme=useTheme();
  const [open,setOpen]=useState(false),[name,setName]=useState<CollectionName>('characters');
  const [records,setRecords]=useState<SavedRecord[]>([]),[error,setError]=useState('');
  const [assetCount,setAssetCount]=useState(3),[showArchived,setShowArchived]=useState(false);
  const [loading,setLoading]=useState(false),[refresh,setRefresh]=useState(0);
  const [selected,setSelected]=useState<string|null>(null),[query,setQuery]=useState(''),[count,setCount]=useState(24);
  useEffect(()=>{
    if(!open)return;
    const controller=new AbortController();let active=true;
    setRecords([]);setError('');setLoading(true);setSelected(null);setQuery('');setCount(24);setShowArchived(false);
    listSavedCollection(origin,name,controller.signal).then(value=>{if(active)setRecords(value);})
      .catch(reason=>{if(active)setError(reason instanceof Error?reason.message:'Saved collections could not be loaded.');})
      .finally(()=>{if(active)setLoading(false);});
    return ()=>{active=false;controller.abort();};
  },[origin,name,open,refresh]);
  const visible=records.filter(record=>(showArchived||!record.archived)&&(record.title+' '+record.description).toLocaleLowerCase().includes(query.toLocaleLowerCase()));
  return <View style={{gap:10}}>
    <Button title={open?'Hide saved collections':'Characters, voices and storyboards'} variant="secondary" accessibilityState={{expanded:open}} onPress={()=>setOpen(value=>!value)}/>
    {open?<>
      <View style={{flexDirection:'row',flexWrap:'wrap',gap:8}}>
        {(['characters','voices','storyboards'] as const).map(value=><Button key={value} title={value[0].toUpperCase()+value.slice(1)} variant={name===value?'primary':'secondary'} onPress={()=>setName(value)}/>)}
      </View>
      <ThemedText themeColor="textSecondary">Saved on your server. Open a card to read its details.</ThemedText>
      {error?<><ThemedText accessibilityRole="alert">{error}</ThemedText><Button title="Try again" variant="secondary" onPress={()=>setRefresh(value=>value+1)}/></>:null}
      {loading?<ThemedText accessibilityLiveRegion="polite">Loading saved {name}…</ThemedText>:null}
      {!loading&&!error?<>
        <TextInput value={query} onChangeText={value=>{setQuery(value);setCount(24);}} accessibilityLabel={`Search saved ${name}`} placeholder={`Search ${name}`} placeholderTextColor={theme.textSecondary} style={{color:theme.text,padding:12,borderRadius:12,backgroundColor:theme.backgroundElement}}/>
        {records.some(record=>record.archived)?<Button title={showArchived?'Hide archived characters':`Show archived characters · ${records.filter(record=>record.archived).length}`} variant="secondary" onPress={()=>{setShowArchived(!showArchived);setCount(24);}}/>:null}
        {!visible.length?<ThemedText>{query?'No matching records.':`No saved ${name} yet.`}</ThemedText>:null}
        {visible.slice(0,count).map(record=><Glass key={record.id} style={{padding:14,gap:10}}>
          <Button title={record.archived?`Archived · ${record.title}`:record.title} variant="secondary" accessibilityState={{expanded:selected===record.id}} onPress={()=>{setSelected(selected===record.id?null:record.id);setAssetCount(3);}}/>
          {selected===record.id?<>
            {name==='storyboards'&&record.beats.length?<Button title="Make an editing copy" onPress={()=>router.push({pathname:'/storyboard-edit' as never,params:{id:record.id,sourceOrigin:origin}})}/>:null}
            {record.archived?<ThemedText themeColor="textSecondary">Archived in your original library. Kept here so older projects can still find this character.</ThemedText>:null}
            {record.relationshipIssues?.length?<View style={{gap:6}}><ThemedText type="smallBold">Some linked media needs attention</ThemedText>{Array.from(new Set(record.relationshipIssues.map(collectionIssueMessage))).map(message=><ThemedText key={message}>{message}</ThemedText>)}</View>:null}
            {record.libraryAssets?.slice(0,assetCount).map(asset=><View key={asset.id} style={{gap:4}}><ThemedText numberOfLines={1}>{asset.title}</ThemedText><Button title={`Open ${asset.kind} in Library`} variant="secondary" onPress={()=>router.push({pathname:'/library',params:{assetId:`server-${asset.id}`}})}/></View>)}
            {(record.libraryAssets?.length||0)>assetCount?<Button title="Show more linked media" variant="secondary" onPress={()=>setAssetCount(value=>value+6)}/>:null}
            {record.description?<ThemedText>{record.description}</ThemedText>:null}
            {record.details.filter(value=>value!==record.description).map((value,i)=><ThemedText key={i}>{value}</ThemedText>)}
            {record.beats.map((beat,i)=><View key={i} style={{gap:4}}><ThemedText type="smallBold">{beat.title}</ThemedText><ThemedText>{beat.description}</ThemedText>{beat.duration?<ThemedText themeColor="textSecondary">Saved scene length: {beat.duration} seconds</ThemedText>:null}
              {beat.mediaLinks?.map(asset=><Button key={asset.field+asset.id} title={`Open ${asset.field==='assembly_source_url'?'assembly source':asset.field==='clip_url'?'scene clip':asset.field==='still_url'?'scene image':'scene preview'} in Library`} variant="secondary" onPress={()=>router.push({pathname:'/library',params:{assetId:`server-${asset.id}`}})}/>)}</View>)}
            {!record.description&&!record.details.length&&!record.beats.length?<ThemedText themeColor="textSecondary">No description saved.</ThemedText>:null}
          </>:null}
        </Glass>)}
        {visible.length>count?<Button title="Show more" variant="secondary" onPress={()=>setCount(value=>value+24)}/>:null}
      </>:null}
    </>:null}
  </View>;
}
