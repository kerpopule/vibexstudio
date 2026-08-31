import * as Haptics from 'expo-haptics';
import * as Notifications from 'expo-notifications';
import { DarkTheme, DefaultTheme, Stack, ThemeProvider, router, useSegments } from 'expo-router';
import { useEffect } from 'react';
import { Alert, AppState, Linking } from 'react-native';

import { useColorScheme } from '@/hooks/use-color-scheme';
import { parsePairDeepLink, probeMediaLab } from '@/lib/media-pairing';
import { initMediaServerWatch } from '@/lib/media-server-watch';
import { mediaLabJobFromResponse, nudgeForPermission, projectIdFromResponse } from '@/lib/notifications';
import { getNotificationsDeclined, setNotificationsDeclined } from '@/lib/storage/settings';
import { agentConnectRuntime } from '@/lib/agent-connect/runtime';
import { parsePrivateInviteLink } from '@/lib/private-provider/links';
import { useApp } from '@/lib/store';
import { initAndroidFolderSync } from '@/lib/sync/android-folder-sync';

/** Ask for notifications on every foreground while they're off — one
    explicit "Not now" retires the nudge for good. */
async function runNotificationNudge(): Promise<void> {
  const declined = await getNotificationsDeclined();
  await nudgeForPermission(
    (openSettings, declineForever) => {
      Alert.alert(
        'Turn on notifications?',
        'VibeX tells you when builds finish and when Media Lab renders are ready to watch.',
        [
          { text: 'Not now', style: 'cancel', onPress: declineForever },
          { text: 'Open Settings', onPress: openSettings },
        ]
      );
    },
    declined,
    () => void setNotificationsDeclined(),
    () => void Linking.openSettings()
  );
}

/** A tapped/AirDropped .vibex bundle arrives as a plain file URL, not a route. */
function isBundleFileUrl(url: string): boolean {
  return /^(file|content):/i.test(url) && /\.vibex(\?|#|$)/i.test(url);
}

/**
 * Scanning the desktop app's QR opens `vibex://pair?url=<encoded>`. We probe
 * the server; on success the phone is paired with no typing at all, and on
 * failure the paste-a-URL screen opens with the address prefilled.
 */
async function handlePairLink(serverUrl: string): Promise<void> {
  if (await probeMediaLab(serverUrl)) {
    await useApp.getState().setMediaLab({ url: serverUrl, addedAt: Date.now() });
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    router.push('/(tabs)/media-lab');
  } else {
    router.push({ pathname: '/connect-media-lab', params: { url: serverUrl } });
  }
}

export default function RootLayout() {
  const colorScheme = useColorScheme();
  const hydrate = useApp((s) => s.hydrate);
  const hydrated = useApp((s) => s.hydrated);
  const onboardingComplete = useApp((s) => s.onboardingComplete);
  const segments = useSegments();

  useEffect(() => {
    hydrate();
  }, [hydrate]);

  // Android: mirror projects into the user's chosen sync folder after turns
  // write files (debounced) and once shortly after launch. No-op elsewhere.
  useEffect(() => {
    initAndroidFolderSync();
  }, []);

  useEffect(() => {
    if (hydrated && !onboardingComplete && (segments[0] as string) !== 'onboarding') {
      router.replace('/onboarding' as never);
    }
  }, [hydrated, onboardingComplete, segments]);

  useEffect(() => {
    if (hydrated) void agentConnectRuntime.initialize();
  }, [hydrated]);

  useEffect(() => {
    const open = (url: string | null) => {
      if (!url) return;
      if (isBundleFileUrl(url)) {
        router.push({ pathname: '/import', params: { file: encodeURIComponent(url) } });
        return;
      }
      const inviteToken = parsePrivateInviteLink(url);
      if (inviteToken) {
        router.push({ pathname: '/connect-private', params: { token: inviteToken } });
        return;
      }
      const pairUrl = parsePairDeepLink(url);
      if (pairUrl) handlePairLink(pairUrl).catch(() => {});
    };
    Linking.getInitialURL().then(open);
    const sub = Linking.addEventListener('url', (e) => open(e.url));
    return () => sub.remove();
  }, []);

  // Tapping a build notification jumps straight into that project.
  useEffect(() => {
    const sub = Notifications.addNotificationResponseReceivedListener((response) => {
      const projectId = projectIdFromResponse(response);
      if (projectId) {
        router.push({ pathname: '/project/[id]', params: { id: projectId } });
        return;
      }
      const jobId = mediaLabJobFromResponse(response);
      if (jobId) {
        // Land straight on the finished item: the Media Lab server view
        // opens ?job=<id> to that screening, ready to play.
        useApp.getState().setMediaLabFocusJob(jobId);
        router.push('/(tabs)/media-lab');
      }
    });
    return () => sub.remove();
  }, []);

  // Media Lab server watcher (finish notifications) + the notifications
  // nudge on every foreground while they're off.
  useEffect(() => {
    if (!hydrated) return;
    initMediaServerWatch();
    runNotificationNudge();
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') runNotificationNudge();
    });
    return () => sub.remove();
  }, [hydrated]);

  return (
    <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
      <Stack>
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="onboarding" options={{ headerShown: false, gestureEnabled: false }} />
        <Stack.Screen name="studio-tour" options={{ headerShown: false, presentation: 'fullScreenModal' }} />
        {/* gestureEnabled false: games use edge swipes — don't let a right
            swipe in the preview pop the user out of the project. */}
        <Stack.Screen name="project/[id]" options={{ headerShown: false, gestureEnabled: false }} />
        <Stack.Screen name="new-project" options={{ presentation: 'modal', title: 'New Project' }} />
        <Stack.Screen name="connect-github" options={{ presentation: 'modal', title: 'Connect GitHub' }} />
        <Stack.Screen name="connect-provider" options={{ presentation: 'modal', title: 'Connect AI' }} />
        <Stack.Screen name="connect-subscription" options={{ presentation: 'modal', title: 'Connect subscription' }} />
        <Stack.Screen name="connect-private" options={{ presentation: 'modal', title: 'Private VibeX Models' }} />
        <Stack.Screen name="edit-model" options={{ presentation: 'modal', title: 'Choose model' }} />
        <Stack.Screen name="connect-media-lab" options={{ presentation: 'modal', title: 'Media Lab' }} />
        <Stack.Screen name="media-lab-setup" options={{ presentation: 'modal', title: 'Set up Media Lab' }} />
        <Stack.Screen name="fal-setup" options={{ presentation: 'modal', title: 'Cloud rendering' }} />
        <Stack.Screen name="agent-connect" options={{ presentation: 'modal', title: 'Connect an agent' }} />
        <Stack.Screen name="import" options={{ title: 'Open Shared App' }} />
      </Stack>
    </ThemeProvider>
  );
}
