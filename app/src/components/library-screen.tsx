import {libraryPage} from '@/lib/library-page';
import {SavedCollections} from '@/components/saved-collections';
import {childLibraryFolders, inLibraryFolder} from '@/lib/library-folders';
import {LibraryUpload} from '@/components/library-upload';
import {shareAssetBytes} from '@/lib/share/share-asset-bytes';
import {shareGalleryFile} from '@/lib/share/share-gallery';
import {ChatAudioAttachment} from '@/components/chat-audio-attachment';
import {audioExtension} from '@/lib/audio-file';
import { SparkyDirector } from '@/components/sparky-director';
import { Image } from 'expo-image';
import { router, useFocusEffect, useLocalSearchParams, useNavigation } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Platform, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';

import {ModelGeneration} from '@/components/model-generation';
import {SpeechGeneration} from '@/components/speech-generation';
import {MusicGeneration} from '@/components/music-generation';
import {VideoGeneration} from '@/components/video-generation';
import {ImageGeneration} from '@/components/image-generation';
import type {ModelSource} from '@/lib/model-workflow';
import { GenerationHistory, ResultPreview } from '@/components/generation-history';
import { LibraryPreview } from '@/components/library-preview';
import {LibraryPlayback} from '@/components/library-playback';
import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { Glass } from '@/components/ui/glass';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useChat } from '@/lib/chat-engine';
import { TAB_PILL_CLEARANCE } from '@/components/ui/tab-pill';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { exportRemoteSprites, readRemoteAsset } from '@/lib/remote-library';
import {saveBackgroundToLibrary,listBackgroundEngines, readBackgroundResult, readModelResult, readAudioResult, readVideoResult, type BackgroundEngine} from '@/lib/remote-generation';
import {listBackgroundRequests, prepareBackgroundRequest, advanceBackgroundRequest, type BackgroundRequest} from '@/lib/background-workflow';
import {libraryOrigin, type RemoteLibraryAsset} from '@/lib/library-core';
import {loadEntries, matchesLibrarySearch, type LibraryEntry} from '@/lib/library-entries';
import { useApp } from '@/lib/store';
/** Reuse a finished device-library asset without starting another generation. */
export default function LibraryScreen({ inTab = false }: { inTab?: boolean }) {
  const { projectId, kind: initialKind, assetId } = useLocalSearchParams<{ projectId?: string; kind?: string; assetId?: string }>();
  const [focusedAsset, setFocusedAsset] = useState(typeof assetId === 'string' ? assetId : null);
  const navigation = useNavigation();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const [selectedProjectId, setSelectedProjectId] = useState(projectId);
  const [choosingProject, setChoosingProject] = useState(false);
  const projects = useApp((s) => s.projects);
  const project = projects.find((p) => p.id === selectedProjectId);
  const openBuilder = () => {
    if (!project) return;
    const state = navigation.getState();
    const previous = state?.routes[(state.index ?? state.routes.length - 1) - 1];
    if (!inTab && previous?.name === 'project/[id]' &&
        (previous.params as {id?: string} | undefined)?.id === project.id && router.canGoBack()) {
      router.back();
    } else {
      router.push({pathname:'/project/[id]',params:{id:project.id}});
    }
  };
  const [visibleModelJobs,setVisibleModelJobs] = useState<{origin:string;ids:string[]}|null>(null);
  const listRef = useRef<FlatList<LibraryEntry>>(null);
  const chooseProject = () => {
    setChoosingProject(true);
    listRef.current?.scrollToOffset({offset: 0, animated: false});
  };
  const headerOffset = useRef(0);
  const toolsOffset = useRef(0);
  const [toolsOpen, setToolsOpen] = useState(false);
  const [savedCutouts,setSavedCutouts] = useState<string[]>([]);
  const modelOffset = useRef(0);
  const [modelSource,setModelSource] = useState<ModelSource|null>(null);
  const serverUrl = useApp((s) => s.mediaLab?.url);
  const [loadedServerUrl, setLoadedServerUrl] = useState<string | undefined>(undefined);
  const [items, setItems] = useState<LibraryEntry[]>([]);
  const [query, setQuery] = useState('');
  const [folder, setFolder] = useState('');
  const [foldersOpen, setFoldersOpen] = useState(false);
  useEffect(() => {setFolder('');}, [serverUrl]);
  const folderItems = items.filter(item => !item.remote || loadedServerUrl === serverUrl);
  const childFolders = childLibraryFolders(folderItems, folder);
  const [kind, setKind] = useState<'all' | LibraryEntry['kind']>(() =>
    initialKind === 'image' || initialKind === 'video' || initialKind === 'audio' || initialKind === 'model'
      ? initialKind : 'all');
  const terms = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  const visibleItems = items.filter(item => (!item.remote || loadedServerUrl === serverUrl) && (!focusedAsset || item.id === focusedAsset) && (kind === 'all' || item.kind === kind) &&
    inLibraryFolder(item,folder) && matchesLibrarySearch(item,terms));
  const pageKey=JSON.stringify([serverUrl,folder,focusedAsset,kind,query]);
  const [pageSelection,setPageSelection]=useState({key:'',page:0});
  const page=libraryPage(visibleItems,pageSelection.key===pageKey?pageSelection.page:0);
  const changePage=(next:number)=>{
    setPageSelection({key:pageKey,page:next});
    listRef.current?.scrollToOffset({offset:0,animated:false});
  };
  const filtered = !!folder || !!focusedAsset || terms.length > 0 || kind !== 'all';
  useEffect(() => {
    if (modelSource && modelSource.serverUrl === serverUrl) {
      listRef.current?.scrollToOffset({offset: headerOffset.current + toolsOffset.current + modelOffset.current, animated: false});
    }
  }, [modelSource, serverUrl]);
  const [deviceError, setDeviceError] = useState<string | null>(null);
  const [remoteError, setRemoteError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshVersion, setRefreshVersion] = useState(0);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const exporting=useRef(false);
  const [exportMessage,setExportMessage]=useState(''),[exportId,setExportId]=useState<string|null>(null);
  const [added, setAdded] = useState<string | null>(null);
  const [spriteMode, setSpriteMode] = useState(false);
  const [spriteFrames, setSpriteFrames] = useState<RemoteLibraryAsset[]>([]);
  const [backgroundHost, setBackgroundHost] = useState<{origin:string;engine:BackgroundEngine|null} | null>(null);
  const backgroundEngine = backgroundHost && backgroundHost.origin === serverUrl ? backgroundHost.engine : null;
  const [backgroundJobs, setBackgroundJobs] = useState<BackgroundRequest[]>([]);
  const [backgroundError, setBackgroundError] = useState<string | null>(null);
  const [backgroundPollError, setBackgroundPollError] = useState<string | null>(null);

  useFocusEffect(useCallback(() => {
    let active = true;
    let checking = false;
    const check = async () => {
      if (!serverUrl || checking) return;
      checking = true;
      try {
        const records = await listBackgroundRequests(serverUrl);
        let problem: string | null = null;
        for (const record of records) {
          if (!record.job || !['succeeded','failed','cancelled'].includes(record.job.status)) {
            try {await advanceBackgroundRequest(record.requestId);}
            catch (e) {problem = e instanceof Error ? e.message : 'Your request is saved. Reconnect to check it.';}
          }
        }
        const current = await listBackgroundRequests(serverUrl);
        if (active) {setBackgroundJobs(current);setBackgroundPollError(problem);}
      } catch (e) {
        if (active) {
          setBackgroundPollError(e instanceof Error ? e.message : 'Your request is saved. Reconnect to check it.');
          try {const saved = await listBackgroundRequests(serverUrl);if (active) setBackgroundJobs(saved);} catch { /* retain visible state */ }
        }
      } finally {checking = false;}
    };
    if (serverUrl) {
      listBackgroundEngines(serverUrl).then((engines) => {
        if (active) {setBackgroundHost({origin:serverUrl,engine:engines[0] ?? null});setBackgroundError(null);}
      }).catch((e) => {if (active) {setBackgroundHost({origin:serverUrl,engine:null});setBackgroundError(e instanceof Error ? e.message : 'Connect generation to continue.');}});
      void check();
    }
    const timer = setInterval(() => void check(),5000);
    return () => {active = false;clearInterval(timer);};
  },[serverUrl]));

  const removeBackground = async (asset: RemoteLibraryAsset) => {
    if (!backgroundEngine || busy) return;
    setToolsOpen(true);
    listRef.current?.scrollToOffset({offset:0,animated:false});
    setBusy('background-'+asset.id);setError(null);
    try {
      const record = await prepareBackgroundRequest(asset,backgroundEngine);
      setBackgroundJobs(await listBackgroundRequests(asset.serverUrl));
      await advanceBackgroundRequest(record.requestId);
    } catch (e) {setError(e instanceof Error ? e.message : 'Your request could not be sent.');}
    finally {
      try {setBackgroundJobs(await listBackgroundRequests(asset.serverUrl));} catch { /* keep saved status */ }
      setBusy(null);
    }
  };
  const saveCutout = async (record: Pick<BackgroundRequest,'origin'|'requestId'|'job'>) => {
    if (!record.job || busy) return;
    setBusy(record.requestId);setError(null);
    try { await saveBackgroundToLibrary(record.origin,record.job.id);setSavedCutouts(values=>[...values,record.job!.id]);refresh(); }
    catch (e) {setError(e instanceof Error ? e.message : 'The cutout could not be saved.');}
    finally {setBusy(null);}
  };
  const cancelBackground = async (record: BackgroundRequest) => {
    setBusy(record.requestId);setError(null);
    try {await advanceBackgroundRequest(record.requestId,true);}
    catch (e) {setError(e instanceof Error ? e.message : 'Cancellation is saved. Reconnect to finish it.');}
    finally {try {setBackgroundJobs(await listBackgroundRequests(record.origin));} catch { /* retain last saved display */ } finally {setBusy(null);}}
  };
  const importGeneration = async (record: Pick<BackgroundRequest, 'origin'|'requestId'> & {job:{id:string;kind?:string}|null}) => {
    if (!project || !record.job || busy) return;
    setBusy(record.requestId);setError(null);
    try {
      const model = record.job.kind === 'model';
      const audio = record.job.kind === 'audio';
      const video = record.job.kind === 'video';
      const media = audio || video ? await (video ? readVideoResult : readAudioResult)(record.origin,record.job.id) : null;
      const bytes = media?.bytes ?? await (model ? readModelResult : readBackgroundResult)(record.origin,record.job.id);
      const prefix = video ? 'video' : audio ? 'audio' : model ? 'model' : 'cutout';
      const extension = media?.extension ?? (model ? 'glb' : 'png');
      await useChat.getState().attachFile(project,bytes,`${prefix}-${record.job.id.slice(0,8)}.${extension}`,video ? 'video' : audio ? 'audio' : model ? undefined : 'image');
      setAdded(record.requestId);
    } catch (e) {setError(e instanceof Error ? e.message : 'The creation could not be added.');}
    finally {setBusy(null);}
  };

  const refresh = () => {
    setRefreshVersion(version => version + 1);
  };
  useFocusEffect(useCallback(() => {
    let active = true;
    setLoading(true);
    setError(null);
    setDeviceError(null);
    setRemoteError(null);
    setSpriteFrames([]);
    loadEntries(serverUrl).then((result) => {
      if (!active) return;
      setItems(result.items);
      setLoadedServerUrl(serverUrl);
      setRemoteError(result.remoteError);
      setDeviceError(result.deviceError);
    }).catch(() => { if (active) setError('Your library could not be loaded. Try again.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [serverUrl,refreshVersion]));

  const exportAsset=async(item:LibraryEntry)=>{
    if(busy||exporting.current)return;
    exporting.current=true;setExportId(item.id);setBusy('export-'+item.id);setError(null);setExportMessage('');
    try{
      if(item.remote){
        setExportMessage('Downloading from your server…');
        const bytes=await readRemoteAsset(item.remote);
        await shareAssetBytes(item.remote.fileName,bytes);
      }else await shareGalleryFile({...item,id:item.id.replace(/^device-/, '')});
      setExportMessage(Platform.OS==='web'?'Download requested. Check your browser’s downloads.':'Share sheet opened. Check your chosen destination to confirm the file was saved.');
    }catch(e){setExportMessage(e instanceof Error?e.message:'This creation could not be shared. Try again.');}
    finally{exporting.current=false;setBusy(null);}
  };

  const addAsset = async (item: LibraryEntry) => {
    if (!project || busy) return;
    setBusy(item.id);
    setError(null);
    try {
      const ext = item.remote ? item.remote.fileName.split('.').pop()! : item.kind==='audio' ? audioExtension(item.mimeType) : item.mimeType === 'image/jpeg' ? 'jpg' : item.mimeType === 'image/webp' ? 'webp' :
        item.kind === 'video' ? (item.mimeType === 'video/webm' ? 'webm' : 'mp4') : 'png';
      const source = item.remote ? await readRemoteAsset(item.remote) : item.uri;
      const name = item.remote ? item.remote.fileName : `library-${item.id}.${ext}`;
      await useChat.getState().attachFile(project, source, name, item.kind === 'image' || item.kind === 'video' || item.kind === 'audio' ? item.kind : undefined);
      setAdded(item.id);
    } catch (e) { setError(e instanceof Error ? e.message : 'The asset could not be added. Try again.'); }
    finally { setBusy(null); }
  };

  const addSprites = async () => {
    if (!project || busy || !spriteFrames.length) return;
    setBusy('sprite-atlas'); setError(null); setAdded(null);
    let imageSaved = false;
    try {
      const result = await exportRemoteSprites(spriteFrames);
      const imagePath = await useChat.getState().attachFile(project, result.png, 'sprite-atlas.png', 'image');
      imageSaved = true;
      result.metadata.meta.image = imagePath.split('/').pop()!;
      await useChat.getState().attachFile(project, new TextEncoder().encode(JSON.stringify(result.metadata, null, 2)), 'sprite-atlas.json');
      setAdded('sprite-atlas'); setSpriteMode(false); setSpriteFrames([]);
    } catch (e) {
      setError(imageSaved ? 'The atlas image was saved, but its frame data could not be saved. Try again to create a complete pair.' :
        e instanceof Error ? e.message : 'The sprite atlas could not be created.');
    } finally { setBusy(null); }
  };

  return (
    <View style={[styles.screen, { backgroundColor: theme.background }]}>
      <FlatList
        ref={listRef}
        data={page.items}
        keyExtractor={(item) => item.id}
        contentContainerStyle={[styles.content, inTab ? {paddingTop:insets.top + Spacing.four,paddingBottom:TAB_PILL_CLEARANCE + insets.bottom} : {paddingBottom:160 + insets.bottom}]}
        ListHeaderComponent={<View style={styles.intro} onLayout={event => {headerOffset.current = event.nativeEvent.layout.y;}}>
          {inTab ? <ThemedText type="heading">Library</ThemedText> : null}
          <ThemedText themeColor="textSecondary">
            {project ? `Add a creation to ${project.name}, then tell the builder how to use it.` : 'Choose a creation to use in a website, app or game.'}
          </ThemedText>
          <Button title={project ? `Project: ${project.name}` : 'Choose project'} variant="secondary" disabled={busy !== null} onPress={() => setChoosingProject((value) => !value)} />
          {choosingProject ? <View style={styles.intro}>
            {projects.map((choice) => <Button key={choice.id} title={`${choice.emoji} ${choice.name}`} variant="secondary" disabled={busy !== null} onPress={() => {setSelectedProjectId(choice.id);setChoosingProject(false);setAdded(null);}} />)}
            {!projects.length ? <Button title="Create a project" onPress={() => router.push('/new-project')} /> : null}
          </View> : null}
          <TextInput accessibilityLabel="Search creations" placeholder="Search creations" placeholderTextColor={theme.textSecondary}
            value={query} onChangeText={(value) => {setFocusedAsset(null);setQuery(value);}} maxLength={240} autoCorrect={false} returnKeyType="search"
            style={[styles.search, {color:theme.text, backgroundColor:theme.backgroundElement}]} />
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filters}>
            {([['all','All'],['image','Images'],['video','Video'],['audio','Audio'],['model','3D']] as const).map(([value,label]) =>
              <Pressable key={value} accessibilityRole="button" accessibilityLabel={`Filter ${label}`} accessibilityState={{selected:kind===value}}
                onPress={() => {setFocusedAsset(null);setKind(value);}} style={[styles.filter, {backgroundColor:kind===value ? theme.tintSoft : theme.backgroundElement}]}>
                <ThemedText type="smallBold" style={{color:kind===value ? theme.tint : theme.textSecondary}}>{label}</ThemedText>
              </Pressable>)}
          </ScrollView>
          <Button title={foldersOpen ? 'Hide folders' : folder ? `Folder: ${folder}` : 'Browse folders'} variant="secondary"
            accessibilityState={{expanded:foldersOpen}} onPress={() => setFoldersOpen(value => !value)} />
          {foldersOpen ? <View style={styles.intro}>
            <ThemedText type="smallBold">{folder || 'All folders'}</ThemedText>
            {folder ? <Button title="Back to parent folder" variant="secondary" onPress={() => setFolder(folder.split('/').slice(0,-1).join('/'))} /> : null}
            {childFolders.map(child => <Button key={child.path} title={`${child.label} (${child.count})`} variant="secondary"
              onPress={() => {setFolder(child.path);setFocusedAsset(null);setKind('all');setQuery('');}} />)}
            {folder ? <Button title="Show all folders" variant="secondary" onPress={() => setFolder('')} /> : null}
          </View> : null}
          {focusedAsset ? <View style={styles.intro}><ThemedText>Selected creation. Choose a project to use it in your website, app or game.</ThemedText><Button title="Show all creations" variant="secondary" onPress={() => {setFocusedAsset(null);setKind('all');setQuery('');setFolder('');}} /></View> : null}
          {serverUrl ? <SavedCollections key={`collections:${serverUrl}`} origin={serverUrl}/> : null}
          {serverUrl ? <LibraryUpload key={serverUrl} origin={serverUrl} onUploaded={()=>setRefreshVersion(value=>value+1)}/> : null}
          {!serverUrl ? <Button title="Connect a server library" variant="secondary" onPress={() => router.push('/connect-media-lab')} /> : null}
          {serverUrl ? <Button title={toolsOpen ? 'Hide creation tools' : 'Creation tools'} variant="secondary"
            accessibilityState={{expanded:toolsOpen}} onPress={() => setToolsOpen(value => !value)} /> : null}
          <View style={toolsOpen ? styles.intro : styles.hiddenTools} onLayout={event => {toolsOffset.current = event.nativeEvent.layout.y;}}>
          {serverUrl ? <View style={styles.intro}>
            <ThemedText type="heading">Background removal</ThemedText>
            <ThemedText themeColor="textSecondary">{backgroundEngine ? 'Remove an image background below, then use the transparent PNG in a project. Your original stays intact.' :
              backgroundError ?? 'No background-removal model is ready on this server. Complete its model setup first.'}</ThemedText>
            {backgroundError ? <Button title="Connect generation" variant="secondary" onPress={() => router.push({pathname:'/connect-media-lab',params:{url:serverUrl,generation:'1'}})} /> : null}
            {backgroundError && backgroundEngine ? <ThemedText accessibilityRole="alert">{backgroundError}</ThemedText> : null}
            {backgroundPollError ? <ThemedText accessibilityRole="alert">{backgroundPollError}</ThemedText> : null}
            {backgroundJobs.filter((record) => record.origin === libraryOrigin(serverUrl)).map((record) => <Glass key={record.requestId} style={styles.card}>
              <ThemedText numberOfLines={2}>{record.title || 'Image cutout'}</ThemedText>
              <ThemedText accessibilityLiveRegion="polite">{record.job?.status === 'succeeded' ? 'Ready to use' : record.job?.status === 'failed' ? 'The server could not finish this image.' :
                record.job?.status === 'cancelled' ? 'Cancelled' : record.cancelRequested ? 'Cancellation requested — reconnect if offline' :
                record.job?.status === 'running' ? 'Removing background on your server…' : record.job?.status === 'queued' ? 'Waiting for the server…' : 'Request saved — checking with server…'}</ThemedText>
              {record.job?.status === 'succeeded' ? <Button title={savedCutouts.includes(record.job!.id) ? 'Saved to Library' : 'Save cutout to Library'} variant="secondary" disabled={busy !== null || savedCutouts.includes(record.job!.id)} onPress={() => void saveCutout(record)} /> : null}
              {record.job?.status === 'succeeded' ? <Button title="Make 3D asset" variant="secondary" disabled={busy !== null} onPress={() => setModelSource({id:record.job!.id,serverUrl:record.origin,title:record.title})} /> : null}
              {record.job?.status === 'succeeded' ? <ResultPreview key={record.origin+record.job.id} origin={record.origin} id={record.job.id} /> : null}
              {record.job?.status === 'succeeded' ? <Button title={added === record.requestId ? 'Added to project' : project ? 'Use cutout in this project' : 'Choose a project'}
                disabled={busy !== null || added === record.requestId} loading={busy === record.requestId}
                onPress={() => project ? void importGeneration(record) : chooseProject()} /> :
                !record.job || !['failed','cancelled'].includes(record.job.status) ? <Button title="Cancel background removal" variant="secondary"
                  disabled={busy !== null || record.cancelRequested} onPress={() => void cancelBackground(record)} /> : null}
              {added === record.requestId && project ? <Button title="Open builder" variant="secondary" onPress={openBuilder} /> : null}
            </Glass>)}
          </View> : null}
          {serverUrl ? <View onLayout={event => {modelOffset.current = event.nativeEvent.layout.y;}}><ModelGeneration key={'model-'+serverUrl} origin={serverUrl} onConnect={() => router.push({pathname:'/connect-media-lab',params:{url:serverUrl,generation:'1'}})} onVisibleJobs={setVisibleModelJobs} source={modelSource?.serverUrl === serverUrl ? modelSource : null}
            disabled={busy !== null} projectSelected={Boolean(project)} addedId={added} onOpenBuilder={openBuilder} onChoose={chooseProject} onUse={record => void importGeneration(record)} /></View> : null}
          {serverUrl ? <SpeechGeneration key={'speech-'+serverUrl} origin={serverUrl} onConnect={() => router.push({pathname:'/connect-media-lab',params:{url:serverUrl,generation:'1'}})}
            disabled={busy !== null} projectSelected={Boolean(project)} addedId={added} onOpenBuilder={openBuilder} onChoose={chooseProject} onSaved={refresh}
            onUse={record => void importGeneration(record)} /> : null}
          {serverUrl ? <MusicGeneration key={'music-'+serverUrl} origin={serverUrl} onConnect={() => router.push({pathname:'/connect-media-lab',params:{url:serverUrl,generation:'1'}})}
            disabled={busy !== null} projectSelected={Boolean(project)} addedId={added} onOpenBuilder={openBuilder} onChoose={chooseProject} onSaved={refresh}
            onUse={record => void importGeneration(record)} /> : null}
          {serverUrl ? <VideoGeneration key={'video-'+serverUrl} origin={serverUrl} onConnect={() => router.push({pathname:'/connect-media-lab',params:{url:serverUrl,generation:'1'}})}
            disabled={busy !== null} projectSelected={Boolean(project)} addedId={added} onOpenBuilder={openBuilder} onChoose={chooseProject} onSaved={refresh}
            onUse={record => void importGeneration(record)} /> : null}
          {serverUrl ? <ImageGeneration key={'image-'+serverUrl} origin={serverUrl} onConnect={() => router.push({pathname:'/connect-media-lab',params:{url:serverUrl,generation:'1'}})}
            disabled={busy !== null} projectSelected={Boolean(project)} addedId={added} onOpenBuilder={openBuilder} onChoose={chooseProject} onSaved={refresh}
            onUse={record => void importGeneration(record)} /> : null}
          </View>
          {items.some((item) => item.remote?.mimeType === 'image/png') ? <Button title={spriteMode ? 'Cancel sprite selection' : 'Make a sprite atlas'} variant="secondary" disabled={busy !== null}
            onPress={() => {setSpriteMode(!spriteMode);setSpriteFrames([]);}} /> : null}
          {spriteMode ? <View style={styles.intro}>
            <ThemedText>Select server PNG frames in animation order. Transparent edges stay transparent; this does not remove backgrounds.</ThemedText>
            <ThemedText themeColor="textSecondary">{spriteFrames.length} frames selected. Remove and reselect a frame to change its order.</ThemedText>
            <Button title={project ? 'Add atlas and frame data to project' : 'Choose a project'} loading={busy === 'sprite-atlas'} disabled={busy !== null || (Boolean(project) && !spriteFrames.length)}
              onPress={() => project ? void addSprites() : chooseProject()} />
          </View> : null}
          {deviceError ? <ThemedText accessibilityRole="alert">{deviceError}</ThemedText> : null}
          {remoteError ? <View style={styles.intro}>
            <ThemedText accessibilityRole="alert">{remoteError}</ThemedText>
            <Button title="Connect server library" variant="secondary" onPress={() => router.push({pathname:'/connect-media-lab',params:{url:serverUrl}})} />
          </View> : null}
          {page.total>0?<ThemedText themeColor="textSecondary" accessibilityLiveRegion="polite">{page.first}–{page.last} of {page.total} creations{filtered?' matching your filters':''}. Search checks your whole Library.</ThemedText>:null}
          {error ? <ThemedText accessibilityRole="alert">{error}</ThemedText> : null}
          {added ? <View style={styles.intro}>
            <ThemedText accessibilityLiveRegion="polite">Saved a copy in your project. It will travel with your project when you share it.</ThemedText>
            {added === 'sprite-atlas' ? <Button title="Open builder" onPress={openBuilder} /> : null}
          </View> : null}
        </View>}
        ListEmptyComponent={loading ? <ActivityIndicator color={theme.tint} /> : serverUrl && !focusedAsset && !folder ? null : <View style={styles.intro}>
          <ThemedText>{focusedAsset ? 'This selected creation is unavailable. Refresh Library or choose another creation.' : filtered ? 'No Library items match these filters.' : serverUrl ? 'Check your server creations below, or create something new.' : 'No saved creations yet.'}</ThemedText>
          {filtered ? <Button title="Clear filters" onPress={() => {setFocusedAsset(null);setQuery('');setKind('all');setFolder('');}} /> :
            <Button title="Create something" onPress={() => router.push('/(tabs)/media-lab')} />}
        </View>}
        renderItem={({ item }) => <Glass style={styles.card}>
          {!item.remote&&item.kind==='audio'?<ChatAudioAttachment uri={item.uri}/>:item.remote ? <LibraryPreview key={`${item.remote.serverUrl}:${item.remote.id}:${item.remote.createdAt}`} asset={item.remote} /> : item.kind === 'image' && item.uri ? <Image source={{ uri: item.uri }} contentFit="contain" style={styles.image} accessibilityLabel={item.prompt || 'Generated image'} /> :
            <View style={styles.video}><ThemedText type="heading">{item.kind === 'model' ? '3D asset' : item.kind === 'audio' ? 'Audio' : item.kind === 'video' ? 'Video' : 'Image'}</ThemedText></View>}
          {item.remote && (item.kind==='audio'||item.kind==='video') ? <LibraryPlayback key={`${item.remote.serverUrl}:${item.remote.id}:${item.remote.bytes}`} asset={item.remote}/> : null}
          <ThemedText numberOfLines={3}>{item.prompt || 'Untitled creation'}</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">{item.remote ? 'Server · ' : 'This device · '}{item.providerLabel}{item.createdAt > 0 ? ` · ${new Date(item.createdAt).toLocaleDateString()}` : ''}</ThemedText>
          {spriteMode && item.remote?.mimeType === 'image/png' ? <Button variant="secondary"
            title={spriteFrames.some((frame) => frame.id === item.remote!.id) ? `Frame ${spriteFrames.findIndex((frame) => frame.id === item.remote!.id) + 1} — remove` : 'Select as next frame'}
            disabled={busy !== null || (spriteFrames.length >= 64 && !spriteFrames.some((frame) => frame.id === item.remote!.id))}
            onPress={() => setSpriteFrames((frames) => frames.some((frame) => frame.id === item.remote!.id) ? frames.filter((frame) => frame.id !== item.remote!.id) : [...frames,item.remote!])} /> : null}
          {item.remote&&['image','video','audio'].includes(item.kind)&&item.remote.bytes<=256*1024**2?<Button title="Edit in video editor" variant="secondary" disabled={busy!==null} onPress={()=>router.push({pathname:'/editor-new',params:{assetId:item.remote!.id,sourceOrigin:item.remote!.serverUrl}})}/>:null}
          {<Button title={Platform.OS==='web'?'Download file':'Save or share file'} variant="secondary" loading={busy==='export-'+item.id} disabled={busy!==null} onPress={()=>void exportAsset(item)}/>}
          {exportMessage&&exportId===item.id?<ThemedText accessibilityRole="alert">{exportMessage}</ThemedText>:null}
          {<Button title={!project ? 'Choose a project' : added === item.id ? 'Added to project' : 'Use in this project'} loading={busy === item.id} disabled={busy !== null || added === item.id} onPress={() => project ? void addAsset(item) : chooseProject()} />}
          {backgroundEngine && item.remote && ['image/png','image/jpeg','image/webp'].includes(item.remote.mimeType) ? <Button title="Remove background" variant="secondary"
            loading={busy === 'background-'+item.remote.id} disabled={busy !== null} onPress={() => void removeBackground(item.remote!)} /> : null}
          {added === item.id && project ? <Button title="Open builder" variant="secondary" onPress={openBuilder} /> : null}
        </Glass>}
        ListFooterComponent={<View style={styles.intro}>
          {page.pages>1?<View style={styles.intro}>
            <ThemedText>Page {page.page+1} of {page.pages}</ThemedText>
            <View style={{flexDirection:'row',flexWrap:'wrap',gap:8}}>
              <Button title="Previous page" variant="secondary" disabled={page.page===0||busy!==null} onPress={()=>changePage(page.page-1)}/>
              <Button title="Next page" variant="secondary" disabled={page.page===page.pages-1||busy!==null} onPress={()=>changePage(page.page+1)}/>
            </View>
          </View>:null}
          {serverUrl && !focusedAsset && !folder ? <GenerationHistory key={`${serverUrl}:${refreshVersion}`} origin={serverUrl}
            kindFilter={kind} queryFilter={query} libraryHasItems={visibleItems.length > 0} libraryUnavailable={loading || Boolean(remoteError) || Boolean(deviceError)}
            excludedIds={toolsOpen ? [...backgroundJobs.filter(record => record.origin === libraryOrigin(serverUrl)).flatMap(record => record.job ? [record.job.id] : []),
              ...(visibleModelJobs?.origin === serverUrl ? visibleModelJobs.ids : [])] : []}
            disabled={busy !== null} addedId={added} projectSelected={Boolean(project)} onChoose={chooseProject}
            onOpenBuilder={openBuilder}
            onMakeModel={job => {setToolsOpen(true);setModelSource({id:job.id,serverUrl,title:'Generated image '+new Date(job.createdAt).toLocaleString()});}}
            savedImageIds={savedCutouts} onSaveImage={job => void saveCutout({origin:serverUrl,requestId:job.id,job:{...job,kind:'image'}})}
            onUse={job => void importGeneration({origin:serverUrl,requestId:job.id,job})} /> : null}
          <Button title="Refresh library" variant="secondary" disabled={loading || busy !== null} onPress={() => void refresh()} />
        </View>}
      />
      <SparkyDirector project={project} inLibrary />
    </View>
  );
}
const styles = StyleSheet.create({
  screen: { flex: 1 },
  hiddenTools: {display: 'none'},
  search: {minHeight:48, borderRadius:14, paddingHorizontal:16, fontSize:16},
  filters: {gap:8},
  filter: {minHeight:44, paddingHorizontal:16, borderRadius:22, alignItems:'center', justifyContent:'center'},
  content: { padding: Spacing.four, gap: Spacing.four, maxWidth: 800, width: '100%', alignSelf: 'center', paddingBottom: 40 },
  intro: { gap: Spacing.three, marginBottom: Spacing.three },
  card: { padding: Spacing.three, gap: Spacing.three, borderRadius: 20, overflow: 'hidden' },
  image: { width: '100%', height: 200 },
  video: { height: 100, alignItems: 'center', justifyContent: 'center' },
});
