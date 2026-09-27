/**
 * Browser tab titles for the web build. Pure so it can be unit-tested; the
 * root layout feeds it `usePathname()` and renders the result through
 * expo-router's <Head>, which also fills the static export's <title>.
 *
 * Names mirror the screen titles in `src/app/_layout.tsx` and the tab
 * titles in `src/app/(tabs)/_layout.tsx`.
 */

export const APP_TITLE = 'VibeX Studio';

const ROUTE_TITLES: Record<string, string> = {
  '': 'Build',
  index: 'Build',
  'media-lab': 'Create',
  creations: 'Library',
  settings: 'Setup',
  onboarding: 'Welcome',
  'studio-tour': 'Tour',
  library: 'Library',
  'new-project': 'New project',
  'connect-github': 'Connect GitHub',
  song: 'Make a song',
  'replace-provider-key': 'Replace API key',
  'third-party-notices': 'Third-party notices',
  'transfer-ai': 'Move AI connections',
  'connect-provider': 'Connect AI',
  'connect-subscription': 'Connect subscription',
  'connect-private': 'Your AI connection',
  'edit-model': 'Choose model',
  'connect-media-lab': 'Media Lab',
  pair: 'Pair',
  'pair-scan': 'Pair a computer',
  'media-lab-setup': 'Set up Media Lab',
  'fal-setup': 'Cloud rendering',
  storage: 'Your storage',
  'agent-connect': 'Connect an agent',
  import: 'Open shared app',
  project: 'Project',
  editor: 'Editor',
  'editor-new': 'New edit',
  'editor-timeline': 'Timeline',
  'storyboard-edit': 'Storyboard',
};

/** "Setup · VibeX Studio" for a known route, "Page not found · …" otherwise. */
export function pageTitle(pathname: string | null | undefined): string {
  const path = (pathname ?? '/').split(/[?#]/)[0];
  // Drop route groups like "(tabs)" and empty segments.
  const segments = path.split('/').filter((s) => s && !/^\(.*\)$/.test(s));
  const first = segments[0] ?? '';
  const name = ROUTE_TITLES[first];
  if (first === '' || first === 'index') return `Build · ${APP_TITLE}`;
  return `${name ?? 'Page not found'} · ${APP_TITLE}`;
}
