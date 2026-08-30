import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Alert, Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Segmented } from '@/components/segmented';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { EmojiTile } from '@/components/ui/emoji-tile';
import { Row, RowDivider, Section } from '@/components/ui/section';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { providerGlyph, shortModelLabel } from '@/lib/ai/models';
import { formatBytes } from '@/lib/format';
import { cloudSyncActive, projectSizeBytes } from '@/lib/storage/projects';
import type { AppearancePref } from '@/lib/storage/settings';
import { clearSyncFolder, pickSyncFolder, syncFolderUri, syncNow } from '@/lib/sync/android-folder-sync';
import { safTreeLabel } from '@/lib/sync/sync-plan';
import { thisDevice } from '@/lib/device';
import { useApp } from '@/lib/store';

export default function SettingsScreen() {
  const insets = useSafeAreaInsets();
  const theme = useTheme();
  const { github, providers, appearance, setAppearance, disconnectGitHub, removeProvider, mediaLab } = useApp();
  const projects = useApp((s) => s.projects);
  const refreshProjects = useApp((s) => s.refreshProjects);
  const deleteProject = useApp((s) => s.deleteProject);
  const [sizes, setSizes] = useState<Record<string, number>>({});
  const [syncFolder, setSyncFolder] = useState<string | null>(null);
  const [syncBusy, setSyncBusy] = useState(false);

  // Recompute project sizes whenever Settings gains focus (and after deletes).
  const loadSizes = useCallback(async () => {
    const fresh: Record<string, number> = {};
    await Promise.all(
      projects.map(async (p) => {
        fresh[p.id] = await projectSizeBytes(p.id);
      })
    );
    setSizes(fresh);
  }, [projects]);

  useFocusEffect(
    useCallback(() => {
      refreshProjects();
      loadSizes();
      if (Platform.OS === 'android') syncFolderUri().then(setSyncFolder);
    }, [refreshProjects, loadSizes])
  );

  const chooseSyncFolder = async () => {
    const uri = await pickSyncFolder();
    if (!uri) return; // cancelled or the picker failed — nothing changed
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
      {
        text: 'Stop syncing',
        style: 'destructive',
        onPress: async () => {
          await clearSyncFolder();
          setSyncFolder(null);
        },
      },
    ]);
  };

  const totalBytes = Object.values(sizes).reduce((a, b) => a + b, 0);
  const bySize = [...projects].sort((a, b) => (sizes[b.id] ?? 0) - (sizes[a.id] ?? 0));

  const confirmDeleteProject = (id: string, name: string) => {
    Alert.alert(`Delete "${name}"?`, `This frees its space on ${thisDevice}. It cannot be undone.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          await deleteProject(id);
          loadSizes();
        },
      },
    ]);
  };

  const confirmDisconnectGitHub = () => {
    Alert.alert('Disconnect GitHub?', 'Synced repos stay on GitHub. Local projects are unaffected.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Disconnect', style: 'destructive', onPress: () => disconnectGitHub() },
    ]);
  };

  const confirmRemoveProvider = (id: string, label: string) => {
    Alert.alert(`Remove ${label}?`, 'The key is deleted from this device’s keychain.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: () => removeProvider(id) },
    ]);
  };

  return (
    <ThemedView style={styles.container}>
      <ScrollView contentContainerStyle={[styles.content, { paddingTop: insets.top + Spacing.two }]}>
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

        <Section title="GitHub">
          {github ? (
            <>
              <Row
                title={github.name ?? github.login}
                subtitle={`@${github.login} · ${github.auth === 'pat' ? 'token' : 'OAuth'} · hosts your synced apps`}
                left={<Image source={{ uri: github.avatarUrl }} style={styles.avatar} />}
              />
              <RowDivider />
              <Row title="Disconnect GitHub" destructive onPress={confirmDisconnectGitHub} />
            </>
          ) : (
            <Row
              title="Connect GitHub"
              subtitle="Host the apps you make in your own repos and share them with a link"
              left={<EmojiTile emoji="🐙" size={36} />}
              onPress={() => router.push('/connect-github')}
            />
          )}
        </Section>

        <Section title="Media Lab">
          {mediaLab ? (
            <Row
              title="Media Lab paired"
              subtitle={`${mediaLab.url} · tap to change or remove`}
              left={<EmojiTile emoji="🎬" size={36} />}
              onPress={() => router.push('/connect-media-lab')}
            />
          ) : (
            <Row
              title="Pair a Media Lab"
              subtitle="Point VibeX at your desktop app or Spark — a Media Lab tab appears"
              left={<EmojiTile emoji="🎬" size={36} />}
              onPress={() => router.push('/connect-media-lab')}
            />
          )}
        </Section>

        {Platform.OS === 'android' ? (
          <Section title="Device sync">
            {syncFolder ? (
              <>
                <Row
                  title={safTreeLabel(syncFolder)}
                  subtitle="Projects mirror into this folder. Put it in Google Drive and they follow you to your other devices — newest edit wins per project."
                  left={<EmojiTile emoji="🔄" size={36} />}
                />
                <RowDivider />
                <Row
                  title={syncBusy ? 'Syncing…' : 'Sync now'}
                  subtitle="Send local changes and fetch projects from other devices"
                  right={syncBusy ? <ActivityIndicator size="small" color={theme.textSecondary} /> : undefined}
                  onPress={syncBusy ? undefined : runSyncNow}
                />
                <RowDivider />
                <Row title="Stop syncing" destructive onPress={confirmStopSyncing} />
              </>
            ) : (
              <Row
                title="Choose a sync folder"
                subtitle="Pick a folder in Google Drive and your projects mirror there — and to your other devices. No accounts, no VibeX servers."
                left={<EmojiTile emoji="🔄" size={36} />}
                onPress={chooseSyncFolder}
              />
            )}
          </Section>
        ) : null}

        <Section title="AI providers">
          {providers.map((provider) => (
            <Row
              key={provider.id}
              title={provider.label}
              subtitle={`${shortModelLabel(provider.defaultModel)} · tap to change model`}
              left={<EmojiTile emoji={providerGlyph(provider)} size={36} />}
              right={
                <Pressable
                  hitSlop={10}
                  onPress={() => confirmRemoveProvider(provider.id, provider.label)}
                  style={{ padding: 4 }}>
                  <Ionicons name="trash-outline" size={18} color={theme.textSecondary} />
                </Pressable>
              }
              onPress={() => router.push({ pathname: '/edit-model', params: { connectionId: provider.id } })}
            />
          ))}
          {providers.length > 0 ? <RowDivider /> : null}
          <Row
            title="Connect an AI provider"
            subtitle="OpenRouter (OAuth), Anthropic, OpenAI, Gemini, Grok, GLM, or any custom endpoint"
            left={<EmojiTile emoji="✨" size={36} />}
            onPress={() => router.push('/connect-provider')}
          />
        </Section>

        <Section title="Storage">
          <Row
            title="Used by your projects"
            subtitle={
              cloudSyncActive()
                ? 'Projects live in your iCloud Drive and sync between your Apple devices — no VibeX servers involved. Delete a project to free its space.'
                : `Everything lives on ${thisDevice} — apps, chats, and media. Delete a project to free its space.`
            }
            left={<EmojiTile emoji="💾" size={36} />}
            right={<ThemedText type="smallBold">{formatBytes(totalBytes)}</ThemedText>}
          />
          {bySize.map((project) => (
            <View key={project.id}>
              <RowDivider />
              <Row
                title={`${project.emoji} ${project.name}`}
                subtitle="Tap to delete"
                right={
                  <ThemedText type="small" style={{ color: theme.textSecondary }}>
                    {formatBytes(sizes[project.id] ?? 0)}
                  </ThemedText>
                }
                onPress={() => confirmDeleteProject(project.id, project.name)}
              />
            </View>
          ))}
        </Section>

        <Section title="Learn VibeX">
          <Row
            title="Replay the studio tour"
            subtitle="A quick guided walkthrough of building, remixing, privacy, and publishing"
            left={<EmojiTile emoji="🪄" size={36} />}
            onPress={() => router.push('/studio-tour' as never)}
          />
        </Section>

        <Section title="Privacy">
          <Row
            title="Your data stays yours"
            subtitle={`VibeXStudio has no servers and collects nothing. Projects live on ${thisDevice}; keys live in the secure keychain; syncing goes straight to your GitHub.`}
            left={<EmojiTile emoji="🔒" size={36} />}
          />
        </Section>
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
    gap: Spacing.four,
  },
  avatar: {
    width: 36,
    height: 36,
    borderRadius: 12,
  },
  appearance: {
    padding: Spacing.two + 2,
    gap: Spacing.two + 2,
  },
});
