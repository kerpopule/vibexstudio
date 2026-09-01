/**
 * Reanimated layout animations (`entering`/`exiting`) leave remounted
 * content `visibility: hidden` in the static web export, so screens wrap
 * them in `enter()` — animation on native, plain mount on web.
 */
import { Platform } from 'react-native';

export function enter<T>(animation: T): T | undefined {
  return Platform.OS === 'web' ? undefined : animation;
}
