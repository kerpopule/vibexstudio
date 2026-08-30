import * as Clipboard from 'expo-clipboard';
import { router } from 'expo-router';
import { useState } from 'react';
import { Alert, Linking, ScrollView, Share, StyleSheet, Switch, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { EmojiTile } from '@/components/ui/emoji-tile';
import { Row, RowDivider, Section } from '@/components/ui/section';
import { TextField } from '@/components/ui/text-field';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { toRepoName } from '@/lib/github/api';
import { buildImportDeepLink } from '@/lib/github/sharePage';
import { GitHubSyncConflictError, syncProjectToGitHub, type SyncProgress } from '@/lib/github/sync';
import { DEPLOYMENT_PROVIDERS, type DeploymentProvider } from '@/lib/share/deploymentProviders';
import { exportProjectBundle, shareMessageFor } from '@/lib/share/exportProject';
import { readProject } from '@/lib/storage/projects';
import { getGitHubToken } from '@/lib/storage/secrets';
import { useApp } from '@/lib/store';
import type { ProjectMeta } from '@/lib/types';

export function ShareView({
  project,
  onProjectChanged,
}: {
  project: ProjectMeta;
  onProjectChanged: (meta: ProjectMeta) => void;
}) {
  const theme = useTheme();
  const github = useApp((s) => s.github);
  const [repoName, setRepoName] = useState(project.github?.repo ?? toRepoName(project.name));
  const [isPrivate, setIsPrivate] = useState(project.github?.isPrivate ?? false);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  const exportBundle = async () => {
    if (exporting) return;
    setExporting(true);
    setExportError(null);
    try {
      // Some targets (Messages included) keep only the file and drop the
      // accompanying note, so park the note on the clipboard as a backup.
      await Clipboard.setStringAsync(shareMessageFor(project.name));
      await exportProjectBundle(project.id);
      setCopied('note');
      setTimeout(() => setCopied(null), 6000);
    } catch (e) {
      setExportError(e instanceof Error ? e.message : 'Could not share the app file.');
    } finally {
      setExporting(false);
    }
  };

  const link = project.github;
  const liveWebUrl = link?.pagesUrl ? link.pagesUrl.replace(/\/+$/, '') : null;
  const shareUrl = liveWebUrl ? `${liveWebUrl}/s/` : null;
  const deepLink = link ? buildImportDeepLink(link.owner, link.repo, link.branch) : null;

  const sync = async (overwriteRemote = false) => {
    if (!github || busy) return;
    const token = await getGitHubToken();
    if (!token) {
      setError('GitHub token missing from the keychain. Reconnect GitHub in Settings.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await syncProjectToGitHub({
        token,
        login: github.login,
        projectId: project.id,
        repoName,
        isPrivate,
        overwriteRemote,
        onProgress: (p: SyncProgress) => setProgress(describe(p)),
      });
      const updated = await readProject(project.id);
      if (updated) onProjectChanged(updated);
    } catch (e) {
      if (e instanceof GitHubSyncConflictError) {
        const remoteChanged = e.kind === 'remote-changed';
        Alert.alert(
          remoteChanged ? 'GitHub has newer work' : 'That repository already exists',
          remoteChanged
            ? 'GitHub contains changes that were not made by this device. Replacing it will discard those remote files.'
            : `A repository named ${github.login}/${repoName} already exists. Replacing it will discard the files currently in that repository.`,
          [
            { text: 'Cancel', style: 'cancel' },
            {
              text: 'Replace GitHub version',
              style: 'destructive',
              onPress: () => void sync(true),
            },
          ]
        );
      } else {
        setError(e instanceof Error ? e.message : 'Sync failed.');
      }
    } finally {
      setBusy(false);
      setProgress(null);
    }
  };

  const copy = async (label: string, value: string) => {
    await Clipboard.setStringAsync(value);
    setCopied(label);
    setTimeout(() => setCopied(null), 1500);
  };

  const openDeploymentProvider = async (provider: DeploymentProvider) => {
    if (!link) return;
    const repoUrl = `https://github.com/${link.owner}/${link.repo}`;
    await Clipboard.setStringAsync(repoUrl);
    setCopied(`deploy-${provider.id}`);
    try {
      await Linking.openURL(provider.url);
    } catch {
      setError(`Could not open ${provider.name}. The GitHub repository link is on your clipboard.`);
    }
  };

  const sendSection = (
    <Section title="Backup / offline copy">
      <Row
        title={exporting ? 'Packing it up…' : 'Export .vibex file'}
        subtitle="Optional fallback: one portable file with the whole app inside. Use this for AirDrop, backups, private handoff, or when you do not want to publish to GitHub."
        left={<EmojiTile emoji="📦" size={36} />}
        onPress={exportBundle}
      />
      {copied === 'note' ? (
        <>
          <RowDivider />
          <Row
            title="Walkthrough note copied 📋"
            subtitle="If your messaging app only attached the file, paste — the note has the get-the-app link for friends without VibeXStudio."
          />
        </>
      ) : null}
      {exportError ? (
        <>
          <RowDivider />
          <Row title={exportError} destructive />
        </>
      ) : null}
    </Section>
  );

  if (!github) {
    return (
      <ScrollView contentContainerStyle={styles.content}>
        <ThemedText style={styles.bigEmoji}>🌎</ThemedText>
        <ThemedText type="subtitle" style={styles.center}>
          Publish a real web link
        </ThemedText>
        <ThemedText themeColor="textSecondary" style={styles.center}>
          Connect GitHub to publish this app to your own repo, turn on GitHub Pages, and get one link people can open in a browser or import into VibeXStudio.
        </ThemedText>
        <Button title="Connect GitHub" onPress={() => router.push('/connect-github')} />
        {sendSection}
      </ScrollView>
    );
  }

  return (
    <ScrollView contentContainerStyle={styles.content}>
      {!link ? (
        <Section title="First sync">
          <View style={styles.form}>
            <TextField label="Repository name" value={repoName} onChangeText={setRepoName} mono />
            <View style={styles.switchRow}>
              <View style={styles.switchLabel}>
                <ThemedText>Private repo</ThemedText>
                <ThemedText type="small" themeColor="textSecondary">
                  Private repos can’t serve a public share link via GitHub Pages on free plans.
                </ThemedText>
              </View>
              <Switch value={isPrivate} onValueChange={setIsPrivate} />
            </View>
          </View>
        </Section>
      ) : (
        <Section title="Synced repo">
          <Row
            title={`${link.owner}/${link.repo}`}
            subtitle={
              link.lastSyncedAt ? `Last synced ${new Date(link.lastSyncedAt).toLocaleString()}` : undefined
            }
            onPress={() => copy('repo', `https://github.com/${link.owner}/${link.repo}`)}
          />
        </Section>
      )}

      <Button
        title={link ? 'Sync changes to GitHub' : 'Publish web link with GitHub'}
        onPress={() => void sync()}
        loading={busy}
        disabled={!repoName.trim()}
      />
      {progress ? (
        <ThemedText type="small" themeColor="textSecondary" style={styles.center}>
          {progress}
        </ThemedText>
      ) : null}
      {error ? <ThemedText style={{ color: theme.danger }}>{error}</ThemedText> : null}

      {link ? (
        <Section title="Share web app">
          {shareUrl ? (
            <>
              <Row
                title="Share smart link"
                subtitle={`${shareUrl} — opens the live website, with an Open in VibeXStudio path for remixing`}
                left={<EmojiTile emoji="🔗" size={36} />}
                onPress={() => Share.share({ message: shareUrl })}
              />
              <RowDivider />
              <Row title={copied === 'share' ? 'Copied!' : 'Copy smart link'} onPress={() => copy('share', shareUrl)} />
              {liveWebUrl ? (
                <>
                  <RowDivider />
                  <Row
                    title={copied === 'web' ? 'Copied!' : 'Copy website only'}
                    subtitle={liveWebUrl}
                    onPress={() => copy('web', liveWebUrl)}
                  />
                </>
              ) : null}
            </>
          ) : (
            <Row
              title="No public web link yet"
              subtitle={
                link.isPrivate
                  ? 'This repo is private. GitHub Pages public sharing needs a public repo on free GitHub, or a paid GitHub plan for private Pages.'
                  : 'GitHub Pages is still provisioning — sync again in a minute to pick up the URL.'
              }
            />
          )}
          {deepLink ? (
            <>
              <RowDivider />
              <Row
                title={copied === 'deep' ? 'Copied!' : 'Copy VibeXStudio import link'}
                subtitle={deepLink}
                onPress={() => copy('deep', deepLink)}
              />
            </>
          ) : null}
        </Section>
      ) : null}
      {link ? (
        <Section title="Host somewhere else">
          <Row
            title="Your GitHub repo stays the source of truth"
            subtitle="These handoffs copy your repo link and open the provider. VibeXStudio never stores those provider credentials."
          />
          {DEPLOYMENT_PROVIDERS.map((provider) => (
            <View key={provider.id}>
              <RowDivider />
              <Row
                title={
                  copied === `deploy-${provider.id}`
                    ? `Opening ${provider.name}…`
                    : `Continue in ${provider.name}`
                }
                subtitle="Sign in, choose the copied GitHub repo, then confirm the provider's settings and pricing."
                left={<EmojiTile emoji={provider.emoji} size={36} />}
                onPress={() => void openDeploymentProvider(provider)}
              />
            </View>
          ))}
        </Section>
      ) : null}
      {sendSection}
    </ScrollView>
  );
}

function describe(p: SyncProgress): string {
  switch (p.phase) {
    case 'preparing':
      return 'Reading project files…';
    case 'creating-repo':
      return `Creating repo ${p.detail}…`;
    case 'uploading':
      return `Uploading ${p.detail}…`;
    case 'committing':
      return 'Committing…';
    case 'pages':
      return 'Enabling GitHub Pages…';
    case 'done':
      return 'Done!';
  }
}

const styles = StyleSheet.create({
  content: {
    width: '100%',
    maxWidth: 760,
    alignSelf: 'center',
    padding: Spacing.three,
    gap: Spacing.four,
  },
  form: {
    padding: Spacing.three,
    gap: Spacing.three,
  },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
  },
  switchLabel: {
    flex: 1,
    gap: 2,
  },
  bigEmoji: {
    fontSize: 56,
    lineHeight: 64,
    textAlign: 'center',
  },
  center: {
    textAlign: 'center',
  },
});
