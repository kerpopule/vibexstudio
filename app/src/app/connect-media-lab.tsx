/**
 * Pair a Media Lab server. The user pastes the URL the desktop app (or
 * Spark) shows — pairing succeeds when the server's gate-exempt
 * /manifest.json answers. The Media Lab tab appears once paired.
 */
import { router } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, TextInput, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Radii, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useApp } from '@/lib/store';

function normalize(raw: string): string | null {
  let url = raw.trim();
  if (!url) return null;
  if (!/^https?:\/\//i.test(url)) url = `http://${url}`;
  try {
    const parsed = new URL(url);
    return `${parsed.protocol}//${parsed.host}`;
  } catch {
    return null;
  }
}

export default function ConnectMediaLabScreen() {
  const theme = useTheme();
  const mediaLab = useApp((s) => s.mediaLab);
  const setMediaLab = useApp((s) => s.setMediaLab);
  const [input, setInput] = useState(mediaLab?.url ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    const url = normalize(input);
    if (!url) {
      setError('That doesn’t look like a URL. Example: http://your-server:7863');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 6000);
      const res = await fetch(`${url}/manifest.json`, { signal: controller.signal });
      clearTimeout(timer);
      if (!res.ok) throw new Error(`answered ${res.status}`);
      await setMediaLab({ url, addedAt: Date.now() });
      router.back();
    } catch {
      setError(
        'No Media Lab answered there. Check the address, and that the server is running on your network or tailnet.'
      );
    } finally {
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
