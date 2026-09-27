# VibeXStudio design tokens

The source of truth is code: `src/constants/theme.ts` (colors, type, spacing,
radii, shadows), `src/components/themed-text.tsx` (text styles) and the
shared UI in `src/components/ui/`. This file summarizes them so screens stay
on the scale. If this file and `theme.ts` disagree, `theme.ts` wins — fix this
file.

Brand: **Co-Agent NOIR**, violet→cyan gradient over warm near-black. Dark is
canonical; light is the warm-paper take of the same hues. The dark palette is
transcribed from Media Lab's `coagent` theme (`media-lab/static/index.html`).

## Color (`Palette.dark` / `Palette.light`)

Read colors with `useTheme()`; never hard-code a hex in a component.

| Token | Dark | Light | Use |
|---|---|---|---|
| `background` | `#0B0806` | `#F7F6F2` | screen ground |
| `backgroundElement` | `#150F0B` | `#FFFFFF` | raised surface |
| `backgroundSelected` | `#211913` | `#EFEDE6` | selected fill, subtle buttons |
| `text` | `rgba(255,255,255,0.98)` | `rgba(20,24,31,0.98)` | primary text |
| `textSecondary` | `rgba(255,255,255,0.76)` | `rgba(20,24,31,0.62)` | secondary text (never dimmer) |
| `tint` | `#5EC2FF` | `#0A6FB2` | links, selected controls, focus |
| `tintSoft` | `rgba(94,194,255,0.16)` | `#DCEDF9` | tinted wells, selected chips |
| `onTint` | `#04121C` | `#FFFFFF` | text on `tint` |
| `accent` | `#A89BFF` | `#5A47D4` | violet counterpart |
| `gradientStart/Mid/End` | `#A89BFF → #83AEFF → #5EC2FF` | `#6D5CE8 → #0E8DE0 → #0A6FB2` | brand gradient via `gradientColors(theme)` |
| `onGradient` | `#04121C` | `#FFFFFF` | text/icons on the gradient |
| `danger` / `success` / `warning` | `#FF6B63` / `#3DDC97` / `#FFB454` | `#C4342B` / `#1D9E63` / `#D98324` | status |
| `border` | `rgba(255,255,255,0.13)` | `rgba(20,24,31,0.10)` | hairlines |
| `glass` / `glassBorder` | `rgba(12,9,7,0.55)` / `rgba(255,255,255,0.38)` | `rgba(255,253,249,0.62)` / `rgba(255,255,255,0.90)` | `Glass` surfaces |
| `washBlue/Violet/Amber` | `.16 / .14 / .08` alpha | `.10 / .08 / .06` alpha | web ambient ground (`lib/web-ground.ts`) |

Links: `ThemedText type="link"` inherits text color; `type="linkPrimary"` uses
`tint`.

### Color scheme

- Settings → Appearance: System / Light / Dark, stored per device.
- Fresh install: **native opens Dark**; **web follows the OS**
  (`prefers-color-scheme`) until the visitor picks one. See
  `getAppearance(fallback)` in `src/lib/storage/settings.ts`.

## Type

Faces: Space Grotesk (display) + Barlow (body), loaded in the root layout.
Select weight by family (`Fonts.displayBold`, `Fonts.bodyBold`), never with
`fontWeight` next to a custom family.

| `ThemedText` type | Face | Size / line | `TypeScale` |
|---|---|---|---|
| `title` | Space Grotesk 700 | 34 / 40 | `title` |
| `subtitle` | Space Grotesk 700 | 26 / 32 | `subtitle` |
| `heading` | Space Grotesk 600 | 17 / 22 | `heading` |
| `default` | Barlow 500 | 16 / 24 | `body` |
| `small`, `smallBold`, `link`, `linkPrimary` | Barlow 500 / 700 | 14 / 20 | `small` |
| `code` | system mono | 12 | `code` |
| micro caps labels (tabs, badges, eyebrows) | Space Grotesk 600 | 10, letter-spaced | `micro` |
| emoji in icon wells | — | 22 | `glyph` |

Use a `ThemedText` type first; reach for `TypeScale` only for the named
exceptions. Code editors may use 13 for density.

## Spacing (`Spacing`)

`half 2 · one 4 · two 8 · three 16 · four 24 · five 32 · six 64`. Screen
padding is `three` (phones) / `four` (wide); stacks use `two`–`four` gaps.
Content max width `MaxContentWidth` = 800.

## Radius (`Radii`)

| Token | px | Use |
|---|---|---|
| `sm` | 10 | chips, small logo marks |
| `md` | 14 | inputs, segmented controls, icon wells, list rows |
| `lg` | 20 | cards, sheets, **all primary and secondary buttons** |
| `xl` | 22 | hero tiles, project cards |
| `pill` | 999 | badges, status chips, the tab pill, filter chips |

Circles use `size / 2`; the phone-frame preview keeps its device radius.

**Buttons are rounded rectangles, not pills.** `Button` (every variant) and the
onboarding / tour primary CTAs use `Radii.lg`. This matches Media Lab's primary
`.go` button (a 15px rounded rect) and the `Button` component used on almost
every screen. Pills are for chips, badges and navigation only.

## Interaction

- Tappables use `ScalePress` (press-down spring + haptic on native; on web a
  pointer cursor, a slight lift and brighten on hover — the lift is skipped for
  reduced motion) or a plain `Pressable` with
  `style={(state) => [..., pressFeedback(state)]}` from
  `components/ui/press-feedback.ts` (dim on press, brighten on hover).
- Minimum hit area 44×44 (`minHeight: 44` or `hitSlop`).
- Roles: `accessibilityRole="button"` on every tappable card; tab bars are
  `tablist` with `tab` children carrying `accessibilityState={{ selected }}`
  (→ `aria-selected` on web).

## Motion

- Native: Reanimated `entering`/`exiting`, always wrapped in `enter()`
  (`src/lib/motion.ts`).
- Web: `webEnter(kind, duration, delay)` in the same style array — a CSS
  opacity/translate entrance (keyframes in `src/global.css`) that only exists
  under `prefers-reduced-motion: no-preference`. Exits are instant on web.

## Shadows

`Shadows.card` (resting) and `Shadows.float` (floating actions); tint a float
shadow with `shadowColor: theme.glow` for brand CTAs.
