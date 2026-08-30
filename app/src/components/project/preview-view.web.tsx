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
import { isBinaryPath, listFiles } from '@/lib/storage/projects';

const MIME: Record<string, string> = {
  html: 'text/html', css: 'text/css', js: 'text/javascript', mjs: 'text/javascript',
  json: 'application/json', svg: 'image/svg+xml', png: 'image/png', jpg: 'image/jpeg',
  jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', ico: 'image/x-icon',
  mp3: 'audio/mpeg', wav: 'audio/wav', mp4: 'video/mp4', woff: 'font/woff',
  woff2: 'font/woff2', ttf: 'font/ttf', txt: 'text/plain', md: 'text/plain',
};

function mimeFor(path: string): string {
  return MIME[path.split('.').pop()?.toLowerCase() ?? ''] ?? 'application/octet-stream';
}

function toBlob(content: string, encoding: string, mime: string): Blob {
  if (encoding === 'base64') {
    const binary = atob(content);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return new Blob([bytes], { type: mime });
  }
  return new Blob([content], { type: mime });
}

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
    const urls: string[] = [];
    (async () => {
      const files = await listFiles(projectId);
      const index = files.find((f) => f.path === 'index.html');
      if (!index) {
        if (!cancelled) setHtml(null);
        return;
      }
      let page = index.content;
      // Longest paths first so "assets/app.css" rewrites before "app.css".
      const others = files.filter((f) => f.path !== 'index.html').sort((a, b) => b.path.length - a.path.length);
      for (const f of others) {
        const url = URL.createObjectURL(toBlob(f.content, f.encoding ?? (isBinaryPath(f.path) ? 'base64' : 'utf-8'), mimeFor(f.path)));
        urls.push(url);
        // Rewrite src/href references to this path (quoted, optionally ./-prefixed).
        const escaped = f.path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        page = page.replace(new RegExp(`(["'])(?:\\./)?${escaped}\\1`, 'g'), `$1${url}$1`);
      }
      if (!cancelled) setHtml(page);
    })();
    return () => {
      cancelled = true;
      urls.forEach((u) => URL.revokeObjectURL(u));
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
