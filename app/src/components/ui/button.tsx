import { LinearGradient } from 'expo-linear-gradient';
import type { ReactNode } from 'react';
import { ActivityIndicator, StyleSheet, View, type PressableProps } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ScalePress } from '@/components/ui/scale-press';
import { gradientColors, Radii, Shadows, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export type ButtonProps = Omit<PressableProps, 'children' | 'style'> & {
  title: string;
  variant?: 'primary' | 'secondary' | 'danger';
  loading?: boolean;
  /** Optional element rendered before the title (an icon, an emoji). */
  leading?: ReactNode;
  style?: object;
};

export function Button({ title, variant = 'primary', loading, disabled, leading, style, ...rest }: ButtonProps) {
  const theme = useTheme();
  const isDisabled = disabled || loading;
  const color = variant === 'secondary' ? theme.text : variant === 'primary' ? theme.onGradient : theme.onTint;

  const content = (
    <View style={styles.content}>
      {loading ? (
        <ActivityIndicator color={color} />
      ) : (
        <>
          {leading}
          <ThemedText type="smallBold" style={{ color, fontSize: 16 }}>
            {title}
          </ThemedText>
        </>
      )}
    </View>
  );

  if (variant === 'primary') {
    return (
      <ScalePress
        accessibilityRole="button"
        disabled={isDisabled}
        style={[
          styles.shell,
          !isDisabled && [Shadows.float, { shadowColor: theme.glow }],
          { opacity: isDisabled ? 0.55 : 1 },
          style,
        ]}
        {...rest}>
        {/* 0.85 keeps the neon brand without searing the eyeballs. */}
        <LinearGradient
          colors={gradientColors(theme)}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={[styles.fill, styles.gradientDim]}>
          {content}
        </LinearGradient>
      </ScalePress>
    );
  }

  return (
    <ScalePress
      accessibilityRole="button"
      disabled={isDisabled}
      style={[
        styles.shell,
        {
          backgroundColor: variant === 'danger' ? theme.danger : theme.backgroundSelected,
          opacity: isDisabled ? 0.55 : 1,
        },
        style,
      ]}
      {...rest}>
      {content}
    </ScalePress>
  );
}

const styles = StyleSheet.create({
  shell: {
    borderRadius: Radii.lg,
    overflow: 'visible',
  },
  fill: {
    borderRadius: Radii.lg,
  },
  gradientDim: {
    opacity: 0.85,
  },
  content: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.two,
    minHeight: 52,
    paddingVertical: 14,
    paddingHorizontal: Spacing.four,
  },
});
