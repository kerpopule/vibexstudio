import {DirectorAssetAction} from '@/components/director-asset-action';
import {directorAssetProposal} from '@/lib/director-actions';
import {readDirectorProjectHistory} from '@/lib/director-project-history';
import type {Conversation} from '@/lib/director-session';
import {askProviderDirector} from '@/lib/provider-director';
import {restoreProjectComposers,useProjectComposer} from '@/lib/project-composer';
import {useChat} from '@/lib/chat-engine';
import {restoreDirectorConversations,useDirectorSession,directorSessionKey,emptyDirectorConversation} from '@/lib/director-session';
import {useEffect,useRef,useState} from 'react';
import {KeyboardAvoidingView,Modal,Platform,Pressable,ScrollView,StyleSheet,Switch,TextInput,View} from 'react-native';
import {router} from 'expo-router';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {ThemedText} from '@/components/themed-text';
import {Button} from '@/components/ui/button';
import {useTheme} from '@/hooks/use-theme';
import {useApp} from '@/lib/store';
import {askDirector,type DirectorMessage} from '@/lib/remote-director';
import {directorAssets,directorProjectContext,refreshDirectorSelection} from '@/lib/director-project-context';
import {listProjectFilePaths} from '@/lib/storage/projects';
import type {ProjectMeta} from '@/lib/types';

export function SparkyDirector({project,visible=true,inLibrary=false,docked=false,onReviewInBuilder}: {project?:ProjectMeta;visible?:boolean;inLibrary?:boolean;docked?:boolean;onReviewInBuilder?:()=>void}) {
  const origin=useApp(state=>state.mediaLab?.url);
  return <DirectorPanel key={(project?.id??'studio')+':'+(origin??'')} project={project} origin={origin} visible={visible} inLibrary={inLibrary} docked={docked} onReviewInBuilder={onReviewInBuilder} />;
}

function DirectorPanel({project,origin,visible,inLibrary,docked,onReviewInBuilder}: {project?:ProjectMeta;origin?:string;visible:boolean;inLibrary:boolean;docked:boolean;onReviewInBuilder?:()=>void}) {
  const theme=useTheme(),insets=useSafeAreaInsets();
  const [open,setOpen]=useState(false),[detailsOpen,setDetailsOpen]=useState(false);
  const providers=useApp(state=>state.providers);
  const [providerId,setProviderId]=useState<string|null>(null),[choosingAI,setChoosingAI]=useState(false);
  const provider=providers.find(item=>item.id===providerId&&item.capabilities.chat);
  const hasAI=providerId!==null?!!provider:!!origin;
  const [savedPlans,setSavedPlans]=useState<Conversation[]>([]),[choosingPlan,setChoosingPlan]=useState(false);
  const [historyContext,setHistoryContext]=useState<string|null>(null);
  const sessionKey=historyContext??directorSessionKey(providerId?`provider:${providerId}:${origin??''}`:origin,project?.id);
  const {draft,messages}=useDirectorSession(state=>state.conversations[sessionKey]??emptyDirectorConversation);
  const busy=useDirectorSession(state=>state.pending[sessionKey]!==undefined);
  const storageError=useDirectorSession(state=>state.storageError);
  const [historyReady,setHistoryReady]=useState(false);
  useEffect(()=>{let active=true;void restoreDirectorConversations().then(()=>{if(active)setHistoryReady(true);});return()=>{active=false;};},[]);
  const setDraft=(value:string)=>useDirectorSession.getState().setDraft(sessionKey,value);
  const [error,setError]=useState<string|null>(null);
  const [importedPaths,setImportedPaths]=useState<Record<string,string>>({});
  const [assets,setAssets]=useState<string[]>([]),[selected,setSelected]=useState<string[]|null>(null);
  const manuallySelected=useRef(false);
  const [includeLibrary,setIncludeLibrary]=useState(false);
  const [includeCollections,setIncludeCollections]=useState(false);
  const [choosing,setChoosing]=useState(false),[loadingAssets,setLoadingAssets]=useState(false);
  const openPanel=async()=>{
    setOpen(true);setLoadingAssets(true);setError(null);
    if(!project){setSelected([]);setLoadingAssets(false);return;}
    try{setSavedPlans(await readDirectorProjectHistory(project.id));}catch(e){setSavedPlans([]);setError(e instanceof Error?e.message:'Could not read saved Sparky plans.');}
    try {
      const paths=[...directorAssets((await listProjectFilePaths(project.id)).map(path=>({path}))).keys()];
      setAssets(paths);
      setSelected(previous=>refreshDirectorSelection(paths,previous,manuallySelected.current));
      if(paths.length>32 && selected===null)setChoosing(true);
    }catch{setSelected(null);setError('Could not load project assets. Close Sparky and try again.');}
    finally{setLoadingAssets(false);}
  };
  const conversation=useRef<ScrollView|null>(null);
  const pending=useRef<AbortController|null>(null);
  const ownedRequest=useRef<number|null>(null);
  useEffect(()=>()=>{
    pending.current?.abort();
    if(ownedRequest.current!==null)useDirectorSession.getState().end(sessionKey,ownedRequest.current);
  },[sessionKey]);
  const send=async()=>{
    if(!historyReady || !hasAI || !draft.trim() || pending.current || loadingAssets || selected===null)return;
    const ticket=useDirectorSession.getState().begin(sessionKey);
    if(ticket===null)return;
    ownedRequest.current=ticket;
    const controller=new AbortController();pending.current=controller;setError(null);
    const text=draft.trim();
    try {
      const context=project?directorProjectContext(project,(await listProjectFilePaths(project.id)).map(path=>({path})),selected):undefined;
      const turns:DirectorMessage[]=[...messages.slice(-18),{role:'user',content:text}];
      let answer:string;
      if(provider){
        if(provider.subscription)await useApp.getState().refreshSubscriptionIfNeeded(provider.id);
        const currentProvider=useApp.getState().providers.find(item=>item.id===provider.id);
        if(!currentProvider)throw new Error('This AI connection was removed. Choose another connection.');
        answer=await askProviderDirector(currentProvider,turns,context,controller.signal,includeLibrary,origin,includeCollections);
      }else if(origin&&providerId===null){answer=await askDirector(origin,turns,context,controller.signal,includeLibrary,includeCollections);}
      else throw new Error('Choose an AI connection for Sparky.');
      if(!controller.signal.aborted){useDirectorSession.getState().complete(sessionKey,draft,[...turns,{role:'assistant',content:answer}]);}
    }catch(e){if(!controller.signal.aborted)setError(e instanceof Error?e.message:'Sparky could not reply.');}
    finally{useDirectorSession.getState().end(sessionKey,ticket);if(pending.current===controller){pending.current=null;ownedRequest.current=null;}}
  };
  const reviewInBuilder=async(index:number)=>{
    if(!project)return;
    await restoreProjectComposers();
    if(useChat.getState().sessions[project.id]?.busy){setError('The builder is working. Wait for it to finish before preparing another request.');return;}
    const answer=messages[index];
    if(answer?.role!=='assistant')return;
    const request=messages.slice(0,index).reverse().find(message=>message.role==='user')?.content;
    const text=`${request?`My request: ${request}\n\n`:''}Use this plan from my discussion with Sparky as guidance. Check it against the actual project files and available assets before implementing.\n\n${directorAssetProposal(answer.content).text}${importedPaths[answer.content]?`\n\nConfirmed asset copied into this project: ${importedPaths[answer.content]}`:''}`;
    if(!useProjectComposer.getState().propose(project.id,text)){
      setError('Your builder already has a draft. Finish or clear it in Chat, then try again.');return;
    }
    setOpen(false);
    if(onReviewInBuilder)onReviewInBuilder();
    else router.push({pathname:'/project/[id]',params:{id:project.id}});
  };
  return <>
    {visible ? <Pressable accessibilityRole="button" accessibilityLabel="Talk with Sparky" onPress={()=>void openPanel()}
      style={[styles.fab,{bottom:insets.bottom+88,backgroundColor:theme.tint},docked?{position:'relative',alignSelf:'flex-end',right:0,bottom:0,marginRight:16,marginTop:8,marginBottom:Math.max(insets.bottom,12)}:null]}>
      <ThemedText type="smallBold" style={{color:theme.onTint}}>✦ Sparky</ThemedText>
    </Pressable> : null}
    <Modal visible={open} transparent animationType="fade" onRequestClose={()=>setOpen(false)}>
      <KeyboardAvoidingView behavior={Platform.OS==='ios'?'padding':undefined}
        style={[styles.overlay,{paddingTop:insets.top+16,paddingBottom:insets.bottom+16}]}>
        <View style={[styles.panel,{backgroundColor:theme.background,borderColor:theme.border}]} accessibilityViewIsModal>
          <View style={styles.heading}><ThemedText type="heading" style={{flex:1}}>Sparky · Director</ThemedText>
            <Button title="Clear chat" variant="secondary" disabled={busy||!historyReady||(!messages.length&&!draft)} onPress={()=>useDirectorSession.getState().clear(sessionKey)}/>
            <Button title="Close" variant="secondary" onPress={()=>setOpen(false)} /></View>
          <Button title={`AI · ${provider?.label??(providerId?'Unavailable connection':origin?'Media Lab server':'Choose AI')}`} variant="secondary" disabled={busy} onPress={()=>setChoosingAI(!choosingAI)}/>
          {savedPlans.length?<Button title={`Saved Sparky plans · ${savedPlans.length}`} variant="secondary" disabled={busy} onPress={()=>{setChoosingPlan(!choosingPlan);setDetailsOpen(false);setChoosingAI(false);}}/>:null}
          {choosingAI?<ScrollView style={{maxHeight:140}} contentContainerStyle={{gap:8}}>
            {origin?<Button title="Use Media Lab server AI" variant="secondary" onPress={()=>{setProviderId(null);setChoosingAI(false);}}/>:null}
            {providers.filter(item=>item.capabilities.chat).map(item=><Button key={item.id} title={`${item.label} · ${item.defaultModel}`} variant="secondary" onPress={()=>{setProviderId(item.id);setChoosingAI(false);}}/>)}
            <Button title="Connect another AI" variant="secondary" onPress={()=>{setOpen(false);router.push('/connect-provider');}}/>
          </ScrollView>:null}
          <ThemedText type="small" themeColor="textSecondary">{project?`Project: ${project.name}`:'Your studio'} · {historyReady?'Recent chat · this device':'Restoring chat…'}</ThemedText>
          <Button title={detailsOpen?'Back to conversation':'Context & options'} variant="secondary" onPress={()=>{setDetailsOpen(!detailsOpen);setChoosing(false);setChoosingPlan(false);setChoosingAI(false);}}/>
          {detailsOpen?<ScrollView style={styles.log} contentContainerStyle={{gap:12}} keyboardShouldPersistTaps="handled">
          {provider?<ThemedText type="small">Messages and selected metadata go to {provider.label} using your connection. Your provider’s normal usage charges may apply.</ThemedText>:null}
          <ThemedText type="small" themeColor="textSecondary">{project?'Plan media and discuss your project assets. Only asset names and types are shared.':'Plan your next app, game, image, video, or audio project. Open a Build project to discuss its assets.'} Sparky can suggest a Library item to copy into this project. You review its real name and destination before adding it. Generation and code changes still go through their own workflows.</ThemedText>
          <View style={styles.heading}>
            <ThemedText type="small" style={{flex:1}}>Include Library · names matching your message, plus recent media (up to 12; metadata only)</ThemedText>
            <Switch accessibilityLabel="Include Library matches and recent creations" value={includeLibrary} disabled={busy}
              onValueChange={setIncludeLibrary} />
            <Button title="Open" accessibilityLabel="Choose a Library creation" variant="secondary" disabled={busy}
              onPress={()=>{setOpen(false);if(inLibrary)return;router.push(project?{pathname:'/library',params:{projectId:project.id}}:'/(tabs)/creations');}} />
          </View>
          {origin?<View style={styles.heading}>
            <ThemedText type="small" style={{flex:1}}>Include saved cast & stories · up to 8 characters, voices and storyboards each. Names, short descriptions, archived status and missing-reference counts only.</ThemedText>
            <Switch accessibilityLabel="Include saved characters voices and storyboards" value={includeCollections} disabled={busy} onValueChange={setIncludeCollections}/>
          </View>:null}
          {project?<Button title={loadingAssets?'Loading assets…':`Assets · ${selected?.length??0} of ${assets.length} included`}
            variant="secondary" disabled={busy||loadingAssets||selected===null} onPress={()=>{setChoosing(!choosing);setDetailsOpen(false);}} />:null}
          <Button title={origin?'Manage Media Lab connection':'Connect Media Lab'} variant="secondary" disabled={busy}
            onPress={()=>{setOpen(false);router.push({pathname:'/connect-media-lab',params:{...(origin?{url:origin}:{}),generation:'1'}});}} />
          </ScrollView>:null}
          {detailsOpen?null:choosingPlan?<ScrollView style={styles.log} contentContainerStyle={styles.turns}>
            <ThemedText type="small">Choose a saved plan to continue it with your selected AI. Your other chats stay intact.</ThemedText>
            {savedPlans.map((plan,index)=><Button key={index} title={`${index+1}. ${(plan.draft||plan.messages.find(m=>m.role==='user')?.content||'Saved conversation').slice(0,80)}`} variant="secondary" onPress={()=>{
              if(!project)return;
              const key=directorSessionKey(`saved-plan:${index}`,project.id);
              if(!useDirectorSession.getState().conversations[key])useDirectorSession.setState(state=>({conversations:{...state.conversations,[key]:plan}}));
              setHistoryContext(key);setChoosingPlan(false);
            }}/>)}</ScrollView>:choosing?<View style={styles.log}>
            <ThemedText type="small">Choose up to 32 assets, or choose none to chat about the project without asset references.</ThemedText>
            <ScrollView style={styles.log} keyboardShouldPersistTaps="handled">
              {assets.map(path=>{
                const checked=selected?.includes(path)??false;
                const disabled=busy||(!checked&&(selected?.length??0)>=32);
                return <Pressable key={path} accessibilityRole="checkbox" accessibilityLabel={path}
                  accessibilityState={{checked,disabled}} disabled={disabled}
                  onPress={()=>{manuallySelected.current=true;setSelected(previous=>checked?(previous??[]).filter(item=>item!==path):[...(previous??[]),path]);}}
                  style={[styles.asset,{opacity:disabled?.5:1}]}>
                  <ThemedText>{checked?'☑':'☐'} {path}</ThemedText>
                </Pressable>;
              })}
            </ScrollView>
            <View style={styles.heading}>
              <Button title="Choose none" variant="secondary" disabled={busy} onPress={()=>{manuallySelected.current=true;setSelected([]);}} />
              <Button title="Done choosing" onPress={()=>setChoosing(false)} />
            </View>
          </View>:<ScrollView ref={conversation} style={styles.log} contentContainerStyle={styles.turns}
            onContentSizeChange={()=>conversation.current?.scrollToEnd({animated:false})}
            onLayout={()=>conversation.current?.scrollToEnd({animated:false})} keyboardShouldPersistTaps="handled">
            {!messages.length?<ThemedText>{project?'What would you like to make or use in this project?':'What would you like to make?'}</ThemedText>:null}
            {messages.map((message,index)=>{
              const action=message.role==='assistant'?directorAssetProposal(message.content):{text:message.content,proposal:null};
              return <View key={index} style={[styles.turn,{backgroundColor:message.role==='user'?theme.tintSoft:theme.backgroundElement}]}>
              <ThemedText type="smallBold">{message.role==='user'?'You':'Sparky'}</ThemedText><ThemedText selectable>{action.text}</ThemedText>
              {project&&action.proposal?<DirectorAssetAction key={sessionKey+':'+message.content} assetId={action.proposal.assetId} project={project} origin={origin} disabled={busy} onImported={path=>{
                setImportedPaths(values=>({...values,[message.content]:path}));
                void listProjectFilePaths(project.id).then(files=>{
                  const paths=[...directorAssets(files.map(path=>({path}))).keys()];
                  setAssets(paths);setSelected(previous=>refreshDirectorSelection(paths,previous,manuallySelected.current));
                }).catch(()=>setError('The asset was copied. Reopen Sparky to refresh its project context.'));
              }}/>:null}
              {project&&message.role==='assistant'?<Button title="Review in builder" variant="secondary" disabled={busy} onPress={()=>void reviewInBuilder(index)} />:null}</View>;
            })}
          </ScrollView>}
          {storageError?<ThemedText accessibilityRole="alert" style={{color:theme.danger}}>Sparky could not save or restore some conversations on this device. Keep this app open to retain your current chat.</ThemedText>:null}
          {error?<ThemedText accessibilityRole="alert" style={{color:theme.danger}}>{error}</ThemedText>:null}
          {!detailsOpen?<><TextInput accessibilityLabel="Message Sparky" placeholder="Ask Sparky…" placeholderTextColor={theme.textSecondary}
            multiline maxLength={4000} value={draft} onChangeText={setDraft} editable={!busy}
            style={[styles.input,{color:theme.text,backgroundColor:theme.backgroundElement}]} />
          {hasAI?<Button title="Send to Sparky" loading={busy} disabled={!historyReady||!draft.trim()||loadingAssets||selected===null} onPress={()=>void send()} />:null}</>:null}

        </View>
      </KeyboardAvoidingView>
    </Modal>
  </>;
}
const styles=StyleSheet.create({
  fab:{position:'absolute',right:16,minHeight:44,paddingHorizontal:16,borderRadius:24,justifyContent:'center',zIndex:20},
  overlay:{flex:1,backgroundColor:'rgba(0,0,0,.45)',paddingHorizontal:16,justifyContent:'flex-end',alignItems:'flex-end'},
  panel:{width:'100%',maxWidth:520,height:640,maxHeight:'100%',borderWidth:1,borderRadius:20,padding:16,gap:12},
  heading:{flexDirection:'row',alignItems:'center',justifyContent:'space-between',gap:8},log:{flex:1},turns:{gap:12},
  asset:{minHeight:44,paddingVertical:12},
  turn:{padding:12,borderRadius:12,gap:4},input:{minHeight:60,maxHeight:140,borderRadius:12,padding:12,fontSize:16},
});
