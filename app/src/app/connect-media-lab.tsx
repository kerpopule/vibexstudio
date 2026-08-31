/**
 * Pair a Media Lab server. The user pastes the URL the desktop app (or
 * Spark) shows — pairing succeeds when the server's gate-exempt
 * /manifest.json answers. Once paired, the Media Lab tab gains a "Server"
 * view hosting the full web UI (the on-device studio is always there).
 */
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, TextInput, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Radii, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { normalizeServerUrl, probeMediaLab } from '@/lib/media-pairing';
import { useApp } from '@/lib/store';

export default function ConnectMediaLabScreen() {
  const theme = useTheme();
  // A failed vibex://pair QR scan lands here with the address prefilled.
  const params = useLocalSearchParams<{ url?: string }>();
  const mediaLab = useApp((s) => s.mediaLab);
  const setMediaLab = useApp((s) => s.setMediaLab);
  const [input, setInput] = useState(params.url ?? mediaLab?.url ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    const url = normalizeServerUrl(input);
    if (!url) {
      setError('That doesn’t look like a URL. Example: http://your-server:7863');
      return;
    }
    setBusy(true);
    setError(null);
    if (await probeMediaLab(url)) {
      await setMediaLab({ url, addedAt: Date.now() });
      setBusy(false);
      router.back();
    } else {
      setError(
        'No Media Lab answered there. Check the address, and that the server is running on your network or tailnet.'
      );
      setBusy(false);
    }
  };

  const remove = async () => {
    await setMediaLab(null);
    router.back();
  };

  return (
    <ThemedView style={styles.container}>
      <ThemedText themeColor="textSecondary" style={styles.blurb}>
        Paste the address your Media Lab shows — the desktop app or your own server. VibeX talks to it
        directly; nothing goes through anyone else.
      </ThemedText>
      <TextInput
        value={input}
        onChangeText={setInput}
        placeholder="http://your-server:7863"
        placeholderTextColor={theme.textSecondary}
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="url"
        style={[
          styles.input,
          { backgroundColor: theme.backgroundElement, color: theme.text, borderColor: theme.border },
        ]}
      />
      {error ? (
        <ThemedText type="small" style={{ color: theme.danger }}>
          {error}
        </ThemedText>
      ) : null}
      <Pressable
        onPress={save}
        disabled={busy}
        style={[styles.button, { backgroundColor: theme.tint, opacity: busy ? 0.6 : 1 }]}>
        {busy ? (
          <ActivityIndicator color={theme.onTint} />
        ) : (
          <ThemedText type="smallBold" style={{ color: theme.onTint }}>
            Pair Media Lab
          </ThemedText>
        )}
      </Pressable>
      {mediaLab ? (
        <Pressable onPress={remove} style={styles.removeRow} hitSlop={8}>
          <ThemedText type="smallBold" style={{ color: theme.danger }}>
            Remove pairing
          </ThemedText>
        </Pressable>
      ) : null}
      <View style={{ flex: 1 }} />
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: Spacing.three,
    gap: Spacing.three,
  },
  blurb: {
    lineHeight: 20,
  },
  input: {
    borderRadius: Radii.md,
    borderWidth: 1,
    paddingHorizontal: Spacing.three,
    paddingVertical: 12,
    fontSize: 16,
  },
  button: {
    borderRadius: Radii.lg,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
  },
  removeRow: {
    alignItems: 'center',
    paddingVertical: Spacing.two,
  },
});
