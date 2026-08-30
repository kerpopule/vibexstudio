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
import { ScalePress } from '@/components/ui/scale-press';
import { Radii, Shadows, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { canGenerateImages, canGenerateVideo } from '@/lib/ai/media';
import { providerGlyph } from '@/lib/ai/models';
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
  const serverActive = mediaLab != null && view === 'server';

  return (
    <ThemedView style={styles.container}>
      {serverActive ? <ServerView link={mediaLab} /> : <StudioView topInset={mediaLab ? 44 : 0} />}
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

function ServerView({ link }: { link: MediaLabLink }) {
  const theme = useTheme();
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
      <WebView
        source={{ uri: link.url }}
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
// On-device studio
// ---------------------------------------------------------------------------

type StudioRow = { type: 'job'; job: StudioJob } | { type: 'item'; item: GalleryItem };

function StudioView({ topInset }: { topInset: number }) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const providers = useApp((s) => s.providers);
  const { items, jobs, hydrated, hydrate, generate, retryJob, dismissJob, removeItem } =
    useMediaStudio();

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
                  : 'Describe the shot — Veo renders 5–8 seconds…'
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
            {mode === 'image' ? 'No image-capable AI connected yet' : 'Video needs Google Gemini (Veo)'}
          </ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            {mode === 'image'
              ? 'Connect Gemini, OpenAI, or Grok — an API key, or your SuperGrok / X Premium+ subscription.'
              : 'Add a Gemini API key and this switches on. Grok and OpenAI can still make images.'}
          </ThemedText>
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
        { paddingTop: insets.top + topInset + Spacing.three, paddingBottom: Spacing.five },
      ]}
      ListHeaderComponent={header}
      renderItem={({ item: row }) =>
        row.type === 'job' ? (
          <JobCell job={row.job} onRetry={() => retryJob(row.job.id)} onDismiss={() => dismissJob(row.job.id)} />
        ) : (
          <GalleryCell
            item={row.item}
            onPress={() => shareItem(row.item)}
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
  onPress,
  onLongPress,
}: {
  item: GalleryItem;
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
          <ThemedText type="smallBold" themeColor="tint">Tap to share / play</ThemedText>
        </View>
      )}
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
