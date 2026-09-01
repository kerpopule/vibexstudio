/**
 * Templates — a fully NATIVE Refero styles gallery. No WebView anywhere:
 *
 *  - Browse: category chips + a two-column grid of static thumbnails parsed
 *    from Refero's server-rendered pages (~160 styles across 7 categories).
 *  - Detail: the style's real preview video (tap to play), title, and
 *    "Use this design" — powered by the complete DESIGN.md the page embeds,
 *    fetched directly. Richer capture than the old in-page scrape, and
 *    immune to the WKWebView cold-start fragility that kept breaking this
 *    tab.
 */
import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import { router, useLocalSearchParams } from 'expo-router';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Linking,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Button } from '@/components/ui/button';
import { Glass } from '@/components/ui/glass';
import { EmojiTile } from '@/components/ui/emoji-tile';
import { Radii, Shadows, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useChat } from '@/lib/chat-engine';
import {
  fetchReferoCategory,
  fetchReferoStyleDetail,
  REFERO_CATEGORIES,
  type ReferoCategory,
  type ReferoStyleCard,
  type ReferoStyleDetail,
} from './refero-catalog';
import {
  buildDesignReferenceFromCapture,
  completeExistingProjectDesignHandoff,
  resolveTemplateSelectionDestination,
} from './references';
import { useApp } from '@/lib/store';
import type { DesignReference } from '@/lib/types';

export default function TemplatesScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { projectId } = useLocalSearchParams<{ projectId?: string }>();
  const projects = useApp((state) => state.projects);
  const setPendingDesignReference = useApp((state) => state.setPendingDesignReference);
  const setProjectDesignReference = useApp((state) => state.setProjectDesignReference);

  const [category, setCategory] = useState<ReferoCategory>(REFERO_CATEGORIES[0]);
  const [cardsBySlug, setCardsBySlug] = useState<Record<string, ReferoStyleCard[]>>({});
  const [gridLoading, setGridLoading] = useState(false);
  const [gridError, setGridError] = useState<string | null>(null);

  const [selected, setSelected] = useState<ReferoStyleCard | null>(null);
  const [detail, setDetail] = useState<ReferoStyleDetail | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);

  const [pendingChoice, setPendingChoice] = useState<DesignReference | null>(null);

  const cards = cardsBySlug[category.slug] ?? [];
  const sortedProjects = useMemo(
    () => [...projects].sort((a, b) => b.updatedAt - a.updatedAt),
    [projects]
  );

  const loadCategory = async (target: ReferoCategory, force = false) => {
    if (!force && cardsBySlug[target.slug]?.length) return;
    setGridLoading(true);
    setGridError(null);
    try {
      const fresh = await fetchReferoCategory(target);
      setCardsBySlug((prev) => ({ ...prev, [target.slug]: fresh }));
    } catch (e) {
      setGridError(e instanceof Error ? e.message : 'Could not reach Refero.');
    } finally {
      setGridLoading(false);
    }
  };

  useEffect(() => {
    const kick = setTimeout(() => loadCategory(REFERO_CATEGORIES[0]), 0);
    return () => clearTimeout(kick);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const openCard = async (card: ReferoStyleCard) => {
    setSelected(card);
    setDetail(null);
    setDetailError(null);
    try {
      setDetail(await fetchReferoStyleDetail(card.url));
    } catch (e) {
      setDetailError(e instanceof Error ? e.message : 'Could not load this style.');
    }
  };

  const closeDetail = () => {
    setSelected(null);
    setDetail(null);
    setDetailError(null);
  };

  const chooseDesign = () => {
    if (!selected || !detail) return;
    try {
      const reference = buildDesignReferenceFromCapture(selected.url, {
        title: detail.title,
        previewImageUrl: detail.image ?? selected.image,
        designText: detail.designMd,
      });
      if (projectId) {
        void attachToProject(projectId, reference);
      } else {
        setPendingChoice(reference);
      }
    } catch (error) {
      Alert.alert('This style is not selectable', error instanceof Error ? error.message : String(error));
    }
  };

  const attachToProject = async (id: string, reference: DesignReference) => {
    try {
      await completeExistingProjectDesignHandoff(id, reference, {
        persistDesignAndAppendHandoff: setProjectDesignReference,
        reloadChat: (projectIdToReload) => useChat.getState().reload(projectIdToReload),
        routeToProject: (destination) => {
          setPendingChoice(null);
          setTimeout(() => router.replace({ pathname: destination.pathname, params: destination.params }), 350);
        },
      });
    } catch (error) {
      Alert.alert('Could not attach design', error instanceof Error ? error.message : String(error));
    }
  };

  const startNewProject = (reference: DesignReference) => {
    setPendingDesignReference(reference);
    setPendingChoice(null);
    const destination = resolveTemplateSelectionDestination();
    // Navigating while the sheet is mid-dismiss gets swallowed on iOS —
    // let the modal finish closing first.
    setTimeout(() => router.push(destination.pathname), 350);
  };

  return (
    <ThemedView style={styles.screen}>
      <View style={[styles.header, { paddingTop: insets.top + Spacing.two }]}>
        <View style={styles.headerCopy}>
          <ThemedText type="title">Templates</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            Real product styles from Refero — scroll, tap one, use its design language.
          </ThemedText>
        </View>
        <View style={[styles.liveBadge, { backgroundColor: theme.tintSoft }]}>
          <View style={[styles.liveDot, { backgroundColor: theme.success }]} />
          <ThemedText type="smallBold" style={{ color: theme.tint }}>LIVE</ThemedText>
        </View>
      </View>

      {selected == null ? (
        <>
          <View>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
              {REFERO_CATEGORIES.map((c) => {
                const active = c.slug === category.slug;
                return (
                  <Pressable
                    key={c.slug}
                    onPress={() => {
                      setCategory(c);
                      void loadCategory(c);
                    }}
                    style={[
                      styles.chip,
                      { borderColor: active ? theme.tint : theme.border, backgroundColor: active ? theme.tintSoft : theme.backgroundElement },
                    ]}>
                    <ThemedText type="smallBold" style={{ color: active ? theme.tint : theme.textSecondary }}>
                      {c.label}
                    </ThemedText>
                  </Pressable>
                );
              })}
            </ScrollView>
          </View>

          <View style={[styles.gridShell, { borderColor: theme.border, backgroundColor: theme.backgroundElement }, Shadows.card]}>
            {gridError && cards.length === 0 ? (
              <View style={styles.centerFill}>
                <EmojiTile emoji="📡" size={48} />
                <ThemedText type="subtitle">Refero is offline</ThemedText>
                <ThemedText type="small" themeColor="textSecondary" style={styles.errorText}>{gridError}</ThemedText>
                <Button title="Retry" variant="secondary" onPress={() => loadCategory(category, true)} />
              </View>
            ) : cards.length === 0 && gridLoading ? (
              <View style={styles.centerFill}>
                <ActivityIndicator color={theme.tint} />
                <ThemedText type="small" themeColor="textSecondary">Loading styles…</ThemedText>
              </View>
            ) : (
              <FlatList
                data={cards}
                keyExtractor={(c) => c.id}
                numColumns={2}
                columnWrapperStyle={styles.gridRow}
                contentContainerStyle={styles.gridContent}
                refreshControl={
                  <RefreshControl refreshing={gridLoading} tintColor={theme.tint} onRefresh={() => loadCategory(category, true)} />
                }
                ListFooterComponent={
                  <ThemedText type="small" themeColor="textSecondary" style={styles.gridFoot}>
                    {cards.length} styles in {category.label}
                  </ThemedText>
                }
                renderItem={({ item }) => (
                  <Pressable
                    onPress={() => void openCard(item)}
                    style={[styles.gridCard, { backgroundColor: theme.background, borderColor: theme.border }]}>
                    <Image source={{ uri: item.image }} style={styles.gridImage} contentFit="cover" transition={150} />
                    <ThemedText type="smallBold" numberOfLines={1} style={styles.gridName}>{item.name}</ThemedText>
                  </Pressable>
                )}
              />
            )}
          </View>
        </>
      ) : (
        <DetailView
          card={selected}
          detail={detail}
          error={detailError}
          onRetry={() => void openCard(selected)}
          onClose={closeDetail}
        />
      )}

      <Glass radius={Radii.xl} style={[styles.cta, { paddingBottom: Math.max(insets.bottom, Spacing.two) }]}>
        <View style={styles.ctaCopy}>
          <ThemedText type="smallBold">
            {selected == null ? 'Tap a style to open it' : detail ? 'Style ready' : 'Loading style…'}
          </ThemedText>
          {selected != null ? (
            <Pressable onPress={closeDetail} hitSlop={8}>
              <ThemedText type="small" themeColor="tint">‹ Back to all styles</ThemedText>
            </Pressable>
          ) : (
            <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
              Every card is a live product{'\u2019'}s design system.
            </ThemedText>
          )}
        </View>
        <Button
          title="Use this design"
          onPress={chooseDesign}
          disabled={!selected || !detail}
          style={styles.ctaButton}
        />
      </Glass>

      <Modal
        visible={Boolean(pendingChoice)}
        transparent
        animationType="slide"
        onRequestClose={() => setPendingChoice(null)}>
        <Pressable style={styles.modalBackdrop} onPress={() => setPendingChoice(null)}>
          <Pressable
            accessibilityViewIsModal
            style={[styles.sheet, { backgroundColor: theme.background }]}
            onPress={(event) => event.stopPropagation()}>
            <View style={[styles.sheetHandle, { backgroundColor: theme.border }]} />
            <ThemedText type="title">Use {pendingChoice?.label}</ThemedText>
            <ThemedText themeColor="textSecondary">
              Start a new project or attach it to one you already have. Nothing generates until you answer in Chat.
            </ThemedText>
            {pendingChoice ? <Button title="Start a new project" onPress={() => startNewProject(pendingChoice)} /> : null}
            {sortedProjects.length ? (
              <>
                <ThemedText type="smallBold" themeColor="textSecondary">OR ATTACH TO</ThemedText>
                <ScrollView style={styles.projectList} contentContainerStyle={styles.projectListContent}>
                  {sortedProjects.map((project) => (
                    <Pressable
                      key={project.id}
                      accessibilityRole="button"
                      onPress={() => pendingChoice && void attachToProject(project.id, pendingChoice)}
                      style={[styles.projectRow, { backgroundColor: theme.backgroundElement, borderColor: theme.border }]}>
                      <ThemedText style={styles.projectEmoji}>{project.emoji}</ThemedText>
                      <View style={styles.projectBody}>
                        <ThemedText type="smallBold" numberOfLines={1}>{project.name}</ThemedText>
                        <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
                          {project.designReference ? `Replace ${project.designReference.label}` : 'Attach design language'}
                        </ThemedText>
                      </View>
                      <Ionicons name="chevron-forward" size={18} color={theme.textSecondary} />
                    </Pressable>
                  ))}
                </ScrollView>
              </>
            ) : null}
            <Button title="Cancel" variant="secondary" onPress={() => setPendingChoice(null)} />
          </Pressable>
        </Pressable>
      </Modal>
    </ThemedView>
  );
}

/** Native style detail: real preview video (tap to play), title, source link. */
function DetailView({
  card,
  detail,
  error,
  onRetry,
  onClose,
}: {
  card: ReferoStyleCard;
  detail: ReferoStyleDetail | null;
  error: string | null;
  onRetry: () => void;
  onClose: () => void;
}) {
  const theme = useTheme();
  const [playing, setPlaying] = useState(false);
  const player = useVideoPlayer(detail?.videoUrl ?? null, (p) => {
    p.loop = true;
    p.muted = true;
  });

  const togglePlay = () => {
    if (playing) {
      player.pause();
      setPlaying(false);
    } else {
      player.play();
      setPlaying(true);
    }
  };

  return (
    <View style={[styles.gridShell, { borderColor: theme.border, backgroundColor: theme.backgroundElement }, Shadows.card]}>
      {error ? (
        <View style={styles.centerFill}>
          <EmojiTile emoji="📡" size={48} />
          <ThemedText type="subtitle">Couldn{'\u2019'}t load this style</ThemedText>
          <ThemedText type="small" themeColor="textSecondary" style={styles.errorText}>{error}</ThemedText>
          <View style={styles.detailErrorRow}>
            <Button title="Retry" variant="secondary" onPress={onRetry} />
            <Button title="Back" variant="secondary" onPress={onClose} />
          </View>
        </View>
      ) : detail == null ? (
        <View style={styles.centerFill}>
          <ActivityIndicator color={theme.tint} />
          <ThemedText type="small" themeColor="textSecondary">Loading {card.name}…</ThemedText>
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.detailContent}>
          <Pressable onPress={detail.videoUrl ? togglePlay : undefined} style={styles.detailMedia}>
            {detail.videoUrl ? (
              <>
                <VideoView player={player} style={styles.detailVideo} contentFit="cover" nativeControls={false} />
                {!playing ? (
                  <View style={styles.playBadge} pointerEvents="none">
                    <Image source={{ uri: detail.image ?? card.image }} style={StyleSheet.absoluteFill} contentFit="cover" />
                    <View style={[styles.playCircle, { backgroundColor: 'rgba(0,0,0,0.45)' }]}>
                      <Ionicons name="play" size={26} color="#FFFFFF" />
                    </View>
                  </View>
                ) : null}
              </>
            ) : (
              <Image source={{ uri: detail.image ?? card.image }} style={styles.detailVideo} contentFit="cover" />
            )}
          </Pressable>
          <ThemedText type="subtitle" style={styles.detailTitle}>{detail.title}</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            Complete design language captured — colors, type, spacing, components. {'\u201c'}Use this design{'\u201d'} hands it to your builder.
          </ThemedText>
          <Pressable onPress={() => void Linking.openURL(card.url)} hitSlop={8}>
            <ThemedText type="small" themeColor="tint">View on refero.design ↗</ThemedText>
          </Pressable>
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  header: {
    paddingHorizontal: Spacing.three,
    paddingBottom: Spacing.two,
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: Spacing.two,
  },
  headerCopy: { flex: 1, gap: 2 },
  liveBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: Radii.pill,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  liveDot: { width: 7, height: 7, borderRadius: 4 },
  chips: {
    paddingHorizontal: Spacing.three,
    paddingBottom: Spacing.two,
    gap: Spacing.two,
  },
  chip: {
    borderRadius: Radii.pill,
    borderWidth: 1,
    paddingHorizontal: Spacing.three,
    paddingVertical: 7,
  },
  gridShell: {
    flex: 1,
    marginHorizontal: Spacing.three,
    borderRadius: Radii.lg,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  gridContent: {
    padding: Spacing.two + 2,
    gap: Spacing.two + 2,
  },
  gridRow: { gap: Spacing.two + 2 },
  gridCard: {
    flex: 1,
    borderRadius: Radii.md,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
    paddingBottom: Spacing.two,
  },
  gridImage: { aspectRatio: 16 / 10, width: '100%' },
  gridName: { paddingHorizontal: Spacing.two + 2, paddingTop: Spacing.two },
  gridFoot: { textAlign: 'center', paddingVertical: Spacing.three },
  centerFill: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.two + 2,
    padding: Spacing.four,
  },
  errorText: { textAlign: 'center' },
  detailErrorRow: { flexDirection: 'row', gap: Spacing.two },
  detailContent: { padding: Spacing.three, gap: Spacing.two + 2 },
  detailMedia: {
    borderRadius: Radii.md,
    overflow: 'hidden',
  },
  detailVideo: { aspectRatio: 16 / 10, width: '100%' },
  playBadge: {
    position: 'absolute' as const, top: 0, left: 0, right: 0, bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  playCircle: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  detailTitle: { marginTop: Spacing.one },
  cta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    marginHorizontal: Spacing.three,
    marginTop: Spacing.two,
    padding: Spacing.three,
  },
  ctaCopy: { flex: 1, gap: 2 },
  ctaButton: { minWidth: 150 },
  modalBackdrop: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  sheet: {
    borderTopLeftRadius: Radii.xl,
    borderTopRightRadius: Radii.xl,
    padding: Spacing.three,
    gap: Spacing.two + 2,
    maxHeight: '80%',
  },
  sheetHandle: {
    alignSelf: 'center',
    width: 44,
    height: 5,
    borderRadius: 3,
  },
  projectList: { maxHeight: 260 },
  projectListContent: { gap: Spacing.two },
  projectRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two + 2,
    borderRadius: Radii.md,
    borderWidth: StyleSheet.hairlineWidth,
    padding: Spacing.two + 2,
  },
  projectEmoji: { fontSize: 24, lineHeight: 30 },
  projectBody: { flex: 1, gap: 1 },
});
