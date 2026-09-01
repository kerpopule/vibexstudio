/**
 * Design tokens for VibeXStudio.
 *
 * The visual language is the Co-Agent / Media Lab "NOIR" system: a warm
 * near-black ground (never blue-black), liquid-glass surfaces, and
 * cyan→violet accents. Dark is canonical; light is a warm-paper derivation
 * with contrast-checked accents. Components read every value from here —
 * no hex literals in screens.
 *
 * Token sources: media-lab-studio static/index.html (`data-theme="coagent"`)
 * and coagent-command DESIGN-SYSTEM.md §1 (DARK/LIGHT token blocks).
 */

import '@/global.css';

import { Platform } from 'react-native';

/** Every color token a screen can read. Ships light + dark takes. */
export interface Theme {
  text: string;
  background: string;
  backgroundElement: string;
  backgroundSelected: string;
  textSecondary: string;
  tint: string;
  tintSoft: string;
  onTint: string;
  onGradient: string;
  border: string;
  danger: string;
  success: string;
  warning: string;
  accent: string;
  gradientStart: string;
  gradientMid: string;
  gradientEnd: string;
  glass: string;
  glassBorder: string;
  glowSoft: string;
  /** Saturated brand color used for floating shadows/glows. */
  glow: string;
}

/**
 * NOIR dark — the canonical Media Lab / Co-Agent look: warm near-black ink,
 * glass tiles, cyan (#5EC2FF) primary with a violet (#A89BFF) companion.
 */
const dark: Theme = {
  text: 'rgba(255,255,255,0.98)',
  /** Warm near-black — the NOIR ground. Never blue-black. */
  background: '#0B0806',
  backgroundElement: '#150F0B',
  backgroundSelected: '#221913',
  /** Text ramp floor — never dimmer than 0.76 alpha on the NOIR ground. */
  textSecondary: 'rgba(255,255,255,0.76)',
  tint: '#5EC2FF',
  /** Cyan-cast raised well behind selected/tinted fills. */
  tintSoft: '#0E2230',
  /** Dark ink on the cyan accent — white doesn't clear contrast on #5EC2FF. */
  onTint: '#04121C',
  onGradient: '#04121C',
  border: 'rgba(255,255,255,0.13)',
  danger: '#FF6B63',
  success: '#3DDC97',
  warning: '#FFB454',
  accent: '#A89BFF',
  /** Brand gradient — violet → cyan → deep cyan (the Co-Agent CTA wash). */
  gradientStart: '#A89BFF',
  gradientMid: '#5EC2FF',
  gradientEnd: '#3A8FCC',
  /** Glass surface fill + hairline (used by the Glass component fallback). */
  glass: 'rgba(12,9,7,0.44)',
  glassBorder: 'rgba(255,255,255,0.17)',
  /** Subtle cyan wash behind hero/empty states. */
  glowSoft: 'rgba(94,194,255,0.14)',
  glow: '#5EC2FF',
};

/**
 * NOIR light — warm paper ground with the same hue family, pre-resolved to
 * contrast-checked accents (#0A6FB2 body-legible cyan, #5A47D4 violet).
 */
const light: Theme = {
  text: 'rgba(20,24,31,0.98)',
  /** Warm paper, not clinical white. */
  background: '#F7F6F2',
  backgroundElement: '#FFFFFF',
  backgroundSelected: '#EFEDE6',
  textSecondary: 'rgba(20,24,31,0.62)',
  /** 4.9:1 on paper — safe at body size. */
  tint: '#0A6FB2',
  tintSoft: '#DCEDF9',
  onTint: '#FFFFFF',
  /** The light gradient runs mid-blue, so white ink reads best on it. */
  onGradient: '#FFFFFF',
  border: 'rgba(20,24,31,0.10)',
  danger: '#C4342B',
  success: '#1D9E63',
  warning: '#D98324',
  accent: '#5A47D4',
  gradientStart: '#6D5CE8',
  gradientMid: '#0E8DE0',
  gradientEnd: '#0A6FB2',
  glass: 'rgba(255,253,249,0.62)',
  glassBorder: 'rgba(255,255,255,0.90)',
  glowSoft: 'rgba(94,194,255,0.30)',
  glow: '#0E8DE0',
};

/** The single NOIR palette; the Appearance setting (or the OS) picks the scheme. */
export const Palette: { light: Theme; dark: Theme } = { light, dark };

/** Back-compat default palette. */
export const Colors = Palette;

/** Brand gradient as an ordered color stop array, ready for LinearGradient. */
export function gradientColors(theme: Theme): [string, string, string] {
  return [theme.gradientStart, theme.gradientMid, theme.gradientEnd];
}

export type ThemeColor = keyof Theme;

/**
 * Typefaces — the Media Lab pairing: Space Grotesk for display (titles,
 * headings, tab labels) and Barlow for body copy. Both are OFL and bundled
 * via @expo-google-fonts, loaded once in the root layout. Custom families on
 * native select weight by FAMILY NAME, so never combine these with a
 * `fontWeight` — pick the weighted face instead.
 */
export const Fonts = {
  /** Space Grotesk 600 — the workhorse display face. */
  display: 'SpaceGrotesk_600SemiBold',
  displayBold: 'SpaceGrotesk_700Bold',
  displayMedium: 'SpaceGrotesk_500Medium',
  /** Barlow — body copy. */
  body: 'Barlow_400Regular',
  bodyMedium: 'Barlow_500Medium',
  bodySemi: 'Barlow_600SemiBold',
  bodyBold: 'Barlow_700Bold',
  /** Legacy aliases (old call sites): rounded = display, sans = body. */
  rounded: 'SpaceGrotesk_600SemiBold',
  sans: 'Barlow_500Medium',
  serif: Platform.select({ ios: 'ui-serif', default: 'serif' }) as string,
  mono: Platform.select({ ios: 'ui-monospace', default: 'monospace' }) as string,
} as const;

/** Font map for expo-font's useFonts — every face the app references. */
export const FONT_ASSETS = {
  SpaceGrotesk_500Medium: require('@expo-google-fonts/space-grotesk/500Medium/SpaceGrotesk_500Medium.ttf'),
  SpaceGrotesk_600SemiBold: require('@expo-google-fonts/space-grotesk/600SemiBold/SpaceGrotesk_600SemiBold.ttf'),
  SpaceGrotesk_700Bold: require('@expo-google-fonts/space-grotesk/700Bold/SpaceGrotesk_700Bold.ttf'),
  Barlow_400Regular: require('@expo-google-fonts/barlow/400Regular/Barlow_400Regular.ttf'),
  Barlow_500Medium: require('@expo-google-fonts/barlow/500Medium/Barlow_500Medium.ttf'),
  Barlow_600SemiBold: require('@expo-google-fonts/barlow/600SemiBold/Barlow_600SemiBold.ttf'),
  Barlow_700Bold: require('@expo-google-fonts/barlow/700Bold/Barlow_700Bold.ttf'),
};

export const Spacing = {
  half: 2,
  one: 4,
  two: 8,
  three: 16,
  four: 24,
  five: 32,
  six: 64,
} as const;

export const Radii = {
  /** Chips, small controls. */
  sm: 10,
  /** Inputs, segmented controls. */
  md: 14,
  /** Cards, sheets, buttons. */
  lg: 20,
  /** Hero tiles, emoji wells — Media Lab cards run 22. */
  xl: 22,
  pill: 999,
} as const;

/**
 * Layered iOS-style shadows. Spread onto a style object; android gets
 * elevation automatically via the `elevation` key.
 */
export const Shadows = {
  /** Resting cards — deep neutral lift, per the NOIR --lift1. */
  card: {
    shadowColor: '#000000',
    shadowOpacity: 0.35,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 6 },
    elevation: 3,
  },
  /** Floating action surfaces — gradient buttons, the composer. Cyan halo. */
  float: {
    shadowColor: '#5EC2FF',
    shadowOpacity: 0.35,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
    elevation: 6,
  },
} as const;

export const BottomTabInset = Platform.select({ ios: 50, android: 80 }) ?? 0;
export const MaxContentWidth = 800;
