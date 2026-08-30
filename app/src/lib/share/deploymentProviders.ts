export interface DeploymentProvider {
  id: 'vercel' | 'netlify' | 'railway' | 'digitalocean';
  name: string;
  emoji: string;
  url: string;
  requiresSignIn: true;
}

/**
 * User-owned deployment handoffs. VibeXStudio copies the GitHub repo URL and
 * opens the provider's official import surface. It never stores provider
 * credentials or deploys through a VibeX backend.
 */
export const DEPLOYMENT_PROVIDERS: readonly DeploymentProvider[] = [
  { id: 'vercel', name: 'Vercel', emoji: '▲', url: 'https://vercel.com/new', requiresSignIn: true },
  { id: 'netlify', name: 'Netlify', emoji: '◆', url: 'https://app.netlify.com/start', requiresSignIn: true },
  { id: 'railway', name: 'Railway', emoji: '🚂', url: 'https://railway.com/new', requiresSignIn: true },
  {
    id: 'digitalocean',
    name: 'DigitalOcean',
    emoji: '🌊',
    url: 'https://cloud.digitalocean.com/apps/new',
    requiresSignIn: true,
  },
];
