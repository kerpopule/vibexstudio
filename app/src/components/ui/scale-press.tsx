import * as Haptics from 'expo-haptics';
import { useState } from 'react';
import { Platform, Pressable, type PressableProps, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { useAnimatedStyle, useReducedMotion, useSharedValue, withSpring } from 'react-native-reanimated';

import { hoverStyle } from '@/components/ui/press-feedback';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

export type ScalePressProps = Omit<PressableProps, 'style'> & {
  style?: StyleProp<ViewStyle>;
  /** How far the surface sinks while pressed. */
  pressedScale?: number;
  /** Fire a light haptic tick on press-in. Defaults on for anything tappable. */
  haptic?: boolean;
};

/**
 * Pressable with springy press-down physics and a haptic tick — the default
 * touch feel for every card, chip, and button in the app. With a pointer
 * (web/desktop) it also lifts slightly and brightens on hover; the lift is
 * skipped when the OS asks for reduced motion.
 */
export function ScalePress({
  style,
  pressedScale = 0.97,
  haptic = true,
  disabled,
  onPressIn,
  onPressOut,
  onHoverIn,
  onHoverOut,
  ...rest
}: ScalePressProps) {
  const scale = useSharedValue(1);
  const reduceMotion = useReducedMotion();
  const [hovered, setHovered] = useState(false);
  // A third of the press travel, the other way: 0.97 press → 1.01 hover.
  const hoverScale = reduceMotion ? 1 : 1 + (1 - pressedScale) / 3;

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  return (
    <AnimatedPressable
      {...rest}
      disabled={disabled}
      style={[animatedStyle, style, hoverStyle(hovered && !disabled, !disabled)]}
      onHoverIn={(e) => {
        setHovered(true);
        // eslint-disable-next-line react-hooks/immutability -- reanimated shared values are mutable refs
        if (!disabled) scale.value = withSpring(hoverScale, { damping: 18, stiffness: 320 });
        onHoverIn?.(e);
      }}
      onHoverOut={(e) => {
        setHovered(false);
        // eslint-disable-next-line react-hooks/immutability -- reanimated shared values are mutable refs
        scale.value = withSpring(1, { damping: 18, stiffness: 320 });
        onHoverOut?.(e);
      }}
      onPressIn={(e) => {
        // eslint-disable-next-line react-hooks/immutability -- reanimated shared values are mutable refs
        scale.value = withSpring(pressedScale, { damping: 18, stiffness: 400 });
        if (haptic && Platform.OS !== 'web') Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        onPressIn?.(e);
      }}
      onPressOut={(e) => {
        // eslint-disable-next-line react-hooks/immutability -- reanimated shared values are mutable refs
        scale.value = withSpring(hovered ? hoverScale : 1, { damping: 14, stiffness: 320 });
        onPressOut?.(e);
      }}
    />
  );
}
