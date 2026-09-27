import { router, Stack, usePathname } from 'expo-router';
import { Image, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Button } from '@/components/ui/button';
import { MaxContentWidth, Radii, Spacing } from '@/constants/theme';
import { webEnter } from '@/lib/motion';

const APP_ICON = require('../../assets/images/icon.png');

/** Branded 404 — unknown links (web) or stale deep links (native). */
export default function NotFoundScreen() {
  const pathname = usePathname();
  const goHome = () => {
    if (router.canDismiss()) router.dismissAll();
    router.replace('/');
  };

  return (
    <>
      <Stack.Screen options={{ title: 'Page not found', headerShown: false }} />
      <ThemedView style={styles.screen}>
        <View style={[styles.card, webEnter('fade-down', 380)]}>
          <Image
            source={APP_ICON}
            style={styles.mark}
            accessibilityLabel="VibeX Studio logo"
            accessibilityIgnoresInvertColors
          />
          <ThemedText type="smallBold" themeColor="tint" style={styles.eyebrow}>
            404
          </ThemedText>
          <ThemedText type="title" accessibilityRole="header" style={styles.center}>
            This page wandered off.
          </ThemedText>
          <ThemedText themeColor="textSecondary" style={styles.center}>
            There’s nothing at{' '}
            <ThemedText type="code" themeColor="textSecondary">
              {pathname}
            </ThemedText>
            . Your projects are safe — head back to the studio.
          </ThemedText>
          <Button title="Back to the studio" onPress={goHome} style={styles.button} />
        </View>
      </ThemedView>
    </>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: Spacing.four,
  },
  card: {
    width: '100%',
    maxWidth: MaxContentWidth / 1.6,
    alignItems: 'center',
    gap: Spacing.three,
  },
  mark: {
    width: 64,
    height: 64,
    borderRadius: Radii.lg,
  },
  eyebrow: {
    letterSpacing: 2,
  },
  center: {
    textAlign: 'center',
  },
  button: {
    alignSelf: 'stretch',
    marginTop: Spacing.two,
  },
});
