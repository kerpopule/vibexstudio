import {useMemo,useState} from 'react';
import {Pressable,View} from 'react-native';
import {Button} from '@/components/ui/button';
import {Glass} from '@/components/ui/glass';
import {TextField} from '@/components/ui/text-field';
import {ThemedText} from '@/components/themed-text';
import {LibraryPreview} from '@/components/library-preview';
import {useTheme} from '@/hooks/use-theme';
import {childLibraryFolders,inLibraryFolder} from '@/lib/library-folders';
import {matchesLibrarySearch} from '@/lib/library-entries';
import type {RemoteLibraryAsset} from '@/lib/library-core';

/** Shared editor source selection: selections survive search, folders and pages. */
export function EditingMediaPicker({assets,selected,onChange,disabled,maxSelected=8,kinds=['video','image','audio']}:{assets:RemoteLibraryAsset[];selected:string[];onChange:(ids:string[])=>void;disabled:boolean;maxSelected?:number;kinds?:ReadonlyArray<'video'|'image'|'audio'>}){
 const theme=useTheme();
 const [query,setQuery]=useState(''),[kind,setKind]=useState('all'),[folder,setFolder]=useState('');
 const [foldersOpen,setFoldersOpen]=useState(false),[count,setCount]=useState(24),[folderCount,setFolderCount]=useState(24);
 const entries=useMemo(()=>assets.map(asset=>({...asset,remote:asset,uri:'',prompt:asset.title})),[assets]);
 const terms=query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
 const matches=entries.filter(item=>(kind==='all'||item.kind===kind)&&inLibraryFolder(item,folder)&&matchesLibrarySearch(item,terms));
 const folders=childLibraryFolders(entries,folder);
 function navigate(path:string){setFolder(path);setCount(24);setFolderCount(24);}
 function toggle(id:string){onChange(selected.includes(id)?selected.filter(value=>value!==id):[...selected,id]);}
 return <View style={{gap:12}}>
  <ThemedText type="heading">Your Library · {selected.length}/{maxSelected} selected</ThemedText>
  {selected.length?<View style={{gap:6}}>
   <ThemedText type="small">Selection order · tap an item to remove it</ThemedText>
   {selected.map((id,index)=><Button key={id} title={`${index+1}. ${assets.find(asset=>asset.id===id)?.title||'Selected media'}`} variant="secondary" disabled={disabled} onPress={()=>toggle(id)}/>)}
  </View>:null}
  <TextField label="Search media" accessibilityLabel="Search editor media" value={query} onChangeText={value=>{setQuery(value);setCount(24);}}/>
  {kinds.length>1?<View style={{flexDirection:'row',flexWrap:'wrap',gap:8}}>
   {(['all',...kinds]).map(value=><Button key={value} title={value==='all'?'All media':value==='image'?'Images':value==='audio'?'Audio':'Videos'} variant={kind===value?'primary':'secondary'} onPress={()=>{setKind(value);setCount(24);}}/>)}
  </View>:null}
  <Button title={foldersOpen?'Hide folders':'Browse folders'} variant="secondary" accessibilityState={{expanded:foldersOpen}} onPress={()=>setFoldersOpen(value=>!value)}/>
  {folder?<ThemedText type="small">{folder}</ThemedText>:null}
  {foldersOpen?<View style={{gap:8}}>
   {folder?<><Button title="Back to parent folder" variant="secondary" onPress={()=>navigate(folder.split('/').slice(0,-1).join('/'))}/><Button title="All folders" variant="secondary" onPress={()=>navigate('')}/></>:null}
   {folders.slice(0,folderCount).map(child=><Button key={child.path} title={`${child.label} (${child.count})`} variant="secondary" onPress={()=>navigate(child.path)}/>)}
   {folders.length>folderCount?<Button title="Show more folders" variant="secondary" onPress={()=>setFolderCount(value=>value+24)}/>:null}
  </View>:null}
  <ThemedText type="small">Showing {Math.min(count,matches.length)} of {matches.length} matching items</ThemedText>
  <View style={{flexDirection:'row',flexWrap:'wrap',gap:12}}>{matches.slice(0,count).map(asset=>{
   const index=selected.indexOf(asset.id),active=index>=0,locked=disabled||(!active&&selected.length>=maxSelected);
   return <Pressable key={asset.id} accessibilityRole="checkbox" accessibilityLabel={`${asset.title} · ${asset.folder||'Server library'}`} accessibilityState={{checked:active,disabled:locked}} disabled={locked} onPress={()=>toggle(asset.id)} style={{flexBasis:240,flexGrow:1}}>
    <Glass style={{padding:16,gap:8,borderWidth:1,borderColor:active?theme.tint:theme.glassBorder}}>
     <LibraryPreview asset={asset.remote}/>
     <ThemedText type="smallBold" numberOfLines={3}>{active?`${index+1}. `:''}{asset.title}</ThemedText>
     <ThemedText type="small">{asset.kind} · {(asset.bytes/1024**2).toFixed(1)} MB</ThemedText>
     <ThemedText type="small" themeColor="textSecondary" numberOfLines={2}>{asset.folder||'Server library'}</ThemedText>
    </Glass>
   </Pressable>;
  })}</View>
  {!matches.length&&assets.length?<ThemedText>No matching media. Try another search or folder.</ThemedText>:null}
  {matches.length>count?<Button title="Show more media" variant="secondary" onPress={()=>setCount(value=>value+24)}/>:null}
 </View>;
}
