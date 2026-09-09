import {StudioTemplates,type StudioTemplate} from '@/components/studio-templates';
import {StudioTools,STUDIO_TOOLS,type StudioTool} from '@/components/studio-tools';
import { Alert } from '@/lib/app-alert';
import { shareGalleryFile } from '@/lib/share/share-gallery';
/**
 * Create opens on the integrated provider controls. Existing server tools remain
 * available during migration; notification links still open their server job.
 * Provider inference is remote and must not be labeled as on-device execution.
 */
import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  useWindowDimensions,
  ActivityIndicator,
  FlatList,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { WebView } from 'react-native-webview';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Button } from '@/components/ui/button';
import { Glass } from '@/components/ui/glass';
import { TAB_PILL_CLEARANCE } from '@/components/ui/tab-pill';
import { ScalePress } from '@/components/ui/scale-press';
import { Radii, Shadows, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { falModelName, recommendedFalModel } from '@/lib/ai/fal-catalog';
import { canGenerateImages, canGenerateVideo } from '@/lib/ai/media';
import { providerGlyph } from '@/lib/ai/models';
import { probeMediaHost } from '@/lib/media-host-probe';
import { useCreationDraft, restoreCreationDraft, selectedCreationProvider } from '@/lib/creation-draft';
import { cutUrl, sendToCut } from '@/lib/medialab-cut';
import type { MediaLabLink } from '@/lib/storage/settings';
import { hasActiveCreation, useMediaStudio, type StudioJob } from '@/lib/media-studio';
import { useApp } from '@/lib/store';
import { useUiChrome } from '@/lib/ui-chrome';
import type { GalleryItem, ProviderConnection } from '@/lib/types';

// ---------------------------------------------------------------------------
// Tab shell: integrated creation and paired server tools
// ---------------------------------------------------------------------------

export default function MediaLabScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const mediaLab = useApp((s) => s.mediaLab);
  const setTabPillHidden = useUiChrome((s) => s.setTabPillHidden);
  const focusJob = useApp((s) => s.mediaLabFocusJob);
  const [view, setView] = useState<'server' | 'device'>(() => focusJob ? 'server' : 'device');
  // A page the on-device studio wants the server view to open (Cut, after an upload).
  const [serverPage, setServerPage] = useState<string | null>(null);
  useEffect(() => useApp.subscribe((state, previous) => {
    if (state.mediaLabFocusJob && state.mediaLabFocusJob !== previous.mediaLabFocusJob) {
      setServerPage(null);
      setView('server');
    }
  }), []);
  const [hostUi,setHostUi]=useState<{origin:string;available:boolean;editingDrafts?:boolean}|null>(null);
  const webInterface=hostUi?.origin===mediaLab?.url?hostUi?.available:undefined;
  const reportHostUi=useCallback((available:boolean)=>{
    if(mediaLab)setHostUi(previous=>({origin:mediaLab.url,available,editingDrafts:previous?.origin===mediaLab.url?previous.editingDrafts:undefined}));
  },[mediaLab]);
  useFocusEffect(useCallback(() => {
    let active = true;
    setHostUi(null);
    if (mediaLab) void probeMediaHost(mediaLab.url).then(host => {
      if (active && host) setHostUi({origin: mediaLab.url, available: host.webInterface, editingDrafts:host.editingDrafts});
    });
    return () => { active = false; };
  }, [mediaLab?.url]));
  const serverActive = mediaLab != null && view === 'server';
  const inCut = serverActive && /\/cut(\?|$)/.test(serverPage ?? '');
  const openServerPage = (url: string) => {
    setServerPage(url);
    setView('server');
  };

  // The paired studio brings its own bottom nav: while it is on screen the
  // VibeX tab pill steps aside, and "‹ Studio" up top is the way out.
  useFocusEffect(
    useCallback(() => {
      setTabPillHidden(serverActive && webInterface!==false);
      return () => setTabPillHidden(false);
    }, [serverActive, webInterface, setTabPillHidden])
  );

  const topRow = insets.top + Spacing.one;
  return (
    <ThemedView style={styles.container}>
      {/* Both views clear the floating top row: the studio pads its scroll
          content, the server view pushes the WebView down so the site's own
          header stays tappable. */}
      {serverActive ? (
        <ServerView key={mediaLab.url} onWebInterface={reportHostUi} link={mediaLab} topInset={insets.top + 52} page={serverPage} />
      ) : (
        <StudioView editingDrafts={hostUi?.origin===mediaLab?.url&&hostUi?.editingDrafts===true} serverWebsite={webInterface} topInset={mediaLab ? 52 : 0} onOpenServerPage={mediaLab ? openServerPage : undefined} />
      )}
      {mediaLab ? (
        <View pointerEvents="box-none" style={[styles.topRow, { top: topRow }]}>
          {serverActive ? (
            <Glass radius={Radii.pill} style={styles.topChip}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Back to VibeX Studio"
                onPress={() => router.navigate('/(tabs)')}
                hitSlop={8}
                style={styles.topChipInner}>
                <Ionicons name="chevron-back" size={16} color={theme.tint} />
                <ThemedText type="smallBold" style={{ color: theme.tint }}>Studio</ThemedText>
              </Pressable>
            </Glass>
          ) : (
            <View style={styles.topSpacer} />
          )}
          <Glass radius={Radii.xl} style={styles.switchPill}>
            {(['device', 'server'] as const).map((v) => {
              const active = view === v;
              return (
                <Pressable
                  key={v}
                  accessibilityRole="button"
                  accessibilityLabel={v === 'device' ? 'Create media' : 'More Media Lab tools'}
                  accessibilityState={{selected: active}}
                  onPress={() => setView(v)}
                  style={[styles.switchSeg, active && { backgroundColor: theme.tintSoft }]}>
                  <Ionicons
                    name={v === 'device' ? 'sparkles' : 'desktop-outline'}
                    size={13}
                    color={active ? theme.tint : theme.textSecondary}
                  />
                  <ThemedText type="smallBold" style={{ color: active ? theme.tint : theme.textSecondary }}>
                    {v === 'device' ? 'Create' : 'More tools'}
                  </ThemedText>
                </Pressable>
              );
            })}
          </Glass>
          {serverActive && webInterface===true ? (
            <Glass radius={Radii.pill} style={styles.topChip}>
              <Pressable
                accessibilityRole="button"
                onPress={() => setServerPage(inCut ? null : cutUrl(mediaLab))}
                hitSlop={8}
                style={styles.topChipInner}>
                <Ionicons name={inCut ? 'film-outline' : 'cut-outline'} size={15} color={theme.tint} />
                <ThemedText type="smallBold" style={{ color: theme.tint }}>{inCut ? 'Lab' : 'Cut'}</ThemedText>
              </Pressable>
            </Glass>
          ) : (
            <View style={styles.topSpacer} />
          )}
        </View>
      ) : null}
    </ThemedView>
  );
}

// ---------------------------------------------------------------------------
// Paired server: honor explicit website capability, preserve older hosts.
// ---------------------------------------------------------------------------

type Reach = 'checking' | 'up' | 'down';

function ServerView({
  link,
  topInset,
  page,
  onWebInterface,
}: {
  link: MediaLabLink;
  onWebInterface: (available:boolean)=>void;
  topInset: number;
  /** A specific page to show (Cut after an upload, or the Lab⇄Cut chip). */
  page: string | null;
}) {
  const theme = useTheme();
  const focusJob = useApp((s) => s.mediaLabFocusJob);
  const clearFocusJob = useApp((s) => s.setMediaLabFocusJob);
  // A tapped "finished" notification lands on that item: the server opens
  // ?job=<id> straight to the screening. Consume the focus once.
  const [focusUri] = useState(() =>
    focusJob ? `${link.url.replace(/\/+$/, '')}/?job=${encodeURIComponent(focusJob)}` : null
  );
  useEffect(() => {
    if (focusJob) clearFocusJob(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // Page precedence: an explicit page (Cut after an upload, or the chip)
  // beats the notification focus, which beats the studio home.
  const sourceUri = page ?? focusUri ?? link.url;
  const [reach, setReach] = useState<Reach>('checking');
  const [webInterface,setWebInterface]=useState(true);
  const checkedFor = useRef<string | null>(null);

  const check = useCallback(async () => {
    setReach('checking');
    const host=await probeMediaHost(link.url);
    if(host){setWebInterface(host.webInterface);onWebInterface(host.webInterface);}
    setReach(host?'up':'down');
  }, [link,onWebInterface]);

  useFocusEffect(
    useCallback(() => {
      // Re-probe when the tab gains focus with a new/changed server.
      if (checkedFor.current !== link.url) {
        checkedFor.current = link.url;
        check();
      }
    }, [link, check])
  );

  if (reach !== 'up') {
    return (
      <ThemedView style={styles.empty}>
        <View style={[styles.orb, { backgroundColor: theme.glowSoft }]}>
          <ThemedText style={styles.orbEmoji}>{reach === 'checking' ? '📡' : '🌙'}</ThemedText>
        </View>
        <ThemedText type="heading" style={styles.center}>
          {reach === 'checking' ? 'Reaching your Media Lab…' : 'Media Lab is unreachable'}
        </ThemedText>
        <ThemedText themeColor="textSecondary" type="small" style={[styles.center, styles.body]}>
          {reach === 'checking'
            ? link.url
            : `No answer from ${link.url}. Make sure the desktop app (or Spark) is running and you're on the same network or tailnet.`}
        </ThemedText>
        {reach === 'down' ? (
          <View style={styles.actions}>
            <Pressable onPress={check} hitSlop={8}>
              <ThemedText type="smallBold" themeColor="tint">Try again</ThemedText>
            </Pressable>
            <Pressable onPress={() => router.push('/connect-media-lab')} hitSlop={8}>
              <ThemedText type="smallBold" themeColor="textSecondary">Change server</ThemedText>
            </Pressable>
          </View>
        ) : null}
      </ThemedView>
    );
  }

  if(!webInterface)return <ThemedView style={styles.empty}>
    <ThemedText type="heading" style={styles.center}>Your server works inside Studio</ThemedText>
    <ThemedText style={[styles.center,styles.body]}>Open Library to find your creations, use available server tools, and check saved jobs. This server has no separate website.</ThemedText>
    <Button title="Open Library" onPress={()=>router.navigate('/(tabs)/creations')} />
  </ThemedView>;

  // react-native-webview has no web renderer — on web, hand off to the browser.
  if (Platform.OS === 'web') {
    return (
      <ThemedView style={styles.empty}>
        <ThemedText type="heading" style={styles.center}>Media Lab is up</ThemedText>
        <Pressable onPress={() => Linking.openURL(sourceUri)} hitSlop={8}>
          <ThemedText type="smallBold" themeColor="tint">Open in a new tab</ThemedText>
        </Pressable>
      </ThemedView>
    );
  }

  return (
    <View style={styles.container}>
      <View style={{ height: topInset }} />
      <WebView
        source={{ uri: sourceUri }}
        style={styles.web}
        allowsBackForwardNavigationGestures
        sharedCookiesEnabled
        mediaPlaybackRequiresUserAction={false}
      />
      <Pressable onPress={check} style={styles.reload} hitSlop={10}>
        <Ionicons name="refresh" size={16} color="#FFFFFF" />
      </Pressable>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Integrated creation
// ---------------------------------------------------------------------------

type StudioRow = { type: 'job'; job: StudioJob } | { type: 'item'; item: GalleryItem };

function StudioView({ topInset, onOpenServerPage, serverWebsite, editingDrafts }: { editingDrafts:boolean; serverWebsite?: boolean; topInset: number; onOpenServerPage?: (url: string) => void }) {
  const serverUrl = useApp((s) => s.mediaLab?.url);
  const {width}=useWindowDimensions();
  const wide=width>=1050;
  const [tool,setTool]=useState<StudioTool>(()=>{const task=useCreationDraft.getState().task;return task==='audio'?'song':task;});
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const providers = useApp((s) => s.providers);
  const mediaLab = useApp((s) => s.mediaLab);
  const { items, jobs, hydrated, hydrate, generate, retryJob, dismissJob, removeItem } =
    useMediaStudio();
  const [sending, setSending] = useState<string | null>(null);
  const [reviewing,setReviewing]=useState(false);
  const [choosingCreator,setChoosingCreator]=useState(false);
  const [restoringDraft, setRestoringDraft] = useState(true);

  const {task, drafts, storageError, setTask, setPrompt: updatePrompt, setProvider} = useCreationDraft();
  useEffect(()=>{setTool(previous=>task==='audio'?(previous==='image'||previous==='video'||previous==='game'?'song':previous):task);},[task]);
  const mode = task === 'video' ? 'video' : 'image';
  const {prompt, providerId: selectedId} = drafts[mode];
  const setPrompt = (value: string) => updatePrompt(mode, value);
  const setSelectedId = (value: string) => setProvider(mode, value);

  useEffect(() => {
    let active = true;
    void restoreCreationDraft().finally(() => {if (active) setRestoringDraft(false);});
    hydrate();
    return () => {active = false;};
  }, [hydrate]);

  const capable = useMemo(
    () => providers.filter(mode === 'image' ? canGenerateImages : canGenerateVideo),
    [providers, mode]
  );
  const selected = selectedCreationProvider(capable, selectedId);

  const sameCreationRunning = selected ? hasActiveCreation(jobs, mode, prompt, selected.id) : false;

  const rows: StudioRow[] = useMemo(
    () => [
      ...jobs.map((job) => ({ type: 'job' as const, job })),
      ...items.map((item) => ({ type: 'item' as const, item })),
    ],
    [jobs, items]
  );

  const submit = () => {
    if (restoringDraft || !selected || !prompt.trim()) return;
    generate(mode, prompt, selected, selectedId).catch(error => Alert.alert('Creation not started', error instanceof Error ? error.message : 'Could not start this creation. Try again.'));
  };

  const shareItem = async (item: GalleryItem) => {
    try {
      await shareGalleryFile(item);
    } catch {
      Alert.alert('Could not share', 'The saved media could not be opened for sharing. Try again from Library.');
    }
  };

  const openInCut = async (item: GalleryItem) => {
    if (!mediaLab || !onOpenServerPage) return;
    setSending(item.id);
    try {
      onOpenServerPage(await sendToCut(mediaLab, item));
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Could not send this to Cut.';
      if (Platform.OS === 'web') globalThis.alert?.(message);
      else Alert.alert('Couldn’t open in Cut', message);
    } finally {
      setSending(null);
    }
  };

  /** Tap = the item's menu: share, edit in Cut (when a Media Lab is paired), delete. */
  const itemMenu = (item: GalleryItem) => {
    const buttons: { text: string; style?: 'cancel' | 'destructive'; onPress?: () => void }[] = [
      { text: Platform.OS === 'web' ? 'Download' : 'Share', onPress: () => shareItem(item) },
    ];
    if (item.kind !== 'audio' && mediaLab && serverWebsite === true && onOpenServerPage) buttons.push({ text: '✂️ Edit in Cut', onPress: () => void openInCut(item) });
    buttons.push({ text: 'Delete', style: 'destructive', onPress: () => confirmDelete(item) });
    buttons.push({ text: 'Cancel', style: 'cancel' });
    Alert.alert(item.kind === 'audio' ? 'This audio' : item.kind === 'video' ? 'This video' : 'This image', item.prompt.slice(0, 120), buttons);
  };

  const confirmDismiss = (job: StudioJob) => {
    if(job.falRecovery){
      Alert.alert('Stop tracking this fal.ai job?', 'This removes the saved request from this device. It does not cancel work or charges at fal.ai. A result not yet saved to Library must be recovered through fal.ai.', [
        {text:'Keep tracking',style:'cancel'},
        {text:'Stop tracking',style:'destructive',onPress:()=>dismissJob(job.id)},
      ]);
      return;
    }
    if (job.retryAction !== 'save') {
      dismissJob(job.id);
      return;
    }
    Alert.alert(`Discard this unsaved ${job.kind}?`, 'This result has not been added to Library. Discarding loses it. Choose Retry save to keep it.', [
      {text: 'Keep result', style: 'cancel'},
      {text: 'Discard result', style: 'destructive', onPress: () => dismissJob(job.id)},
    ]);
  };

  const confirmDelete = (item: GalleryItem) => {
    const title = `Delete this ${item.kind}?`;
    Alert.alert(title, 'It only exists in this gallery. Deleting cannot be undone.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: async () => {
        try { await removeItem(item.id); }
        catch { Alert.alert('Could not delete', 'The item is still in your library. Try again when device storage is available.'); }
      } },
    ]);
  };

  const chooseTemplate=(template:StudioTemplate)=>{
    const apply=()=>{setReviewing(false);updatePrompt(template.kind,template.prompt);setTask(template.kind);setTool(template.kind);};
    if(useCreationDraft.getState().drafts[template.kind].prompt.trim()){
      Alert.alert('Replace this draft?',`Your ${template.kind} prompt already has text. Using this template replaces that prompt.`,[
        {text:'Keep my draft',style:'cancel'}, {text:'Use template',onPress:apply},
      ]);
    }else apply();
  };

  const header = (
    <View style={[styles.studioHeader,wide?{flexDirection:'row',alignItems:'flex-start',gap:28}:null]}>
      <StudioTools selected={tool} wide={wide} onSelect={value=>{setReviewing(false);setTool(value);if(value==='image'||value==='video'||value==='game')setTask(value);else setTask('audio');}} />
      <View style={{flex:1,width:wide?undefined:'100%',gap:12}}>
      {tool==='templates'?<StudioTemplates onChoose={chooseTemplate} disabled={restoringDraft||sameCreationRunning} />:null}
      {tool!=='image'&&tool!=='video'&&tool!=='game'&&tool!=='templates'?<View style={[styles.connectCard,{backgroundColor:theme.backgroundElement}]}>
        <ThemedText type="heading">{STUDIO_TOOLS.find(item=>item.id===tool)?.title}</ThemedText>
        {tool==='song'?<Button title="Make a song with my fal.ai key" onPress={()=>router.push('/song')} />:null}
        {tool==='song'&&serverUrl?<Button title="Compose on my server (experimental)" variant="secondary" onPress={()=>router.push('/library')} />:null}
        {editingDrafts&&(tool==='editor'||tool==='music-video')?<><ThemedText themeColor="textSecondary">{tool==='music-video'?'Choose a song and scenes from Library, then adjust timing, captions and audio in the editor.':'Arrange clips, trim, split, add captions and adjust audio. Preview and export when your server supports them.'}</ThemedText><Button title={tool==='music-video'?'Assemble a music video':'Open video editor'} onPress={()=>router.push({pathname:'/editor',params:tool==='music-video'?{intent:'music-video'}:{}})}/></>:serverWebsite === false ? <>
          <ThemedText themeColor="textSecondary">This server has no separate studio website. Its available tools and saved results are in Library. You can also connect a different Media Lab server.</ThemedText>
          <Button title="Open Library" onPress={()=>router.push('/library')} />
          <Button title="Change Media Lab server" variant="secondary" onPress={()=>router.push('/connect-media-lab')} />
        </> : <>
        <ThemedText themeColor="textSecondary">{tool==='editor'?'Open Cut to arrange clips and edit your video.':tool==='screenshot-song'?'In your server’s Music tools, choose screenshot songs, upload screenshots and review the extracted lyrics.':tool==='talking-head'?'Use your server’s Video tools to select a portrait, voice and script.':tool==='characters'?'Open Characters in your server studio to choose or create a cast.':tool==='music-video'?'In your server’s Music tools, choose a song and Make a music video to select scenes and performers.':'Open Music in your server studio to make songs and work with lyrics.'}</ThemedText>
        <ThemedText type="small" themeColor="textSecondary">These tools open your connected Media Lab. Available features depend on the engines and tools installed on that server.</ThemedText>
        <Button title={mediaLab?(tool==='editor'?'Open video editor':'Open connected server tools'):'Connect Media Lab'} onPress={()=>{if(mediaLab&&onOpenServerPage)onOpenServerPage(tool==='editor'?cutUrl(mediaLab):mediaLab.url);else router.push('/connect-media-lab');}} />
        </>}
      </View>:null}
      <ThemedText type="title">{tool==='image'?'Create an image':tool==='video'?'Create a video clip':tool==='game'?'Make game assets':'Your media workspace'}</ThemedText>
      {tool==='video'&&serverUrl?<Button title="Render a clip on my server (experimental)" variant="secondary" onPress={()=>router.push('/library')} />:null}
      {tool==='image'&&serverUrl?<Button title="Create an image on my server (experimental)" variant="secondary" onPress={()=>router.push('/library')} />:null}
      {storageError ? <ThemedText accessibilityRole="alert" style={{color:theme.danger}}>Drafts could not be saved on this device. Copy your prompt before leaving.</ThemedText> : null}
      <ThemedText type="small" themeColor="textSecondary">
        Choose what to make. Each task shows its available tools and where to start.
      </ThemedText>

      <Button title="Use something from Library" variant="secondary" onPress={() => router.push('/library')} />

      {task === 'audio' ? null : task === 'game' ? (
        <View style={[styles.connectCard, { backgroundColor: theme.backgroundElement }]}>
          <ThemedText type="smallBold">Start with an image</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            Use a saved image in Library to remove its background or assemble PNG frames into
            a sprite atlas. Select a Build project there to add your assets and frame data.
            Background removal requires a ready server engine.
          </ThemedText>
          <Button title="Choose an image in Library" onPress={() => router.push({pathname:'/library', params:{kind:'image'}})} />
          <Button title="Create a new image" variant="secondary" onPress={() => {setTask('image');setTool('image');}} />
          <ThemedText type="small" themeColor="textSecondary">
            Existing 3D models can be previewed and used from Library. One-click 3D generation
            is still being qualified and is not ready to install.
          </ThemedText>
        </View>
      ) : (
        <>
          {reviewing?<Glass radius={Radii.xl} style={{padding:20,gap:16}}>
            <ThemedText type="smallBold" themeColor="tint">02 · REVIEW & CREATE</ThemedText>
            <ThemedText type="heading">Your {mode==='image'?'image':'video clip'}</ThemedText>
            <ScrollView style={{maxHeight:180}}><ThemedText selectable>{prompt}</ThemedText></ScrollView>
            {selected?<View style={{gap:8}}>
              <ThemedText type="small" themeColor="textSecondary">Creating with {selected.label} · {engineLabel(selected,mode)}</ThemedText>
              <Button title={choosingCreator?'Hide creators':'Change creator'} variant="secondary" onPress={()=>setChoosingCreator(value=>!value)} />
            </View>:null}
            {choosingCreator||!selected?<>

          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            style={styles.providerBar}
            contentContainerStyle={styles.providerBarContent}>
            {capable.map((p) => (
              <ProviderChip
                key={p.id}
                provider={p}
                mode={mode}
                active={p.id === selected?.id}
                onPress={() => {setSelectedId(p.id);setChoosingCreator(false);}}
              />
            ))}
          </ScrollView>

          {selectedId && !selected && capable.length > 0 ? <ThemedText accessibilityRole="alert" style={{color:theme.danger}}>Your chosen creator is unavailable. Choose a creator above to continue with this prompt.</ThemedText> : null}
            </>:null}
            <Button title="Back to description" variant="secondary" onPress={()=>setReviewing(false)} />
            {selected?<Button title={sameCreationRunning?'Creation in progress…':mode==='image'?'Generate image':'Generate video'} onPress={submit} disabled={restoringDraft||sameCreationRunning||!prompt.trim()} />:null}
          </Glass>:<>
          {/* Prompt composer */}
          <Glass radius={Radii.xl} style={[styles.composer, Shadows.card]}>
            <ThemedText type="smallBold" themeColor="tint" style={{padding:12}}>01 · DESCRIBE</ThemedText>
            <TextInput
              style={[styles.input, { color: theme.text }]}
              placeholder={
                mode === 'image'
                  ? 'Describe the image — style, subject, mood…'
                  : 'Describe the shot — you get a few seconds of video…'
              }
              placeholderTextColor={theme.textSecondary}
              accessibilityLabel={mode === 'image' ? 'Image prompt' : 'Video prompt'}
              value={prompt}
              onChangeText={setPrompt}
              multiline
              maxLength={4000}
            />
            <Button
              title="Continue to review"
              onPress={()=>setReviewing(true)}
              disabled={restoringDraft || !prompt.trim()}
              style={styles.generateBtn}
            />
          </Glass>
          </>}
          {reviewing && capable.length === 0 ? (
        <View style={[styles.connectCard, { backgroundColor: theme.backgroundElement }, Shadows.card]}>
          <ThemedText type="smallBold">
            {mode === 'image' ? 'Connect an image creator' : 'Connect a video creator'}
          </ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            Connect a provider that supports this format. For background removal, sprites and
            3D assets from your server, start with an image in Library.
          </ThemedText>
          <Button
            title="Choose how to create"
            onPress={() => router.push('/media-lab-setup')}
            style={styles.setupBtn}
          />
          <View style={styles.actions}>
            <Pressable onPress={() => router.push('/connect-provider')} hitSlop={8}>
              <ThemedText type="smallBold" themeColor="tint">Add a provider</ThemedText>
            </Pressable>
            <Pressable onPress={() => router.push('/connect-subscription')} hitSlop={8}>
              <ThemedText type="smallBold" themeColor="tint">Use a subscription</ThemedText>
            </Pressable>
          </View>
        </View>
          ) : null}
        </>
      )}
      </View>
    </View>
  );

  return (
    <FlatList
      data={rows}
      keyExtractor={(row) => (row.type === 'job' ? row.job.id : row.item.id)}
      key={wide?'desktop':'mobile'}
      numColumns={wide?4:2}
      keyboardShouldPersistTaps="handled"
      columnWrapperStyle={styles.galleryRow}
      contentContainerStyle={[
        styles.gallery,
        { paddingTop: insets.top + topInset + Spacing.three, paddingBottom: TAB_PILL_CLEARANCE },
      ]}
      ListHeaderComponent={header}
      renderItem={({ item: row }) =>
        row.type === 'job' ? (
          <JobCell job={row.job} onRetry={() => retryJob(row.job.id)} onDismiss={() => confirmDismiss(row.job)} />
        ) : (
          <GalleryCell
            item={row.item}
            busy={sending === row.item.id}
            onPress={() => itemMenu(row.item)}
            onLongPress={() => confirmDelete(row.item)}
          />
        )
      }
      ListEmptyComponent={
        hydrated ? (
          <ThemedText type="small" themeColor="textSecondary" style={styles.center}>
            Everything you generate lands here — and stays after a relaunch.
          </ThemedText>
        ) : null
      }
    />
  );
}

function ProviderChip({
  provider,
  mode,
  active,
  onPress,
}: {
  provider: ProviderConnection;
  mode: 'image' | 'video';
  active: boolean;
  onPress: () => void;
}) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button" accessibilityLabel={`Use ${provider.label} · ${engineLabel(provider,mode)}`} accessibilityState={{selected:active}}
      onPress={onPress}
      style={[
        styles.providerChip,
        {
          backgroundColor: active ? theme.tintSoft : theme.backgroundElement,
          borderColor: active ? theme.tint : 'transparent',
        },
      ]}>
      <ThemedText type="small">{providerGlyph(provider)}</ThemedText>
      <ThemedText type="small" numberOfLines={1} style={active ? { color: theme.tint } : undefined}>
        {engineLabel(provider, mode)}
      </ThemedText>
    </Pressable>
  );
}

/** Short engine label for the picker chips (the image/video model, not chat). */
function engineLabel(p: ProviderConnection, mode: 'image' | 'video'): string {
  if (p.kind === 'fal') {
    // Recommended-first: an unset choice shows (and uses) the catalog default.
    const model = p.mediaModels?.[mode] || recommendedFalModel(mode);
    return falModelName(model);
  }
  if (mode === 'video') return 'Veo';
  if (p.subscription === 'xai-oauth' || p.kind === 'xai') return 'Grok Imagine';
  if (p.kind === 'openai') return 'GPT Image';
  if (p.kind === 'gemini') return 'Gemini Image';
  return p.label;
}

// ---------------------------------------------------------------------------
// Gallery cells
// ---------------------------------------------------------------------------

function GalleryCell({
  item,
  busy,
  onPress,
  onLongPress,
}: {
  item: GalleryItem;
  busy?: boolean;
  onPress: () => void;
  onLongPress: () => void;
}) {
  const theme = useTheme();
  return (
    <View style={[styles.cell, { backgroundColor: theme.backgroundElement }, Shadows.card]}>
    <ScalePress
      onPress={onPress}
      onLongPress={onLongPress}>
      {item.kind === 'image' ? (
        <Image source={{ uri: item.uri }} style={styles.cellImage} contentFit="cover" transition={180} />
      ) : (
        <View style={[styles.cellPoster, { backgroundColor: theme.tintSoft }]}>
          <ThemedText style={styles.posterEmoji}>{item.kind==='audio'?'🎵':'🎬'}</ThemedText>
          <ThemedText type="small" themeColor="textSecondary" numberOfLines={2} style={styles.center}>
            {item.prompt}
          </ThemedText>
          <ThemedText type="smallBold" themeColor="tint">Tap for options</ThemedText>
        </View>
      )}
      {busy ? (
        <View style={styles.cellBusy}>
          <ActivityIndicator color="#FFFFFF" />
          <ThemedText type="smallBold" style={{ color: '#FFFFFF' }}>Sending to Cut…</ThemedText>
        </View>
      ) : null}
      <View style={styles.cellMeta}>
        <ThemedText type="small" numberOfLines={1}>{item.prompt}</ThemedText>
        <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
          {item.providerLabel}
        </ThemedText>
      </View>
    </ScalePress>
    <Button title="Use in project" variant="secondary" disabled={busy}
      accessibilityLabel={`Use ${item.prompt.slice(0, 80) || item.kind} in a project`}
      onPress={() => router.push({pathname:'/library', params:{assetId:`device-${item.id}`}})} />
    </View>
  );
}

function JobCell({ job, onRetry, onDismiss }: { job: StudioJob; onRetry: () => void; onDismiss: () => void }) {
  const theme = useTheme();
  if (job.status === 'error') {
    return (
      <View style={[styles.cell, styles.jobCell, { backgroundColor: theme.backgroundElement }, Shadows.card]}>
        <ThemedText style={styles.posterEmoji}>😵‍💫</ThemedText>
        <ThemedText type="small" style={{ color: theme.danger }}>
          {job.error}
        </ThemedText>
        <View style={styles.actions}>
          <Pressable accessibilityRole="button" onPress={job.retryAction==='review'?()=>{void Linking.openURL('https://fal.ai/dashboard').catch(()=>Alert.alert('Could not open fal.ai','Open fal.ai in your browser and check your queue before creating another job.'));}:onRetry} hitSlop={8}>
            <ThemedText type="smallBold" themeColor="tint">{job.retryAction === 'save' ? 'Retry save' : job.retryAction==='resume'?'Resume job':job.retryAction==='review'?'Check fal.ai':'Retry'}</ThemedText>
          </Pressable>
          <Pressable accessibilityRole="button" onPress={onDismiss} hitSlop={8}>
            <ThemedText type="smallBold" themeColor="textSecondary">{job.falRecovery?'Stop tracking':job.retryAction === 'save' ? 'Discard result' : 'Dismiss'}</ThemedText>
          </Pressable>
        </View>
      </View>
    );
  }
  return (
    <View style={[styles.cell, styles.jobCell, { backgroundColor: theme.backgroundElement }, Shadows.card]}>
      <ActivityIndicator color={theme.tint} />
      <ThemedText type="small" numberOfLines={2} style={styles.center}>
        {job.prompt}
      </ThemedText>
      <ThemedText type="small" themeColor="textSecondary" numberOfLines={2} style={styles.center}>
        {job.detail}
      </ThemedText>
    </View>
  );
}

// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  web: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  reload: {
    position: 'absolute',
    top: Spacing.five + Spacing.three + 44,
    right: Spacing.three,
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.32)',
  },
  topRow: {
    position: 'absolute',
    left: Spacing.two,
    right: Spacing.two,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  topSpacer: { width: 88 },
  topChip: { minWidth: 88 },
  topChipInner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  cellBusy: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  switchPill: {
    flexDirection: 'row',
    padding: 3,
    gap: 2,
  },
  switchSeg: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: Spacing.two,
    paddingVertical: 6,
    borderRadius: Radii.lg,
  },
  empty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.three,
    padding: Spacing.five,
  },
  orb: {
    width: 116,
    height: 116,
    borderRadius: 58,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: Spacing.two,
  },
  orbEmoji: {
    fontSize: 52,
    lineHeight: 60,
  },
  center: {
    textAlign: 'center',
  },
  body: {
    maxWidth: 300,
  },
  actions: {
    flexDirection: 'row',
    gap: Spacing.four,
    marginTop: Spacing.one,
  },
  studioHeader: {
    gap: Spacing.two,
    marginBottom: Spacing.three,
  },
  modeRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.one,
    marginTop: Spacing.one,
  },
  modeChip: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: Spacing.two,
    paddingVertical: 8,
    borderRadius: Radii.lg,
    borderWidth: 1,
  },
  providerBar: {
    flexGrow: 0,
  },
  providerBarContent: {
    gap: Spacing.one,
  },
  providerChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: Spacing.two,
    paddingVertical: 7,
    borderRadius: Radii.lg,
    borderWidth: 1,
    maxWidth: 220,
  },
  composer: {
    padding: Spacing.two,
    gap: Spacing.two,
  },
  input: {
    minHeight: 64,
    maxHeight: 140,
    fontSize: 16,
    textAlignVertical: 'top',
    paddingHorizontal: Spacing.one,
  },
  generateBtn: {
    alignSelf: 'stretch',
  },
  connectCard: {
    borderRadius: Radii.lg,
    padding: Spacing.three,
    gap: Spacing.one,
  },
  setupBtn: {
    marginTop: Spacing.one,
  },
  gallery: {
    width: '100%',
    maxWidth: 1440,
    alignSelf: 'center',
    paddingHorizontal: Spacing.three,
    gap: Spacing.two,
  },
  galleryRow: {
    gap: Spacing.two,
  },
  cell: {
    flex: 1,
    borderRadius: Radii.lg,
    overflow: 'hidden',
  },
  cellImage: {
    width: '100%',
    aspectRatio: 1,
  },
  cellPoster: {
    width: '100%',
    aspectRatio: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.one,
    padding: Spacing.two,
  },
  posterEmoji: {
    fontSize: 34,
    lineHeight: 42,
  },
  jobCell: {
    aspectRatio: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.one,
    padding: Spacing.two,
  },
  cellMeta: {
    padding: Spacing.two,
    gap: 2,
  },
});
