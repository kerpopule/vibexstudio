/**
 * Setup — everything that connects VibeX to the world, in the order a
 * person thinks about it: the checklist first (what's done, what's next),
 * then Your AI, Media Lab, Your computer, Publish, Agents, and the
 * housekeeping (appearance, storage, privacy). Every row goes somewhere.
 */
import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Alert, Linking, Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Segmented } from '@/components/segmented';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { EmojiTile } from '@/components/ui/emoji-tile';
import { Glass } from '@/components/ui/glass';
import { ScalePress } from '@/components/ui/scale-press';
import { Row, RowDivider, Section } from '@/components/ui/section';
import { TAB_PILL_CLEARANCE } from '@/components/ui/tab-pill';
import { Fonts, Radii, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { falModelName, recommendedFalModel } from '@/lib/ai/fal-catalog';
import { providerGlyph, shortModelLabel } from '@/lib/ai/models';
import { thisDevice } from '@/lib/device';
import { formatBytes } from '@/lib/format';
import { hostLabel, setupSteps, type SetupStepId } from '@/lib/setup';
import { projectSizeBytes } from '@/lib/storage/projects';
import type { AppearancePref } from '@/lib/storage/settings';
import { useApp } from '@/lib/store';
import { checkForUpdate, currentVersion, hasNativeUpdater, runNativeUpdater, updateDestination } from '@/lib/update-check';
import { clearSyncFolder, pickSyncFolder, syncFolderUri, syncNow } from '@/lib/sync/android-folder-sync';
import { safTreeLabel } from '@/lib/sync/sync-plan';

const STEP_GLYPH: Record<SetupStepId, string> = { ai: '✨', media: '🎬', computer: '🖥️', publish: '🐙' };

export default function SetupScreen() {
  const insets = useSafeAreaInsets();
  const theme = useTheme();
  const { github, providers, appearance, setAppearance, disconnectGitHub, removeProvider, mediaLab, workbench, unpairWorkbench } = useApp();
  const projects = useApp((s) => s.projects);
  const refreshProjects = useApp((s) => s.refreshProjects);
  const deleteProject = useApp((s) => s.deleteProject);
  const [sizes, setSizes] = useState<Record<string, number>>({});
  const [syncFolder, setSyncFolder] = useState<string | null>(null);
  const [syncBusy, setSyncBusy] = useState(false);
  const [showStorage, setShowStorage] = useState(false);
  const [checkingUpdate, setCheckingUpdate] = useState(false);

  const checkUpdates = async () => {
    if (checkingUpdate) return;
    setCheckingUpdate(true);
    try {
      if (hasNativeUpdater()) {
        await runNativeUpdater();
        return;
      }
      const info = await checkForUpdate(true);
      if (!info) {
        Alert.alert('You’re up to date', `VibeX Studio ${currentVersion()} is the latest release.`);
        return;
      }
      const destination = updateDestination(info);
      Alert.alert(`VibeX Studio ${info.version} is out`, info.notes.slice(0, 400) || 'A newer release is available.', [
        { text: 'Later', style: 'cancel' },
        { text: destination.label, onPress: () => void Linking.openURL(destination.url) },
      ]);
    } finally {
      setCheckingUpdate(false);
    }
  };

  const steps = setupSteps({ providers, mediaLab, workbench, github });
  const doneCount = steps.filter((s) => s.done).length;

  const loadSizes = useCallback(async () => {
    const fresh: Record<string, number> = {};
    await Promise.all(projects.map(async (p) => { fresh[p.id] = await projectSizeBytes(p.id); }));
    setSizes(fresh);
  }, [projects]);

  useFocusEffect(
    useCallback(() => {
      refreshProjects();
      loadSizes();
      if (Platform.OS === 'android') syncFolderUri().then(setSyncFolder);
    }, [refreshProjects, loadSizes])
  );

  const goTo = (id: SetupStepId) => {
    switch (id) {
      case 'ai': return router.push('/connect-provider');
      case 'media': return router.push('/media-lab-setup');
      case 'computer': return router.push('/pair-scan' as never);
      case 'publish': return router.push('/connect-github');
    }
  };

  const chooseSyncFolder = async () => {
    const uri = await pickSyncFolder();
    if (!uri) return;
    setSyncFolder(uri);
    runSyncNow();
  };

  const runSyncNow = async () => {
    if (syncBusy) return;
    setSyncBusy(true);
    try {
      const summary = await syncNow();
      await refreshProjects();
      await loadSizes();
      if (summary) {
        const parts = [
          summary.pushed ? `${summary.pushed} sent` : null,
          summary.pulled ? `${summary.pulled} updated` : null,
          summary.imported ? `${summary.imported} imported` : null,
          summary.failed ? `${summary.failed} failed` : null,
        ].filter(Boolean);
        Alert.alert('Sync complete', parts.length ? parts.join(' · ') : 'Everything already up to date.');
      } else {
        Alert.alert('Sync unavailable', 'Could not reach the sync folder. Pick it again if the grant was revoked.');
      }
    } finally {
      setSyncBusy(false);
    }
  };

  const confirmStopSyncing = () => {
    Alert.alert('Stop syncing?', 'The folder grant is forgotten. Projects already mirrored there stay put.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Stop syncing', style: 'destructive', onPress: async () => { await clearSyncFolder(); setSyncFolder(null); } },
    ]);
  };

  const totalBytes = Object.values(sizes).reduce((a, b) => a + b, 0);
  const bySize = [...projects].sort((a, b) => (sizes[b.id] ?? 0) - (sizes[a.id] ?? 0));

  const confirmDeleteProject = (id: string, name: string) => {
    Alert.alert(`Delete "${name}"?`, `This frees its space on ${thisDevice}. It cannot be undone.`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: async () => { await deleteProject(id); loadSizes(); } },
    ]);
  };

  const confirmUnpairWorkbench = () => {
    Alert.alert('Unpair this computer?', 'The pairing token is deleted from the keychain. Re-pair any time by scanning the desktop QR again.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Unpair', style: 'destructive', onPress: () => void unpairWorkbench() },
    ]);
  };

  const confirmDisconnectGitHub = () => {
    Alert.alert('Disconnect GitHub?', 'Synced repos stay on GitHub. Local projects are unaffected.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Disconnect', style: 'destructive', onPress: () => disconnectGitHub() },
    ]);
  };

  const confirmRemoveProvider = (id: string, label: string, isPrivate: boolean) => {
    const detail = isPrivate
      ? 'This revokes the private device grant, then deletes its credential and refresh handle from this device’s keychain.'
      : 'The key or sign-in is deleted from this device’s keychain.';
    Alert.alert(`Remove ${label}?`, detail, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: () => removeProvider(id) },
    ]);
  };

  const chat = providers.filter((p) => p.capabilities.chat);
  const mediaOnly = providers.filter((p) => !p.capabilities.chat);

  return (
    <ThemedView style={styles.container}>
      <ScrollView contentContainerStyle={[styles.content, { paddingTop: insets.top + Spacing.two, paddingBottom: TAB_PILL_CLEARANCE }]}>
        <View style={styles.titleRow}>
          <ThemedText type="title">Setup</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">{doneCount}/{steps.length} connected</ThemedText>
        </View>

        {/* The checklist — the same four questions onboarding asks. */}
        <Glass radius={Radii.xl} style={styles.checklist}>
          {steps.map((step, i) => (
            <View key={step.id}>
              {i > 0 ? <View style={[styles.checkDivider, { backgroundColor: theme.border }]} /> : null}
              <ScalePress accessibilityRole="button" onPress={() => goTo(step.id)} style={styles.checkRow}>
                <View style={[styles.checkGlyph, { backgroundColor: step.done ? theme.tint : theme.tintSoft }]}>
                  <ThemedText style={styles.checkGlyphText}>{STEP_GLYPH[step.id]}</ThemedText>
                </View>
                <View style={styles.checkBody}>
                  <View style={styles.checkTitleRow}>
                    <ThemedText type="heading">{step.title}</ThemedText>
                    {step.required && !step.done ? (
                      <View style={[styles.badge, { backgroundColor: theme.warning }]}>
                        <ThemedText style={[styles.badgeText, { color: '#1A1000' }]}>NEEDED</ThemedText>
                      </View>
                    ) : null}
                  </View>
                  <ThemedText type="small" themeColor="textSecondary" numberOfLines={2}>
                    {step.done ? step.status : step.blurb}
                  </ThemedText>
                </View>
                <Ionicons
                  name={step.done ? 'checkmark-circle' : 'add-circle-outline'}
                  size={22}
                  color={step.done ? theme.success : theme.tint}
                />
              </ScalePress>
            </View>
          ))}
        </Glass>

        <Section title="Your AI">
          {chat.map((provider) => (
            <View key={provider.id}>
              <Row
                title={provider.label}
                subtitle={`${shortModelLabel(provider.defaultModel)} · tap to change model`}
                left={<EmojiTile emoji={providerGlyph(provider)} size={36} />}
                right={
                  <Pressable hitSlop={10} onPress={() => confirmRemoveProvider(provider.id, provider.label, Boolean(provider.privateProvider))} style={styles.trash}>
                    <Ionicons name="trash-outline" size={18} color={theme.textSecondary} />
                  </Pressable>
                }
                onPress={() => router.push({ pathname: '/edit-model', params: { connectionId: provider.id } })}
              />
              <RowDivider />
            </View>
          ))}
          <Row
            title="Sign in with a subscription"
            subtitle="ChatGPT, Grok / X Premium, MiniMax, Kimi — no API key"
            left={<EmojiTile emoji="🎟️" size={36} />}
            onPress={() => router.push('/connect-subscription')}
          />
          <RowDivider />
          <Row
            title="Add an API key or local model"
            subtitle="OpenRouter (sign in), Claude, OpenAI, Gemini, GLM, Ollama, any OpenAI-style endpoint"
            left={<EmojiTile emoji="🔑" size={36} />}
            onPress={() => router.push('/connect-provider')}
          />
          <RowDivider />
          <Row
            title="Private hosted model"
            subtitle="Redeem a signed, device-scoped invite"
            left={<EmojiTile emoji="🔐" size={36} />}
            onPress={() => router.push('/connect-private')}
          />
        </Section>

        <Section title="Media Lab">
          {mediaLab ? (
            <>
              <Row
                title={`Paired · ${hostLabel(mediaLab.url)}`}
                subtitle="The full studio — video, music, images, characters, Cut — lives in the Media Lab tab"
                left={<EmojiTile emoji="🎬" size={36} />}
                onPress={() => router.push({ pathname: '/connect-media-lab', params: { url: mediaLab.url } })}
              />
              <RowDivider />
            </>
          ) : null}
          {mediaOnly.map((provider) => (
            <View key={provider.id}>
              <Row
                title={provider.label}
                subtitle={
                  provider.kind === 'fal'
                    ? `${falModelName(provider.mediaModels?.image || recommendedFalModel('image'))} · ${falModelName(provider.mediaModels?.video || recommendedFalModel('video'))}`
                    : 'Images and video on this device'
                }
                left={<EmojiTile emoji={providerGlyph(provider)} size={36} />}
                right={
                  <Pressable hitSlop={10} onPress={() => confirmRemoveProvider(provider.id, provider.label, false)} style={styles.trash}>
                    <Ionicons name="trash-outline" size={18} color={theme.textSecondary} />
                  </Pressable>
                }
              />
              <RowDivider />
            </View>
          ))}
          <Row
            title={mediaLab ? 'Change where media gets made' : 'Set up Media Lab'}
            subtitle="This device · your computer or Spark · cloud rendering — pick any, add more later"
            left={<EmojiTile emoji="🪄" size={36} />}
            onPress={() => router.push('/media-lab-setup')}
          />
        </Section>

        <Section title="Your computer">
          {workbench ? (
            <>
              <Row
                title={`Paired · ${hostLabel(workbench.url)}`}
                subtitle="Installs, builds, and serves your projects — preview them here with live reload"
                left={<EmojiTile emoji="🖥️" size={36} />}
              />
              <RowDivider />
              <Row title="Unpair" destructive onPress={confirmUnpairWorkbench} />
            </>
          ) : (
            <Row
              title="Pair the desktop app"
              subtitle="Scan the QR from VibeX Studio on your Mac, Windows, or Linux computer"
              left={<EmojiTile emoji="🔗" size={36} />}
              onPress={() => router.push('/pair-scan' as never)}
            />
          )}
        </Section>

        <Section title="Publish">
          {github ? (
            <>
              <Row
                title={github.name ?? github.login}
                subtitle={`@${github.login} · ${github.auth === 'pat' ? 'token' : 'OAuth'} · hosts your published apps`}
                left={<Image source={{ uri: github.avatarUrl }} style={styles.avatar} />}
              />
              <RowDivider />
              <Row title="Disconnect GitHub" destructive onPress={confirmDisconnectGitHub} />
            </>
          ) : (
            <Row
              title="Connect GitHub"
              subtitle="Publish apps to your own GitHub Pages and share them with a link"
              left={<EmojiTile emoji="🐙" size={36} />}
              onPress={() => router.push('/connect-github')}
            />
          )}
          {Platform.OS === 'android' ? (
            <>
              <RowDivider />
              {syncFolder ? (
                <>
                  <Row
                    title={safTreeLabel(syncFolder)}
                    subtitle="Projects mirror into this folder (put it in Google Drive to follow you between devices)"
                    left={<EmojiTile emoji="🔄" size={36} />}
                  />
                  <RowDivider />
                  <Row
                    title={syncBusy ? 'Syncing…' : 'Sync now'}
                    right={syncBusy ? <ActivityIndicator size="small" color={theme.textSecondary} /> : undefined}
                    onPress={syncBusy ? undefined : runSyncNow}
                  />
                  <RowDivider />
                  <Row title="Stop syncing" destructive onPress={confirmStopSyncing} />
                </>
              ) : (
                <Row
                  title="Choose a sync folder"
                  subtitle="Pick a folder in Google Drive and your projects mirror there — no accounts, no VibeX servers"
                  left={<EmojiTile emoji="🔄" size={36} />}
                  onPress={chooseSyncFolder}
                />
              )}
            </>
          ) : null}
        </Section>

        <Section title="Agents">
          <Row
            title="Let an agent drive VibeX"
            subtitle="Hermes, Claude Code, Codex, OpenCode, or any MCP client — over your local Wi-Fi, with your approval"
            left={<EmojiTile emoji="🪽" size={36} />}
            onPress={() => router.push('/agent-connect')}
          />
        </Section>

        <Section title="Appearance">
          <View style={styles.appearance}>
            <Segmented<AppearancePref>
              options={[
                { value: 'system', label: 'System' },
                { value: 'light', label: 'Light' },
                { value: 'dark', label: 'Dark' },
              ]}
              value={appearance}
              onChange={setAppearance}
            />
          </View>
        </Section>

        <Section title="Storage">
          <Row
            title={`${formatBytes(totalBytes)} used by ${projects.length} project${projects.length === 1 ? '' : 's'}`}
            subtitle={`Apps, chats, and media live on ${thisDevice}`}
            left={<EmojiTile emoji="💾" size={36} />}
            right={<Ionicons name={showStorage ? 'chevron-up' : 'chevron-down'} size={16} color={theme.textSecondary} />}
            onPress={() => setShowStorage((v) => !v)}
          />
          {showStorage
            ? bySize.map((project) => (
                <View key={project.id}>
                  <RowDivider />
                  <Row
                    title={`${project.emoji} ${project.name}`}
                    subtitle="Tap to delete"
                    right={<ThemedText type="small" themeColor="textSecondary">{formatBytes(sizes[project.id] ?? 0)}</ThemedText>}
                    onPress={() => confirmDeleteProject(project.id, project.name)}
                  />
                </View>
              ))
            : null}
        </Section>

        <Section title="About">
          <Row
            title="60-second studio tour"
            subtitle="Building, remixing, privacy, and publishing"
            left={<EmojiTile emoji="🪄" size={36} />}
            onPress={() => router.push('/studio-tour' as never)}
          />
          <RowDivider />
          <Row
            title="Your data stays yours"
            subtitle={
              providers.some((provider) => provider.privateProvider)
                ? `Projects stay on ${thisDevice}; keys stay in the secure keychain. Private VibeX prompts pass through the explicitly connected private broker; VibeXStudio adds no analytics or prompt logging.`
                : `Projects live on ${thisDevice}; keys live in the secure keychain. Provider and GitHub calls go straight to services you choose. No analytics, no telemetry, no account.`
            }
            left={<EmojiTile emoji="🔒" size={36} />}
          />
          <RowDivider />
          <Row
            title={checkingUpdate ? 'Checking…' : `Check for updates · ${currentVersion()}`}
            subtitle={hasNativeUpdater() ? 'Updates install in place on this computer' : Platform.OS === 'ios' ? 'Beta builds arrive through TestFlight; the App Store updates on its own' : 'Compares this build with the latest GitHub release'}
            left={<EmojiTile emoji="⬆️" size={36} />}
            right={checkingUpdate ? <ActivityIndicator size="small" color={theme.textSecondary} /> : undefined}
            onPress={checkingUpdate ? undefined : checkUpdates}
          />
          <RowDivider />
          <Row
            title="Open source · Apache-2.0"
            subtitle="github.com/kerpopule/vibexstudio"
            left={<EmojiTile emoji="🌐" size={36} />}
            onPress={() => void Linking.openURL('https://github.com/kerpopule/vibexstudio')}
          />
        </Section>
      </ScrollView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { padding: Spacing.three, gap: Spacing.four },
  titleRow: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', paddingHorizontal: 2 },
  checklist: { paddingVertical: 4 },
  checkRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, paddingVertical: 12 },
  checkDivider: { height: StyleSheet.hairlineWidth, marginLeft: 70 },
  checkGlyph: { width: 44, height: 44, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  checkGlyphText: { fontSize: 21, lineHeight: 26 },
  checkBody: { flex: 1, gap: 2 },
  checkTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  badge: { borderRadius: Radii.pill, paddingHorizontal: 7, paddingVertical: 2 },
  badgeText: { fontFamily: Fonts.display, fontSize: 9, letterSpacing: 1 },
  avatar: { width: 36, height: 36, borderRadius: 12 },
  appearance: { padding: Spacing.two + 2, gap: Spacing.two + 2 },
  trash: { padding: 4 },
});
