import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';
import { router, useLocalSearchParams } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Linking, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Button } from '@/components/ui/button';
import { Radii, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import {
  completePasteLogin,
  pollDeviceLogin,
  startDeviceLogin,
  SUBSCRIPTION_PROVIDERS,
  type DeviceLoginSession,
  type SubscriptionProviderId,
} from '@/lib/ai/subscriptionOauth';
import { useApp } from '@/lib/store';

type Phase = 'starting' | 'awaiting' | 'success' | 'error';

export default function ConnectSubscriptionScreen() {
  const theme = useTheme();
  const addSubscription = useApp((s) => s.addSubscription);
  const { provider } = useLocalSearchParams<{ provider: SubscriptionProviderId }>();
  const spec = provider ? SUBSCRIPTION_PROVIDERS[provider] : null;

  const [phase, setPhase] = useState<Phase>('starting');
  const [session, setSession] = useState<DeviceLoginSession | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pastedUrl, setPastedUrl] = useState('');
  const [finishing, setFinishing] = useState(false);
  const pollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const begin = useCallback(async () => {
    if (!provider) return;
    setPhase('starting');
    setError(null);
    try {
      const s = await startDeviceLogin(provider);
      setSession(s);
      setPhase('awaiting');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not start sign-in.');
      setPhase('error');
    }
  }, [provider]);

  useEffect(() => {
    let active = true;
    void (async () => {
      if (active) await begin();
    })();
    const timer = pollTimer;
    return () => {
      active = false;
      if (timer.current) clearTimeout(timer.current);
    };
  }, [begin]);

  // Poll loop once we have a session (paste-flow sessions finish via the button).
  useEffect(() => {
    if (phase !== 'awaiting' || !session || !spec || session.flow === 'paste') return;
    let cancelled = false;

    const tick = async () => {
      const result = await pollDeviceLogin(session).catch((e) => ({
        status: 'error' as const,
        message: e instanceof Error ? e.message : 'Sign-in failed.',
      }));
      if (cancelled) return;
      if (result.status === 'success') {
        await addSubscription({
          subscription: provider as SubscriptionProviderId,
          label: spec.name,
          defaultModel: spec.defaultModel,
          accessToken: result.tokens.accessToken,
          refreshToken: result.tokens.refreshToken,
          expiresAt: result.tokens.expiresAt,
        });
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        setPhase('success');
        setTimeout(() => router.dismiss(), 900);
        return;
      }
      if (result.status === 'error') {
        setError(result.message);
        setPhase('error');
        return;
      }
      pollTimer.current = setTimeout(tick, session.intervalMs);
    };

    pollTimer.current = setTimeout(tick, session.intervalMs);
    return () => {
      cancelled = true;
      if (pollTimer.current) clearTimeout(pollTimer.current);
    };
  }, [phase, session, spec, provider, addSubscription]);

  const succeed = useCallback(
    async (tokens: { accessToken: string; refreshToken?: string; expiresAt: number }) => {
      if (!spec) return;
      await addSubscription({
        subscription: provider as SubscriptionProviderId,
        label: spec.name,
        defaultModel: spec.defaultModel,
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        expiresAt: tokens.expiresAt,
      });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setPhase('success');
      setTimeout(() => router.dismiss(), 900);
    },
    [spec, provider, addSubscription]
  );

  const openApproval = async () => {
    if (!session) return;
    Haptics.selectionAsync();
    if (session.flow === 'paste') {
      // Real Safari, not the in-app sheet — the user needs a copyable address bar.
      await Linking.openURL(session.verificationUri);
      return;
    }
    await Clipboard.setStringAsync(session.userCode);
    await WebBrowser.openBrowserAsync(session.verificationUriComplete ?? session.verificationUri);
  };

  const finishPaste = async () => {
    if (!session) return;
    setFinishing(true);
    setError(null);
    try {
      const tokens = await completePasteLogin(session, pastedUrl);
      await succeed(tokens);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Sign-in failed.');
    } finally {
      setFinishing(false);
    }
  };

  const pasteFromClipboard = async () => {
    const text = await Clipboard.getStringAsync();
    if (text) setPastedUrl(text.trim());
    Haptics.selectionAsync();
  };

  if (!spec) {
    return (
      <ThemedView style={styles.container}>
        <ThemedText style={styles.pad}>Unknown subscription provider.</ThemedText>
      </ThemedView>
    );
  }

  return (
    <ThemedView style={styles.container}>
      <ScrollView contentContainerStyle={styles.content}>
        <ThemedText type="subtitle">{spec.name}</ThemedText>
        <ThemedText themeColor="textSecondary">{spec.blurb}</ThemedText>

        {phase === 'starting' ? (
          <ThemedText themeColor="textSecondary">Getting your sign-in code…</ThemedText>
        ) : null}

        {phase === 'awaiting' && session && session.flow === 'paste' ? (
          <>
            <ThemedText themeColor="textSecondary" type="small">
              1. Tap below — Safari opens {hostOf(session.verificationUri)}; sign in and approve.{'\n'}
              2. Safari will land on a page that can’t load (an address starting with
              http://127.0.0.1) — that’s expected!{'\n'}
              3. Tap Safari’s address bar, copy the whole link, come back, and paste it here.
            </ThemedText>
            <Button title="Open x.ai & approve" onPress={openApproval} />
            <View style={[styles.codeCard, { backgroundColor: theme.tintSoft, borderColor: theme.tint }]}>
              <ThemedText type="small" themeColor="textSecondary">
                Paste the link from Safari
              </ThemedText>
              <TextInput
                value={pastedUrl}
                onChangeText={setPastedUrl}
                placeholder="http://127.0.0.1:56121/callback?code=…"
                placeholderTextColor={theme.textSecondary}
                autoCapitalize="none"
                autoCorrect={false}
                style={[styles.pasteInput, { color: theme.text, borderColor: theme.border }]}
              />
              <Pressable onPress={pasteFromClipboard}>
                <ThemedText type="small" themeColor="tint">
                  Paste from clipboard
                </ThemedText>
              </Pressable>
            </View>
            <Button
              title={finishing ? 'Connecting…' : 'Finish connecting'}
              onPress={finishPaste}
              disabled={finishing || !pastedUrl.trim()}
            />
            {error ? <ThemedText style={{ color: theme.danger }}>{error}</ThemedText> : null}
          </>
        ) : null}

        {phase === 'awaiting' && session && session.flow !== 'paste' ? (
          <>
            <View style={[styles.codeCard, { backgroundColor: theme.tintSoft, borderColor: theme.tint }]}>
              <ThemedText type="small" themeColor="textSecondary">
                Your sign-in code
              </ThemedText>
              <ThemedText style={[styles.code, { color: theme.tint }]}>{session.userCode}</ThemedText>
              <Pressable onPress={() => Clipboard.setStringAsync(session.userCode)}>
                <ThemedText type="small" themeColor="tint">
                  Tap to copy
                </ThemedText>
              </Pressable>
            </View>
            <ThemedText themeColor="textSecondary" type="small">
              1. Tap below to open {hostOf(session.verificationUri)} (code is copied for you).{'\n'}
              2. Sign in and approve.{'\n'}
              3. Come back — VibeXStudio finishes automatically. ⚡
            </ThemedText>
            <Button title="Open & approve" onPress={openApproval} />
            <View style={styles.pollRow}>
              <ThemedText type="small" themeColor="textSecondary">
                Waiting for you to approve…
              </ThemedText>
            </View>
          </>
        ) : null}

        {phase === 'success' ? (
          <View style={[styles.codeCard, { backgroundColor: theme.tintSoft, borderColor: theme.success }]}>
            <ThemedText type="heading" style={{ color: theme.success }}>
              Connected! 🎉
            </ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              {spec.name} is ready to vibe.
            </ThemedText>
          </View>
        ) : null}

        {phase === 'error' ? (
          <>
            <ThemedText style={{ color: theme.danger }}>{error}</ThemedText>
            <Button title="Try again" onPress={begin} />
          </>
        ) : null}
      </ScrollView>
    </ThemedView>
  );
}

function hostOf(url: string): string {
  return url.replace(/^https?:\/\//, '').split('/')[0];
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    padding: Spacing.three,
    gap: Spacing.three,
  },
  pad: {
    padding: Spacing.three,
  },
  codeCard: {
    borderRadius: Radii.lg,
    borderWidth: 1,
    padding: Spacing.four,
    alignItems: 'center',
    gap: Spacing.two,
  },
  code: {
    fontSize: 36,
    lineHeight: 48,
    paddingVertical: 2,
    fontWeight: '800',
    letterSpacing: 4,
  },
  pollRow: {
    alignItems: 'center',
  },
  pasteInput: {
    alignSelf: 'stretch',
    borderWidth: 1,
    borderRadius: Radii.md,
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.two,
    fontSize: 14,
  },
});
