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

/**
 * "this device" everywhere. The web build runs on phones and tablets as well
 * as computers (and inside the desktop shell), and the page is rendered ahead
 * of time, so it cannot pick "computer" safely.
 */
export const thisDevice = Platform.select({
  ios: 'this device',
  android: 'this device',
  web: 'this device',
  default: 'this computer',
});

/** Bare noun: "device" / "computer" */
export const deviceNoun = Platform.select({
  ios: 'device',
  android: 'device',
  default: 'computer',
});
