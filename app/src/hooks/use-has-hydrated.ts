import { useSyncExternalStore } from 'react';

const subscribe = () => () => {};

/**
 * False while React hydrates the static web export (and during the static
 * render itself), true afterwards and for every screen mounted later. Use it
 * to keep values the server cannot know (window size, the real URL) out of
 * the first client render so it matches the exported HTML.
 */
export function useHasHydrated(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => true,
    () => false
  );
}
