// Setup opens these routes before the user has finished onboarding. Keep the
// wizard mounted underneath them so returning preserves the current step.
const SETUP_ROUTES = new Set([
  'onboarding',
  'pair',
  'pair-scan',
  'connect-media-lab',
  'connect-provider',
  'transfer-ai',
  'connect-subscription',
  'connect-private',
  'connect-github',
  'fal-setup',
]);

export function needsOnboardingRedirect(hydrated: boolean, complete: boolean, route?: string): boolean {
  return hydrated && !complete && !SETUP_ROUTES.has(route ?? '');
}
