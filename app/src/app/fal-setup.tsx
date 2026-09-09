/** Direct fal.ai setup. Pairing a compute server never changes key ownership. */
import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { useRef, useState } from 'react';
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
    body: 'Review fal.ai’s current model prices and billing before generating.',
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
  const providers = useApp((s) => s.providers);
  const addProvider = useApp((s) => s.addProvider);
  const saving = useRef(false);

  const [apiKey, setApiKey] = useState('');
  const [imageModel, setImageModel] = useState(recommendedFalModel('image'));
  const [videoModel, setVideoModel] = useState(recommendedFalModel('video'));
  const [saved, setSaved] = useState(false);
  const [advanced, setAdvanced] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    const key = apiKey.trim();
    if (!key || saving.current || saved) return;
    saving.current = true;
    setBusy(true);
    setError(null);
    try {
      // Add the new connection before touching any existing one. Projects may
      // still reference an older connection, so preserve it for explicit removal.
      await addProvider({
        kind: 'fal', auth: 'apiKey', secret: key,
        mediaModels: { image: imageModel, video: videoModel },
      });
      setApiKey('');
      setSaved(true);
    } catch {
      setError('Could not save the connection on this device. Check available storage or any credential-vault prompt, then try again. Existing connections are kept.');
    } finally {
      saving.current = false;
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
            editable={!busy && !saved}
            mono
          />
          <ThemedText type="small" themeColor="textSecondary">
            Saved on this device for direct requests to fal.ai. Native apps use the OS credential vault; browsers use this site’s local storage. Pairing Media Lab does not send this key to that server.
          </ThemedText>
          {providers.some(provider => provider.kind === 'fal') ? <ThemedText type="small" themeColor="textSecondary">This adds a new connection. Existing connections and projects are kept; remove an old connection in Setup when you no longer need it.</ThemedText> : null}
        </View>

        <Button title={advanced ? 'Hide model choices' : 'Choose image and video models'} variant="secondary" onPress={() => setAdvanced(value => !value)} disabled={busy || saved} />
        {advanced ? <>
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

        </> : <ThemedText type="small" themeColor="textSecondary">Start with the selected defaults. You can change models before generating.</ThemedText>}
        {saved ? <>
          <ThemedText accessibilityRole="alert">Connection saved on this device. No generation was started and the key has not been verified with fal.ai.</ThemedText>
          <Button title="Done" onPress={() => router.canGoBack() ? router.back() : router.replace('/(tabs)')} />
        </> : <Button title="Save on this device" onPress={save} loading={busy} disabled={!apiKey.trim()} />}

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
