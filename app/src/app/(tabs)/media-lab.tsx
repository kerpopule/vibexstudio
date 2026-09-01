/**
 * Media Lab tab — a one-stop creation surface that always exists:
 *
 *  - "On device": a native studio that generates images/video straight from
 *    the user's connected providers (Gemini, OpenAI, Grok — API key or
 *    subscription OAuth) into a persistent gallery. No server needed.
 *  - "Server": when a Media Lab server is paired (desktop app or a Spark),
 *    the original full web UI in a WebView, unchanged.
 *
 * A floating glass pill switches between the two when a server is paired.
 * Generation itself runs in src/lib/media-studio.ts (engine, not component),
 * sharing the chat engine's FIFO turn slots and notification pattern.
 */
import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import { router, useFocusEffect } from 'expo-router';
import * as Sharing from 'expo-sharing';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
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
import { cutUrl, sendToCut } from '@/lib/medialab-cut';
import type { MediaLabLink } from '@/lib/storage/settings';
import { useMediaStudio, type StudioJob } from '@/lib/media-studio';
import { useApp } from '@/lib/store';
import type { GalleryItem, ProviderConnection } from '@/lib/types';

// ---------------------------------------------------------------------------
// Tab shell: on-device studio ⇄ paired server
// ---------------------------------------------------------------------------

export default function MediaLabScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const mediaLab = useApp((s) => s.mediaLab);
  const [view, setView] = useState<'server' | 'device'>('server');
  // A page the on-device studio wants the server view to open (Cut, after an upload).
  const [serverPage, setServerPage] = useState<string | null>(null);
  const serverActive = mediaLab != null && view === 'server';
  const openServerPage = (url: string) => {
    setServerPage(url);
    setView('server');
  };

  return (
    <ThemedView style={styles.container}>
      {/* When the switch pill floats over the top, both views clear it:
          the studio pads its scroll content, the server view pushes the
          whole WebView down so the site's own header stays tappable. */}
      {serverActive ? (
        <ServerView link={mediaLab} topInset={insets.top + 52} page={serverPage} onNavigate={setServerPage} />
      ) : (
        <StudioView topInset={mediaLab ? 52 : 0} onOpenServerPage={mediaLab ? openServerPage : undefined} />
      )}
      {mediaLab ? (
        <Glass radius={Radii.xl} style={[styles.switchPill, { top: insets.top + Spacing.one }]}>
          {(['device', 'server'] as const).map((v) => {
            const active = view === v;
            return (
              <Pressable
                key={v}
                onPress={() => setView(v)}
                style={[styles.switchSeg, active && { backgroundColor: theme.tintSoft }]}>
                <Ionicons
                  name={v === 'device' ? 'sparkles' : 'desktop-outline'}
                  size={13}
                  color={active ? theme.tint : theme.textSecondary}
                />
                <ThemedText type="smallBold" style={{ color: active ? theme.tint : theme.textSecondary }}>
                  {v === 'device' ? 'On device' : 'Server'}
                </ThemedText>
              </Pressable>
            );
          })}
        </Glass>
      ) : null}
    </ThemedView>
  );
}

// ---------------------------------------------------------------------------
// Paired server (the original behavior, unchanged)
// ---------------------------------------------------------------------------

type Reach = 'checking' | 'up' | 'down';

/** /manifest.json is gate-exempt on Media Lab — the cheapest liveness probe. */
async function probe(url: string): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 4000);
    const res = await fetch(`${url.replace(/\/+$/, '')}/manifest.json`, { signal: controller.signal });
    clearTimeout(timer);
    return res.ok;
  } catch {
    return false;
  }
}

function ServerView({
  link,
  topInset,
  page,
  onNavigate,
}: {
  link: MediaLabLink;
  topInset: number;
  /** A specific page to show (Cut after an upload, or the Studio⇄Cut chip). */
  page: string | null;
  onNavigate: (url: string | null) => void;
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
  const inCut = /\/cut(\?|$)/.test(sourceUri);
  const setUri = onNavigate;
  const [reach, setReach] = useState<Reach>('checking');
  const checkedFor = useRef<string | null>(null);

  const check = useCallback(async () => {
    setReach('checking');
    setReach((await probe(link.url)) ? 'up' : 'down');
  }, [link]);

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

  // react-native-webview has no web renderer — on web, hand off to the browser.
  if (Platform.OS === 'web') {
    return (
      <ThemedView style={styles.empty}>
        <ThemedText type="heading" style={styles.center}>Media Lab is up</ThemedText>
        <Pressable onPress={() => Linking.openURL(link.url)} hitSlop={8}>
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
      {/* Studio ⇄ Cut: the editor is one tap from anywhere in the server view. */}
      <Glass radius={Radii.pill} style={styles.cutChip}>
        <Pressable
          onPress={() => setUri(inCut ? null : cutUrl(link))}
          hitSlop={8}
          style={styles.cutChipInner}>
          <Ionicons name={inCut ? 'film-outline' : 'cut-outline'} size={14} color={theme.tint} />
          <ThemedText type="smallBold" style={{ color: theme.tint }}>{inCut ? 'Studio' : 'Cut'}</ThemedText>
        </Pressable>
      </Glass>
    </View>
  );
}

// ---------------------------------------------------------------------------
// On-device studio
// ---------------------------------------------------------------------------

type StudioRow = { type: 'job'; job: StudioJob } | { type: 'item'; item: GalleryItem };

function StudioView({ topInset, onOpenServerPage }: { topInset: number; onOpenServerPage?: (url: string) => void }) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const providers = useApp((s) => s.providers);
  const mediaLab = useApp((s) => s.mediaLab);
  const { items, jobs, hydrated, hydrate, generate, retryJob, dismissJob, removeItem } =
    useMediaStudio();
  const [sending, setSending] = useState<string | null>(null);

  const [mode, setMode] = useState<'image' | 'video'>('image');
  const [prompt, setPrompt] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    hydrate();
  }, [hydrate]);

  const capable = useMemo(
    () => providers.filter(mode === 'image' ? canGenerateImages : canGenerateVideo),
    [providers, mode]
  );
  const selected = capable.find((p) => p.id === selectedId) ?? capable[0] ?? null;

  const rows: StudioRow[] = useMemo(
    () => [
      ...jobs.map((job) => ({ type: 'job' as const, job })),
      ...items.map((item) => ({ type: 'item' as const, item })),
    ],
    [jobs, items]
  );

  const submit = () => {
    if (!selected || !prompt.trim()) return;
    generate(mode, prompt, selected).catch(() => {});
    setPrompt('');
  };

  const shareItem = async (item: GalleryItem) => {
    try {
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(item.uri, { mimeType: item.mimeType });
      }
    } catch {
      // User dismissed the sheet, or sharing is unsupported here (web).
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
    if (Platform.OS === 'web') {
      shareItem(item);
      return;
    }
    const buttons: { text: string; style?: 'cancel' | 'destructive'; onPress?: () => void }[] = [
      { text: 'Share', onPress: () => shareItem(item) },
    ];
    if (mediaLab && onOpenServerPage) buttons.push({ text: '✂️ Edit in Cut', onPress: () => void openInCut(item) });
    buttons.push({ text: 'Delete', style: 'destructive', onPress: () => confirmDelete(item) });
    buttons.push({ text: 'Cancel', style: 'cancel' });
    Alert.alert(item.kind === 'video' ? 'This video' : 'This image', item.prompt.slice(0, 120), buttons);
  };

  const confirmDelete = (item: GalleryItem) => {
    const title = `Delete this ${item.kind}?`;
    if (Platform.OS === 'web') {
      // RN-web's Alert has no buttons; use the browser's confirm dialog.
      if (globalThis.confirm?.(title)) removeItem(item.id);
      return;
    }
    Alert.alert(title, 'It only exists in this gallery. Deleting cannot be undone.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => removeItem(item.id) },
    ]);
  };

  const header = (
    <View style={styles.studioHeader}>
      <ThemedText type="title">Media Lab</ThemedText>
      <ThemedText type="small" themeColor="textSecondary">
        Generate images and video right here, with the AI you already connected.
      </ThemedText>

      {/* Image / Video mode toggle */}
      <View style={styles.modeRow}>
        {(['image', 'video'] as const).map((m) => {
          const active = mode === m;
          return (
            <ScalePress
              key={m}
              onPress={() => setMode(m)}
              style={[
                styles.modeChip,
                {
                  backgroundColor: active ? theme.tintSoft : theme.backgroundElement,
                  borderColor: active ? theme.tint : 'transparent',
                },
              ]}>
              <Ionicons
                name={m === 'image' ? 'image' : 'videocam'}
                size={15}
                color={active ? theme.tint : theme.textSecondary}
              />
              <ThemedText type="smallBold" style={active ? { color: theme.tint } : undefined}>
                {m === 'image' ? 'Image' : 'Video'}
              </ThemedText>
            </ScalePress>
          );
        })}
      </View>

      {capable.length > 0 ? (
        <>
          {/* Provider/engine picker */}
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
                onPress={() => setSelectedId(p.id)}
              />
            ))}
          </ScrollView>

          {/* Prompt composer */}
          <Glass radius={Radii.xl} style={[styles.composer, Shadows.card]}>
            <TextInput
              style={[styles.input, { color: theme.text }]}
              placeholder={
                mode === 'image'
                  ? 'Describe the image — style, subject, mood…'
                  : 'Describe the shot — you get a few seconds of video…'
              }
              placeholderTextColor={theme.textSecondary}
              value={prompt}
              onChangeText={setPrompt}
              multiline
              maxLength={4000}
            />
            <Button
              title={mode === 'image' ? '✨ Generate image' : '🎬 Generate video'}
              onPress={submit}
              disabled={!prompt.trim()}
              style={styles.generateBtn}
            />
          </Glass>
        </>
      ) : (
        <View style={[styles.connectCard, { backgroundColor: theme.backgroundElement }, Shadows.card]}>
          <ThemedText type="smallBold">
            {mode === 'image' ? 'Nothing can make images yet' : 'Nothing can make video yet'}
          </ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            Pick how you want to create — this device alone works great, and there are upgrades when
            you want them.
          </ThemedText>
          <Button
            title="Set up Media Lab"
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
      )}
    </View>
  );

  return (
    <FlatList
      data={rows}
      keyExtractor={(row) => (row.type === 'job' ? row.job.id : row.item.id)}
      numColumns={2}
      keyboardShouldPersistTaps="handled"
      columnWrapperStyle={styles.galleryRow}
      contentContainerStyle={[
        styles.gallery,
        { paddingTop: insets.top + topInset + Spacing.three, paddingBottom: TAB_PILL_CLEARANCE },
      ]}
      ListHeaderComponent={header}
      renderItem={({ item: row }) =>
        row.type === 'job' ? (
          <JobCell job={row.job} onRetry={() => retryJob(row.job.id)} onDismiss={() => dismissJob(row.job.id)} />
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
    <ScalePress
      onPress={onPress}
      onLongPress={onLongPress}
      style={[styles.cell, { backgroundColor: theme.backgroundElement }, Shadows.card]}>
      {item.kind === 'image' ? (
        <Image source={{ uri: item.uri }} style={styles.cellImage} contentFit="cover" transition={180} />
      ) : (
        <View style={[styles.cellPoster, { backgroundColor: theme.tintSoft }]}>
          <ThemedText style={styles.posterEmoji}>🎬</ThemedText>
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
  );
}

function JobCell({ job, onRetry, onDismiss }: { job: StudioJob; onRetry: () => void; onDismiss: () => void }) {
  const theme = useTheme();
  if (job.status === 'error') {
    return (
      <View style={[styles.cell, styles.jobCell, { backgroundColor: theme.backgroundElement }, Shadows.card]}>
        <ThemedText style={styles.posterEmoji}>😵‍💫</ThemedText>
        <ThemedText type="small" style={{ color: theme.danger }} numberOfLines={4}>
          {job.error}
        </ThemedText>
        <View style={styles.actions}>
          <Pressable onPress={onRetry} hitSlop={8}>
            <ThemedText type="smallBold" themeColor="tint">Retry</ThemedText>
          </Pressable>
          <Pressable onPress={onDismiss} hitSlop={8}>
            <ThemedText type="smallBold" themeColor="textSecondary">Dismiss</ThemedText>
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
    top: Spacing.five + Spacing.three,
    right: Spacing.three,
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.32)',
  },
  cutChip: {
    position: 'absolute',
    right: Spacing.three,
    bottom: TAB_PILL_CLEARANCE + 6,
  },
  cutChipInner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  cellBusy: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  switchPill: {
    position: 'absolute',
    alignSelf: 'center',
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
    gap: Spacing.one,
    marginTop: Spacing.one,
  },
  modeChip: {
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
