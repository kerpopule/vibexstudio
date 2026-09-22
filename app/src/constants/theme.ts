/**
 * Design tokens for VibeXStudio.
 *
 * The current Media Lab reference uses near-black, neutral glass surfaces,
 * fine luminous edges, blue accents, and dim blue/purple background orbs.
 * Dark is canonical; light retains its warm-paper palette.
 * Components share these tokens across desktop and mobile.
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
  /**
   * Ambient background washes — the "orbs" that make the Co-Agent ground read
   * as Co-Agent rather than as flat near-black. Web only; RN has no radial
   * gradients, so native renders the flat `background` token alone.
   * Transcribed from `media-lab/static/index.html` `:root[data-theme="coagent"] body`.
   */
  orbBlue: string;
  orbViolet: string;
  orbAmber: string;
}

/**
 * NOIR dark — the canonical Media Lab / Co-Agent look: **warm** near-black ink,
 * glass tiles, blue selected controls and neutral glass edges.
 *
 * Every value below is transcribed from the live `coagent` theme in
 * `media-lab/static/index.html` — the studio's default theme
 * (`localStorage['lab-theme']`, default `'coagent'`, "Studio default: the
 * Co-Agent look"). That source is the authority for this palette; if it changes,
 * this block changes with it.
 *
 * Verified coagent tokens (2026-09-22):
 *   --ink:#0B0806  --ink-2:#150F0B
 *   --gold:#5EC2FF  --gold-hi:#A89BFF  --gold-2:#3A8FCC
 *   --on-accent:#04121C  --red:#FF6B63  --green:#3DDC97
 *   --bg-a:#0E2A3A  --bg-b:#1A1330
 *   --nav-bg:rgba(12,18,26,.55)  --panel:rgba(7,10,14,.90)
 *   --glass:rgba(12,9,7,.44)  --glass-strong:rgba(10,7,5,.62)
 * and the three ambient ground washes the theme paints over `--ink`:
 *   blue  rgba(94,194,255,.16) at 14% -6%
 *   violet rgba(139,124,255,.14) at 92% 10%
 *   amber rgba(255,180,84,.08)  at 50% 102%
 *
 * The amber wash is real and intended — it is what keeps the warm ink from
 * reading as a cold blue-black. Do not "correct" it away.
 */
const dark: Theme = {
  text: 'rgba(255,255,255,0.98)',
  /** `--ink` — warm near-black, not neutral black. */
  background: '#0B0806',
  /** `--ink-2` — the one raised ink step. */
  backgroundElement: '#150F0B',
  /**
   * Derived: one step above `--ink-2` for selected fills and code blocks.
   * coagent has no direct token for this; it only needs to stay in the ink
   * family (+12 per channel from `--ink-2`, warmth preserved).
   */
  backgroundSelected: '#211913',
  /** Text ramp floor — never dimmer than 0.76 alpha on the NOIR ground. */
  textSecondary: 'rgba(255,255,255,0.76)',
  /** `--gold` — the blue primary. */
  tint: '#5EC2FF',
  /** The blue ambient wash value, used as a raised well behind tinted fills. */
  tintSoft: 'rgba(94,194,255,0.16)',
  /** `--on-accent`. */
  onTint: '#04121C',
  onGradient: '#04121C',
  border: 'rgba(255,255,255,0.13)',
  /** `--red`. */
  danger: '#FF6B63',
  /** `--green`. */
  success: '#3DDC97',
  warning: '#FFB454',
  /**
   * `--gold-hi` — coagent's violet. The light palette already treats `accent`
   * as the violet counterpart to a blue `tint`; dark now matches, which is what
   * puts coagent's blue→violet identity into the app.
   */
  accent: '#A89BFF',
  /**
   * The brand gradient: **violet → cyan**, matching `scripts/generate-assets.js`
   * (`GRAD_START` #A89BFF violet → `GRAD_END` #5EC2FF cyan — the icon artwork)
   * and the CLAUDE.md brand note "violet→cyan gradient over warm near-black".
   * The previous all-cyan ramp contradicted the app's own mark.
   *
   * The midpoint is derived as the per-channel mean of the two ends; the
   * generator itself only defines a 2-stop diagonal.
   * All three stops keep `onGradient` (#04121C) at ≥7.9:1 — the old ramp's
   * bottom stop was 5.2:1, so this is an accessibility improvement, not just a
   * brand fix.
   */
  gradientStart: '#A89BFF',
  gradientMid: '#83AEFF',
  gradientEnd: '#5EC2FF',
  /**
   * `--glass` hue with `--glass-strong`'s weight. The source's flat `.44` alpha
   * only reads because Media Lab pairs it with a blurred backdrop AND a 1.3px
   * specular rim; native RN has neither, so alpha stays up or glass tiles
   * vanish into the ground. Hue is source-exact.
   */
  glass: 'rgba(12,9,7,0.55)',
  glassBorder: 'rgba(255,255,255,0.38)',
  /** Blue ambient wash — the first of the three ground washes. */
  glowSoft: 'rgba(94,194,255,0.08)',
  glow: '#50B7EE',
  /**
   * The three Co-Agent washes, source-exact from Media Lab
   * (`rgba(94,194,255,.16)` / `rgba(139,124,255,.14)` / `rgba(255,180,84,.08)`).
   * Positions live in `themed-view.tsx`: blue top-left, violet top-right,
   * warm amber bottom-centre.
   */
  orbBlue: 'rgba(94,194,255,0.16)',
  orbViolet: 'rgba(139,124,255,0.14)',
  orbAmber: 'rgba(255,180,84,0.08)',
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
  /**
   * Derived for the light (warm-paper) ground: the same three-wash structure,
   * tuned down and re-hued to the light palette's own accents (`tint` #0A6FB2,
   * `accent` #5A47D4, `warning` #D98324). Media Lab's own `paper` theme has no
   * washes, so these have no source-exact counterpart.
   */
  orbBlue: 'rgba(10,111,178,0.10)',
  orbViolet: 'rgba(90,71,212,0.08)',
  orbAmber: 'rgba(217,131,36,0.06)',
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
  /** Floating action surfaces — restrained neutral lift. */
  float: {
    shadowColor: '#000000',
    shadowOpacity: 0.35,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
    elevation: 6,
  },
} as const;

export const BottomTabInset = Platform.select({ ios: 50, android: 80 }) ?? 0;
export const MaxContentWidth = 800;
