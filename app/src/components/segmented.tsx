import * as Haptics from 'expo-haptics';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Animated, { useAnimatedStyle, withSpring } from 'react-native-reanimated';

import { ThemedText } from '@/components/themed-text';
import { Radii, Shadows } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

/**
 * Segmented control with a spring-animated sliding thumb, iOS style.
 */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
}) {
  const theme = useTheme();
  const [trackWidth, setTrackWidth] = useState(0);
  const index = Math.max(
    0,
    options.findIndex((o) => o.value === value)
  );
  const segmentWidth = trackWidth > 0 ? (trackWidth - PADDING * 2) / options.length : 0;

  const thumbStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: withSpring(index * segmentWidth, { damping: 20, stiffness: 280 }) }],
    width: segmentWidth,
  }));

  return (
    <View
      style={[styles.track, { backgroundColor: theme.backgroundSelected }]}
      onLayout={(e) => setTrackWidth(e.nativeEvent.layout.width)}>
      {segmentWidth > 0 ? (
        <Animated.View
          style={[styles.thumb, { backgroundColor: theme.backgroundElement }, Shadows.card, thumbStyle]}
        />
      ) : null}
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <Pressable
            key={option.value}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            onPress={() => {
              if (!selected) Haptics.selectionAsync();
              onChange(option.value);
            }}
            style={styles.segment}>
            <ThemedText type="smallBold" themeColor={selected ? 'tint' : 'textSecondary'}>
              {option.label}
            </ThemedText>
          </Pressable>
        );
      })}
    </View>
  );
}

const PADDING = 3;

const styles = StyleSheet.create({
  track: {
    flexDirection: 'row',
    borderRadius: Radii.md,
    padding: PADDING,
  },
  thumb: {
    position: 'absolute',
    top: PADDING,
    bottom: PADDING,
    left: PADDING,
    borderRadius: Radii.md - 3,
  },
  segment: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: Radii.md - 3,
    paddingVertical: 9,
  },
});
