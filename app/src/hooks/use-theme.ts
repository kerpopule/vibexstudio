/**
 * Resolves the active theme from the effective color scheme. Appearance
 * overrides flow through `Appearance.setColorScheme`, so `useColorScheme`
 * already reflects them.
 */

import { Palette } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

export function useTheme() {
  const scheme = useColorScheme();

  return Palette[scheme === 'dark' ? 'dark' : 'light'];
}
