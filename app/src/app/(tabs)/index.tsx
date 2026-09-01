import Ionicons from '@expo/vector-icons/Ionicons';
import { LinearGradient } from 'expo-linear-gradient';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useRef } from 'react';
import { ActivityIndicator, Alert, FlatList, Image, StyleSheet, useWindowDimensions, View } from 'react-native';
import Animated, {
  Easing,
  FadeInDown,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Glass } from '@/components/ui/glass';
import { TAB_PILL_CLEARANCE } from '@/components/ui/tab-pill';
import { ScalePress } from '@/components/ui/scale-press';
import { Fonts, gradientColors, Radii, Shadows, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { type ChatSession, useChat } from '@/lib/chat-engine';
import { thisDevice } from '@/lib/device';
import { workspaceLayoutForWidth } from '@/lib/layout';
import { enter } from '@/lib/motion';
import { readyToBuild } from '@/lib/setup';
import { useApp } from '@/lib/store';
import type { ProjectMeta } from '@/lib/types';

/** Live build state for a card, derived from the project's chat session. */
type Activity = 'building' | 'queued' | 'paused' | 'attention' | null;

function activityFor(session: ChatSession | undefined): Activity {
  if (!session) return null;
  if (session.busy) return session.streamText?.startsWith('Waiting for a free build slot') ? 'queued' : 'building';
  const last = session.messages[session.messages.length - 1];
  if (last?.role === 'assistant' && last.error && last.error !== 'aborted') {
    return last.error.startsWith('Network error') ? 'paused' : 'attention';
  }
  return null;
}

const ACTIVITY_LABEL: Record<NonNullable<Activity>, string> = {
  building: 'Building…',
  queued: 'Queued',
  paused: 'Paused — reopens where it left off',
  attention: 'Needs your attention',
};

const APP_ICON = require('../../../assets/images/icon.png');

/** Rest: gradient peeks as a 4px rail on the left. Pressed: it wraps the whole tile. */
const RAIL_W = 4;
const RING_W = 3;

function ProjectCard({
  item,
  activity,
  onOpen,
  onLongPress,
}: {
  item: ProjectMeta;
  activity: Activity;
  onOpen: () => void;
  onLongPress: () => void;
}) {
  const theme = useTheme();
  const ring = useSharedValue(0);
  const navigating = useRef(false);

  const innerStyle = useAnimatedStyle(() => ({
    marginLeft: RAIL_W - (RAIL_W - RING_W) * ring.value,
    marginTop: RING_W * ring.value,
    marginRight: RING_W * ring.value,
    marginBottom: RING_W * ring.value,
    borderRadius: Radii.xl - RING_W * ring.value,
  }));

  return (
    <ScalePress
      onPressIn={() => {
         
        ring.value = withTiming(1, { duration: 160, easing: Easing.out(Easing.quad) });
      }}
      onPressOut={() => {
        // Retract only on cancelled taps; a real press keeps the ring lit while navigating.
         
        if (!navigating.current) ring.value = withDelay(120, withTiming(0, { duration: 240 }));
      }}
      onPress={() => {
        navigating.current = true;
        setTimeout(() => {
          onOpen();
           
          ring.value = withDelay(500, withTiming(0, { duration: 240 }));
          navigating.current = false;
        }, 170);
      }}
      onLongPress={onLongPress}
      style={[styles.cardShadow, Shadows.card]}>
      <View style={styles.cardRing}>
        <LinearGradient
          colors={gradientColors(theme)}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={[StyleSheet.absoluteFill, styles.gradientDim]}
        />
        <Animated.View style={[styles.cardInner, { backgroundColor: theme.background }, innerStyle]}>
          <Glass radius={Radii.xl} style={styles.card}>
            <LinearGradient colors={gradientColors(theme)} style={styles.cardEmojiWell}>
              <View style={[styles.cardEmojiInner, { backgroundColor: theme.backgroundElement }]}>
                <ThemedText style={styles.cardEmoji}>{item.emoji}</ThemedText>
              </View>
            </LinearGradient>
            <View style={styles.cardBody}>
              <ThemedText type="heading" numberOfLines={1}>
                {item.name}
              </ThemedText>
              {activity ? (
                <View style={styles.cardMeta}>
                  {activity === 'building' ? (
                    <ActivityIndicator size="small" color={theme.tint} style={styles.activitySpinner} />
                  ) : (
                    <View
                      style={[
                        styles.readyDot,
                        { backgroundColor: activity === 'attention' ? theme.danger : theme.warning },
                      ]}
                    />
                  )}
                  <ThemedText
                    type="smallBold"
                    numberOfLines={1}
                    style={{
                      color:
                        activity === 'building'
                          ? theme.tint
                          : activity === 'attention'
                            ? theme.danger
                            : theme.warning,
                    }}>
                    {ACTIVITY_LABEL[activity]}
                  </ThemedText>
                </View>
              ) : (
                <View style={styles.cardMeta}>
                  <Ionicons
                    name={item.github ? 'logo-github' : 'sparkles-outline'}
                    size={12}
                    color={item.github ? theme.textSecondary : theme.tint}
                  />
                  <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
                    {item.github
                      ? `${item.github.owner}/${item.github.repo}`
                      : `Local · ${timeAgo(item.updatedAt)}`}
                  </ThemedText>
                </View>
              )}
            </View>
            <Ionicons name="chevron-forward" size={18} color={theme.textSecondary} />
          </Glass>
        </Animated.View>
      </View>
    </ScalePress>
  );
}

export default function ProjectsScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const wide = workspaceLayoutForWidth(width) === 'wide';
  const { projects, hydrated, refreshProjects, deleteProject } = useApp();
  const providers = useApp((s) => s.providers);
  const mediaLab = useApp((s) => s.mediaLab);
  const workbench = useApp((s) => s.workbench);
  const github = useApp((s) => s.github);
  const canBuild = readyToBuild({ providers, mediaLab, workbench, github });
  const sessions = useChat((s) => s.sessions);

  useFocusEffect(
    useCallback(() => {
      if (hydrated) refreshProjects();
    }, [hydrated, refreshProjects])
  );

  const confirmDelete = (project: ProjectMeta) => {
    Alert.alert(
      `Delete "${project.name}"?`,
      project.github
        ? 'This deletes the local copy. Your GitHub repo is untouched.'
        : `This project only exists on ${thisDevice}. Deleting it cannot be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete', style: 'destructive', onPress: () => deleteProject(project.id) },
      ]
    );
  };

  return (
    <ThemedView style={styles.container}>
      {/* Ambient brand glow bleeding from the top — sells the dark glass. */}
      <LinearGradient
        colors={[theme.glowSoft, 'transparent']}
        style={styles.ambient}
        pointerEvents="none"
      />
      <FlatList
        data={projects}
        keyExtractor={(item) => item.id}
        contentContainerStyle={[
          styles.list,
          wide && styles.listWide,
          { paddingTop: insets.top + Spacing.two },
        ]}
        ListHeaderComponent={
          <Animated.View entering={enter(FadeInDown.duration(480))} style={styles.hero}>
            <View style={styles.heroTopline}>
              <View style={styles.wordmark}>
                <Image
                  source={APP_ICON}
                  style={styles.logoMark}
                  accessibilityLabel="VibeX Studio logo"
                  accessibilityIgnoresInvertColors
                />
                <View>
                  <ThemedText type="smallBold">VibeX Studio</ThemedText>
                  <ThemedText type="small" themeColor="textSecondary">Apps + media, on your terms</ThemedText>
                </View>
              </View>
              <ScalePress
                accessibilityRole="button"
                accessibilityLabel={canBuild ? 'AI connected. Open Setup' : 'Connect an AI'}
                onPress={() => (canBuild ? router.push('/(tabs)/settings') : router.push('/connect-provider'))}
                style={[styles.readyChip, { backgroundColor: theme.tintSoft }]}>
                <View style={[styles.readyDot, { backgroundColor: canBuild ? theme.success : theme.warning }]} />
                <ThemedText style={[styles.readyLabel, { color: theme.tint }]}>
                  {canBuild ? 'READY' : 'CONNECT AI'}
                </ThemedText>
                <Ionicons name="chevron-forward" size={11} color={theme.tint} />
              </ScalePress>
            </View>
            <ThemedText type="title" style={styles.heroTitle}>Create anything.{`\n`}Keep it yours.</ThemedText>
            <ThemedText themeColor="textSecondary" style={styles.heroBody}>
              Build, remix, preview, and publish real web apps from your device.
            </ThemedText>
            <ScalePress onPress={() => router.push('/new-project')} style={[styles.quickStart, { shadowColor: theme.glow }, Shadows.float]}>
              <LinearGradient colors={gradientColors(theme)} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.quickStartFill}>
                <View style={styles.quickStartCopy}>
                  <ThemedText type="heading" style={{ color: theme.onGradient }}>Start a new build</ThemedText>
                  <ThemedText type="small" style={{ color: theme.onGradient, opacity: 0.82 }}>Describe it. Watch it become real.</ThemedText>
                </View>
                <View style={[styles.quickStartIcon, { backgroundColor: theme.glass }]}>
                  <Ionicons name="arrow-forward" size={20} color={theme.onGradient} />
                </View>
              </LinearGradient>
            </ScalePress>
            {projects.length ? <ThemedText type="smallBold" themeColor="textSecondary" style={styles.sectionLabel}>RECENT PROJECTS</ThemedText> : null}
          </Animated.View>
        }
        ListEmptyComponent={
          hydrated ? (
            <Animated.View entering={enter(FadeInDown.duration(500))} style={styles.empty}>
              <LinearGradient colors={gradientColors(theme)} style={styles.emptyOrb}>
                <ThemedText style={styles.emptyEmoji}>✨</ThemedText>
              </LinearGradient>
              <ThemedText type="subtitle" style={styles.center}>
                Vibe your first app
              </ThemedText>
              <ThemedText themeColor="textSecondary" style={[styles.center, styles.emptyBody]}>
                Describe an app in chat and watch it come to life — right on your device. Everything stays on your
                device unless you sync it to your own GitHub.
              </ThemedText>
            </Animated.View>
          ) : null
        }
        renderItem={({ item, index }) => (
          <Animated.View entering={enter(FadeInDown.delay(Math.min(index, 8) * 55).duration(420))}>
            <ProjectCard
              item={item}
              activity={activityFor(sessions[item.id])}
              onOpen={() => router.push({ pathname: '/project/[id]', params: { id: item.id } })}
              onLongPress={() => confirmDelete(item)}
            />
          </Animated.View>
        )}
      />
    </ThemedView>
  );
}

/** "just now", "5m ago", "3h ago", "2d ago" — keeps cards human. */
function timeAgo(ts: number): string {
  const s = Math.max(0, (Date.now() - ts) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  ambient: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 260,
  },
  list: {
    padding: Spacing.three,
    gap: 14,
    flexGrow: 1,
    paddingBottom: TAB_PILL_CLEARANCE,
  },
  listWide: {
    width: '100%',
    maxWidth: 760,
    alignSelf: 'center',
  },
  hero: {
    gap: 12,
    marginBottom: Spacing.three,
  },
  heroTopline: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: Spacing.three,
  },
  wordmark: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  logoMark: {
    width: 42,
    height: 42,
    borderRadius: 14,
    resizeMode: 'cover',
  },
  readyChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: Radii.pill,
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  readyDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
  },
  readyLabel: {
    fontFamily: Fonts.display,
    fontSize: 10,
    letterSpacing: 1,
  },
  heroTitle: {
    fontSize: 42,
    lineHeight: 43,
    letterSpacing: -1.6,
  },
  heroBody: {
    fontSize: 16,
    lineHeight: 22,
    maxWidth: 360,
  },
  quickStart: {
    borderRadius: Radii.xl,
    marginTop: Spacing.two,
    marginBottom: Spacing.three,
  },
  quickStartFill: {
    minHeight: 112,
    borderRadius: Radii.xl,
    padding: Spacing.three,
    flexDirection: 'row',
    alignItems: 'center',
  },
  quickStartCopy: {
    flex: 1,
    gap: 5,
  },
  quickStartIcon: {
    width: 46,
    height: 46,
    borderRadius: 23,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sectionLabel: {
    letterSpacing: 1.2,
    fontSize: 10,
    marginTop: 2,
  },
  empty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.three,
    padding: Spacing.four,
  },
  emptyOrb: {
    opacity: 0.85,
    width: 124,
    height: 124,
    borderRadius: 62,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: Spacing.two,
  },
  emptyEmoji: {
    fontSize: 56,
    lineHeight: 66,
  },
  emptyBody: {
    maxWidth: 300,
  },
  center: {
    textAlign: 'center',
  },
  cardShadow: {
    borderRadius: Radii.xl,
  },
  cardRing: {
    borderRadius: Radii.xl,
    overflow: 'hidden',
  },
  cardInner: {
    overflow: 'hidden',
  },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    paddingVertical: 14,
    paddingHorizontal: Spacing.three,
  },
  cardEmojiWell: {
    opacity: 0.85,
    width: 52,
    height: 52,
    borderRadius: Radii.md,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 2,
  },
  cardEmojiInner: {
    flex: 1,
    alignSelf: 'stretch',
    borderRadius: Radii.md - 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardEmoji: {
    fontSize: 26,
    lineHeight: 32,
  },
  cardBody: {
    flex: 1,
    gap: 3,
  },
  cardMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  activitySpinner: {
    transform: [{ scale: 0.7 }],
  },
  gradientDim: {
    opacity: 0.85,
  },
});
