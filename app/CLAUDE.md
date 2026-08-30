# VibeXStudio — agent notes

Local-first mobile app (Expo SDK 56, expo-router, TypeScript strict) where
users vibe-code static web apps via AI chat, preview them in a WebView, and
optionally publish to their own GitHub + Pages.

## Commands

- `npm run typecheck` — strict tsc, must stay clean
- `npm run lint` — expo lint (eslint 9), zero warnings policy in CI
- `npm test` — vitest; tests cover the pure logic in `src/lib` (parser,
  prompts, share page). Modules with Expo/native imports are not unit-tested.

## Architecture invariants

- **No backend, ever.** The app talks only to the user's chosen AI providers
  and GitHub, directly from the device. Do not add analytics, telemetry, or
  any VibeXStudio-owned service.
- **Secrets only in `src/lib/storage/secrets.ts`** (expo-secure-store).
  Never put tokens/keys in AsyncStorage, project files, or zustand state.
- Non-secret settings → `src/lib/storage/settings.ts` (AsyncStorage).
  Project data → `src/lib/storage/projects.ts` (expo-file-system `File`/
  `Directory` API — note: the *new* SDK 54+ class API, not the legacy one).
- AI providers are described in `src/lib/ai/registry.ts`; chat goes through
  one of three wire protocols in `src/lib/ai/chat.ts` (openai, anthropic,
  gemini) using the XHR-based SSE helper in `src/lib/ai/sse.ts` (RN fetch
  can't stream).
- **Generation runs in `src/lib/chat-engine.ts`** (zustand), never in a
  component — turns keep streaming across pane switches and navigation.
  Concurrency is gated by `src/lib/concurrency.ts` (FIFO slots, hardware
  ceiling from `src/lib/turn-limits.ts` — never a flat limit of one). Turn
  outcomes fire local notifications via `src/lib/notifications.ts` (done /
  reply / error / paused) only when the app is backgrounded; notification
  taps deep-link to the project from the root layout. Background-interrupted
  turns auto-resume app-wide from the engine's AppState listener — do not
  reintroduce per-view resume logic.
  Its per-project `filesVersion` counter drives live preview reloads; the
  project screen keeps all four panes mounted (display:none) so the WebView
  survives tab changes. Don't move turn execution back into components.
- Chat text renders through `src/lib/markdown.ts` (pure, tested) +
  `src/components/markdown.tsx`. Extend the parser, not ad-hoc regexes in
  components.
- Brand: Co-Agent NOIR — violet→cyan gradient over warm near-black (see
  `src/constants/theme.ts`; use `gradientColors(theme)` for the 3-stop array,
  and `onGradient` for text/icons on it). Icons/splash are drawn
  programmatically by `scripts/generate-assets.js` (always overwrites — it is
  the artwork's source of truth; keep its color constants in sync with theme).
- Glass surfaces go through `src/components/ui/glass.tsx` — real iOS liquid
  glass (`expo-glass-effect`) with `expo-blur` then a translucent fallback.
  Use it for cards/composer/sheets instead of a flat `backgroundElement` fill.
- VibeX has a personality: the system prompt in `src/lib/ai/prompts.ts` makes
  the builder witty, hype, all-ages-clean. Keep the hard rules + output format
  intact when editing it (the parser depends on the fenced-block contract).
- "Bring your subscription" OAuth lives in `src/lib/ai/subscriptionOauth.ts`
  (MiniMax + Kimi device-code flows, real public client ids from their CLIs).
  Tokens: access in keychain via secrets.ts, refresh via
  setProviderRefreshToken; `store.refreshSubscriptionIfNeeded` tops them up
  before a turn. Routing/headers resolve in `chat.ts` from the subscription
  spec (MiniMax = Anthropic wire + bearer; Kimi = OpenAI wire + UA header).
- Preview auto-reveals: the engine bumps `previewReadySignal` when a turn
  first writes index.html; `project/[id].tsx` watches it and jumps to Preview.
- Model output → files via the fenced-block format in `src/lib/ai/prompts.ts`
  parsed by `src/lib/ai/parser.ts` (paths sanitized — keep it that way).
- GitHub sync pushes a whole-tree commit via the Git Data API
  (`src/lib/github/sync.ts`) and writes `s/index.html` (share/redirect page),
  `vibex.json` (project meta), and `README.md` alongside the app files.
- Share links: Pages URL + `/s/` → `vibex://import?repo=owner/name&ref=br`
  handled by `src/app/import.tsx` via `src/lib/github/importRepo.ts`.

## iOS builds & testing — use FlowDeck (macOS only)

When running on a Mac with the FlowDeck CLI installed, drive Xcode through
`flowdeck` instead of raw xcodebuild/simctl — it wraps build/run/test/
simulator/UI-automation in one CLI with `--json` (NDJSON) output made for
agents. Docs: https://flowdeck.studio/docs/cli/introduction

- One-time: `flowdeck ai install-skill` (installs the Claude Code skill);
  `npx expo prebuild --platform ios` generates the `ios/` workspace
  (gitignored — regenerate freely).
- Build & run: `flowdeck build` / `flowdeck run -s "iPhone 16"` from the
  repo root (FlowDeck auto-detects the workspace; Metro must be running for
  debug builds: `npx expo start`).
- Verify UI like a user (v1.16+): `flowdeck ui simulator tap/type/swipe/
  assert visible` — batch sequences in one call to save tool calls.
- Capture proof: `flowdeck simulator frames --duration 2s --fps 15` or
  `flowdeck simulator record` to validate the WebView preview and animations.
- Localization/accessibility passes: `flowdeck simulator language set es`,
  `flowdeck simulator content-size set accessibility-extra-large`.
- Deep-link testing: `flowdeck ui simulator open-url "vibex://import?repo=owner/name"`
  (needs a dev build, not Expo Go).

This shell may be a Linux sandbox; check `uname` before reaching for
FlowDeck/Xcode and fall back to typecheck/lint/vitest when not on macOS.

## Xcode 27 beta workarounds (verified working 2026-06-11)

Three fixes were needed to build/run under Xcode 27.0 beta (27A5194q):

1. **expo-modules-jsi Swift error** — Swift 6.3 rejects forming a C function
   pointer from a ternary. Fixed via `patches/expo-modules-jsi+56.0.9.patch`
   (applied automatically by `patch-package` on postinstall). Drop the patch
   once upstream fixes it (check newer expo-modules-jsi releases).
2. **Pod deployment targets < 15.0 rejected** — `ios/Podfile` post_install
   has a clamp raising `IPHONEOS_DEPLOYMENT_TARGET` to 15.1. `ios/` is
   gitignored: after `expo prebuild --clean`, re-add the clamp loop to
   post_install before `pod install`.
3. **UIScene life cycle is mandatory (TN3187)** — apps built with the iOS 27
   SDK crash at launch without a scene manifest. `ios/VibeXStudio/
   AppDelegate.swift` got a `SceneDelegate` class (starts React Native in
   `scene(_:willConnectTo:)`, forwards deep links) and `Info.plist` got
   `UIApplicationSceneManifest` pointing at
   `$(PRODUCT_MODULE_NAME).SceneDelegate`. Also lost on `prebuild --clean` —
   re-apply both. Upstream tracking: expo/expo#46664.

Machine-level (this Mac, not the repo): `xcode-select` points at
`~/.flowdeck/Xcode27Shim.app/Contents/Developer` — a symlink shim that
restores `Developer/Library/PrivateFrameworks/{SimulatorKit,CoreSimulator}.framework`
(moved to `Contents/SharedFrameworks` in Xcode 27), which FlowDeck's
FBSimulatorControl needs. Also: FlowDeck HID typing doesn't reach the iOS 27
simulator — `flowdeck ui simulator type` reports success but no text lands.
Workaround: `flowdeck simulator pasteboard set "text"`, long-press the field
(`tap --point x,y --duration 1.2`), tap "Paste".

## Placeholders to resolve before release

- store URLs in `src/lib/github/sharePage.ts` (APP_STORE_URL still a dummy id;
  GET_APP_URL + the kerpopule.github.io/vibex landing page are live)
