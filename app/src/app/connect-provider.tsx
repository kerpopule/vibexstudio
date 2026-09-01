import { router, useLocalSearchParams } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Button } from '@/components/ui/button';
import { TextField } from '@/components/ui/text-field';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { connectOpenRouter } from '@/lib/ai/openrouterOauth';
import { PROVIDER_ORDER, PROVIDERS } from '@/lib/ai/registry';
import { SUBSCRIPTION_ORDER, SUBSCRIPTION_PROVIDERS } from '@/lib/ai/subscriptionOauth';
import { useApp } from '@/lib/store';
import type { ProviderKind } from '@/lib/types';

export default function ConnectProviderScreen() {
  const theme = useTheme();
  const addProvider = useApp((s) => s.addProvider);
  // `?kind=` preselects a provider (onboarding / Setup tiles land here directly).
  const params = useLocalSearchParams<{ kind?: string }>();
  const preselect = params.kind && params.kind in PROVIDERS ? (params.kind as ProviderKind) : null;
  const [kind, setKind] = useState<ProviderKind | null>(preselect);
  const [apiKey, setApiKey] = useState('');
  const [model, setModel] = useState(preselect ? PROVIDERS[preselect].defaultModel : '');
  const [baseUrl, setBaseUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const spec = kind ? PROVIDERS[kind] : null;

  const saveWithKey = async () => {
    if (!kind || !apiKey.trim()) return;
    if (kind === 'custom' && !baseUrl.trim()) {
      setError('A base URL is required for a custom endpoint.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await addProvider({ kind, auth: 'apiKey', secret: apiKey.trim(), model, baseUrl });
      router.dismiss();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save the connection.');
    } finally {
      setBusy(false);
    }
  };

  const saveWithOAuth = async () => {
    setBusy(true);
    setError(null);
    try {
      const key = await connectOpenRouter();
      await addProvider({ kind: 'openrouter', auth: 'oauth', secret: key, model });
      router.dismiss();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'OpenRouter sign-in failed.');
    } finally {
      setBusy(false);
    }
  };

  if (!kind) {
    return (
      <ThemedView style={styles.container}>
        <ScrollView contentContainerStyle={styles.content}>
          <ThemedText themeColor="textSecondary">
            Bring your own AI. Everything is stored in this device’s secure keychain and sent only to the provider
            you choose — no VibeXStudio account, no server.
          </ThemedText>

          <ThemedText type="smallBold" themeColor="textSecondary" style={styles.sectionLabel}>
            USE YOUR SUBSCRIPTION (NO API KEY)
          </ThemedText>
          {SUBSCRIPTION_ORDER.map((id) => {
            const sub = SUBSCRIPTION_PROVIDERS[id];
            return (
              <Pressable
                key={id}
                onPress={() => router.push({ pathname: '/connect-subscription', params: { provider: id } })}
                style={({ pressed }) => [
                  styles.providerCard,
                  { backgroundColor: theme.tintSoft, opacity: pressed ? 0.7 : 1 },
                ]}>
                <View style={styles.providerBody}>
                  <ThemedText type="smallBold">{sub.name}</ThemedText>
                  <ThemedText type="small" themeColor="textSecondary">
                    {sub.blurb}
                  </ThemedText>
                </View>
                <ThemedText themeColor="tint">›</ThemedText>
              </Pressable>
            );
          })}

          <ThemedText type="smallBold" themeColor="textSecondary" style={styles.sectionLabel}>
            API KEY OR OAUTH
          </ThemedText>
          {PROVIDER_ORDER.map((candidate) => {
            const candidateSpec = PROVIDERS[candidate];
            return (
              <Pressable
                key={candidate}
                onPress={() => {
                  setKind(candidate);
                  setModel(candidateSpec.defaultModel);
                }}
                style={({ pressed }) => [
                  styles.providerCard,
                  { backgroundColor: theme.backgroundElement, opacity: pressed ? 0.7 : 1 },
                ]}>
                <View style={styles.providerBody}>
                  <ThemedText type="smallBold">{candidateSpec.name}</ThemedText>
                  <ThemedText type="small" themeColor="textSecondary">
                    {candidateSpec.blurb}
                  </ThemedText>
                </View>
                <ThemedText themeColor="textSecondary">›</ThemedText>
              </Pressable>
            );
          })}
        </ScrollView>
      </ThemedView>
    );
  }

  return (
    <ThemedView style={styles.container}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Pressable onPress={() => setKind(null)}>
          <ThemedText themeColor="tint">‹ All providers</ThemedText>
        </Pressable>
        <ThemedText type="subtitle">{spec!.name}</ThemedText>

        {spec!.supportsOAuth ? (
          <View style={styles.block}>
            <Button title={`Sign in with ${spec!.name}`} onPress={saveWithOAuth} loading={busy} />
            <ThemedText type="small" themeColor="textSecondary" style={styles.center}>
              — or paste an API key below —
            </ThemedText>
          </View>
        ) : null}

        {kind === 'custom' ? (
          <TextField
            label="Base URL"
            placeholder="https://my-host.example/v1"
            value={baseUrl}
            onChangeText={setBaseUrl}
            keyboardType="url"
            mono
          />
        ) : null}

        <TextField
          label="API key"
          placeholder="sk-…"
          value={apiKey}
          onChangeText={setApiKey}
          secureTextEntry
          mono
          hint={spec!.keyUrl ? `Get a key at ${spec!.keyUrl}` : undefined}
        />
        {spec!.keyUrl ? (
          <Pressable onPress={() => WebBrowser.openBrowserAsync(spec!.keyUrl!)}>
            <ThemedText type="small" themeColor="tint">
              Open {spec!.keyUrl} ↗
            </ThemedText>
          </Pressable>
        ) : null}

        <TextField
          label="Default model"
          placeholder={spec!.defaultModel || 'model-name'}
          value={model}
          onChangeText={setModel}
          mono
        />
        {spec!.suggestedModels.length > 0 ? (
          <View style={styles.chips}>
            {spec!.suggestedModels.map((suggested) => (
              <Pressable
                key={suggested}
                onPress={() => setModel(suggested)}
                style={[
                  styles.chip,
                  { backgroundColor: suggested === model ? theme.tintSoft : theme.backgroundElement },
                ]}>
                <ThemedText type="small">{suggested}</ThemedText>
              </Pressable>
            ))}
          </View>
        ) : null}

        <Button title="Save connection" onPress={saveWithKey} loading={busy} disabled={!apiKey.trim()} />
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
    gap: Spacing.three,
  },
  sectionLabel: {
    marginTop: Spacing.two,
  },
  providerCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    borderRadius: 16,
    padding: Spacing.three,
  },
  providerBody: {
    flex: 1,
    gap: 2,
  },
  block: {
    gap: Spacing.three,
  },
  center: {
    textAlign: 'center',
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.two,
  },
  chip: {
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
});
