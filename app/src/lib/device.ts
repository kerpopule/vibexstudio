/**
 * Platform-aware device nouns for user-facing copy, so the desktop/web build
 * doesn't claim to be an iPhone.
 */
import { Platform } from 'react-native';

/** Device-neutral on mobile so the same copy is correct on phone and tablet. */
export const yourDevice = Platform.select({
  ios: 'your device',
  android: 'your device',
  default: 'your computer',
});

/** "this device" / "this computer" */
export const thisDevice = Platform.select({
  ios: 'this device',
  android: 'this device',
  default: 'this computer',
});

/** Bare noun: "device" / "computer" */
export const deviceNoun = Platform.select({
  ios: 'device',
  android: 'device',
  default: 'computer',
});
