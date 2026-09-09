import { useEffect, useState } from 'react';
import { FullWindowOverlay } from 'react-native-screens';
import { Modal, Platform, ScrollView, Switch, View } from 'react-native';
import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { useTheme } from '@/hooks/use-theme';
import { approveCurrentRequest } from '@/lib/agent-connect/approval';
import type {PendingApproval} from '@/lib/agent-connect/core';
import { agentConnectRuntime } from '@/lib/agent-connect/runtime';

/** Live approval state is shared across screens and disappears on timeout. */
export function AgentApprovalHost() {
  const core=agentConnectRuntime.core;
  const theme=useTheme();
  const [pending,setPending]=useState(core.pendingApproval);
  const [selection,setSelection]=useState<{request:PendingApproval|null;library:boolean;copy:boolean;background:boolean;generate:boolean;edit:boolean;render:boolean}>({request:null,library:false,copy:false,background:false,generate:false,edit:false,render:false});
  useEffect(()=>core.subscribe(()=>setPending(core.pendingApproval)),[core]);
  if(!pending)return null;
  const selected=selection.request===pending ? selection : {library:false,copy:false,background:false,generate:false,edit:false,render:false};
  const toggle=(kind:'library'|'copy'|'background'|'generate'|'edit'|'render',value:boolean)=>{
    const next={...selected,[kind]:value};
    if(kind==='library'&&!value){next.copy=false;next.background=false;next.generate=false;next.edit=false;next.render=false;}
    if((kind==='copy'||kind==='background'||kind==='generate'||kind==='edit'||kind==='render')&&value)next.library=true;
    setSelection({request:pending,...next});
  };
  const decide=(approved:boolean,mediaRead=false,mediaImport=false,mediaBackground=false,mediaEdit=false,mediaRender=false,mediaGenerate=false)=>approveCurrentRequest(core,pending,approved,mediaRead,mediaImport,mediaBackground,mediaEdit,mediaRender,mediaGenerate);
  const content = <>
    <View style={{flex:1,backgroundColor:'rgba(0,0,0,0.6)',justifyContent:'center',alignItems:'center',padding:20}}>
      <View accessibilityViewIsModal accessibilityRole="alert" style={{width:'100%',maxWidth:480,maxHeight:'90%',backgroundColor:theme.background,padding:24,borderRadius:20,gap:16}}>
        <ScrollView>
          <ThemedText type="smallBold" style={{fontSize:20,marginBottom:12}}>Allow this agent?</ThemedText>
          <ThemedText>{pending.agentName} at {pending.remoteAddress} wants to create and list projects, read and write project files, and append visible project messages.</ThemedText>
          <ThemedText style={{marginTop:12}}>Optional Media Lab access</ThemedText>
          {([
            ['library','See my library','Share creation details, saved collections, editing draft timelines and available tools. No media files are read and no edits are made.'],
            ['copy','Copy assets into projects','Also lets this agent copy library files and its own finished background-removal images into your projects.'],
            ['edit','Edit my video drafts','Lets this agent create drafts from Library media and change timelines, captions and clip audio on this editing device. Originals stay in Library. Does not render or publish.'],
            ['render','Render and save my video drafts','Lets this agent render saved revisions using your server’s CPU and disk and save finished exports in your server Library. Does not publish or copy media into projects.'],
            ['generate','Create new media on my server','Lets this agent create images, video clips, songs and spoken lines with the engines your server already advertises, and save its own results in your Library. Uses your server’s GPU or CPU. No model installation and no paid provider.'],
            ['background','Remove image backgrounds','Also lets this agent run your configured engine on library images and check or cancel its own requests, and save its finished images in your Library. Uses your server’s resources.'],
          ] as const).map(([kind,title,detail])=><View key={kind} style={{marginTop:16,gap:4}}>
            <View style={{flexDirection:'row',alignItems:'center',justifyContent:'space-between',gap:12}}>
              <ThemedText type="smallBold" style={{flex:1}}>{title}</ThemedText>
              <Switch accessibilityLabel={title} value={selected[kind]} onValueChange={value=>toggle(kind,value)} />
            </View>
            <ThemedText type="small">{detail}</ThemedText>
          </View>)}
          <ThemedText type="small" style={{marginTop:16}}>No model installation, paid-provider setup, other generation, or library deletion. Disconnecting blocks future calls; accepted jobs can finish.</ThemedText>
        </ScrollView>
        <Button title="Deny" variant="secondary" onPress={()=>decide(false)} />
        <Button title="Allow selected access" onPress={()=>decide(true,selected.library,selected.copy,selected.background,selected.edit,selected.render,selected.generate)} />
      </View>
    </View>
  </>;
  return Platform.OS==='ios' ? <FullWindowOverlay unstable_accessibilityContainerViewIsModal>{content}</FullWindowOverlay> : <Modal transparent visible animationType="fade" onRequestClose={()=>decide(false)}>{content}</Modal>;
}
