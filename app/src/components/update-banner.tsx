/**
 * One-line "a newer VibeX Studio is out" banner. Appears on the Studio tab
 * when GitHub has a newer release than this build; dismisses per version.
 * Inside the desktop shell the tap runs the shell's own in-place updater.
 */
import Ionicons from '@expo/vector-icons/Ionicons';
import { useEffect, useState } from 'react';
import { Linking, Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Glass } from '@/components/ui/glass';
import { Radii, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import {
  checkForUpdate,
  dismissUpdate,
  hasNativeUpdater,
  runNativeUpdater,
  updateDestination,
  type UpdateInfo,
} from '@/lib/update-check';

export function UpdateBanner() {
  const theme = useTheme();
  const [info, setInfo] = useState<UpdateInfo | null>(null);

  useEffect(() => {
    let active = true;
    checkForUpdate().then((found) => {
      if (active && found) setInfo(found);
    });
    return () => {
      active = false;
    };
  }, []);

  if (!info) return null;
  const native = hasNativeUpdater();
  const destination = updateDestination(info);

  const go = async () => {
    if (native) {
      await runNativeUpdater();
      return;
    }
    await Linking.openURL(destination.url);
  };
  const dismiss = async () => {
    await dismissUpdate(info.version);
    setInfo(null);
  };

  return (
    <Glass radius={Radii.lg} style={styles.banner}>
      <View style={[styles.dot, { backgroundColor: theme.tint }]} />
      <View style={styles.body}>
        <ThemedText type="smallBold">VibeX Studio {info.version} is out</ThemedText>
        <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
          {native ? 'Update in place — takes a moment, then relaunches.' : 'You’re on an older build.'}
        </ThemedText>
      </View>
      <Pressable accessibilityRole="button" onPress={go} hitSlop={6} style={[styles.cta, { backgroundColor: theme.tintSoft }]}>
        <ThemedText type="smallBold" style={{ color: theme.tint }}>{native ? 'Update' : destination.label}</ThemedText>
      </Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel="Dismiss" onPress={dismiss} hitSlop={10}>
        <Ionicons name="close" size={16} color={theme.textSecondary} />
      </Pressable>
    </Glass>
  );
}

const styles = StyleSheet.create({
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingVertical: 10,
    marginBottom: Spacing.two,
  },
  dot: { width: 8, height: 8, borderRadius: 4 },
  body: { flex: 1, gap: 1 },
  cta: { borderRadius: Radii.pill, paddingHorizontal: 12, paddingVertical: 7 },
});
