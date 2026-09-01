/**
 * "Use your subscription" — sign in with a plan you already pay for.
 * Three shapes, one screen:
 *   poll     MiniMax / Kimi device codes (RFC 8628)
 *   browser  ChatGPT — the in-app browser redirects to a loopback listener
 *            VibeX runs on this device for a few seconds; falls back to paste
 *   paste    xAI — copy the failed 127.0.0.1 link out of Safari
 * Opened without a `provider` param it shows the chooser instead of a dead end.
 */
import Ionicons from '@expo/vector-icons/Ionicons';
import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';
import { router, useLocalSearchParams } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Linking, Platform, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Button } from '@/components/ui/button';
import { ScalePress } from '@/components/ui/scale-press';
import { Fonts, Radii, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { captureLoopbackCallback, LOOPBACK_SUPPORTED } from '@/lib/ai/loopback-callback';
import {
  CHATGPT_LOOPBACK_PORT,
  CHATGPT_REDIRECT_PATH,
  completePasteLogin,
  pollDeviceLogin,
  startDeviceLogin,
  SUBSCRIPTION_ORDER,
  SUBSCRIPTION_PROVIDERS,
  type DeviceLoginSession,
  type SubscriptionProviderId,
} from '@/lib/ai/subscriptionOauth';
import { useApp } from '@/lib/store';

type Phase = 'starting' | 'awaiting' | 'success' | 'error';

const SUBSCRIPTION_GLYPH: Record<SubscriptionProviderId, string> = {
  'chatgpt-oauth': '🟢',
  'xai-oauth': '✖️',
  'minimax-oauth': '🟠',
  'kimi-oauth': '🌙',
};

export default function ConnectSubscriptionScreen() {
  const { provider } = useLocalSearchParams<{ provider?: SubscriptionProviderId }>();
  const spec = provider ? SUBSCRIPTION_PROVIDERS[provider] : null;
  if (!spec) return <SubscriptionChooser />;
  return <SubscriptionLogin provider={provider as SubscriptionProviderId} />;
}

function SubscriptionChooser() {
  const theme = useTheme();
  return (
    <ThemedView style={styles.container}>
      <ScrollView contentContainerStyle={styles.content}>
        <ThemedText themeColor="textSecondary">
          Pick the plan you already pay for. VibeX signs in with the vendor’s own public app id — no key to copy,
          nothing VibeX-owned in the loop.
        </ThemedText>
        {SUBSCRIPTION_ORDER.map((id) => {
          const sub = SUBSCRIPTION_PROVIDERS[id];
          return (
            <ScalePress
              key={id}
              accessibilityRole="button"
              onPress={() => router.replace({ pathname: '/connect-subscription', params: { provider: id } })}
              style={[styles.choice, { backgroundColor: theme.backgroundElement }]}>
              <View style={[styles.glyphWell, { backgroundColor: theme.tintSoft }]}>
                <ThemedText style={styles.glyph}>{SUBSCRIPTION_GLYPH[id]}</ThemedText>
              </View>
              <View style={styles.choiceBody}>
                <ThemedText type="heading">{sub.name}</ThemedText>
                <ThemedText type="small" themeColor="textSecondary">{sub.blurb}</ThemedText>
              </View>
              <Ionicons name="chevron-forward" size={16} color={theme.textSecondary} />
            </ScalePress>
          );
        })}
      </ScrollView>
    </ThemedView>
  );
}

function SubscriptionLogin({ provider }: { provider: SubscriptionProviderId }) {
  const theme = useTheme();
  const addSubscription = useApp((s) => s.addSubscription);
  const spec = SUBSCRIPTION_PROVIDERS[provider];

  const [phase, setPhase] = useState<Phase>('starting');
  const [session, setSession] = useState<DeviceLoginSession | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pastedUrl, setPastedUrl] = useState('');
  const [finishing, setFinishing] = useState(false);
  const [listening, setListening] = useState(false);
  const pollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const capture = useRef<ReturnType<typeof captureLoopbackCallback> | null>(null);

  const succeed = useCallback(
    async (tokens: { accessToken: string; refreshToken?: string; expiresAt: number }) => {
      await addSubscription({
        subscription: provider,
        label: spec.name,
        defaultModel: spec.defaultModel,
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        expiresAt: tokens.expiresAt,
      });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      setPhase('success');
      setTimeout(() => router.dismiss(), 900);
    },
    [spec, provider, addSubscription]
  );

  const begin = useCallback(async () => {
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
      capture.current?.cancel();
    };
  }, [begin]);

  // Poll loop for device-code sessions.
  useEffect(() => {
    if (phase !== 'awaiting' || !session || session.flow !== 'poll') return;
    let cancelled = false;
    const tick = async () => {
      const result = await pollDeviceLogin(session).catch((e) => ({
        status: 'error' as const,
        message: e instanceof Error ? e.message : 'Sign-in failed.',
      }));
      if (cancelled) return;
      if (result.status === 'success') {
        await succeed(result.tokens);
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
  }, [phase, session, succeed]);

  const finishWith = async (callbackUrlOrCode: string) => {
    if (!session) return;
    setFinishing(true);
    setError(null);
    try {
      await succeed(await completePasteLogin(session, callbackUrlOrCode));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Sign-in failed.');
    } finally {
      setFinishing(false);
    }
  };

  const openApproval = async () => {
    if (!session) return;
    Haptics.selectionAsync().catch(() => {});
    if (session.flow === 'browser') {
      if (LOOPBACK_SUPPORTED) {
        capture.current?.cancel();
        const cap = captureLoopbackCallback(CHATGPT_LOOPBACK_PORT, CHATGPT_REDIRECT_PATH, 10 * 60_000);
        capture.current = cap;
        setListening(true);
        cap.result
          .then((url) => {
            WebBrowser.dismissBrowser();
            return finishWith(url);
          })
          .catch((e: Error) => {
            if (e.message !== 'cancelled') setError(`${e.message} You can also paste the link below.`);
          })
          .finally(() => setListening(false));
        await WebBrowser.openBrowserAsync(session.verificationUri);
      } else {
        await Linking.openURL(session.verificationUri);
      }
      return;
    }
    if (session.flow === 'paste') {
      // Real Safari, not the in-app sheet — the user needs a copyable address bar.
      await Linking.openURL(session.verificationUri);
      return;
    }
    await Clipboard.setStringAsync(session.userCode);
    await WebBrowser.openBrowserAsync(session.verificationUriComplete ?? session.verificationUri);
  };

  const pasteFromClipboard = async () => {
    const text = await Clipboard.getStringAsync();
    if (text) setPastedUrl(text.trim());
    Haptics.selectionAsync().catch(() => {});
  };

  const vendorHost = session ? hostOf(session.verificationUri) : '';

  return (
    <ThemedView style={styles.container}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <ThemedText type="subtitle">{spec.name}</ThemedText>
        <ThemedText themeColor="textSecondary">{spec.blurb}</ThemedText>

        {phase === 'starting' ? <ThemedText themeColor="textSecondary">Getting things ready…</ThemedText> : null}

        {phase === 'awaiting' && session?.flow === 'browser' ? (
          <>
            <ThemedText themeColor="textSecondary" type="small">
              {LOOPBACK_SUPPORTED
                ? `Tap below — ${vendorHost} opens, you sign in and approve, and VibeX finishes on its own. ⚡`
                : `Tap below — ${vendorHost} opens in your browser. After you approve, it lands on a page that can’t load (an address starting with http://localhost:${CHATGPT_LOOPBACK_PORT}). Copy that whole link and paste it here.`}
            </ThemedText>
            <Button title={listening ? 'Waiting for ChatGPT…' : 'Sign in with ChatGPT'} onPress={openApproval} loading={finishing} />
            <PasteBox
              label={LOOPBACK_SUPPORTED ? 'Didn’t come back? Paste the link here' : 'Paste the link from your browser'}
              placeholder={`http://localhost:${CHATGPT_LOOPBACK_PORT}${CHATGPT_REDIRECT_PATH}?code=…`}
              value={pastedUrl}
              onChange={setPastedUrl}
              onPaste={pasteFromClipboard}
            />
            <Button
              title={finishing ? 'Connecting…' : 'Finish connecting'}
              variant="secondary"
              onPress={() => finishWith(pastedUrl)}
              disabled={finishing || !pastedUrl.trim()}
            />
          </>
        ) : null}

        {phase === 'awaiting' && session?.flow === 'paste' ? (
          <>
            <ThemedText themeColor="textSecondary" type="small">
              1. Tap below — {Platform.OS === 'ios' ? 'Safari' : 'your browser'} opens {vendorHost}; sign in and approve.{'\n'}
              2. It will land on a page that can’t load (an address starting with http://127.0.0.1) — that’s expected!{'\n'}
              3. Copy the whole link from the address bar, come back, and paste it here.
            </ThemedText>
            <Button title={`Open ${vendorHost} & approve`} onPress={openApproval} />
            <PasteBox
              label="Paste the link from your browser"
              placeholder="http://127.0.0.1:56121/callback?code=…"
              value={pastedUrl}
              onChange={setPastedUrl}
              onPaste={pasteFromClipboard}
            />
            <Button
              title={finishing ? 'Connecting…' : 'Finish connecting'}
              onPress={() => finishWith(pastedUrl)}
              disabled={finishing || !pastedUrl.trim()}
            />
          </>
        ) : null}

        {phase === 'awaiting' && session?.flow === 'poll' ? (
          <>
            <View style={[styles.codeCard, { backgroundColor: theme.tintSoft, borderColor: theme.tint }]}>
              <ThemedText type="small" themeColor="textSecondary">Your sign-in code</ThemedText>
              <ThemedText style={[styles.code, { color: theme.tint }]}>{session.userCode}</ThemedText>
              <Pressable onPress={() => Clipboard.setStringAsync(session.userCode)}>
                <ThemedText type="small" themeColor="tint">Tap to copy</ThemedText>
              </Pressable>
            </View>
            <ThemedText themeColor="textSecondary" type="small">
              1. Tap below to open {vendorHost} (the code is copied for you).{'\n'}
              2. Sign in and approve.{'\n'}
              3. Come back — VibeX finishes automatically. ⚡
            </ThemedText>
            <Button title={`Open ${vendorHost}`} onPress={openApproval} />
            <View style={styles.pollRow}>
              <ThemedText type="small" themeColor="textSecondary">Waiting for approval…</ThemedText>
            </View>
          </>
        ) : null}

        {error && phase !== 'error' ? <ThemedText style={{ color: theme.danger }}>{error}</ThemedText> : null}

        {phase === 'success' ? (
          <View style={[styles.codeCard, { backgroundColor: theme.tintSoft, borderColor: theme.tint }]}>
            <ThemedText style={styles.big}>🎉</ThemedText>
            <ThemedText type="heading">Connected</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">{spec.name} is ready to vibe.</ThemedText>
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

function PasteBox({
  label,
  placeholder,
  value,
  onChange,
  onPaste,
}: {
  label: string;
  placeholder: string;
  value: string;
  onChange: (v: string) => void;
  onPaste: () => void;
}) {
  const theme = useTheme();
  return (
    <View style={[styles.pasteCard, { backgroundColor: theme.backgroundElement, borderColor: theme.border }]}>
      <ThemedText type="small" themeColor="textSecondary">{label}</ThemedText>
      <TextInput
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor={theme.textSecondary}
        autoCapitalize="none"
        autoCorrect={false}
        style={[styles.pasteInput, { color: theme.text, borderColor: theme.border, backgroundColor: theme.background }]}
      />
      <Pressable onPress={onPaste} hitSlop={6}>
        <ThemedText type="small" themeColor="tint">Paste from clipboard</ThemedText>
      </Pressable>
    </View>
  );
}

function hostOf(url: string): string {
  return url.replace(/^https?:\/\//, '').split('/')[0];
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { padding: Spacing.three, gap: Spacing.three },
  choice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    borderRadius: Radii.lg,
    padding: Spacing.three,
  },
  glyphWell: { width: 44, height: 44, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  glyph: { fontSize: 22, lineHeight: 28 },
  choiceBody: { flex: 1, gap: 2 },
  codeCard: {
    borderRadius: Radii.lg,
    borderWidth: 1,
    padding: Spacing.four,
    alignItems: 'center',
    gap: Spacing.two,
  },
  code: { fontFamily: Fonts.displayBold, fontSize: 36, lineHeight: 48, paddingVertical: 2, letterSpacing: 4 },
  big: { fontSize: 40, lineHeight: 48 },
  pollRow: { alignItems: 'center' },
  pasteCard: { borderRadius: Radii.lg, borderWidth: StyleSheet.hairlineWidth, padding: Spacing.three, gap: Spacing.two },
  pasteInput: {
    alignSelf: 'stretch',
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: Radii.md,
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.two,
    fontSize: 14,
    fontFamily: Fonts.mono,
  },
});
