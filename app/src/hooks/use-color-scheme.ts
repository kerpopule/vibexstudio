import { useColorScheme as useRNColorScheme } from 'react-native';

import { useApp } from '@/lib/store';

/**
 * Effective color scheme: the user's Appearance setting wins; 'system'
 * follows the OS. On native `Appearance.setColorScheme` already folds the
 * override into the RN value — reading the stored pref here as well is
 * harmless there and is the ONLY thing that makes the override work on
 * web/desktop, where that API doesn't exist.
 */
export function useColorScheme() {
  const os = useRNColorScheme();
  const appearance = useApp((s) => s.appearance);
  return appearance === 'system' ? os : appearance;
}
