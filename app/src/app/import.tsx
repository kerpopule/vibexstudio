import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Button } from '@/components/ui/button';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { importRepoAsProject } from '@/lib/github/importRepo';
import { importBundleFromFile, importBundleFromUrl } from '@/lib/share/importBundle';
import { getGitHubToken } from '@/lib/storage/secrets';
import { useApp } from '@/lib/store';

/**
 * Receiving side of every share path:
 *  - vibex://import?repo=owner/name&ref=main  (GitHub share link)
 *  - /import?file=<uri>                        (tapped/picked .vibex file)
 *  - /import?url=<link>                        (pasted Dropbox/Drive/iCloud link)
 * Creates a local project and opens it.
 */
export default function ImportScreen() {
  const theme = useTheme();
  const params = useLocalSearchParams<{ repo?: string; ref?: string; file?: string; url?: string }>();
  const refreshProjects = useApp((s) => s.refreshProjects);
  const [status, setStatus] = useState('Starting…');
  const [error, setError] = useState<string | null>(null);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;

    const run = async () => {
      try {
        let projectId: string;
        if (typeof params.file === 'string' && params.file) {
          const result = await importBundleFromFile(decodeURIComponent(params.file), setStatus);
          projectId = result.meta.id;
        } else if (typeof params.url === 'string' && params.url) {
          const result = await importBundleFromUrl(decodeURIComponent(params.url), setStatus);
          projectId = result.meta.id;
        } else {
          const repoParam = typeof params.repo === 'string' ? params.repo : '';
          const [owner, repo] = repoParam.split('/');
          if (!owner || !repo) {
            setError('This link is missing a valid app (expected a repo, file, or url).');
            return;
          }
          const token = await getGitHubToken();
          const result = await importRepoAsProject({
            owner,
            repo,
            ref: typeof params.ref === 'string' && params.ref ? params.ref : undefined,
            token,
            onProgress: setStatus,
          });
          projectId = result.meta.id;
        }
        await refreshProjects();
        router.replace({ pathname: '/project/[id]', params: { id: projectId } });
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Import failed.');
      }
    };
    run();
  }, [params.repo, params.ref, params.file, params.url, refreshProjects]);

  return (
    <ThemedView style={styles.container}>
      {error ? (
        <>
          <ThemedText style={styles.emoji}>😵</ThemedText>
          <ThemedText style={[styles.center, { color: theme.danger }]}>{error}</ThemedText>
          <Button title="Back to projects" variant="secondary" onPress={() => router.replace('/')} />
        </>
      ) : (
        <>
          <ActivityIndicator size="large" color={theme.tint} />
          <ThemedText themeColor="textSecondary" style={styles.center}>
            {status}
          </ThemedText>
        </>
      )}
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.four,
    padding: Spacing.five,
  },
  emoji: {
    fontSize: 56,
    lineHeight: 64,
  },
  center: {
    textAlign: 'center',
  },
});
