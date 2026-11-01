/**
 * Motion helpers shared by native and web.
 *
 * Reanimated layout animations (`entering`/`exiting`) leave remounted
 * content `visibility: hidden` in the static web export, so screens wrap
 * them in `enter()` — animation on native, plain mount on web.
 *
 * Web gets its entrance from `webEnter()` instead: a plain CSS animation
 * (opacity + a short translate) whose keyframes live in `src/global.css`.
 * The keyframes are declared inside `@media (prefers-reduced-motion:
 * no-preference)`, so for reduced-motion users the animation name resolves
 * to nothing and the content simply appears — no JS check, no hydration
 * mismatch. The animation fills `both`, so nothing is ever left hidden once
 * it ends, even if the app's JS never runs.
 *
 * Exits are not animated on web: the element is unmounted immediately.
 */
import { Platform, type ViewStyle } from 'react-native';

export function enter<T>(animation: T): T | undefined {
  return Platform.OS === 'web' ? undefined : animation;
}

/** Web entrance kinds; keyframe names match `src/global.css`. */
export type WebEnterKind = 'fade' | 'fade-down' | 'fade-up';

const KEYFRAMES: Record<WebEnterKind, string> = {
  fade: 'vx-enter-fade',
  'fade-down': 'vx-enter-fade-down',
  'fade-up': 'vx-enter-fade-up',
};

/**
 * CSS entrance for web, mirroring the native `enter()` animation next to it
 * (`FadeIn` → 'fade', `FadeInDown` → 'fade-down', `FadeInUp` → 'fade-up').
 * Returns undefined on native, so it can sit in any style array.
 */
export function webEnter(kind: WebEnterKind, duration = 320, delay = 0): ViewStyle | undefined {
  if (Platform.OS !== 'web') return undefined;
  // react-native-web passes these through as plain CSS properties; they are
  // not part of RN's ViewStyle type.
  return {
    animationName: KEYFRAMES[kind],
    animationDuration: `${duration}ms`,
    animationDelay: `${delay}ms`,
    animationTimingFunction: 'cubic-bezier(0.2, 0.8, 0.2, 1)',
    animationFillMode: 'both',
  } as unknown as ViewStyle;
}
