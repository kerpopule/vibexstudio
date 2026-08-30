/**
 * The on-device Media Lab studio engine (zustand). Generation runs here —
 * not in a component — mirroring chat-engine's rule: jobs keep running across
 * tab switches, share the same FIFO turn slots as chat builds, and land in
 * the persistent gallery (src/lib/storage/media-gallery).
 */
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { create } from 'zustand';

import { canGenerateImages, canGenerateVideo, generateImage, generateVideo } from '@/lib/ai/media';
import { acquireTurnSlot, releaseTurnSlot } from '@/lib/concurrency';
import { notifyEvent, primeNotifications } from '@/lib/notifications';
import { deleteGalleryItem, listGallery, saveGalleryImage, saveGalleryVideo } from '@/lib/storage/media-gallery';
import { newId } from '@/lib/storage/projects';
import * as secrets from '@/lib/storage/secrets';
import { useApp } from '@/lib/store';
import type { GalleryItem, ProviderConnection } from '@/lib/types';

export interface StudioJob {
  id: string;
  kind: 'image' | 'video';
  prompt: string;
  providerId: string;
  providerLabel: string;
  status: 'queued' | 'running' | 'error';
  /** Streaming progress detail shown in the pending cell. */
  detail: string;
  error?: string;
}

interface MediaStudio {
  hydrated: boolean;
  items: GalleryItem[];
  jobs: StudioJob[];
  hydrate: () => Promise<void>;
  generate: (kind: 'image' | 'video', prompt: string, provider: ProviderConnection) => Promise<void>;
  retryJob: (jobId: string) => void;
  dismissJob: (jobId: string) => void;
  removeItem: (itemId: string) => Promise<void>;
}

const KEEP_AWAKE_TAG = 'vibex-media-studio';
let awakeJobs = 0;

export const useMediaStudio = create<MediaStudio>((set, get) => {
  const patchJob = (jobId: string, partial: Partial<StudioJob>) =>
    set((s) => ({ jobs: s.jobs.map((j) => (j.id === jobId ? { ...j, ...partial } : j)) }));

  const run = async (job: StudioJob, provider: ProviderConnection) => {
    // Top up subscription OAuth tokens (e.g. Grok) before spending them.
    if (provider.subscription) {
      await useApp
        .getState()
        .refreshSubscriptionIfNeeded(provider.id)
        .catch(() => {});
    }
    const secret = await secrets.getProviderSecret(provider.id);
    if (!secret) {
      patchJob(job.id, {
        status: 'error',
        error: `The key for ${provider.label} is missing from the keychain. Remove and re-add it in Settings.`,
      });
      return;
    }
    // Ask for notification permission while the user is engaged so the
    // "done" notice can fire if they background the app mid-render.
    primeNotifications().catch(() => {});
    try {
      await acquireTurnSlot({
        onQueued: () => patchJob(job.id, { detail: 'Waiting for a free build slot…' }),
      });
    } catch {
      set((s) => ({ jobs: s.jobs.filter((j) => j.id !== job.id) }));
      return;
    }
    patchJob(job.id, {
      status: 'running',
      detail: job.kind === 'image' ? 'Generating image…' : 'Starting video generation…',
    });
    if (awakeJobs++ === 0) activateKeepAwakeAsync(KEEP_AWAKE_TAG).catch(() => {});
    let ok = false;
    try {
      let item: GalleryItem;
      if (job.kind === 'image') {
        const image = await generateImage(provider, secret, job.prompt);
        item = await saveGalleryImage(job.prompt, provider.label, image.base64, image.mimeType);
      } else {
        const video = await generateVideo(provider, secret, job.prompt, (detail) =>
          patchJob(job.id, { detail })
        );
        patchJob(job.id, { detail: 'Saving video…' });
        item = await saveGalleryVideo(job.prompt, provider.label, video.url, video.mimeType);
      }
      set((s) => ({
        jobs: s.jobs.filter((j) => j.id !== job.id),
        items: [item, ...s.items],
      }));
      ok = true;
    } catch (e) {
      patchJob(job.id, {
        status: 'error',
        error: e instanceof Error ? e.message : `Could not generate the ${job.kind}.`,
      });
    } finally {
      if (--awakeJobs === 0) deactivateKeepAwake(KEEP_AWAKE_TAG).catch(() => {});
      releaseTurnSlot();
    }
    notifyEvent(
      ok ? '🎬 Media Lab' : '🎬 Media Lab hit a snag',
      ok
        ? `Your ${job.kind} is ready in the gallery.`
        : `The ${job.kind} failed — open the app to retry.`
    ).catch(() => {});
  };

  return {
    hydrated: false,
    items: [],
    jobs: [],

    hydrate: async () => {
      if (get().hydrated) return;
      try {
        set({ items: await listGallery(), hydrated: true });
      } catch {
        set({ hydrated: true });
      }
    },

    generate: async (kind, prompt, provider) => {
      const usable = kind === 'image' ? canGenerateImages(provider) : canGenerateVideo(provider);
      if (!usable || !prompt.trim()) return;
      const job: StudioJob = {
        id: newId(),
        kind,
        prompt: prompt.trim(),
        providerId: provider.id,
        providerLabel: provider.label,
        status: 'queued',
        detail: 'Starting…',
      };
      set((s) => ({ jobs: [job, ...s.jobs] }));
      await run(job, provider);
    },

    retryJob: (jobId) => {
      const job = get().jobs.find((j) => j.id === jobId);
      if (!job || job.status !== 'error') return;
      const provider = useApp.getState().providers.find((p) => p.id === job.providerId);
      if (!provider) {
        patchJob(jobId, { error: 'That provider was removed. Dismiss and pick another.' });
        return;
      }
      patchJob(jobId, { status: 'queued', detail: 'Starting…', error: undefined });
      run({ ...job, status: 'queued', error: undefined }, provider).catch(() => {});
    },

    dismissJob: (jobId) => {
      set((s) => ({ jobs: s.jobs.filter((j) => j.id !== jobId) }));
    },

    removeItem: async (itemId) => {
      await deleteGalleryItem(itemId).catch(() => {});
      set((s) => ({ items: s.items.filter((i) => i.id !== itemId) }));
    },
  };
});
