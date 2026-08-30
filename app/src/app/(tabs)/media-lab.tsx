/**
 * Media Lab tab — hosts the paired Media Lab server (the desktop app or a
 * Spark) in a WebView. The tab only exists when a server is paired (see the
 * tabs layout); this screen handles reachability, the offline state, and a
 * jump back to Settings. The gate code lives inside the page — its cookie
 * persists in the WebView, so login happens once.
 */
import Ionicons from '@expo/vector-icons/Ionicons';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { Linking, Platform, Pressable, StyleSheet, View } from 'react-native';
import { WebView } from 'react-native-webview';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useApp } from '@/lib/store';

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

export default function MediaLabScreen() {
  const theme = useTheme();
  const mediaLab = useApp((s) => s.mediaLab);
  const [reach, setReach] = useState<Reach>('checking');
  const checkedFor = useRef<string | null>(null);

  const check = useCallback(async () => {
    if (!mediaLab) return;
    setReach('checking');
    setReach((await probe(mediaLab.url)) ? 'up' : 'down');
  }, [mediaLab]);

  useFocusEffect(
    useCallback(() => {
      // Re-probe when the tab gains focus with a new/changed server.
      if (mediaLab && checkedFor.current !== mediaLab.url) {
        checkedFor.current = mediaLab.url;
        check();
      }
    }, [mediaLab, check])
  );

  if (!mediaLab) return null; // Tab is hidden without a pairing; belt and braces.

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
            ? mediaLab.url
            : `No answer from ${mediaLab.url}. Make sure the desktop app (or Spark) is running and you're on the same network or tailnet.`}
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
        <Pressable onPress={() => Linking.openURL(mediaLab.url)} hitSlop={8}>
          <ThemedText type="smallBold" themeColor="tint">Open in a new tab</ThemedText>
        </Pressable>
      </ThemedView>
    );
  }

  return (
    <View style={styles.container}>
      <WebView
        source={{ uri: mediaLab.url }}
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
    marginTop: Spacing.two,
  },
});
