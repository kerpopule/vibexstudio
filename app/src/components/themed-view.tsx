import { Platform, View, type ViewProps } from 'react-native';

import { ThemeColor } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export type ThemedViewProps = ViewProps & {
  lightColor?: string;
  darkColor?: string;
  type?: ThemeColor;
};

export function ThemedView({ style, lightColor, darkColor, type, ...otherProps }: ThemedViewProps) {
  const theme = useTheme();

  /**
   * The Co-Agent ambient ground washes ride on this element — but as real CSS,
   * not as a `backgroundImage` style: react-native-web has no gradient handling,
   * so a style-level gradient is silently dropped and never reaches the DOM
   * (that is why the ground was flat ink for the component's whole life).
   * `applyGroundWashes` publishes the rule; this attribute opts the element in.
   *
   * Only for the untinted ground (`!type`), same as before, and web-only —
   * native keeps the flat `background` token.
   */
  const ground =
    !type && Platform.OS === 'web' ? ({ dataSet: { vibexGround: 'on' } } as object) : {};

  return (
    <View
      style={[{ backgroundColor: theme[type ?? 'background'] }, style]}
      {...ground}
      {...otherProps}
    />
  );
}
