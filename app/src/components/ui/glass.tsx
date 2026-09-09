import { BlurView } from 'expo-blur';
import { GlassView, isLiquidGlassAvailable } from 'expo-glass-effect';
import type { ReactNode } from 'react';
import { Platform, View, type StyleProp, type ViewStyle } from 'react-native';

import { Radii } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useTheme } from '@/hooks/use-theme';

const LIQUID_GLASS = Platform.OS === 'ios' && isLiquidGlassAvailable();

export type GlassProps = {
  children?: ReactNode;
  style?: StyleProp<ViewStyle>;
  /** Corner radius; defaults to the large card radius. */
  radius?: number;
  /** 'regular' = frosted, 'clear' = barely-there. iOS liquid glass only. */
  variant?: 'regular' | 'clear';
  /** Tint pulled toward the brand on the glass (iOS liquid glass). */
  tint?: string;
  /** Adds the thin luminous hairline that sells the glass edge. */
  bordered?: boolean;
};

/**
 * One glass surface, three tiers of fidelity:
 *  1. iOS 26+ → real liquid glass (`expo-glass-effect`).
 *  2. Other iOS / Android → `expo-blur` frosted blur.
 *  3. Anything else → a translucent fill.
 * Every tier gets the signature thin luminous border.
 */
export function Glass({ children, style, radius = Radii.lg, variant = 'regular', tint, bordered = true }: GlassProps) {
  const theme = useTheme();
  const scheme = useColorScheme();
  const border = bordered
    ? { borderWidth: 1, borderColor: theme.glassBorder }
    : null;

  if (LIQUID_GLASS) {
    return (
      <GlassView
        glassEffectStyle={variant}
        tintColor={tint}
        colorScheme={scheme === 'dark' ? 'dark' : 'light'}
        style={[{ borderRadius: radius, overflow: 'hidden' }, border, style]}>
        {children}
      </GlassView>
    );
  }

  if (Platform.OS === 'ios' || Platform.OS === 'android') {
    return (
      <BlurView
        intensity={variant === 'clear' ? 24 : 48}
        tint={scheme === 'dark' ? 'dark' : 'light'}
        style={[{ borderRadius: radius, overflow: 'hidden' }, border, style]}>
        {children}
      </BlurView>
    );
  }

  return (
    <View style={[{ borderRadius: radius, backgroundColor: theme.glass, overflow: 'hidden', ...(Platform.OS==='web'?{backdropFilter:'blur(20px) saturate(118%)',WebkitBackdropFilter:'blur(20px) saturate(118%)',backgroundImage:'linear-gradient(180deg,rgba(255,255,255,.085),rgba(255,255,255,.012))',boxShadow:'inset 0 1px 0 rgba(255,255,255,.28),inset 0 0 0 1px rgba(255,255,255,.08),0 18px 36px -18px rgba(0,0,0,.48)'} as object:{}) }, border, style]}>
      {children}
    </View>
  );
}
