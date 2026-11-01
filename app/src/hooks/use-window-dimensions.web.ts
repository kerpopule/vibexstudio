import { useWindowDimensions as useRNWindowDimensions, type ScaledSize } from 'react-native';

import { useHasHydrated } from '@/hooks/use-has-hydrated';

/** What react-native-web reports while rendering the static export (no window). */
const STATIC_RENDER: ScaledSize = { width: 0, height: 0, scale: 1, fontScale: 1 };

/**
 * Window size that is safe to hydrate on web. The static export is rendered
 * with a 0x0 window, so layouts that branch on width (wide/narrow) would
 * differ from the first client render and React would throw away the server
 * HTML (minified error #418). During hydration this returns the static-render
 * size, then the real one; after hydration it is the real size from the start.
 */
export function useWindowDimensions(): ScaledSize {
  const hasHydrated = useHasHydrated();
  const size = useRNWindowDimensions();
  return hasHydrated ? size : STATIC_RENDER;
}
