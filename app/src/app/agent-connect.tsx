import * as Clipboard from 'expo-clipboard';
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { router } from 'expo-router';
import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { Alert, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Button } from '@/components/ui/button';
import { Glass } from '@/components/ui/glass';
import { Row, RowDivider, Section } from '@/components/ui/section';
import { Radii, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { buildAgentInvite } from '@/lib/agent-connect/invite';
import { agentConnectRuntime } from '@/lib/agent-connect/runtime';

export default function AgentConnectScreen() {
  const insets = useSafeAreaInsets();
  const theme = useTheme();
  const runtime = useSyncExternalStore(
    agentConnectRuntime.subscribe,
    agentConnectRuntime.snapshot,
    agentConnectRuntime.snapshot,
  );
  const core = agentConnectRuntime.core;
  const [, forceRender] = useState(0);
  const [clock, setClock] = useState(0);
  const ticket = core.activeTicket;
  const pending = core.pendingApproval;

  useEffect(() => core.subscribe(() => forceRender((value) => value + 1)), [core]);
  useEffect(() => {
    void agentConnectRuntime.initialize();
  }, []);

  useEffect(() => {
    if (!pending) return;
    Alert.alert(
      'Allow this agent?',
      `${pending.agentName} at ${pending.remoteAddress} wants access to list projects, read and write project files, and append visible project messages.`,
      [
        { text: 'Deny', style: 'cancel', onPress: () => void core.resolveApproval(false) },
        { text: 'Allow', onPress: () => void core.resolveApproval(true) },
      ],
      { cancelable: false },
    );
  }, [core, pending]);

  useEffect(() => {
    if (!ticket || ticket.redeemed) return;
    const timer = setInterval(() => setClock(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, [ticket]);

  const invite = useMemo(() => {
    if (!ticket || !runtime.host || ticket.redeemed || ticket.expiresAt <= clock) return null;
    return buildAgentInvite(ticket, runtime.host);
  }, [runtime.host, ticket, clock]);

  const issueInvite = () => {
    if (!runtime.running || !runtime.host) return;
    core.issueTicket();
    forceRender((value) => value + 1);
  };

  const copyInvite = async () => {
    if (!invite) return;
    await Clipboard.setStringAsync(invite);
    Alert.alert('Agent invite copied', 'Paste it into Hermes, Codex, Claude Code, OpenCode, or another MCP client on the same Wi-Fi.');
  };

  const shareInvite = async () => {
    if (!invite) return;
    if (!(await Sharing.isAvailableAsync())) {
      Alert.alert('Sharing unavailable', 'Copy the invite instead.');
      return;
    }
    const file = new File(Paths.cache, 'connect-vibexstudio.md');
    file.write(invite);
    await Sharing.shareAsync(file.uri, {
      mimeType: 'text/markdown',
      UTI: 'net.daringfireball.markdown',
      dialogTitle: 'Share VibeXStudio agent invite',
    });
  };

  const confirmRevoke = (agentId: string, name: string) => {
    Alert.alert(`Unlink ${name}?`, 'Its bearer token will stop working immediately.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Unlink', style: 'destructive', onPress: () => void core.revokeAgent(agentId) },
    ]);
  };

  return (
    <ThemedView style={styles.screen}>
      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + Spacing.four }]}>
        <View style={styles.hero}>
          <ThemedText style={styles.heroIcon}>🪽</ThemedText>
          <ThemedText type="title" style={styles.center}>Connect an agent</ThemedText>
          <ThemedText themeColor="textSecondary" style={styles.center}>
            Let a trusted agent work directly in your VibeX projects while this app is open on the same Wi-Fi.
          </ThemedText>
        </View>

        <Glass style={styles.card}>
          <View style={styles.statusLine}>
            <View style={[styles.dot, { backgroundColor: runtime.running ? theme.success : theme.danger }]} />
            <ThemedText type="heading">{runtime.running ? 'Ready on this phone' : 'Agent Connect unavailable'}</ThemedText>
          </View>
          {runtime.running && runtime.host ? (
            <>
              <Fact label="MCP address" value={`http://${runtime.host}:8791/mcp`} />
              <ThemedText themeColor="textSecondary">
                Local network only. Keep VibeXStudio in the foreground and keep both devices on the same Wi-Fi.
              </ThemedText>
            </>
          ) : (
            <ThemedText accessibilityRole="alert" style={{ color: theme.danger }}>
              {runtime.error ?? 'Bring VibeXStudio to the foreground and join Wi-Fi.'}
            </ThemedText>
          )}
        </Glass>

        <Glass style={styles.card}>
          <ThemedText type="heading">One-time invite</ThemedText>
          <ThemedText themeColor="textSecondary">
            The code lasts 15 minutes, works once, and still requires you to tap Allow on this phone. The returned bearer token lives only in the agent&apos;s secret store and this device&apos;s keychain.
          </ThemedText>
          {invite && ticket ? (
            <>
              <Fact label="Pairing code" value={ticket.code} mono />
              <Fact label="Expires" value={new Date(ticket.expiresAt).toLocaleTimeString()} />
              <Button title="Copy complete agent invite" onPress={copyInvite} />
              <Button title="Share invite file" variant="secondary" onPress={shareInvite} />
            </>
          ) : (
            <Button title="Generate one-time invite" onPress={issueInvite} disabled={!runtime.running} />
          )}
        </Glass>

        <Section title="Linked agents">
          {core.agents.length ? core.agents.map((agent, index) => (
            <View key={agent.id}>
              {index ? <RowDivider /> : null}
              <Row
                title={agent.name}
                subtitle={`Paired ${new Date(agent.pairedAt).toLocaleString()}${agent.lastSeenAt ? ` · last used ${new Date(agent.lastSeenAt).toLocaleString()}` : ''}`}
                right={<ThemedText style={{ color: theme.danger }}>Unlink</ThemedText>}
                onPress={() => confirmRevoke(agent.id, agent.name)}
              />
            </View>
          )) : (
            <Row title="No linked agents" subtitle="Generate an invite to connect Hermes, Codex, Claude Code, OpenCode, or another MCP client." />
          )}
        </Section>

        <Button title="Done" variant="secondary" onPress={() => router.back()} />
      </ScrollView>
    </ThemedView>
  );
}

function Fact({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <View style={styles.fact}>
      <ThemedText type="smallBold" themeColor="textSecondary">{label}</ThemedText>
      <ThemedText selectable style={mono ? styles.mono : undefined}>{value}</ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { padding: Spacing.three, gap: Spacing.three },
  hero: { alignItems: 'center', gap: Spacing.two, paddingVertical: Spacing.two },
  heroIcon: { fontSize: 48, lineHeight: 58 },
  center: { textAlign: 'center' },
  card: { padding: Spacing.three, gap: Spacing.three, borderRadius: Radii.lg },
  statusLine: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  dot: { width: 10, height: 10, borderRadius: 5 },
  fact: { gap: Spacing.one },
  mono: { fontFamily: 'Menlo', fontSize: 13 },
});
