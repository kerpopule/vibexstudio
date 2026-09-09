import { Alert } from '@/lib/app-alert';
import * as Clipboard from 'expo-clipboard';
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { router } from 'expo-router';
import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Button } from '@/components/ui/button';
import { Glass } from '@/components/ui/glass';
import { Row, RowDivider, Section } from '@/components/ui/section';
import { Radii, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { buildAgentInvite } from '@/lib/agent-connect/invite';
import { RemoteAgentSetup } from '@/components/remote-agent-setup';
import type { RemoteTarget } from '@/lib/agent-connect/remote';
import { agentConnectRuntime } from '@/lib/agent-connect/runtime';

// Remember the user's destination across screen navigation in this app session.
// A missing remote connection still disables its invite; never switch destinations silently.
let sessionInviteLocation: 'local' | 'remote' = 'local';

export default function AgentConnectScreen() {
  const insets = useSafeAreaInsets();
  const theme = useTheme();
  const runtime = useSyncExternalStore(
    agentConnectRuntime.subscribe,
    agentConnectRuntime.snapshot,
    agentConnectRuntime.snapshot,
  );
  const core = agentConnectRuntime.core;
  // Keep mutable core fields in React state so the compiler tracks invite and linked-agent changes.
  const [coreState, setCoreState] = useState(() => ({ticket:core.activeTicket, agents:[...core.agents]}));
  const [clock, setClock] = useState(0);
  const ticket = coreState.ticket;
  const [remoteTarget,setRemoteTarget]=useState<RemoteTarget|null>(null);
  const [inviteLocation,setInviteLocation]=useState<'local'|'remote'>(()=>sessionInviteLocation);
  const chooseInviteLocation=(value:'local'|'remote')=>{sessionInviteLocation=value;setInviteLocation(value);};

  useEffect(() => core.subscribe(() => setCoreState({ticket:core.activeTicket, agents:[...core.agents]})), [core]);
  useEffect(() => {
    void agentConnectRuntime.initialize();
  }, []);

  useEffect(() => {
    if (!ticket || ticket.redeemed) return;
    const timer = setInterval(() => setClock(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, [ticket]);

  const invite = useMemo(() => {
    if (!ticket || !runtime.host || ticket.redeemed || ticket.expiresAt <= clock) return null;
    if (inviteLocation==='remote' && !remoteTarget) return null;
    return inviteLocation==='remote' && remoteTarget
      ? buildAgentInvite(ticket, '127.0.0.1', {port:remoteTarget.port,remoteServer:remoteTarget.host})
      : buildAgentInvite(ticket, runtime.host, {port:runtime.port,localComputer:runtime.localComputer});
  }, [runtime.host, runtime.port, runtime.localComputer, ticket, clock, remoteTarget, inviteLocation]);

  const issueInvite = () => {
    if (!runtime.running || !runtime.host) return;
    core.issueTicket();
  };

  const copyInvite = async () => {
    if (!invite) return;
    await Clipboard.setStringAsync(invite);
    Alert.alert('Agent invite copied', inviteLocation==='remote' && remoteTarget ? `Paste it into an agent running on ${remoteTarget.host}. Keep Studio open.` : runtime.localComputer ? 'Paste it into an agent running on this computer. Keep Studio open.' : 'Paste it into Hermes or another MCP client on the same Wi-Fi.');
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
    Alert.alert(`Unlink ${name}?`, 'This stops new requests from the agent. Work it already started may continue.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Unlink', style: 'destructive', onPress: () => {
        void core.revokeAgent(agentId).then(result => {
          if (result.credentialCleanupPending) Alert.alert('Agent unlinked', 'Its access is removed. The device could not delete its old credential from the secure vault, but that credential no longer works.');
        }).catch(() => Alert.alert('Could not unlink agent', 'The agent is still linked. Check device storage and try again.'));
      } },
    ]);
  };

  return (
    <ThemedView style={styles.screen}>
      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + Spacing.four }]}>
        <View style={styles.hero}>
          <ThemedText style={styles.heroIcon}>🪽</ThemedText>
          <ThemedText type="title" style={styles.center}>Connect an agent</ThemedText>
          <ThemedText themeColor="textSecondary" style={styles.center}>
            Let a trusted agent work directly in your VibeX projects while this app is open.
          </ThemedText>
        </View>

        <Glass style={styles.card}>
          <View style={styles.statusLine}>
            <View style={[styles.dot, { backgroundColor: runtime.running ? theme.success : theme.danger }]} />
            <ThemedText type="heading">{runtime.running ? 'Ready on this device' : 'Agent Connect unavailable'}</ThemedText>
          </View>
          {runtime.running && runtime.host ? (
            <>
              <Fact label="MCP address" value={`http://${runtime.host}:${runtime.port ?? 8791}/mcp`} />
              <ThemedText themeColor="textSecondary">
                {runtime.localComputer ? 'Same computer only. Keep Studio open while your agent works. Use the remote setup below if your agent runs elsewhere.' : 'Local network only. Keep VibeXStudio in the foreground and keep both devices on the same Wi-Fi.'}
              </ThemedText>
            </>
          ) : (
            <ThemedText accessibilityRole="alert" style={{ color: theme.danger }}>
              {runtime.error ?? 'Bring VibeXStudio to the foreground and join Wi-Fi.'}
            </ThemedText>
          )}
        </Glass>

        {runtime.localComputer && runtime.running ? <Glass style={styles.card}><RemoteAgentSetup onTarget={setRemoteTarget}/></Glass> : null}

        <Glass style={styles.card}>
          <ThemedText type="heading">One-time invite</ThemedText>
          <ThemedText themeColor="textSecondary">
            The code lasts 15 minutes, works once, and still requires approval on this device. Choose projects only, or also allow media library access. The returned bearer token lives only in the agent&apos;s secret store and this device&apos;s keychain.
          </ThemedText>
          {runtime.localComputer ? <>
            <ThemedText type="smallBold">Where will you paste the invite?</ThemedText>
            <Button title="Agent on this computer" variant={inviteLocation==='local'?'primary':'secondary'} onPress={()=>chooseInviteLocation('local')}/>
            <Button title="Agent on my server" variant={inviteLocation==='remote'?'primary':'secondary'} onPress={()=>chooseInviteLocation('remote')}/>
            <ThemedText>{inviteLocation==='local'?'Invite destination: this computer.':remoteTarget?`Invite destination: ${remoteTarget.host}. Keep its connection running.`:'Connect your server above before generating its invite.'}</ThemedText>
          </> : null}
          {invite && ticket ? (
            <>
              <Fact label="Pairing code" value={ticket.code} mono />
              <Fact label="Expires" value={new Date(ticket.expiresAt).toLocaleTimeString()} />
              <Button title="Copy complete agent invite" onPress={copyInvite} />
              <Button title="Share invite file" variant="secondary" onPress={shareInvite} />
            </>
          ) : (
            <Button title="Generate one-time invite" onPress={issueInvite} disabled={!runtime.running || (inviteLocation==='remote' && !remoteTarget)} />
          )}
        </Glass>

        <Section title="Linked agents">
          {coreState.agents.length ? coreState.agents.map((agent, index) => (
            <View key={agent.id}>
              {index ? <RowDivider /> : null}
              <Row
                title={agent.name}
                subtitle={`${agent.mediaRender ? 'Projects + video rendering' : agent.mediaEdit ? 'Projects + video editing' : agent.mediaGenerate ? 'Projects + media generation' : agent.mediaBackground ? (agent.mediaImport ? 'Projects + media tools' : 'Projects + background removal') : agent.mediaImport ? 'Projects + media import' : agent.mediaRead ? 'Projects + media library' : 'Projects only'} · Paired ${new Date(agent.pairedAt).toLocaleString()}${agent.lastSeenAt ? ` · last used ${new Date(agent.lastSeenAt).toLocaleString()}` : ''}`}
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
