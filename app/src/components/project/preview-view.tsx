import Ionicons from '@expo/vector-icons/Ionicons';
import { File } from 'expo-file-system';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { WebView } from 'react-native-webview';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { filesRootUri } from '@/lib/storage/projects';

/**
 * Live preview of the project's web app, straight off the local filesystem —
 * the same files that get synced to GitHub Pages. `reloadKey` bumps on every
 * file the AI writes, so the page refreshes while generation streams.
 */
export function PreviewView({
  projectId,
  reloadKey,
  immersive = false,
  onToggleImmersive,
}: {
  projectId: string;
  reloadKey: number;
  immersive?: boolean;
  onToggleImmersive?: () => void;
}) {
  const theme = useTheme();
  const [manualReload, setManualReload] = useState(0);

  const indexFile = new File(`${filesRootUri(projectId)}/index.html`);
  // reloadKey in the dep below: re-check existence whenever files change.
  const indexUri = indexFile.exists ? indexFile.uri : null;

  if (!indexUri) {
    return (
      <View style={styles.empty}>
        <View style={[styles.emptyGlow, { backgroundColor: theme.glowSoft }]}>
          <ThemedText style={styles.emptyEmoji}>🔮</ThemedText>
        </View>
        <ThemedText type="heading" style={styles.center}>
          Nothing to preview yet
        </ThemedText>
        <ThemedText themeColor="textSecondary" type="small" style={[styles.center, styles.emptyBody]}>
          Head to Chat and describe your app — the preview lights up as soon as the AI writes files.
        </ThemedText>
        <Pressable onPress={() => setManualReload((n) => n + 1)} hitSlop={8}>
          <ThemedText type="smallBold" themeColor="tint">
            Check again
          </ThemedText>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <WebView
        key={`${reloadKey}-${manualReload}`}
        source={{ uri: indexUri }}
        originWhitelist={['*']}
        allowFileAccess
        allowFileAccessFromFileURLs
        allowUniversalAccessFromFileURLs
        allowingReadAccessToURL={filesRootUri(projectId)}
        style={styles.web}
      />
      {/* Refresh sits as a subtle silhouette top-right and disappears in
          fullscreen so the immersive view stays clean. */}
      {!immersive ? (
        <Pressable
          onPress={() => setManualReload((n) => n + 1)}
          hitSlop={10}
          style={styles.topReload}>
          <Ionicons name="refresh" size={18} color="#FFFFFF" />
        </Pressable>
      ) : null}
      {/* The fullscreen toggle stays bottom-right in both modes. */}
      {onToggleImmersive ? (
        <Pressable onPress={onToggleImmersive} style={[styles.fab, styles.fabBottom]}>
          <Ionicons name={immersive ? 'contract' : 'expand'} size={20} color="#FFFFFF" />
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  web: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  empty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.three,
    padding: Spacing.five,
  },
  emptyGlow: {
    width: 116,
    height: 116,
    borderRadius: 58,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: Spacing.two,
  },
  emptyEmoji: {
    fontSize: 56,
    lineHeight: 64,
  },
  emptyBody: {
    maxWidth: 280,
  },
  center: {
    textAlign: 'center',
  },
  topReload: {
    position: 'absolute',
    top: Spacing.three,
    right: Spacing.three,
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.32)',
  },
  fab: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.4)',
    elevation: 4,
    shadowColor: '#000',
    shadowOpacity: 0.25,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
  },
  fabBottom: {
    position: 'absolute',
    right: Spacing.three,
    bottom: Spacing.five,
  },
});
