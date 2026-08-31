/**
 * Curated fal.ai model catalog. Nobody should have to know model ids: each
 * entry pairs the id with a friendly name and a plain-words blurb, and the
 * `recommended` ones sort first and come pre-selected everywhere (the fal
 * walkthrough's pickers and the on-device studio's engine default).
 *
 * This is data, not code — keeping it current is an edit here, not a rework.
 */

export interface FalCatalogEntry {
  /** fal model id, e.g. "fal-ai/flux/dev" — also the queue.fal.run path. */
  id: string;
  /** Friendly name shown in pickers. */
  name: string;
  /** What it's for, in plain words. */
  blurb: string;
  kind: 'image' | 'video';
  recommended: boolean;
}

export const FAL_CATALOG: FalCatalogEntry[] = [
  {
    id: 'fal-ai/flux/dev',
    name: 'Flux Dev',
    blurb: 'Great all-round images',
    kind: 'image',
    recommended: true,
  },
  {
    id: 'fal-ai/flux-pro/v1.1',
    name: 'Flux Pro 1.1',
    blurb: 'Extra-sharp images for finals',
    kind: 'image',
    recommended: false,
  },
  {
    id: 'fal-ai/flux/schnell',
    name: 'Flux Schnell',
    blurb: 'Fastest drafts, pennies each',
    kind: 'image',
    recommended: false,
  },
  {
    id: 'fal-ai/veo3/fast',
    name: 'Veo 3 Fast',
    blurb: 'Fast video',
    kind: 'video',
    recommended: true,
  },
  {
    id: 'fal-ai/kling-video/v2.1/standard/text-to-video',
    name: 'Kling 2.1',
    blurb: 'Smooth, cinematic clips',
    kind: 'video',
    recommended: false,
  },
  {
    id: 'fal-ai/minimax/hailuo-02/standard/text-to-video',
    name: 'Hailuo 02',
    blurb: 'Expressive motion and characters',
    kind: 'video',
    recommended: false,
  },
];

/** Entries of one kind, recommended first, original order otherwise (stable). */
export function catalogFor(kind: 'image' | 'video'): FalCatalogEntry[] {
  const matching = FAL_CATALOG.filter((entry) => entry.kind === kind);
  return [...matching.filter((e) => e.recommended), ...matching.filter((e) => !e.recommended)];
}

/** The pre-selected model id for a kind (first recommended, else first). */
export function recommendedFalModel(kind: 'image' | 'video'): string {
  const sorted = catalogFor(kind);
  return sorted[0]?.id ?? '';
}

/** Friendly name for a model id; falls back to the id's last segment-ish. */
export function falModelName(id: string): string {
  const entry = FAL_CATALOG.find((e) => e.id === id);
  if (entry) return entry.name;
  return id.replace(/^fal-ai\//, '');
}
