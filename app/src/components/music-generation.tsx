import {useCallback,useState} from 'react';
import {useFocusEffect} from 'expo-router';
import {TextInput,View} from 'react-native';
import {ThemedText} from '@/components/themed-text';
import {Button} from '@/components/ui/button';
import {Glass} from '@/components/ui/glass';
import {Spacing} from '@/constants/theme';
import {useTheme} from '@/hooks/use-theme';
import {listMusicEngines,saveResultToLibrary,MUSIC_PROMPT_LIMIT,MUSIC_LYRICS_LIMIT,MUSIC_MIN_SECONDS,type MusicEngine} from '@/lib/remote-generation';
import {listMusicRequests,prepareMusicRequest,advanceMusicRequest,markMusicSaved,type MusicRequest} from '@/lib/music-workflow';

const LENGTHS=[20,30,60];

/** Experimental music on the paired server's GPU (ACE-Step); keyed by origin like the speech panel. */
export function MusicGeneration({origin,onUse,disabled,projectSelected,onChoose,addedId,onOpenBuilder,onConnect,onSaved}: {
  origin:string;onUse:(record:MusicRequest)=>void;disabled:boolean;projectSelected:boolean;onChoose:()=>void;
  addedId:string|null;onOpenBuilder:()=>void;onConnect:()=>void;onSaved:()=>void;
}) {
  const theme=useTheme();
  const [engine,setEngine]=useState<MusicEngine|null>(null);
  const [records,setRecords]=useState<MusicRequest[]>([]);
  const [prompt,setPrompt]=useState('');
  const [lyrics,setLyrics]=useState('');
  const [seconds,setSeconds]=useState(20);
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
        const current=await listMusicRequests(origin);
        if(active)setRecords(current);
        for(const record of current) {
          if(!record.job || !['succeeded','failed','cancelled'].includes(record.job.status)) await advanceMusicRequest(record.requestId);
        }
        const latest=await listMusicRequests(origin);
        if(active){setRecords(latest);setError(null);}
      } catch(e){if(active)setError(e instanceof Error?e.message:'Your music request is saved. Reconnect to continue.');}
      finally{polling=false;}
    };
    setChecking(true);setEngineError(null);setEngine(null);
    listMusicEngines(origin).then(engines=>{if(active){setEngine(engines[0]??null);setEngineError(null);}})
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
    catch(e){setError(e instanceof Error?e.message:'Your music request could not be completed.');}
    finally{try{setRecords(await listMusicRequests(origin));}catch(e){setError(e instanceof Error?e.message:'Saved request status is unavailable.');}finally{setBusy(false);}}
  };
  const field={padding:Spacing.two,borderRadius:12,borderWidth:1,borderColor:theme.border,color:theme.text,backgroundColor:theme.backgroundElement,textAlignVertical:'top' as const};
  return <View style={{gap:Spacing.two}}>
    <ThemedText type="heading">Music (experimental)</ThemedText>
    <ThemedText themeColor="textSecondary">Describe a piece and your server composes it on its own GPU. Leave lyrics empty for an instrumental. The first request after a quiet period takes about a minute longer while the model loads.</ThemedText>
    {checking?<ThemedText>Checking music availability on this server…</ThemedText>:null}
    {!checking&&!engine&&!engineError?<ThemedText>No music model is ready on this server. Its administrator can enable the experimental music pack.</ThemedText>:null}
    {engine?<>
      <TextInput accessibilityLabel="Describe the music" multiline value={prompt} onChangeText={value=>setPrompt(value.slice(0,MUSIC_PROMPT_LIMIT))}
        placeholder="e.g. upbeat synth pop for a game victory screen" placeholderTextColor={theme.textSecondary} editable={!busy&&!disabled} style={[field,{minHeight:72}]} />
      <TextInput accessibilityLabel="Lyrics (optional)" multiline value={lyrics} onChangeText={value=>setLyrics(value.slice(0,MUSIC_LYRICS_LIMIT))}
        placeholder="Lyrics (optional; empty = instrumental)" placeholderTextColor={theme.textSecondary} editable={!busy&&!disabled} style={[field,{minHeight:60}]} />
      <View style={{flexDirection:'row',gap:Spacing.one,flexWrap:'wrap'}}>
        {LENGTHS.filter(value=>value>=MUSIC_MIN_SECONDS&&value<=engine.maxSeconds).map(value=><Button key={value} title={`${value} s`} variant={seconds===value?'primary':'secondary'} disabled={busy||disabled} onPress={()=>setSeconds(value)} />)}
      </View>
      <Button title="Compose on this server" disabled={!prompt.trim()||busy||disabled} loading={busy}
        onPress={()=>void act(async()=>{const record=await prepareMusicRequest(origin,engine,prompt,lyrics,seconds);setPrompt('');setLyrics('');await advanceMusicRequest(record.requestId);})} />
    </>:null}
    {engineError?<View style={{gap:Spacing.two}}>
      <ThemedText accessibilityRole="alert">{engineError}</ThemedText>
      <Button title="Reconnect generation" variant="secondary" disabled={busy||disabled} onPress={onConnect} />
    </View>:null}
    {error?<ThemedText accessibilityRole="alert">{error}</ThemedText>:null}
    {records.map(record=><Glass key={record.requestId} style={{padding:Spacing.two,gap:Spacing.two}}>
      <ThemedText numberOfLines={3}>{record.prompt} · {record.seconds} s{record.lyrics?' · with lyrics':' · instrumental'}</ThemedText>
      <ThemedText accessibilityLiveRegion="polite">{record.job?.status==='succeeded'?'Music ready':record.job?.status==='cancelled'?'Cancelled':record.job?.status==='failed'?'The server could not finish this piece.':record.cancelRequested?'Cancellation requested':record.job?.status==='running'?'Composing on your server…':record.job?.status==='queued'?'Waiting for the server GPU…':'Request saved'}</ThemedText>
      {record.job?.status==='succeeded'?<>
        <Button title={record.libraryAssetId?'Saved to Library':'Save music to Library'} variant="secondary" disabled={busy||disabled||Boolean(record.libraryAssetId)}
          onPress={()=>{const id=record.job!.id;void act(async()=>{const assetId=await saveResultToLibrary(record.origin,id);await markMusicSaved(record.requestId,assetId);onSaved();});}} />
        <Button title={addedId===record.requestId?'Added to project':projectSelected?'Use audio in this project':'Choose a project'} disabled={busy||disabled||addedId===record.requestId} onPress={()=>projectSelected?onUse(record):onChoose()} />
      </>:
        !record.job||!['failed','cancelled'].includes(record.job.status)?<>
          <Button title="Check saved music request" disabled={busy||disabled} onPress={()=>void act(()=>advanceMusicRequest(record.requestId))} />
          <Button title="Cancel music" variant="secondary" disabled={busy||disabled||record.cancelRequested} onPress={()=>void act(()=>advanceMusicRequest(record.requestId,true))} />
        </>:null}
      {addedId===record.requestId&&projectSelected?<Button title="Open builder" variant="secondary" onPress={onOpenBuilder} />:null}
    </Glass>)}
  </View>;
}
