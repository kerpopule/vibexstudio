import {useCallback,useState} from 'react';
import {useFocusEffect} from 'expo-router';
import {TextInput,View} from 'react-native';
import {ThemedText} from '@/components/themed-text';
import {Button} from '@/components/ui/button';
import {Glass} from '@/components/ui/glass';
import {Spacing} from '@/constants/theme';
import {useTheme} from '@/hooks/use-theme';
import {listSpeechEngines,saveResultToLibrary,SPEECH_TEXT_LIMIT,type SpeechEngine} from '@/lib/remote-generation';
import {listSpeechRequests,prepareSpeechRequest,advanceSpeechRequest,markSpeechSaved,type SpeechRequest} from '@/lib/speech-workflow';

/** Experimental English speech on a paired server; keyed by origin like the 3D panel. */
export function SpeechGeneration({origin,onUse,disabled,projectSelected,onChoose,addedId,onOpenBuilder,onConnect,onSaved}: {
  origin:string;onUse:(record:SpeechRequest)=>void;disabled:boolean;projectSelected:boolean;onChoose:()=>void;
  addedId:string|null;onOpenBuilder:()=>void;onConnect:()=>void;onSaved:()=>void;
}) {
  const theme=useTheme();
  const [engine,setEngine]=useState<SpeechEngine|null>(null);
  const [records,setRecords]=useState<SpeechRequest[]>([]);
  const [text,setText]=useState('');
  const [error,setError]=useState<string|null>(null);
  const [checking,setChecking]=useState(true);
  const [engineError,setEngineError]=useState<string|null>(null);
  const [busy,setBusy]=useState(false);
  useFocusEffect(useCallback(() => {
    let active=true,polling=false;
    const check=async () => {
      if(polling)return;
      polling=true;
      try {
        const current=await listSpeechRequests(origin);
        if(active)setRecords(current);
        for(const record of current) {
          if(!record.job || !['succeeded','failed','cancelled'].includes(record.job.status)) await advanceSpeechRequest(record.requestId);
        }
        const latest=await listSpeechRequests(origin);
        if(active){setRecords(latest);setError(null);}
      } catch(e){if(active)setError(e instanceof Error?e.message:'Your speech request is saved. Reconnect to continue.');}
      finally{polling=false;}
    };
    setChecking(true);setEngineError(null);setEngine(null);
    listSpeechEngines(origin).then(engines=>{if(active){setEngine(engines[0]??null);setEngineError(null);}})
      .catch(e=>{if(active)setEngineError(e instanceof Error?e.message:'Connect generation to continue.');})
      .finally(()=>{if(active)setChecking(false);});
    void check();
    const timer=setInterval(()=>void check(),5000);
    return()=>{active=false;clearInterval(timer);};
  },[origin]));
  const act=async (action:()=>Promise<unknown>)=>{
    if(busy)return;
    setBusy(true);setError(null);
    try{await action();}
    catch(e){setError(e instanceof Error?e.message:'Your speech request could not be completed.');}
    finally{try{setRecords(await listSpeechRequests(origin));}catch(e){setError(e instanceof Error?e.message:'Saved request status is unavailable.');}finally{setBusy(false);}}
  };
  const remaining=SPEECH_TEXT_LIMIT-text.length;
  return <View style={{gap:Spacing.two}}>
    <ThemedText type="heading">Speech (experimental)</ThemedText>
    <ThemedText themeColor="textSecondary">English text is spoken by the reviewed default voice on your server. No cloned or personal voice is used. Generation runs on the CPU and can take a minute or two for a short line.</ThemedText>
    {checking?<ThemedText>Checking speech availability on this server…</ThemedText>:null}
    {!checking&&!engine&&!engineError?<ThemedText>No speech model is ready on this server. Its administrator can enable the experimental speech pack.</ThemedText>:null}
    {engine?<>
      <TextInput accessibilityLabel="Text to speak" multiline value={text} onChangeText={value=>setText(value.slice(0,SPEECH_TEXT_LIMIT))}
        placeholder="What should the voice say?" placeholderTextColor={theme.textSecondary} editable={!busy&&!disabled}
        style={{minHeight:88,padding:Spacing.two,borderRadius:12,borderWidth:1,borderColor:theme.border,color:theme.text,backgroundColor:theme.backgroundElement,textAlignVertical:'top'}} />
      <ThemedText themeColor="textSecondary">{remaining} characters left</ThemedText>
      <Button title="Speak on this server" disabled={!text.trim()||busy||disabled} loading={busy}
        onPress={()=>void act(async()=>{const record=await prepareSpeechRequest(origin,engine,text);setText('');await advanceSpeechRequest(record.requestId);})} />
    </>:null}
    {engineError?<View style={{gap:Spacing.two}}>
      <ThemedText accessibilityRole="alert">{engineError}</ThemedText>
      <Button title="Reconnect generation" variant="secondary" disabled={busy||disabled} onPress={onConnect} />
    </View>:null}
    {error?<ThemedText accessibilityRole="alert">{error}</ThemedText>:null}
    {records.map(record=><Glass key={record.requestId} style={{padding:Spacing.two,gap:Spacing.two}}>
      <ThemedText numberOfLines={3}>“{record.text}”</ThemedText>
      <ThemedText accessibilityLiveRegion="polite">{record.job?.status==='succeeded'?'Speech ready':record.job?.status==='cancelled'?'Cancelled':record.job?.status==='failed'?'The server could not finish this speech.':record.cancelRequested?'Cancellation requested':record.job?.status==='running'?'Speaking on your server…':record.job?.status==='queued'?'Waiting for the server…':'Request saved'}</ThemedText>
      {record.job?.status==='succeeded'?<>
        <Button title={record.libraryAssetId?'Saved to Library':'Save speech to Library'} variant="secondary" disabled={busy||disabled||Boolean(record.libraryAssetId)}
          onPress={()=>{const id=record.job!.id;void act(async()=>{const assetId=await saveResultToLibrary(record.origin,id);await markSpeechSaved(record.requestId,assetId);onSaved();});}} />
        <Button title={addedId===record.requestId?'Added to project':projectSelected?'Use audio in this project':'Choose a project'} disabled={busy||disabled||addedId===record.requestId} onPress={()=>projectSelected?onUse(record):onChoose()} />
      </>:
        !record.job||!['failed','cancelled'].includes(record.job.status)?<>
          <Button title="Check saved speech request" disabled={busy||disabled} onPress={()=>void act(()=>advanceSpeechRequest(record.requestId))} />
          <Button title="Cancel speech" variant="secondary" disabled={busy||disabled||record.cancelRequested} onPress={()=>void act(()=>advanceSpeechRequest(record.requestId,true))} />
        </>:null}
      {addedId===record.requestId&&projectSelected?<Button title="Open builder" variant="secondary" onPress={onOpenBuilder} />:null}
    </Glass>)}
  </View>;
}
