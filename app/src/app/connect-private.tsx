import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Button } from '@/components/ui/button';
import { Glass } from '@/components/ui/glass';
import { Radii, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import {
  discardPendingPrivateProvider,
  redeemPrivateInvite,
  type PendingPrivateProvider,
} from '@/lib/private-provider/client';
import { useApp } from '@/lib/store';

function formatExpiry(value: number): string {
  return new Date(value).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

export default function ConnectPrivateScreen() {
  const { token } = useLocalSearchParams<{ token?: string }>();
  const [inviteToken, setInviteToken] = useState(typeof token === 'string' ? token : '');
  const insets = useSafeAreaInsets();
  const theme = useTheme();
  const addPrivateProvider = useApp((state) => state.addPrivateProvider);
  const [pending, setPending] = useState<PendingPrivateProvider | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const review = async () => {
    setBusy(true);
    setError('');
    try {
      if (!inviteToken) throw new Error('This private invite link is missing or invalid.');
      const candidate = await redeemPrivateInvite(inviteToken);
      setPending(candidate);
      setInviteToken('');
      // The one-time invite is no longer needed after redemption. Remove it
      // from router state so it cannot survive in navigation diagnostics.
      router.setParams({ token: '' });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The private invite could not be redeemed.');
    } finally {
      setBusy(false);
    }
  };

  const connect = async () => {
    if (!pending) return;
    setBusy(true);
    setError('');
    try {
      await addPrivateProvider(pending);
      setPending(null);
      router.replace('/(tabs)/settings');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The private provider could not be saved.');
    } finally {
      setBusy(false);
    }
  };

  const cancel = async () => {
    if (pending) await discardPendingPrivateProvider(pending).catch(() => {});
    setPending(null);
    router.back();
  };

  return (
    <ThemedView style={styles.screen}>
      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + Spacing.four }]}>
        <View style={styles.hero}>
          <ThemedText style={styles.lock}>🔐</ThemedText>
          <ThemedText type="title" style={styles.center}>Private VibeX Models</ThemedText>
          <ThemedText themeColor="textSecondary" style={styles.center}>
            A device-scoped friends-and-family connection. No URL, provider key, or model setup is required.
          </ThemedText>
        </View>

        {pending ? (
          <Glass style={styles.card}>
            <ThemedText type="heading">Review before connecting</ThemedText>
            <Fact label="Issued by" value={pending.metadata.issuer} />
            <Fact label="Models" value={pending.metadata.allowedModels.join(', ')} />
            <Fact label="Capabilities" value="Streaming text chat only — no tools, vision, image, video, H3, files, or remote media" />
            <Fact label="Grant expires" value={formatExpiry(pending.metadata.expiresAt)} />
            <Fact
              label="Limits"
              value={`${pending.metadata.limits.perDevicePerDay}/device/day · ${pending.metadata.limits.perGrantPerDay}/grant/day · ${pending.metadata.limits.perDeviceConcurrent} request/device · ${pending.metadata.limits.globalConcurrent} pilot-wide`}
            />
            <Fact label="Revocation" value="The issuer can revoke access immediately. Remove Private VibeX Models in Settings to revoke this device and delete local credentials." />
            <View style={[styles.notice, { backgroundColor: theme.tintSoft, borderColor: theme.border }]}>
              <ThemedText type="smallBold">Private infrastructure notice</ThemedText>
              <ThemedText type="small">
                Prompts and generated output pass through Steve&apos;s private infrastructure. Do not use customer,
                production, regulated, or sensitive data. VibeXStudio and the broker do not log prompt or output bodies.
              </ThemedText>
            </View>
            <Button title="I understand — connect" onPress={connect} loading={busy} />
            <Button title="Cancel and revoke" variant="secondary" onPress={cancel} disabled={busy} />
          </Glass>
        ) : (
          <Glass style={styles.card}>
            <ThemedText type="heading">Redeem on this device</ThemedText>
            <ThemedText themeColor="textSecondary">
              The one-time invite is checked by the private broker and exchanged for a credential bound to this
              installation. The invite itself is never stored, copied, logged, or added to a project.
            </ThemedText>
            <Button title="Review private grant" onPress={review} loading={busy} disabled={!inviteToken} />
            <Button title="Not now" variant="secondary" onPress={() => router.back()} disabled={busy} />
          </Glass>
        )}

        {error ? (
          <View accessibilityRole="alert" style={[styles.error, { borderColor: theme.danger }]}>
            <ThemedText style={{ color: theme.danger }}>{error}</ThemedText>
          </View>
        ) : null}
      </ScrollView>
    </ThemedView>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.fact}>
      <ThemedText type="smallBold" themeColor="textSecondary">{label}</ThemedText>
      <ThemedText>{value}</ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { padding: Spacing.three, gap: Spacing.three },
  hero: { alignItems: 'center', gap: Spacing.two, paddingVertical: Spacing.three },
  lock: { fontSize: 48, lineHeight: 58 },
  center: { textAlign: 'center' },
  card: { padding: Spacing.three, gap: Spacing.three, borderRadius: Radii.lg },
  fact: { gap: Spacing.one },
  notice: { gap: Spacing.one, padding: Spacing.three, borderRadius: Radii.md, borderWidth: StyleSheet.hairlineWidth },
  error: { padding: Spacing.three, borderRadius: Radii.md, borderWidth: 1 },
});
