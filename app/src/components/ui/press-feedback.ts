/**
 * Press and hover feedback for plain `Pressable`s (the ones that are not a
 * `ScalePress`). Pass it as the style callback's last entry:
 *
 *   <Pressable style={(state) => [styles.row, pressFeedback(state)]} />
 *
 * Pressed dims the surface on every platform. Hover only exists with a
 * pointer (react-native-web adds `hovered` to the callback state); there it
 * brightens slightly and shows a pointer cursor.
 */
import { Platform, type PressableStateCallbackType, type ViewStyle } from 'react-native';

/** react-native-web's callback state carries `hovered`/`focused` too. */
type WebPressState = PressableStateCallbackType & { hovered?: boolean };

const PRESSED: ViewStyle = { opacity: 0.72 };

/**
 * Web-only hover treatment shared with `ScalePress`: pointer cursor on
 * anything enabled, a slight brighten while hovered, and a short transition.
 * Undefined on native.
 */
export function hoverStyle(hovered: boolean, enabled = true): ViewStyle | undefined {
  if (Platform.OS !== 'web') return undefined;
  // cursor/filter/transition are plain CSS on react-native-web.
  return {
    cursor: enabled ? 'pointer' : 'auto',
    transitionProperty: 'filter, opacity, background-color',
    transitionDuration: '140ms',
    filter: hovered ? 'brightness(1.1)' : undefined,
  } as unknown as ViewStyle;
}

export function pressFeedback(state: PressableStateCallbackType, enabled = true): ViewStyle[] {
  const { pressed, hovered } = state as WebPressState;
  const out: ViewStyle[] = [];
  const hover = hoverStyle(Boolean(hovered) && enabled, enabled);
  if (hover) out.push(hover);
  if (pressed && enabled) out.push(PRESSED);
  return out;
}
