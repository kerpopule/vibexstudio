import {useCallback,useState} from 'react';
import {useFocusEffect} from 'expo-router';
import {TextInput,View} from 'react-native';
import {ThemedText} from '@/components/themed-text';
import {Button} from '@/components/ui/button';
import {Glass} from '@/components/ui/glass';
import {Spacing} from '@/constants/theme';
import {useTheme} from '@/hooks/use-theme';
import {listImageEngines,saveResultToLibrary,IMAGE_PROMPT_LIMIT,type ImageEngine} from '@/lib/remote-generation';
import {listImageRequests,prepareImageRequest,advanceImageRequest,markImageSaved,type ImageRequest} from '@/lib/image-workflow';

const SIZES=[{label:'Square',size:'1024*1024'},{label:'Landscape',size:'1280*768'},{label:'Portrait',size:'768*1280'}];

/** Experimental text-to-image on the paired server's GPU (Z-Image-Turbo); keyed by origin like the speech panel. */
export function ImageGeneration({origin,onUse,disabled,projectSelected,onChoose,addedId,onOpenBuilder,onConnect,onSaved}: {
  origin:string;onUse:(record:ImageRequest)=>void;disabled:boolean;projectSelected:boolean;onChoose:()=>void;
  addedId:string|null;onOpenBuilder:()=>void;onConnect:()=>void;onSaved:()=>void;
}) {
  const theme=useTheme();
  const [engine,setEngine]=useState<ImageEngine|null>(null);
  const [records,setRecords]=useState<ImageRequest[]>([]);
  const [prompt,setPrompt]=useState('');
  const [size,setSize]=useState('1024*1024');
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
        const current=await listImageRequests(origin);
        if(active)setRecords(current);
        for(const record of current) {
          if(!record.job || !['succeeded','failed','cancelled'].includes(record.job.status)) await advanceImageRequest(record.requestId);
        }
        const latest=await listImageRequests(origin);
        if(active){setRecords(latest);setError(null);}
      } catch(e){if(active)setError(e instanceof Error?e.message:'Your image request is saved. Reconnect to continue.');}
      finally{polling=false;}
    };
    setChecking(true);setEngineError(null);setEngine(null);
    listImageEngines(origin).then(engines=>{if(active){setEngine(engines[0]??null);setEngineError(null);}})
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
    catch(e){setError(e instanceof Error?e.message:'Your image request could not be completed.');}
    finally{try{setRecords(await listImageRequests(origin));}catch(e){setError(e instanceof Error?e.message:'Saved request status is unavailable.');}finally{setBusy(false);}}
  };
  const field={padding:Spacing.two,borderRadius:12,borderWidth:1,borderColor:theme.border,color:theme.text,backgroundColor:theme.backgroundElement,textAlignVertical:'top' as const};
  return <View style={{gap:Spacing.two}}>
    <ThemedText type="heading">Images (experimental)</ThemedText>
    <ThemedText themeColor="textSecondary">Describe an image and your server renders it on its own GPU in seconds. The first request after a quiet period takes about a minute longer while the model loads.</ThemedText>
    {checking?<ThemedText>Checking image availability on this server…</ThemedText>:null}
    {!checking&&!engine&&!engineError?<ThemedText>No image model is ready on this server. Its administrator can enable the experimental image pack.</ThemedText>:null}
    {engine?<>
      <TextInput accessibilityLabel="Describe the image" multiline value={prompt} onChangeText={value=>setPrompt(value.slice(0,IMAGE_PROMPT_LIMIT))}
        placeholder="e.g. a lighthouse on a rocky coast at dusk, painterly" placeholderTextColor={theme.textSecondary} editable={!busy&&!disabled} style={[field,{minHeight:72}]} />
      <View style={{flexDirection:'row',gap:Spacing.one,flexWrap:'wrap'}}>
        {SIZES.filter(value=>engine.sizes.includes(value.size)).map(value=><Button key={value.size} title={value.label} variant={size===value.size?'primary':'secondary'} disabled={busy||disabled} onPress={()=>setSize(value.size)} />)}
      </View>
      <Button title="Create image on this server" disabled={!prompt.trim()||busy||disabled} loading={busy}
        onPress={()=>void act(async()=>{const record=await prepareImageRequest(origin,engine,prompt,size);setPrompt('');await advanceImageRequest(record.requestId);})} />
    </>:null}
    {engineError?<View style={{gap:Spacing.two}}>
      <ThemedText accessibilityRole="alert">{engineError}</ThemedText>
      <Button title="Reconnect generation" variant="secondary" disabled={busy||disabled} onPress={onConnect} />
    </View>:null}
    {error?<ThemedText accessibilityRole="alert">{error}</ThemedText>:null}
    {records.map(record=><Glass key={record.requestId} style={{padding:Spacing.two,gap:Spacing.two}}>
      <ThemedText numberOfLines={3}>{record.prompt} · {record.size.replace('*','×')}</ThemedText>
      <ThemedText accessibilityLiveRegion="polite">{record.job?.status==='succeeded'?'Image ready':record.job?.status==='cancelled'?'Cancelled':record.job?.status==='failed'?'The server could not finish this image.':record.cancelRequested?'Cancellation requested':record.job?.status==='running'?'Rendering on your server…':record.job?.status==='queued'?'Waiting for the server GPU…':'Request saved'}</ThemedText>
      {record.job?.status==='succeeded'?<>
        <Button title={record.libraryAssetId?'Saved to Library':'Save image to Library'} variant="secondary" disabled={busy||disabled||Boolean(record.libraryAssetId)}
          onPress={()=>{const id=record.job!.id;void act(async()=>{const assetId=await saveResultToLibrary(record.origin,id);await markImageSaved(record.requestId,assetId);onSaved();});}} />
        <Button title={addedId===record.requestId?'Added to project':projectSelected?'Use image in this project':'Choose a project'} disabled={busy||disabled||addedId===record.requestId} onPress={()=>projectSelected?onUse(record):onChoose()} />
      </>:
        !record.job||!['failed','cancelled'].includes(record.job.status)?<>
          <Button title="Check saved image request" disabled={busy||disabled} onPress={()=>void act(()=>advanceImageRequest(record.requestId))} />
          <Button title="Cancel image" variant="secondary" disabled={busy||disabled||record.cancelRequested} onPress={()=>void act(()=>advanceImageRequest(record.requestId,true))} />
        </>:null}
      {addedId===record.requestId&&projectSelected?<Button title="Open builder" variant="secondary" onPress={onOpenBuilder} />:null}
    </Glass>)}
  </View>;
}
