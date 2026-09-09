import {Glass} from '@/components/ui/glass';
import {useState} from 'react';
import {Button} from '@/components/ui/button';
import {Pressable,View} from 'react-native';
import {ThemedText} from '@/components/themed-text';
import {useTheme} from '@/hooks/use-theme';

export const STUDIO_TOOLS = [
  {id:'image',title:'Images',detail:'Prompts and reference images'},
  {id:'video',title:'Video clips',detail:'Generate a new shot'},
  {id:'editor',title:'Video editor',detail:'Arrange and edit in Cut'},
  {id:'music-video',title:'Music videos',detail:'Songs, scenes and performers'},
  {id:'song',title:'Songs & audio',detail:'Music, lyrics and sound'},
  {id:'screenshot-song',title:'Screenshot to music',detail:'Turn reviewed text into lyrics'},
  {id:'talking-head',title:'Talking heads',detail:'Portrait, voice and script'},
  {id:'characters',title:'Characters',detail:'Choose or create your cast'},
  {id:'templates',title:'Templates',detail:'Browse starting ideas'},
  {id:'game',title:'Game assets',detail:'Sprites, backgrounds and 3D'},
] as const;
export type StudioTool = typeof STUDIO_TOOLS[number]['id'];
export function StudioTools({selected,onSelect,wide}:{selected:StudioTool;onSelect:(tool:StudioTool)=>void;wide:boolean}){
 const theme=useTheme();
 const [expanded,setExpanded]=useState(false);
 return <View style={{width:wide?300:'100%',gap:12}}>
  <ThemedText type="heading">Studio tools</ThemedText>
  <ThemedText type="small" themeColor="textSecondary">Choose a task. Your drafts stay saved as you explore.</ThemedText>
  {!wide?<Button title={expanded?'Hide tool list':`All studio tools · ${STUDIO_TOOLS.find(tool=>tool.id===selected)?.title}`} variant="secondary" onPress={()=>setExpanded(value=>!value)} />:null}
  {wide||expanded?<View style={{flexDirection:'row',flexWrap:'wrap',gap:8}}>
   {STUDIO_TOOLS.map(tool=><Pressable key={tool.id} accessibilityRole="button" accessibilityLabel={tool.title}
    accessibilityState={{selected:selected===tool.id}} onPress={()=>{onSelect(tool.id);setExpanded(false);}}
    style={{width:'48%',minHeight:92,borderRadius:16,borderWidth:1,borderColor:selected===tool.id?theme.tint:'transparent'}}>
    <Glass radius={15} bordered={selected!==tool.id} style={{flex:1,padding:14,gap:8,backgroundColor:selected===tool.id?theme.tintSoft:theme.glass}}>
    <ThemedText type="smallBold">{tool.title}</ThemedText>
    <ThemedText type="small" themeColor="textSecondary">{tool.detail}</ThemedText>
    </Glass>
   </Pressable>)}
  </View>:null}
 </View>;
}
