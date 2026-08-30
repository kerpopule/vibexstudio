import { useSyncExternalStore } from 'react';
import { useColorScheme as useRNColorScheme } from 'react-native';

import { useApp } from '@/lib/store';

const subscribe = () => () => {};

/**
 * Effective color scheme on web/desktop: the user's Appearance setting wins
 * ('system' follows prefers-color-scheme). There is no Appearance.
 * setColorScheme on react-native-web, so the stored pref is applied here.
 * The hydration guard keeps static rendering stable (server snapshot is
 * always 'light').
 */
export function useColorScheme() {
  const hasHydrated = useSyncExternalStore(
    subscribe,
    () => true,
    () => false
  );
  const os = useRNColorScheme();
  const appearance = useApp((s) => s.appearance);
  if (!hasHydrated) return 'light';
  return appearance === 'system' ? os : appearance;
}
