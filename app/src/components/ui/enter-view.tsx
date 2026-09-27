import type { ComponentProps } from 'react';
import { Platform, View } from 'react-native';
import Animated from 'react-native-reanimated';

type EnterViewProps = ComponentProps<typeof Animated.View>;

/**
 * A view that animates in on every platform.
 *
 * Native: a Reanimated `Animated.View`; pass `entering={enter(...)}` (and
 * `exiting`) exactly as before.
 * Web: a plain `View`, because Reanimated consumes CSS animation props on its
 * own components. Put `webEnter(...)` from `@/lib/motion` in `style` and the
 * browser runs a CSS entrance (reduced-motion safe, see `src/global.css`).
 */
export function EnterView({ entering, exiting, layout, ...rest }: EnterViewProps) {
  if (Platform.OS === 'web') {
    return <View {...(rest as ComponentProps<typeof View>)} />;
  }
  return <Animated.View entering={entering} exiting={exiting} layout={layout} {...rest} />;
}
