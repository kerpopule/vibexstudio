import {useCallback,useState} from 'react';
import {useFocusEffect} from 'expo-router';
import {TextInput,View} from 'react-native';
import {ThemedText} from '@/components/themed-text';
import {Button} from '@/components/ui/button';
import {Glass} from '@/components/ui/glass';
import {Spacing} from '@/constants/theme';
import {useTheme} from '@/hooks/use-theme';
import {listVideoEngines,saveResultToLibrary,VIDEO_PROMPT_LIMIT,type VideoEngine} from '@/lib/remote-generation';
import {listVideoRequests,prepareVideoRequest,advanceVideoRequest,markVideoSaved,type VideoRequest} from '@/lib/video-workflow';

const LENGTHS=[{label:'1 s',frames:25},{label:'2 s',frames:49},{label:'3 s',frames:73}];
const SIZES=[{label:'Portrait',size:'704*1280'},{label:'Landscape',size:'1280*704'}];

/** Experimental text-to-video on the paired server's GPU (Wan2.2 TI2V-5B); keyed by origin like the speech panel. */
export function VideoGeneration({origin,onUse,disabled,projectSelected,onChoose,addedId,onOpenBuilder,onConnect,onSaved}: {
  origin:string;onUse:(record:VideoRequest)=>void;disabled:boolean;projectSelected:boolean;onChoose:()=>void;
  addedId:string|null;onOpenBuilder:()=>void;onConnect:()=>void;onSaved:()=>void;
}) {
  const theme=useTheme();
  const [engine,setEngine]=useState<VideoEngine|null>(null);
  const [records,setRecords]=useState<VideoRequest[]>([]);
  const [prompt,setPrompt]=useState('');
  const [frames,setFrames]=useState(25);
  const [size,setSize]=useState('704*1280');
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
        const current=await listVideoRequests(origin);
        if(active)setRecords(current);
        for(const record of current) {
          if(!record.job || !['succeeded','failed','cancelled'].includes(record.job.status)) await advanceVideoRequest(record.requestId);
        }
        const latest=await listVideoRequests(origin);
        if(active){setRecords(latest);setError(null);}
      } catch(e){if(active)setError(e instanceof Error?e.message:'Your video request is saved. Reconnect to continue.');}
      finally{polling=false;}
    };
    setChecking(true);setEngineError(null);setEngine(null);
    listVideoEngines(origin).then(engines=>{if(active){setEngine(engines[0]??null);setEngineError(null);}})
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
    catch(e){setError(e instanceof Error?e.message:'Your video request could not be completed.');}
    finally{try{setRecords(await listVideoRequests(origin));}catch(e){setError(e instanceof Error?e.message:'Saved request status is unavailable.');}finally{setBusy(false);}}
  };
  const field={padding:Spacing.two,borderRadius:12,borderWidth:1,borderColor:theme.border,color:theme.text,backgroundColor:theme.backgroundElement,textAlignVertical:'top' as const};
  return <View style={{gap:Spacing.two}}>
    <ThemedText type="heading">Video clips (experimental)</ThemedText>
    <ThemedText themeColor="textSecondary">Describe a short clip and your server renders it on its own GPU. Expect a few minutes per clip; the first request after a quiet period takes several minutes longer while the model loads.</ThemedText>
    {checking?<ThemedText>Checking video availability on this server…</ThemedText>:null}
    {!checking&&!engine&&!engineError?<ThemedText>No video model is ready on this server. Its administrator can enable the experimental video pack.</ThemedText>:null}
    {engine?<>
      <TextInput accessibilityLabel="Describe the clip" multiline value={prompt} onChangeText={value=>setPrompt(value.slice(0,VIDEO_PROMPT_LIMIT))}
        placeholder="e.g. a paper boat drifting on a calm pond at golden hour" placeholderTextColor={theme.textSecondary} editable={!busy&&!disabled} style={[field,{minHeight:72}]} />
      <View style={{flexDirection:'row',gap:Spacing.one,flexWrap:'wrap'}}>
        {LENGTHS.filter(value=>value.frames<=engine.maxFrames).map(value=><Button key={value.frames} title={value.label} variant={frames===value.frames?'primary':'secondary'} disabled={busy||disabled} onPress={()=>setFrames(value.frames)} />)}
      </View>
      <View style={{flexDirection:'row',gap:Spacing.one,flexWrap:'wrap'}}>
        {SIZES.filter(value=>engine.sizes.includes(value.size)).map(value=><Button key={value.size} title={value.label} variant={size===value.size?'primary':'secondary'} disabled={busy||disabled} onPress={()=>setSize(value.size)} />)}
      </View>
      <Button title="Render on this server" disabled={!prompt.trim()||busy||disabled} loading={busy}
        onPress={()=>void act(async()=>{const record=await prepareVideoRequest(origin,engine,prompt,frames,size);setPrompt('');await advanceVideoRequest(record.requestId);})} />
    </>:null}
    {engineError?<View style={{gap:Spacing.two}}>
      <ThemedText accessibilityRole="alert">{engineError}</ThemedText>
      <Button title="Reconnect generation" variant="secondary" disabled={busy||disabled} onPress={onConnect} />
    </View>:null}
    {error?<ThemedText accessibilityRole="alert">{error}</ThemedText>:null}
    {records.map(record=><Glass key={record.requestId} style={{padding:Spacing.two,gap:Spacing.two}}>
      <ThemedText numberOfLines={3}>{record.prompt} · {Math.round((record.frames-1)/record.engine.fps*10)/10} s · {record.size==='1280*704'?'landscape':'portrait'}</ThemedText>
      <ThemedText accessibilityLiveRegion="polite">{record.job?.status==='succeeded'?'Clip ready':record.job?.status==='cancelled'?'Cancelled':record.job?.status==='failed'?'The server could not finish this clip.':record.cancelRequested?'Cancellation requested':record.job?.status==='running'?'Rendering on your server…':record.job?.status==='queued'?'Waiting for the server GPU…':'Request saved'}</ThemedText>
      {record.job?.status==='succeeded'?<>
        <Button title={record.libraryAssetId?'Saved to Library':'Save clip to Library'} variant="secondary" disabled={busy||disabled||Boolean(record.libraryAssetId)}
          onPress={()=>{const id=record.job!.id;void act(async()=>{const assetId=await saveResultToLibrary(record.origin,id);await markVideoSaved(record.requestId,assetId);onSaved();});}} />
        <Button title={addedId===record.requestId?'Added to project':projectSelected?'Use clip in this project':'Choose a project'} disabled={busy||disabled||addedId===record.requestId} onPress={()=>projectSelected?onUse(record):onChoose()} />
      </>:
        !record.job||!['failed','cancelled'].includes(record.job.status)?<>
          <Button title="Check saved video request" disabled={busy||disabled} onPress={()=>void act(()=>advanceVideoRequest(record.requestId))} />
          <Button title="Cancel clip" variant="secondary" disabled={busy||disabled||record.cancelRequested} onPress={()=>void act(()=>advanceVideoRequest(record.requestId,true))} />
        </>:null}
      {addedId===record.requestId&&projectSelected?<Button title="Open builder" variant="secondary" onPress={onOpenBuilder} />:null}
    </Glass>)}
  </View>;
}
