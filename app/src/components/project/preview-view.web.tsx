/**
 * Web/desktop preview (Metro resolves `.web.tsx` on the web platform).
 * There is no file:// tree to point a WebView at — instead the project's
 * files load from IndexedDB, every asset becomes a blob URL, relative
 * references inside index.html are rewritten to those URLs, and the result
 * renders in a sandboxed iframe via srcdoc.
 */
import Ionicons from '@expo/vector-icons/Ionicons';
import { useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { buildPreviewDocument } from '@/lib/preview-document';
import { isBinaryPath, listFiles } from '@/lib/storage/projects';

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
  const [html, setHtml] = useState<string | null>(null);

  const revision = useMemo(() => `${reloadKey}-${manualReload}`, [reloadKey, manualReload]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const files = await listFiles(projectId);
      if (cancelled) return;
      const page = buildPreviewDocument(files, isBinaryPath);
      if (!cancelled) setHtml(page);
    })();
    return () => {
      cancelled = true;
      // The iframe owns its blob URLs; navigation/destruction releases them.
    };
  }, [projectId, revision]);

  if (html == null) {
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
      <iframe
        key={revision}
        srcDoc={html}
        sandbox="allow-scripts allow-modals allow-forms allow-popups"
        style={{ border: 0, width: '100%', height: '100%', background: '#fff' }}
        title="Project preview"
      />
      {!immersive ? (
        <Pressable onPress={() => setManualReload((n) => n + 1)} hitSlop={10} style={styles.topReload}>
          <Ionicons name="refresh" size={18} color="#FFFFFF" />
        </Pressable>
      ) : null}
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
