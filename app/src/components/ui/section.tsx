import type { PropsWithChildren, ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Radii, Shadows, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

/** Settings-style section: a header plus a rounded card of rows. */
export function Section({ title, children }: PropsWithChildren<{ title: string }>) {
  const theme = useTheme();
  return (
    <View style={styles.section}>
      <ThemedText type="smallBold" themeColor="textSecondary" style={styles.header}>
        {title.toUpperCase()}
      </ThemedText>
      <View style={[styles.card, { backgroundColor: theme.backgroundElement }, Shadows.card]}>{children}</View>
    </View>
  );
}

export function Row({
  title,
  subtitle,
  left,
  right,
  onPress,
  destructive,
}: {
  title: string;
  subtitle?: string;
  left?: ReactNode;
  right?: ReactNode;
  onPress?: () => void;
  destructive?: boolean;
}) {
  const theme = useTheme();
  const content = (
    <View style={styles.row}>
      {left ? <View style={styles.left}>{left}</View> : null}
      <View style={styles.body}>
        <ThemedText style={destructive ? { color: theme.danger } : undefined} numberOfLines={1}>
          {title}
        </ThemedText>
        {subtitle ? (
          <ThemedText type="small" themeColor="textSecondary" numberOfLines={3}>
            {subtitle}
          </ThemedText>
        ) : null}
      </View>
      {right ?? (onPress ? <ThemedText themeColor="textSecondary">›</ThemedText> : null)}
    </View>
  );
  if (!onPress) return content;
  return (
    <Pressable onPress={onPress} style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}>
      {content}
    </Pressable>
  );
}

export function RowDivider() {
  const theme = useTheme();
  return <View style={[styles.divider, { backgroundColor: theme.border }]} />;
}

const styles = StyleSheet.create({
  section: {
    gap: Spacing.two,
  },
  header: {
    marginLeft: Spacing.three,
  },
  card: {
    borderRadius: Radii.lg,
    overflow: 'hidden',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    paddingHorizontal: Spacing.three,
    paddingVertical: 14,
    minHeight: 52,
  },
  left: {
    width: 32,
    alignItems: 'center',
  },
  body: {
    flex: 1,
    gap: 2,
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    marginLeft: Spacing.three,
  },
});
