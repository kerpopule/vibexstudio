import {Image} from 'expo-image';
import {useCallback, useEffect, useRef, useState} from 'react';
import {useFocusEffect} from 'expo-router';
import {View} from 'react-native';
import {ThemedText} from '@/components/themed-text';
import {Button} from '@/components/ui/button';
import {Glass} from '@/components/ui/glass';
import {Spacing} from '@/constants/theme';
import {readStudioPreview, listPermittedStudioHistory, type StudioHistoryJob} from '@/lib/remote-generation';

export function ResultPreview({origin,id}:{origin:string;id:string}) {
  const [uri,setUri] = useState<string|null>(null);
  const [attempt,setAttempt] = useState(0);
  const [error,setError] = useState<string|null>(null);
  useEffect(() => {
    if (!attempt) return;
    let active = true;
    readStudioPreview(origin,id).then(bytes => {
      let binary = '';
      for (let i=0;i<bytes.length;i+=8192) binary += String.fromCharCode(...bytes.subarray(i,i+8192));
      if (active) setUri('data:image/png;base64,'+globalThis.btoa(binary));
    }).catch(e => {if (active) setError(e instanceof Error ? e.message : 'Preview unavailable.');});
    return () => {active=false;};
  },[origin,id,attempt]);
  return uri ? <Image source={{uri}} contentFit="contain" style={{width:'100%',height:200}} accessibilityLabel="Generated image preview" /> :
    <View>{error ? <ThemedText accessibilityRole="alert">{error}</ThemedText> : null}
      <Button title="Preview image" variant="secondary" loading={attempt > 0 && !error} disabled={attempt > 0 && !error}
        onPress={() => {setError(null);setAttempt(value => value+1);}} /></View>;
}

/** Mount with a server-origin key so a connection change cannot mix histories. */
export function GenerationHistory({origin, excludedIds, disabled, projectSelected, addedId, onUse, onChoose, onOpenBuilder, onMakeModel, onSaveImage, savedImageIds = [], kindFilter = 'all', queryFilter = '', libraryHasItems = true, libraryUnavailable = false}: {
  onSaveImage?:(job:StudioHistoryJob) => void;
  savedImageIds?:string[];
  libraryHasItems?: boolean;
  libraryUnavailable?: boolean;
  queryFilter?: string;
  kindFilter?: 'all' | StudioHistoryJob['kind'];
  origin:string; excludedIds:string[]; disabled:boolean; projectSelected:boolean; addedId:string|null;
  onMakeModel?:(job:StudioHistoryJob) => void; onUse:(job:StudioHistoryJob) => void; onChoose:() => void; onOpenBuilder:() => void;
}) {
  const [permitted,setPermitted] = useState<boolean|null>(null);
  const [jobs,setJobs] = useState<StudioHistoryJob[]>([]);
  const [cursor,setCursor] = useState<string|null>(null);
  const [loading,setLoading] = useState(false);
  const [error,setError] = useState<string|null>(null);
  const epoch = useRef(0);
  const pending = useRef(false);
  const load = useCallback(async (before?:string) => {
    if (pending.current) return;
    pending.current = true;
    const generation = epoch.current;
    setLoading(true);setError(null);
    try {
      const page = await listPermittedStudioHistory(origin,before);
      if (generation !== epoch.current) return;
      setPermitted(page !== null);
      if (!page) {setJobs([]);setCursor(null);return;}
      setJobs(previous => before ? [...new Map([...previous,...page.jobs].map(job => [job.id,job])).values()] : page.jobs);
      setCursor(page.nextCursor);
    } catch (e) {
      if (generation === epoch.current) {setPermitted(null);setError(e instanceof Error ? e.message : 'Server creations are unavailable. Use Refresh library to try again.');}
    } finally {
      if (generation === epoch.current) {pending.current=false;setLoading(false);}
    }
  },[origin]);
  useFocusEffect(useCallback(() => {
    pending.current=false;
    void load();
    return () => {epoch.current++;pending.current=false;};
  },[load]));
  const terms = queryFilter.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  const visible = jobs.filter(job => !excludedIds.includes(job.id) && (kindFilter === 'all' || job.kind === kindFilter) && terms.every(term => `${job.title ?? ''} Generated ${job.kind}`.toLocaleLowerCase().includes(term)));
  if (permitted === false) return libraryHasItems || libraryUnavailable ? null : <ThemedText themeColor="textSecondary">
    {terms.length || kindFilter !== 'all' ? 'No saved creations match these filters.' : 'No saved creations yet.'}
  </ThemedText>;
  if (permitted === null && !error) return null;
  return <View style={{gap:Spacing.two}}>
    <ThemedText type="heading">Your server creations</ThemedText>
    <ThemedText themeColor="textSecondary">Finished and running creations from this device’s jobs.</ThemedText>
    {error ? <ThemedText accessibilityRole="alert">{error}</ThemedText> : null}
    {loading ? <ThemedText accessibilityLiveRegion="polite">Checking server creations…</ThemedText> : null}
    {!loading && !error && !visible.length ? <ThemedText themeColor="textSecondary">{terms.length || kindFilter !== 'all' ? 'No server creations match these filters on this page.' : 'No additional server creations on this page.'}</ThemedText> : null}
    {visible.map(job => <Glass key={job.id} style={{padding:Spacing.three,gap:Spacing.two}}>
      <ThemedText>{job.title || (job.kind === 'image' ? 'Generated image' : 'Generated '+job.kind)} · {new Date(job.createdAt).toLocaleString()}</ThemedText>
      <ThemedText>{({succeeded:'Ready to use',failed:'Could not finish',cancelled:'Cancelled',cancel_requested:'Cancellation requested',running:'Running on your server',queued:'Waiting for your server'})[job.status]}</ThemedText>
      {job.status === 'succeeded' && job.kind === 'image' && onSaveImage ? <Button title={savedImageIds.includes(job.id) ? 'Saved to Library' : 'Save cutout to Library'} variant="secondary" disabled={disabled || savedImageIds.includes(job.id)} onPress={() => onSaveImage(job)} /> : null}
      {job.status === 'succeeded' && job.kind === 'image' && onMakeModel ? <Button title="Make 3D asset" variant="secondary" disabled={disabled} onPress={() => onMakeModel(job)} /> : null}
      {job.status === 'succeeded' && job.kind === 'image' ? <ResultPreview origin={origin} id={job.id} /> : null}
      {job.status === 'succeeded' && (job.kind === 'image' || job.kind === 'model' || job.kind === 'audio' || job.kind === 'video') ? <Button title={addedId === job.id ? 'Added to project' : projectSelected ? (job.kind === 'video' ? 'Use video in this project' : job.kind === 'audio' ? 'Use audio in this project' : job.kind === 'model' ? 'Use 3D model in this project' : 'Use image in this project') : 'Choose a project'}
        disabled={disabled || addedId === job.id} onPress={() => projectSelected ? onUse(job) : onChoose()} /> : null}
      {addedId === job.id && projectSelected ? <Button title="Open builder" variant="secondary" onPress={onOpenBuilder} /> : null}
    </Glass>)}
    {cursor ? <Button title="Load older generations" variant="secondary" disabled={loading || disabled} onPress={() => void load(cursor)} /> : null}
  </View>;
}
