import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Radii } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

/**
 * The app's signature mark: an emoji sitting in a soft tinted squircle well.
 * Used for project cards, the project header, and settings rows.
 */
export function EmojiTile({ emoji, size = 48 }: { emoji: string; size?: number }) {
  const theme = useTheme();
  const fontSize = Math.round(size * 0.52);
  return (
    <View
      style={[
        styles.tile,
        {
          width: size,
          height: size,
          borderRadius: size >= 44 ? Radii.md : Radii.sm,
          backgroundColor: theme.tintSoft,
        },
      ]}>
      <ThemedText style={{ fontSize, lineHeight: Math.round(fontSize * 1.25) }}>{emoji}</ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  tile: {
    alignItems: 'center',
    justifyContent: 'center',
  },
});
