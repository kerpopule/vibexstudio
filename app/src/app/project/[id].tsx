import Ionicons from '@expo/vector-icons/Ionicons';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Segmented } from '@/components/segmented';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { ChatView } from '@/components/project/chat-view';
import { FilesView } from '@/components/project/files-view';
import { PreviewView } from '@/components/project/preview-view';
import { ShareView } from '@/components/project/share-view';
import { EmojiTile } from '@/components/ui/emoji-tile';
import { Radii, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useChat } from '@/lib/chat-engine';
import { workspaceLayoutForWidth } from '@/lib/layout';
import { readProject } from '@/lib/storage/projects';
import type { ProjectMeta } from '@/lib/types';

type Pane = 'chat' | 'preview' | 'files' | 'share';

export default function ProjectScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const wide = workspaceLayoutForWidth(width) === 'wide';
  const { id } = useLocalSearchParams<{ id: string }>();
  const [project, setProject] = useState<ProjectMeta | null>(null);
  const [pane, setPane] = useState<Pane>('chat');
  const [immersive, setImmersive] = useState(false);
  const busy = useChat((s) => (id ? (s.sessions[id]?.busy ?? false) : false));
  const filesVersion = useChat((s) => (id ? (s.sessions[id]?.filesVersion ?? 0) : 0));
  const previewReadySignal = useChat((s) => (id ? (s.sessions[id]?.previewReadySignal ?? 0) : 0));
  const bumpFiles = useChat((s) => s.bumpFiles);
  const lastPreviewSignal = useRef(previewReadySignal);

  useEffect(() => {
    if (id) readProject(id).then(setProject);
  }, [id]);

  // On phones, new renderable output opens an immersive preview. Wide windows
  // already keep chat and preview visible together, so generation never
  // steals focus from the prompt editor.
  useEffect(() => {
    if (previewReadySignal > lastPreviewSignal.current) {
      lastPreviewSignal.current = previewReadySignal;
      if (!wide) {
        const reveal = setTimeout(() => {
          setPane('preview');
          setImmersive(true);
        }, 0);
        return () => clearTimeout(reveal);
      }
    }
  }, [previewReadySignal, wide]);

  if (!project) {
    return <ThemedView style={styles.container} />;
  }

  const showChrome = wide || !(immersive && pane === 'preview');
  const activePane = wide && pane === 'preview' ? 'chat' : pane;
  const paneOptions: { value: Pane; label: string }[] = wide
    ? [
        { value: 'chat', label: 'Build' },
        { value: 'files', label: 'Files' },
        { value: 'share', label: 'Publish' },
      ]
    : [
        { value: 'chat', label: 'Chat' },
        { value: 'preview', label: 'Preview' },
        { value: 'files', label: 'Files' },
        { value: 'share', label: 'Share' },
      ];

  return (
    <ThemedView style={[styles.container, { paddingTop: showChrome ? insets.top : 0 }]}>
      <Stack.Screen options={{ headerShown: false }} />
      {showChrome ? (
        <>
          <View style={styles.header}>
            <Pressable
              onPress={() => router.back()}
              hitSlop={{ top: 16, bottom: 16, left: 20, right: 8 }}
              accessibilityRole="button"
              accessibilityLabel="Back to projects"
              style={[styles.backButton, { backgroundColor: theme.backgroundElement }]}>
              <Ionicons name="chevron-back" size={22} color={theme.tint} />
            </Pressable>
            <EmojiTile emoji={project.emoji} size={36} />
            <ThemedText type="heading" numberOfLines={1} style={styles.headerTitle}>
              {project.name}
            </ThemedText>
            {busy ? <ActivityIndicator size="small" color={theme.tint} /> : null}
            {project.github ? (
              <View style={[styles.syncBadge, { backgroundColor: theme.tintSoft }]}>
                <Ionicons name="logo-github" size={12} color={theme.tint} />
                <ThemedText type="small" style={{ color: theme.tint, fontSize: 12 }}>
                  synced
                </ThemedText>
              </View>
            ) : null}
          </View>

          <View style={styles.tabs}>
            <Segmented<Pane>
              options={paneOptions}
              value={activePane}
              onChange={setPane}
            />
          </View>
        </>
      ) : null}

      {/* Every mode stays mounted so generation can keep streaming. Wide
          windows turn Build into a real two-pane chat + live-preview desk. */}
      {wide ? (
        <View style={[styles.wideWorkspace, activePane !== 'chat' && styles.paneHidden]}>
          <View style={[styles.wideChat, { borderRightColor: theme.border }]}>
            <ChatView project={project} />
          </View>
          <View style={styles.widePreview}>
            <PreviewView
              projectId={project.id}
              reloadKey={filesVersion}
              immersive={false}
            />
          </View>
        </View>
      ) : (
        <>
          <View style={[styles.pane, pane !== 'chat' && styles.paneHidden]}>
            <ChatView project={project} />
          </View>
          <View
            style={[
              styles.pane,
              pane !== 'preview' && styles.paneHidden,
              pane === 'preview' && !showChrome ? { paddingBottom: 0 } : null,
            ]}>
            <PreviewView
              projectId={project.id}
              reloadKey={filesVersion}
              immersive={immersive && pane === 'preview'}
              onToggleImmersive={() => setImmersive((v) => !v)}
            />
          </View>
        </>
      )}
      <View style={[styles.pane, activePane !== 'files' && styles.paneHidden, { paddingBottom: insets.bottom }]}>
        <FilesView projectId={project.id} reloadKey={filesVersion} onFilesChanged={() => bumpFiles(project.id)} />
      </View>
      <View style={[styles.pane, activePane !== 'share' && styles.paneHidden, { paddingBottom: insets.bottom }]}>
        <ShareView project={project} onProjectChanged={setProject} />
      </View>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two + 2,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two + 2,
  },
  backButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    flex: 1,
  },
  syncBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderRadius: Radii.pill,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  tabs: {
    paddingHorizontal: Spacing.three,
    paddingBottom: Spacing.two,
  },
  pane: {
    flex: 1,
  },
  wideWorkspace: {
    flex: 1,
    flexDirection: 'row',
  },
  wideChat: {
    // Lovable/Bolt-style desk: chat keeps the left third, the live preview
    // owns the right two-thirds (minWidth keeps the composer usable on
    // smaller tablets).
    width: '33.333%',
    minWidth: 340,
    maxWidth: 480,
    borderRightWidth: StyleSheet.hairlineWidth,
  },
  widePreview: {
    flex: 1,
  },
  paneHidden: {
    display: 'none',
  },
});
