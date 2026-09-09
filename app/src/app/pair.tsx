/**
 * The landing screen for `vibex://pair` QR scans. The desktop app's QR
 * carries a Media Lab half, a Workbench half (with its token), or both;
 * this screen probes each and shows what paired instead of dumping the
 * user on an Unmatched Route page while the work happens invisibly.
 */
import * as Haptics from 'expo-haptics';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { PairedServerStorage } from '@/components/paired-server-storage';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Radii, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { parsePairDeepLinkV2 } from '@/lib/media-pairing';
import { useApp } from '@/lib/store';
import { performPair, type PairOutcome } from '@/lib/pair-actions';

/** Rebuild the deep link from route params so parsing stays in one place. */
function linkFromParams(params: Record<string, string | string[] | undefined>): string {
  const search = new URLSearchParams();
  for (const key of ['medialab', 'url', 'workbench', 'wbt', 'wbi']) {
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
  const hydrated = useApp(state=>state.hydrated);
  const onboardingComplete = useApp(state=>state.onboardingComplete);
  const params = useLocalSearchParams<{ medialab?: string; url?: string; workbench?: string; wbt?: string; wbi?: string }>();
  const [showSync, setShowSync] = useState(false);
  const [outcome, setOutcome] = useState<PairOutcome | null>(null);
  // Static web routes hydrate their search parameters after the first render.
  const payload = useMemo(() => parsePairDeepLinkV2(linkFromParams(params)),
    [params.medialab, params.url, params.workbench, params.wbt, params.wbi]);
  const unusable = hydrated && !payload;

  useEffect(() => {
    if (!hydrated || !payload) return;
    let active = true;
    setOutcome(null);
    setShowSync(false);
    performPair(payload).then((result) => {
      if (!active) return;
      setOutcome(result);
      const anyOk = result.workbench?.ok || result.mediaLab?.ok;
      Haptics.notificationAsync(
        anyOk ? Haptics.NotificationFeedbackType.Success : Haptics.NotificationFeedbackType.Error
      ).catch(() => {});
    });
    return () => { active = false; };
  }, [payload, hydrated]);

  const done = () => {
    // In-app pairing has the unfinished wizard underneath it. Replacing it
    // would create a new Welcome screen and discard the current setup step.
    if (router.canGoBack()) router.back();
    else if (!onboardingComplete) router.replace('/onboarding');
    else router.replace('/');
  };

  const results = [outcome?.workbench, outcome?.mediaLab].filter(Boolean);
  const allPaired = results.length > 0 && results.every(result => result?.ok);
  const anyPaired = results.some(result => result?.ok);
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
        <ScrollView contentContainerStyle={styles.results}>
          <ThemedText type="title" style={styles.title}>
            {unusable ? 'Nothing to pair' : allPaired ? 'Pairing complete' : anyPaired ? 'Partly connected' : 'Could not pair'}
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
                  ? `${outcome.mediaLab.url} — connected — find its available tools in Create and Library`
                  : outcome.mediaLab.reason ?? 'No Media Lab answered there.'
              }
            />
          ) : null}
          {outcome?.workbench?.ok ? (
            <View style={{gap:Spacing.two}}>
              <ThemedText type="smallBold">Bring your projects together</ThemedText>
              <ThemedText themeColor="textSecondary">
                Pairing connects this device to your computer. To exchange projects, choose project sync next.
                Move your AI connections next to bring API keys and model choices. Subscription accounts still need a fresh sign-in.
              </ThemedText>
              <Pressable accessibilityRole="button" accessibilityState={{expanded:showSync}}
                onPress={() => setShowSync(value => !value)}
                style={[styles.secondary, {borderColor:theme.border}]}>
                <ThemedText type="smallBold">{showSync ? 'Hide project sync' : 'Set up project sync'}</ThemedText>
              </Pressable>
              {showSync ? <PairedServerStorage pairedHere /> : null}
              <Pressable accessibilityRole="button" onPress={()=>router.push('/transfer-ai')} style={[styles.secondary,{borderColor:theme.border}]}>
                <ThemedText type="smallBold">Move AI connections</ThemedText>
              </Pressable>
            </View>
          ) : null}
          {outcome?.mediaLab?.ok ? (
            <View style={{gap:Spacing.two}}>
              <ThemedText themeColor="textSecondary">
                To use saved creations in your projects, enter this server’s access code next.
              </ThemedText>
              <Pressable accessibilityRole="button"
                onPress={() => router.replace({pathname:'/connect-media-lab', params:{url:outcome.mediaLab!.url}})}
                style={[styles.secondary, {borderColor:theme.border}]}>
                <ThemedText type="smallBold">Connect saved creations</ThemedText>
              </Pressable>
            </View>
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
        </ScrollView>
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
