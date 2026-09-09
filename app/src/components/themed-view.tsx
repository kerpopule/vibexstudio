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

  return <View style={[{ backgroundColor: theme[type ?? 'background'], ...(!type&&Platform.OS==='web'?{backgroundImage:'radial-gradient(circle at 8% 12%,rgba(58,139,195,.11) 0%,transparent 42%),radial-gradient(circle at 87% 72%,rgba(113,75,169,.09) 0%,transparent 44%)'} as object:{}) }, style]} {...otherProps} />;
}
