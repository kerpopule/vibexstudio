import {useCallback,useEffect,useState} from 'react';
import {useFocusEffect} from 'expo-router';
import {View} from 'react-native';
import {ThemedText} from '@/components/themed-text';
import {Button} from '@/components/ui/button';
import {Glass} from '@/components/ui/glass';
import {Spacing} from '@/constants/theme';
import {listModelEngines,type ModelEngine} from '@/lib/remote-generation';
import {listModelRequests,prepareModelRequest,advanceModelRequest,type ModelRequest,type ModelSource} from '@/lib/model-workflow';

/** Key by origin: pending state and results never cross a server change. */
export function ModelGeneration({origin,source,onUse,disabled,projectSelected,onChoose,addedId,onOpenBuilder,onVisibleJobs,onConnect}: {
  onConnect:()=>void;
  onVisibleJobs:(value:{origin:string;ids:string[]})=>void;
  origin:string;source:ModelSource|null;onUse:(record:ModelRequest)=>void;
  disabled:boolean;projectSelected:boolean;onChoose:()=>void;addedId:string|null;onOpenBuilder:()=>void;
}) {
  const [engine,setEngine]=useState<ModelEngine|null>(null);
  const [records,setRecords]=useState<ModelRequest[]>([]);
  const [error,setError]=useState<string|null>(null);
  const [checkingEngine,setCheckingEngine]=useState(true);
  const [engineError,setEngineError]=useState<string|null>(null);
  const [busy,setBusy]=useState(false);
  useEffect(() => {
    onVisibleJobs({origin,ids:records.flatMap(record=>record.job?[record.job.id]:[])});
  },[origin,records,onVisibleJobs]);
  useFocusEffect(useCallback(() => {
    let active=true,checking=false;
    const check=async () => {
      if(checking)return;
      checking=true;
      try {
        const saved=await listModelRequests(origin);
        if(active)setRecords(saved);
        for(const record of saved) {
          if(!record.job || !['succeeded','failed','cancelled'].includes(record.job.status)) await advanceModelRequest(record.requestId);
        }
        const current=await listModelRequests(origin);
        if(active){setRecords(current);setError(null);}
      } catch(e){if(active)setError(e instanceof Error?e.message:'Your 3D request is saved. Reconnect to continue.');}
      finally{checking=false;}
    };
    setCheckingEngine(true);setEngineError(null);setEngine(null);
    listModelEngines(origin).then(engines=>{if(active){setEngine(engines[0]??null);setEngineError(null);}})
      .catch(e=>{if(active)setEngineError(e instanceof Error?e.message:'Connect generation to continue.');})
      .finally(()=>{if(active)setCheckingEngine(false);});
    void check();
    const timer=setInterval(()=>void check(),5000);
    return()=>{active=false;clearInterval(timer);};
  },[origin]));
  const act=async (action:()=>Promise<unknown>)=>{
    if(busy)return;
    setBusy(true);setError(null);
    try{await action();}
    catch(e){setError(e instanceof Error?e.message:'Your 3D request could not be completed.');}
    finally{try{setRecords(await listModelRequests(origin));}catch(e){setError(e instanceof Error?e.message:'Saved request status is unavailable.');}finally{setBusy(false);}}
  };
  return <View style={{gap:Spacing.two}}>
    <ThemedText type="heading">Draft 3D assets</ThemedText>
    <ThemedText themeColor="textSecondary">Use a cutout of one object with a transparent background. A perspective photo works better than a flat drawing. Check the generated shape before using it in a game.</ThemedText>
    {checkingEngine?<ThemedText>Checking 3D availability on this server…</ThemedText>:null}
    {!checkingEngine&&!engine&&!engineError?<ThemedText>No compatible 3D model is ready on this server. Complete its 3D setup first.</ThemedText>:null}
    {source?<><ThemedText>Selected: {source.title}</ThemedText>
      <Button title="Make draft 3D asset on this server" disabled={!engine||busy||disabled} loading={busy}
        onPress={()=>void act(async()=>{if(engine){const saved=await prepareModelRequest(source,engine);await advanceModelRequest(saved.requestId);}})} /></>:
      <ThemedText>Select “Make 3D asset” on a completed image.</ThemedText>}
    {engineError?<View style={{gap:Spacing.two}}>
      <ThemedText accessibilityRole="alert">{engineError}</ThemedText>
      <Button title="Reconnect generation" variant="secondary" disabled={busy||disabled} onPress={onConnect} />
    </View>:null}
    {error?<ThemedText accessibilityRole="alert">{error}</ThemedText>:null}
    {records.map(record=><Glass key={record.requestId} style={{padding:Spacing.two,gap:Spacing.two}}>
      <ThemedText>{record.title}</ThemedText>
      <ThemedText accessibilityLiveRegion="polite">{record.job?.status==='succeeded'?'Draft 3D asset ready':record.job?.status==='cancelled'?'Cancelled':record.job?.status==='failed'?'The server could not finish this model.':record.cancelRequested?'Cancellation requested':record.job?.status??'Request saved'}</ThemedText>
      {record.job?.status==='succeeded'?<Button title={addedId===record.requestId?'Added to project':projectSelected?'Use 3D model in this project':'Choose a project'} disabled={busy||disabled||addedId===record.requestId} onPress={()=>projectSelected?onUse(record):onChoose()} />:
        !record.job||!['failed','cancelled'].includes(record.job.status)?<>
          <Button title="Check saved 3D request" disabled={busy||disabled} onPress={()=>void act(()=>advanceModelRequest(record.requestId))} />
          <Button title="Cancel 3D generation" variant="secondary" disabled={busy||disabled||record.cancelRequested} onPress={()=>void act(()=>advanceModelRequest(record.requestId,true))} />
        </>:null}
      {addedId===record.requestId&&projectSelected?<Button title="Open builder" variant="secondary" onPress={onOpenBuilder} />:null}
    </Glass>)}
  </View>;
}
