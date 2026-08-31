/**
 * Cloud rendering (fal.ai) walkthrough — door 3. Four steps, each a tap:
 * make an account, add billing, copy the key, paste it here. Models come
 * from the curated catalog with the recommended ones pre-selected, so nobody
 * has to know a model id.
 *
 * Where the key lands: a paired Media Lab server takes it via its
 * /api/providers settings API; with no server, it becomes an on-device fal
 * connection so the phone's own studio renders in the cloud.
 */
import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { useState } from 'react';
import { Linking, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Button } from '@/components/ui/button';
import { TextField } from '@/components/ui/text-field';
import { Radii, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { catalogFor, recommendedFalModel } from '@/lib/ai/fal-catalog';
import { useApp } from '@/lib/store';

const STEPS = [
  {
    title: 'Create a fal.ai account',
    body: 'Free to sign up — Google or GitHub works.',
    url: 'https://fal.ai/login',
  },
  {
    title: 'Add billing',
    body: 'You only pay for what you render — images cost pennies.',
    url: 'https://fal.ai/dashboard/billing',
  },
  {
    title: 'Copy your API key',
    body: 'Make a key and copy it — you’ll paste it in the next step.',
    url: 'https://fal.ai/dashboard/keys',
  },
] as const;

export default function FalSetupScreen() {
  const theme = useTheme();
  const mediaLab = useApp((s) => s.mediaLab);
  const providers = useApp((s) => s.providers);
  const addProvider = useApp((s) => s.addProvider);
  const removeProvider = useApp((s) => s.removeProvider);

  const [apiKey, setApiKey] = useState('');
  const [imageModel, setImageModel] = useState(recommendedFalModel('image'));
  const [videoModel, setVideoModel] = useState(recommendedFalModel('video'));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    const key = apiKey.trim();
    if (!key) return;
    setBusy(true);
    setError(null);
    try {
      if (mediaLab) {
        // A server is paired — the key belongs to it, so every device that
        // uses that Media Lab gets cloud rendering.
        const res = await fetch(`${mediaLab.url.replace(/\/+$/, '')}/api/providers`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            api_key: key,
            enabled: true,
            models: { image: imageModel, video: videoModel },
          }),
        });
        if (res.status === 401 || res.status === 403) {
          setError(
            'Your Media Lab wants you to sign in first. Open the Media Lab tab, sign in there, then come back and tap Save again.'
          );
          return;
        }
        if (!res.ok) {
          setError('Your Media Lab didn’t accept the key. Make sure it’s running, then try again.');
          return;
        }
      } else {
        // No server — the phone's own studio uses fal directly. Replace any
        // earlier fal connection instead of stacking duplicates.
        const existing = providers.find((p) => p.kind === 'fal');
        if (existing) await removeProvider(existing.id);
        await addProvider({
          kind: 'fal',
          auth: 'apiKey',
          secret: key,
          mediaModels: { image: imageModel, video: videoModel },
        });
      }
      if (router.canDismiss()) router.dismissAll();
    } catch {
      setError('Something interrupted the save. Check your connection and try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <ThemedView style={styles.container}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <ThemedText themeColor="textSecondary" style={styles.blurb}>
          Cloud rendering runs your prompts on big GPUs and sends the results back here. Four quick
          steps and you’re in.
        </ThemedText>

        {STEPS.map((step, i) => (
          <View key={step.title} style={[styles.step, { backgroundColor: theme.backgroundElement }]}>
            <View style={[styles.stepDot, { backgroundColor: theme.tintSoft }]}>
              <ThemedText type="smallBold" style={{ color: theme.tint, fontSize: 12 }}>
                {i + 1}
              </ThemedText>
            </View>
            <View style={styles.stepBody}>
              <ThemedText type="smallBold">{step.title}</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                {step.body}
              </ThemedText>
            </View>
            <Pressable
              accessibilityRole="button"
              onPress={() => Linking.openURL(step.url).catch(() => {})}
              style={[styles.openBtn, { backgroundColor: theme.tintSoft }]}
              hitSlop={6}>
              <ThemedText type="smallBold" style={{ color: theme.tint }}>
                Open
              </ThemedText>
              <Ionicons name="open-outline" size={13} color={theme.tint} />
            </Pressable>
          </View>
        ))}

        {/* Step 4 — paste the key. */}
        <View style={[styles.step, styles.pasteStep, { backgroundColor: theme.backgroundElement }]}>
          <View style={styles.stepHeader}>
            <View style={[styles.stepDot, { backgroundColor: theme.tintSoft }]}>
              <ThemedText type="smallBold" style={{ color: theme.tint, fontSize: 12 }}>
                4
              </ThemedText>
            </View>
            <ThemedText type="smallBold">Paste your key here</ThemedText>
          </View>
          <TextField
            placeholder="fal-…"
            value={apiKey}
            onChangeText={setApiKey}
            secureTextEntry
            mono
          />
          {mediaLab ? (
            <ThemedText type="small" themeColor="textSecondary">
              It’s saved to your paired Media Lab, so everything that uses it gets cloud rendering.
            </ThemedText>
          ) : (
            <ThemedText type="small" themeColor="textSecondary">
              It stays in this phone’s secure keychain and goes only to fal.ai.
            </ThemedText>
          )}
        </View>

        <ModelPicker
          label="IMAGES"
          options={catalogFor('image')}
          value={imageModel}
          onChange={setImageModel}
        />
        <ModelPicker
          label="VIDEO"
          options={catalogFor('video')}
          value={videoModel}
          onChange={setVideoModel}
        />

        <Button title="Save and start creating" onPress={save} loading={busy} disabled={!apiKey.trim()} />
        {error ? (
          <ThemedText type="small" style={{ color: theme.danger }}>
            {error}
          </ThemedText>
        ) : null}
      </ScrollView>
    </ThemedView>
  );
}

function ModelPicker({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: ReturnType<typeof catalogFor>;
  value: string;
  onChange: (id: string) => void;
}) {
  const theme = useTheme();
  return (
    <View style={styles.pickerBlock}>
      <ThemedText type="smallBold" themeColor="textSecondary">
        {label}
      </ThemedText>
      <View style={styles.chips}>
        {options.map((entry) => {
          const active = entry.id === value;
          return (
            <Pressable
              key={entry.id}
              onPress={() => onChange(entry.id)}
              style={[
                styles.chip,
                {
                  backgroundColor: active ? theme.tintSoft : theme.backgroundElement,
                  borderColor: active ? theme.tint : 'transparent',
                },
              ]}>
              <ThemedText type="smallBold" style={active ? { color: theme.tint } : undefined}>
                {entry.name}
              </ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                {entry.blurb}
                {entry.recommended ? ' · recommended' : ''}
              </ThemedText>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    padding: Spacing.three,
    gap: Spacing.two,
  },
  blurb: {
    lineHeight: 20,
    marginBottom: Spacing.one,
  },
  step: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    borderRadius: Radii.lg,
    padding: Spacing.three,
  },
  pasteStep: {
    flexDirection: 'column',
    alignItems: 'stretch',
  },
  stepHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  stepDot: {
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepBody: {
    flex: 1,
    gap: 2,
  },
  openBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderRadius: Radii.pill,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  pickerBlock: {
    gap: Spacing.one,
    marginTop: Spacing.one,
  },
  chips: {
    gap: Spacing.one,
  },
  chip: {
    borderRadius: Radii.md,
    borderWidth: 1,
    paddingHorizontal: Spacing.two,
    paddingVertical: 10,
    gap: 2,
  },
});
