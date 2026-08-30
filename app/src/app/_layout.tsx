import * as Notifications from 'expo-notifications';
import { DarkTheme, DefaultTheme, Stack, ThemeProvider, router, useSegments } from 'expo-router';
import { useEffect } from 'react';
import { Linking } from 'react-native';

import { useColorScheme } from '@/hooks/use-color-scheme';
import { projectIdFromResponse } from '@/lib/notifications';
import { useApp } from '@/lib/store';
import { initAndroidFolderSync } from '@/lib/sync/android-folder-sync';

/** A tapped/AirDropped .vibex bundle arrives as a plain file URL, not a route. */
function isBundleFileUrl(url: string): boolean {
  return /^(file|content):/i.test(url) && /\.vibex(\?|#|$)/i.test(url);
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
    const open = (url: string | null) => {
      if (url && isBundleFileUrl(url)) {
        router.push({ pathname: '/import', params: { file: encodeURIComponent(url) } });
      }
    };
    Linking.getInitialURL().then(open);
    const sub = Linking.addEventListener('url', (e) => open(e.url));
    return () => sub.remove();
  }, []);

  // Tapping a build notification jumps straight into that project.
  useEffect(() => {
    const sub = Notifications.addNotificationResponseReceivedListener((response) => {
      const projectId = projectIdFromResponse(response);
      if (projectId) router.push({ pathname: '/project/[id]', params: { id: projectId } });
    });
    return () => sub.remove();
  }, []);

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
        <Stack.Screen name="edit-model" options={{ presentation: 'modal', title: 'Choose model' }} />
        <Stack.Screen name="connect-media-lab" options={{ presentation: 'modal', title: 'Media Lab' }} />
        <Stack.Screen name="import" options={{ title: 'Open Shared App' }} />
      </Stack>
    </ThemeProvider>
  );
}
