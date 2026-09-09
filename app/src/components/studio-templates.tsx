import {useState} from 'react';
import {TextInput,View} from 'react-native';
import {ThemedText} from '@/components/themed-text';
import {Button} from '@/components/ui/button';
import {useTheme} from '@/hooks/use-theme';

export type StudioTemplate={id:string;title:string;kind:'image'|'video';prompt:string};
/** Original editable starter prompts; no reference images or model dependencies are bundled. */
const templates:StudioTemplate[]=[
 {id:'website-hero',title:'Website hero',kind:'image',prompt:'Create a wide website hero image for [project or product]. Place the main subject on the right with uncluttered space on the left for a headline. Use [brand colors], natural lighting and a clear focal point. Do not add text or logos.'},
 {id:'product-photo',title:'Product spotlight',kind:'image',prompt:'Create a polished studio image of [product] on a simple [color] backdrop. Use soft directional lighting, believable materials and a subtle grounded shadow. Keep the full product visible. No text or watermarks.'},
 {id:'character-concept',title:'Character concept',kind:'image',prompt:'Design an original [character description] for [game or story]. Show one full-body front view in a relaxed neutral pose on a plain background. Keep the silhouette readable, the clothing details consistent and the hands visible. Style: [art style]. No text.'},
 {id:'game-background',title:'Game background',kind:'image',prompt:'Create a side-view environment for a 2D game set in [location]. Keep the foreground play area clear and separate the background into readable near, middle and distant layers. Style: [art style]. No characters, interface elements or text.'},
 {id:'cinematic-shot',title:'Cinematic opening',kind:'video',prompt:'A single continuous establishing shot of [place] at [time of day]. The camera moves slowly forward toward [focal point]. Maintain consistent architecture, lighting and subject details throughout. Mood: [mood]. No cuts, titles or text.'},
 {id:'music-video-shot',title:'Music video scene',kind:'video',prompt:'One continuous music-video shot featuring [original performer description] in [setting]. The performer makes a subtle, natural movement while the camera [camera movement]. Lighting and palette: [description]. Keep identity, clothing and background consistent. This is a visual shot; no on-screen lyrics or text.'},
];
export function StudioTemplates({onChoose,disabled}:{onChoose:(template:StudioTemplate)=>void;disabled:boolean}){
 const theme=useTheme();const [query,setQuery]=useState('');
 const visible=templates.filter(template=>`${template.title} ${template.kind} ${template.prompt}`.toLowerCase().includes(query.trim().toLowerCase()));
 return <View style={{gap:12}}>
  <ThemedText type="heading">Starter templates</ThemedText>
  <ThemedText themeColor="textSecondary">Choose a starting prompt, replace the bracketed details and make it yours. Choosing a template does not start generation.</ThemedText>
  <TextInput accessibilityLabel="Search starter templates" placeholder="Search templates…" value={query} onChangeText={setQuery} style={{minHeight:48,padding:12,borderRadius:12,color:theme.text,backgroundColor:theme.backgroundElement}} placeholderTextColor={theme.textSecondary} />
  {visible.map(template=><View key={template.id} style={{padding:16,borderRadius:16,backgroundColor:theme.backgroundElement,gap:10}}>
   <ThemedText type="smallBold">{template.title} · {template.kind==='image'?'Image':'Video clip'}</ThemedText>
   <ThemedText selectable themeColor="textSecondary">{template.prompt}</ThemedText>
   <Button title={`Use ${template.title}`} variant="secondary" disabled={disabled} onPress={()=>onChoose(template)} />
  </View>)}
  {!visible.length?<ThemedText>No templates match this search.</ThemedText>:null}
 </View>;
}
