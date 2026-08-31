import { describe, expect, it } from 'vitest';

import {
  catalogFor,
  FAL_CATALOG,
  falModelName,
  recommendedFalModel,
} from '../src/lib/ai/fal-catalog';

describe('catalogFor', () => {
  it('returns only entries of the requested kind', () => {
    expect(catalogFor('image').every((e) => e.kind === 'image')).toBe(true);
    expect(catalogFor('video').every((e) => e.kind === 'video')).toBe(true);
  });

  it('sorts recommended entries first, keeping order stable within groups', () => {
    for (const kind of ['image', 'video'] as const) {
      const sorted = catalogFor(kind);
      const firstNonRecommended = sorted.findIndex((e) => !e.recommended);
      // No recommended entry appears after a non-recommended one.
      if (firstNonRecommended >= 0) {
        expect(sorted.slice(firstNonRecommended).every((e) => !e.recommended)).toBe(true);
      }
      // Stability: relative order matches the source catalog within each group.
      const source = FAL_CATALOG.filter((e) => e.kind === kind);
      expect(sorted.filter((e) => e.recommended)).toEqual(source.filter((e) => e.recommended));
      expect(sorted.filter((e) => !e.recommended)).toEqual(source.filter((e) => !e.recommended));
    }
  });

  it('loses no entries in the sort', () => {
    expect(catalogFor('image').length + catalogFor('video').length).toBe(FAL_CATALOG.length);
  });
});

describe('recommendedFalModel', () => {
  it('picks a recommended entry of the right kind', () => {
    for (const kind of ['image', 'video'] as const) {
      const id = recommendedFalModel(kind);
      const entry = FAL_CATALOG.find((e) => e.id === id);
      expect(entry?.kind).toBe(kind);
      expect(entry?.recommended).toBe(true);
    }
  });

  it('matches the spec defaults', () => {
    expect(recommendedFalModel('image')).toBe('fal-ai/flux/dev');
    expect(recommendedFalModel('video')).toBe('fal-ai/veo3/fast');
  });
});

describe('falModelName', () => {
  it('returns the friendly name for known models', () => {
    expect(falModelName('fal-ai/flux/dev')).toBe('Flux Dev');
    expect(falModelName('fal-ai/veo3/fast')).toBe('Veo 3 Fast');
  });

  it('falls back to a readable id for unknown models', () => {
    expect(falModelName('fal-ai/some/new-model')).toBe('some/new-model');
  });
});

describe('catalog data sanity', () => {
  it('has at least one recommended entry per kind and no duplicate ids', () => {
    expect(FAL_CATALOG.some((e) => e.kind === 'image' && e.recommended)).toBe(true);
    expect(FAL_CATALOG.some((e) => e.kind === 'video' && e.recommended)).toBe(true);
    expect(new Set(FAL_CATALOG.map((e) => e.id)).size).toBe(FAL_CATALOG.length);
  });
});
