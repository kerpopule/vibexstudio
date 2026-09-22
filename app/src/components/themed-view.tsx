import { Platform, View, type ViewProps } from 'react-native';

import { ThemeColor, type Theme } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export type ThemedViewProps = ViewProps & {
  lightColor?: string;
  darkColor?: string;
  type?: ThemeColor;
};

/**
 * The Co-Agent ambient ground washes.
 *
 * Media Lab's word for these is "washes", not "orbs" — `styles.orb` in this
 * app is the circular gradient badge, which is a different element.
 *
 * Geometry and order are Media Lab's own
 * (`media-lab/static/index.html`, `:root[data-theme="coagent"] body`):
 * blue top-left, violet top-right, warm amber bottom-centre.
 *
 * These used to be three hardcoded literals here (`rgba(58,139,195,.11)` /
 * `rgba(113,75,169,.09)`, no amber) which is why the visible ground ignored the
 * palette entirely. They are theme tokens now — see `Theme.washBlue` and friends.
 *
 * React Native has no radial gradients, so this is web-only (desktop + PWA);
 * native keeps the flat `background` token.
 */
function groundWashes(theme: Theme): string {
  return [
    `radial-gradient(900px 620px at 14% -6%, ${theme.washBlue} 0%, transparent 70%)`,
    `radial-gradient(820px 560px at 92% 10%, ${theme.washViolet} 0%, transparent 70%)`,
    `radial-gradient(720px 520px at 50% 102%, ${theme.washAmber} 0%, transparent 72%)`,
  ].join(',');
}

export function ThemedView({ style, lightColor, darkColor, type, ...otherProps }: ThemedViewProps) {
  const theme = useTheme();

  return (
    <View
      style={[
        {
          backgroundColor: theme[type ?? 'background'],
          ...(!type && Platform.OS === 'web' ? ({ backgroundImage: groundWashes(theme) } as object) : {}),
        },
        style,
      ]}
      {...otherProps}
    />
  );
}
