import * as Clipboard from 'expo-clipboard';
import { router } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { useEffect, useRef, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';

import { Segmented } from '@/components/segmented';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Button } from '@/components/ui/button';
import { TextField } from '@/components/ui/text-field';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { pollDeviceFlow, startDeviceFlow, type DeviceCodeSession } from '@/lib/github/deviceFlow';
import { useApp } from '@/lib/store';
import { setGitHubClientIdOverride } from '@/lib/storage/settings';

type Mode = 'oauth' | 'pat';

export default function ConnectGitHubScreen() {
  const theme = useTheme();
  const connectGitHub = useApp((s) => s.connectGitHub);
  const [mode, setMode] = useState<Mode>('oauth');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // PAT mode
  const [pat, setPat] = useState('');

  // Device flow mode
  const [session, setSession] = useState<DeviceCodeSession | null>(null);
  const pollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [clientId, setClientId] = useState('');

  useEffect(() => {
    return () => {
      if (pollTimer.current) clearTimeout(pollTimer.current);
    };
  }, []);

  const finish = async (token: string, auth: 'device' | 'pat') => {
    await connectGitHub(token, auth);
    router.dismiss();
  };

  const connectWithPat = async () => {
    if (!pat.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await finish(pat.trim(), 'pat');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not verify the token.');
    } finally {
      setBusy(false);
    }
  };

  const beginDeviceFlow = async () => {
    setBusy(true);
    setError(null);
    try {
      if (clientId.trim()) await setGitHubClientIdOverride(clientId);
      const newSession = await startDeviceFlow();
      setSession(newSession);
      await Clipboard.setStringAsync(newSession.userCode);
      WebBrowser.openBrowserAsync(newSession.verificationUri);
      schedulePoll(newSession, newSession.intervalMs);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not start GitHub sign-in.');
      setBusy(false);
    }
  };

  const schedulePoll = (activeSession: DeviceCodeSession, delay: number) => {
    pollTimer.current = setTimeout(async () => {
      const result = await pollDeviceFlow(activeSession);
      switch (result.status) {
        case 'success':
          try {
            await finish(result.token, 'device');
          } catch (e) {
            setError(e instanceof Error ? e.message : 'Could not load your GitHub profile.');
            setBusy(false);
            setSession(null);
          }
          return;
        case 'pending':
          schedulePoll(activeSession, activeSession.intervalMs);
          return;
        case 'slow_down':
          schedulePoll(activeSession, result.intervalMs);
          return;
        case 'error':
          setError(result.message);
          setBusy(false);
          setSession(null);
      }
    }, delay);
  };

  return (
    <ThemedView style={styles.container}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <ThemedText themeColor="textSecondary">
          GitHub hosts the apps you make — in your account, under your control. VibeXStudio talks to GitHub directly
          from this device; your token never leaves the device.
        </ThemedText>

        <Segmented
          options={[
            { value: 'oauth', label: 'Sign in with GitHub' },
            { value: 'pat', label: 'Access token' },
          ]}
          value={mode}
          onChange={setMode}
        />

        {mode === 'oauth' ? (
          <View style={styles.block}>
            {session ? (
              <View style={[styles.codeCard, { backgroundColor: theme.backgroundElement }]}>
                <ThemedText type="small" themeColor="textSecondary">
                  Enter this code on github.com (copied to clipboard):
                </ThemedText>
                <ThemedText type="subtitle" style={styles.code}>
                  {session.userCode}
                </ThemedText>
                <ThemedText type="small" themeColor="textSecondary">
                  Waiting for approval…
                </ThemedText>
              </View>
            ) : (
              <>
                <Button title="Sign in with GitHub" onPress={beginDeviceFlow} loading={busy} />
                <TextField
                  label="OAuth client ID (advanced, optional)"
                  placeholder="Use your own GitHub OAuth app"
                  value={clientId}
                  onChangeText={setClientId}
                  mono
                />
              </>
            )}
          </View>
        ) : (
          <View style={styles.block}>
            <TextField
              label="Personal access token"
              placeholder="github_pat_… or ghp_…"
              value={pat}
              onChangeText={setPat}
              secureTextEntry
              mono
              hint="Create one at github.com → Settings → Developer settings. It needs the “repo” scope (or read/write access to contents, administration, and pages for fine-grained tokens)."
            />
            <Button title="Connect" onPress={connectWithPat} loading={busy} disabled={!pat.trim()} />
          </View>
        )}

        {error ? <ThemedText style={{ color: theme.danger }}>{error}</ThemedText> : null}
      </ScrollView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    padding: Spacing.three,
    gap: Spacing.four,
  },
  block: {
    gap: Spacing.three,
  },
  codeCard: {
    borderRadius: 16,
    padding: Spacing.four,
    alignItems: 'center',
    gap: Spacing.two,
  },
  code: {
    letterSpacing: 4,
  },
});
