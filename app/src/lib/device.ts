/**
 * Platform-aware device nouns for user-facing copy, so the desktop/web build
 * doesn't claim to be an iPhone.
 */
import { Platform } from 'react-native';

/** "your iPhone" / "your phone" / "your computer" */
export const yourDevice = Platform.select({
  ios: 'your iPhone',
  android: 'your phone',
  default: 'your computer',
});

/** "this iPhone" / "this phone" / "this computer" */
export const thisDevice = Platform.select({
  ios: 'this iPhone',
  android: 'this phone',
  default: 'this computer',
});

/** Bare noun: "iPhone" / "phone" / "computer" */
export const deviceNoun = Platform.select({
  ios: 'iPhone',
  android: 'phone',
  default: 'computer',
});
