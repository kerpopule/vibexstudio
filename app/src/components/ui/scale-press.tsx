import * as Haptics from 'expo-haptics';
import { Pressable, type PressableProps, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';

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
 * touch feel for every card, chip, and button in the app.
 */
export function ScalePress({
  style,
  pressedScale = 0.97,
  haptic = true,
  onPressIn,
  onPressOut,
  ...rest
}: ScalePressProps) {
  const scale = useSharedValue(1);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  return (
    <AnimatedPressable
      {...rest}
      style={[animatedStyle, style]}
      onPressIn={(e) => {
        // eslint-disable-next-line react-hooks/immutability -- reanimated shared values are mutable refs
        scale.value = withSpring(pressedScale, { damping: 18, stiffness: 400 });
        if (haptic) Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        onPressIn?.(e);
      }}
      onPressOut={(e) => {
        // eslint-disable-next-line react-hooks/immutability -- reanimated shared values are mutable refs
        scale.value = withSpring(1, { damping: 14, stiffness: 320 });
        onPressOut?.(e);
      }}
    />
  );
}
