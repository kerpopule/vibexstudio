import Ionicons from '@expo/vector-icons/Ionicons';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Radii, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { fetchModels, shortModelLabel, staticModels } from '@/lib/ai/models';
import { getProviderSecret } from '@/lib/storage/secrets';
import { useApp } from '@/lib/store';

export default function EditModelScreen() {
  const theme = useTheme();
  const { connectionId } = useLocalSearchParams<{ connectionId: string }>();
  const providers = useApp((s) => s.providers);
  const setConnectionModel = useApp((s) => s.setConnectionModel);
  const refreshSubscriptionIfNeeded = useApp((s) => s.refreshSubscriptionIfNeeded);
  const connection = providers.find((p) => p.id === connectionId) ?? null;

  const [models, setModels] = useState<string[]>(connection ? staticModels(connection) : []);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(connection?.defaultModel ?? '');
  const connectionId2 = connection?.id;

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      if (!connection) return;
      try {
        // Fresh token for subscriptions so the models call authenticates.
        if (connection.subscription) await refreshSubscriptionIfNeeded(connection.id).catch(() => {});
        const secret = (await getProviderSecret(connection.id)) ?? '';
        const live = await fetchModels(connection, secret);
        if (!cancelled) setModels(live);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connectionId2]);

  const choose = async (model: string) => {
    if (!connection) return;
    setSelected(model);
    await setConnectionModel(connection.id, model);
    router.back();
  };

  if (!connection) {
    return (
      <ThemedView style={styles.container}>
        <ThemedText style={styles.pad}>Connection not found.</ThemedText>
      </ThemedView>
    );
  }

  return (
    <ThemedView style={styles.container}>
      <ScrollView contentContainerStyle={styles.content}>
        <ThemedText type="subtitle">{connection.label}</ThemedText>
        <ThemedText themeColor="textSecondary" type="small">
          Pick the model for this provider. The list is pulled live each time you open this screen, so
          new models show up automatically.
        </ThemedText>

        {loading ? (
          <View style={styles.loading}>
            <ActivityIndicator color={theme.tint} />
            <ThemedText type="small" themeColor="textSecondary">
              Loading models…
            </ThemedText>
          </View>
        ) : null}

        <View style={[styles.list, { borderColor: theme.border }]}>
          {models.map((model, i) => {
            const isSel = model === selected;
            return (
              <Pressable
                key={model}
                onPress={() => choose(model)}
                style={[
                  styles.option,
                  i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.border },
                  isSel && { backgroundColor: theme.tintSoft },
                ]}>
                <View style={styles.optionBody}>
                  <ThemedText style={isSel ? { color: theme.tint } : undefined}>
                    {shortModelLabel(model)}
                  </ThemedText>
                  <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
                    {model}
                  </ThemedText>
                </View>
                {isSel ? <Ionicons name="checkmark-circle" size={22} color={theme.tint} /> : null}
              </Pressable>
            );
          })}
        </View>
      </ScrollView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { padding: Spacing.three, gap: Spacing.three },
  pad: { padding: Spacing.three },
  loading: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  list: { borderRadius: Radii.lg, borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden' },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.three,
    gap: Spacing.two,
  },
  optionBody: { flex: 1, gap: 2 },
});
