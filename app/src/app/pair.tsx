/**
 * The landing screen for `vibex://pair` QR scans. The desktop app's QR
 * carries a Media Lab half, a Workbench half (with its token), or both;
 * this screen probes each and shows what paired instead of dumping the
 * user on an Unmatched Route page while the work happens invisibly.
 */
import * as Haptics from 'expo-haptics';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Radii, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { parsePairDeepLinkV2 } from '@/lib/media-pairing';
import { performPair, type PairOutcome } from '@/lib/pair-actions';

/** Rebuild the deep link from route params so parsing stays in one place. */
function linkFromParams(params: Record<string, string | string[] | undefined>): string {
  const search = new URLSearchParams();
  for (const key of ['medialab', 'url', 'workbench', 'wbt']) {
    const value = params[key];
    if (typeof value === 'string' && value) search.set(key, value);
  }
  return `vibex://pair?${search.toString()}`;
}

function OutcomeRow({ emoji, title, detail, ok }: { emoji: string; title: string; detail?: string; ok: boolean }) {
  const theme = useTheme();
  return (
    <View style={[styles.row, { backgroundColor: theme.backgroundElement }]}>
      <ThemedText style={styles.rowEmoji}>{emoji}</ThemedText>
      <View style={styles.rowText}>
        <ThemedText type="smallBold">{`${ok ? '✓' : '✕'} ${title}`}</ThemedText>
        {detail ? (
          <ThemedText style={[styles.rowDetail, { color: ok ? theme.textSecondary : theme.danger }]}>
            {detail}
          </ThemedText>
        ) : null}
      </View>
    </View>
  );
}

export default function PairScreen() {
  const theme = useTheme();
  const params = useLocalSearchParams<{ medialab?: string; url?: string; workbench?: string; wbt?: string }>();
  const [outcome, setOutcome] = useState<PairOutcome | null>(null);
  // Parsed once at mount — the QR is scanned once; params never change here.
  const [payload] = useState(() => parsePairDeepLinkV2(linkFromParams(params)));
  const unusable = !payload;

  useEffect(() => {
    if (!payload) return;
    performPair(payload).then((result) => {
      setOutcome(result);
      const anyOk = result.workbench?.ok || result.mediaLab?.ok;
      Haptics.notificationAsync(
        anyOk ? Haptics.NotificationFeedbackType.Success : Haptics.NotificationFeedbackType.Error
      ).catch(() => {});
    });
  }, [payload]);

  const done = () => {
    if (router.canGoBack()) router.back();
    else router.replace('/');
  };

  const mediaLabFailed = outcome?.mediaLab && !outcome.mediaLab.ok;

  return (
    <ThemedView style={styles.screen}>
      {!outcome && !unusable ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={theme.tint} />
          <ThemedText type="subtitle" style={styles.wait}>
            Pairing…
          </ThemedText>
          <ThemedText style={[styles.hint, { color: theme.textSecondary }]}>
            Talking to your computer over your own network.
          </ThemedText>
        </View>
      ) : (
        <View style={styles.results}>
          <ThemedText type="title" style={styles.title}>
            {unusable ? 'Nothing to pair' : 'Pairing complete'}
          </ThemedText>
          {unusable ? (
            <ThemedText style={[styles.hint, { color: theme.textSecondary }]}>
              This link didn’t carry a Media Lab or Workbench address. Scan the QR shown by the
              VibeXStudio desktop app.
            </ThemedText>
          ) : null}
          {outcome?.workbench ? (
            <OutcomeRow
              emoji="🖥️"
              title="Workbench"
              ok={outcome.workbench.ok}
              detail={
                outcome.workbench.ok
                  ? `${outcome.workbench.url} — your computer now builds and serves projects`
                  : outcome.workbench.reason
              }
            />
          ) : null}
          {outcome?.mediaLab ? (
            <OutcomeRow
              emoji="🎬"
              title="Media Lab"
              ok={outcome.mediaLab.ok}
              detail={
                outcome.mediaLab.ok
                  ? `${outcome.mediaLab.url} — its full web UI joined the Media Lab tab`
                  : 'No Media Lab answered there.'
              }
            />
          ) : null}
          {mediaLabFailed ? (
            <Pressable
              onPress={() =>
                router.replace({ pathname: '/connect-media-lab', params: { url: outcome?.mediaLab?.url } })
              }
              style={[styles.secondary, { borderColor: theme.border }]}>
              <ThemedText type="smallBold">Pair Media Lab manually</ThemedText>
            </Pressable>
          ) : null}
          <Pressable onPress={done} style={[styles.doneButton, { backgroundColor: theme.tint }]}>
            <ThemedText type="smallBold" style={{ color: theme.onTint }}>
              Done
            </ThemedText>
          </Pressable>
        </View>
      )}
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, justifyContent: 'center', padding: Spacing.four },
  center: { alignItems: 'center', gap: Spacing.three },
  wait: { marginTop: Spacing.two },
  hint: { textAlign: 'center' },
  results: { gap: Spacing.three },
  title: { textAlign: 'center', marginBottom: Spacing.two },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    borderRadius: Radii.lg,
    padding: Spacing.three,
  },
  rowEmoji: { fontSize: 28 },
  rowText: { flex: 1, gap: 2 },
  rowDetail: { fontSize: 13, lineHeight: 18 },
  secondary: {
    alignItems: 'center',
    borderRadius: Radii.lg,
    borderWidth: StyleSheet.hairlineWidth,
    padding: Spacing.three,
  },
  doneButton: {
    alignItems: 'center',
    borderRadius: Radii.lg,
    padding: Spacing.three,
    marginTop: Spacing.two,
  },
});
