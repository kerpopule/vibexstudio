/**
 * The on-device Media Lab studio engine (zustand). Generation runs here —
 * not in a component — mirroring chat-engine's rule: jobs keep running across
 * tab switches, share the same FIFO turn slots as chat builds, and land in
 * the persistent gallery (src/lib/storage/media-gallery).
 */
import {listFalRequests,forgetFalRequest,getFalRequest,type FalRecovery} from '@/lib/ai/fal-recovery';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { create } from 'zustand';

import { canGenerateImages, canGenerateVideo, generateImage, generateVideo } from '@/lib/ai/media';
import { acquireTurnSlot, releaseTurnSlot } from '@/lib/concurrency';
import { clearCompletedCreationDraft } from '@/lib/creation-draft';
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
  retryAction?: 'save'|'resume'|'review';
  falRecovery?: true;
  falModel?: string;
}

export function hasActiveCreation(jobs:StudioJob[],kind:'image'|'video',prompt:string,providerId:string){
  return jobs.some(job=>job.kind===kind&&job.prompt===prompt.trim()&&job.providerId===providerId&&job.status!=='error');
}

interface MediaStudio {
  hydrated: boolean;
  items: GalleryItem[];
  jobs: StudioJob[];
  hydrate: () => Promise<void>;
  generate: (kind: 'image' | 'video', prompt: string, provider: ProviderConnection, draftProviderId?: string | null) => Promise<boolean>;
  retryJob: (jobId: string) => void;
  dismissJob: (jobId: string) => void;
  removeItem: (itemId: string) => Promise<void>;
}

const KEEP_AWAKE_TAG = 'vibex-media-studio';
let awakeJobs = 0;

export const useMediaStudio = create<MediaStudio>((set, get) => {
  let hydration: Promise<void> | null = null;
  const preparing = new Set<string>();
  const submittedDrafts = new Map<string, {prompt: string; providerId: string | null}>();
  const pendingSaves = new Map<string, () => Promise<GalleryItem>>();
  const patchJob = (jobId: string, partial: Partial<StudioJob>) =>
    set((s) => ({ jobs: s.jobs.map((j) => (j.id === jobId ? { ...j, ...partial } : j)) }));

  const finishSave = async (job:StudioJob) => {
    const save = pendingSaves.get(job.id);
    if (!save) return false;
    patchJob(job.id,{status:'running',detail:`Saving ${job.kind}…`,error:undefined});
    try {
      const item = await save();
      // If clearing tracking fails, retry this already-saved item rather than
      // downloading or saving another copy within this running app.
      pendingSaves.set(job.id,async()=>item);
      if(job.falRecovery)await forgetFalRequest(job.id);
      pendingSaves.delete(job.id);
      set(state=>({jobs:state.jobs.filter(row=>row.id!==job.id),items:[item,...state.items]}));
      const draft = submittedDrafts.get(job.id);
      submittedDrafts.delete(job.id);
      if (draft) clearCompletedCreationDraft(job.kind, draft.prompt, draft.providerId);
      notifyEvent('🎬 Media Lab', `Your ${job.kind} is ready in Library.`).catch(() => {});
      return true;
    } catch {
      patchJob(job.id,{status:'error',retryAction:'save',detail:'',error:'Your creation finished, but could not be saved. Retry saves this result without generating again. Keep the app open until it is saved.'});
      notifyEvent('🎬 Media Lab needs a save', `Your ${job.kind} finished, but could not be saved. Open the app and choose Retry save.`).catch(() => {});
      return false;
    }
  };

  const run = async (job: StudioJob, provider: ProviderConnection) => {
    if(job.falModel)provider={...provider,mediaModels:{...provider.mediaModels,[job.kind]:job.falModel}};
    // Top up subscription OAuth tokens (e.g. Grok) before spending them.
    if (provider.subscription) {
      await useApp
        .getState()
        .refreshSubscriptionIfNeeded(provider.id)
        .catch(() => {});
    }
    let secret: string | null;
    try {
      secret = await secrets.getProviderSecret(provider.id);
    } catch {
      patchJob(job.id, {
        status: 'error',
        detail: '',
        error: 'Could not read your provider key. Unlock your device and try again. Your prompt is saved in this job.',
      });
      return false;
    }
    if (!secret) {
      patchJob(job.id, {
        status: 'error',
        error: `The key for ${provider.label} is missing from this device’s saved connection. Remove and re-add it in Settings.`,
      });
      return false;
    }
    // Ask for notification permission while the user is engaged so the
    // "done" notice can fire if they background the app mid-render.
    primeNotifications().catch(() => {});
    try {
      await acquireTurnSlot({
        onQueued: () => patchJob(job.id, { detail: 'Waiting for a free build slot…' }),
      });
    } catch {
      patchJob(job.id, {
        status: 'error',
        detail: '',
        error: 'Could not start this creation. Your prompt is saved in this job. Try again.',
      });
      return false;
    }
    patchJob(job.id, {
      status: 'running',
      detail: job.kind === 'image' ? 'Generating image…' : 'Starting video generation…',
    });
    if (awakeJobs++ === 0) activateKeepAwakeAsync(KEEP_AWAKE_TAG).catch(() => {});
    let ok = false;
    try {
      if (job.kind === 'image') {
        const image = provider.kind==='fal' ? await generateImage(provider, secret, job.prompt,job.id) : await generateImage(provider, secret, job.prompt);
        pendingSaves.set(job.id,()=>job.falRecovery ? saveGalleryImage(job.prompt, provider.label, image.base64, image.mimeType,job.id) : saveGalleryImage(job.prompt, provider.label, image.base64, image.mimeType));
      } else {
        const progress = (detail:string) => patchJob(job.id, { detail });
        const video = provider.kind==='fal' ? await generateVideo(provider, secret, job.prompt, progress,job.id) : await generateVideo(provider, secret, job.prompt, progress);
        pendingSaves.set(job.id,()=>job.falRecovery ? saveGalleryVideo(job.prompt, provider.label, video.url, video.mimeType,job.id) : saveGalleryVideo(job.prompt, provider.label, video.url, video.mimeType));
      }
      ok = await finishSave(job);
    } catch (e) {
      let retryAction:StudioJob['retryAction'];
      if(job.falRecovery){
        try{const tracked=await getFalRequest(job.id);retryAction=tracked?.phase==='accepted'?'resume':tracked?.phase==='submitting'?'review':undefined;}
        catch{retryAction='review';}
      }
      patchJob(job.id, {
        retryAction,
        status: 'error',
        error: e instanceof Error ? e.message : `Could not generate the ${job.kind}.`,
      });
      notifyEvent('🎬 Media Lab hit a snag', `The ${job.kind} failed — open the app to retry.`).catch(() => {});
    } finally {
      if (--awakeJobs === 0) deactivateKeepAwake(KEEP_AWAKE_TAG).catch(() => {});
      releaseTurnSlot();
    }
    return ok;
  };

  return {
    hydrated: false,
    items: [],
    jobs: [],

    hydrate: async () => {
      if (get().hydrated) return;
      if (hydration) return hydration.catch(() => {});
      hydration = (async () => {
        try {
          const stored = await listGallery();
          const recovered = (await listFalRequests()).filter((row):row is FalRecovery & {kind:'image'|'video'}=>!row.projectId&&row.kind!=='audio');
          const landed = new Set(stored.map(item=>item.id));
          for(const row of recovered)if(landed.has(`fal-${row.id}`))await forgetFalRequest(row.id);
          // A generation can finish while storage is loading. Preserve those
          // new items and collapse IDs already included in the storage result.
          set((state) => ({
            items: [...new Map([...stored, ...state.items].map((item) => [item.id, item])).values()]
              .sort((a, b) => b.createdAt - a.createdAt),
            jobs: [...state.jobs,...recovered.filter(row=>!landed.has(`fal-${row.id}`)&&!state.jobs.some(job=>job.id===row.id)).map(row=>({
              id:row.id,kind:row.kind,prompt:row.prompt,providerId:row.providerId,providerLabel:row.providerLabel,
              falRecovery:true as const,falModel:row.model,status:'error' as const,retryAction:row.phase==='accepted'?'resume' as const:'review' as const,detail:'',error:row.phase==='accepted'?'A saved fal.ai generation is ready to check. Resume job checks this request without submitting again.':'The previous submission may have been accepted. Check your fal.ai queue; retry will not submit it again.',
            }))],
            hydrated: true,
          }));
        } finally {
          hydration = null;
        }
      })();
      // A failed read remains retryable when Create is opened again.
      await hydration.catch(() => {});
    },

    generate: async (kind, prompt, provider, draftProviderId) => {
      const usable = kind === 'image' ? canGenerateImages(provider) : canGenerateVideo(provider);
      if (!usable || !prompt.trim() || hasActiveCreation(get().jobs,kind,prompt,provider.id)) return false;
      const reservation=JSON.stringify([kind,prompt.trim(),provider.id]);
      if(preparing.has(reservation))return false;
      preparing.add(reservation);
      try{
      if(provider.kind==='fal'){
        await get().hydrate();
        if(!get().hydrated)throw new Error('Saved creations could not be checked. Reopen Create and try again before starting a new generation.');
        if(get().jobs.some(row=>row.falRecovery&&row.kind===kind&&row.prompt===prompt.trim()&&row.providerId===provider.id))
          throw new Error('This creation already has a saved request below. Resume it or check your fal.ai queue before starting another.');
      }
      const job: StudioJob = {
        id: newId(),
        kind,
        prompt: prompt.trim(),
        providerId: provider.id,
        providerLabel: provider.label,
        status: 'queued',
        detail: 'Starting…',
        ...(provider.kind==='fal'?{falRecovery:true as const}:{}),
      };
      // Keep the exact editor snapshot through render/save retries. A newer
      // prompt or provider choice must survive completion of this request.
      if (draftProviderId !== undefined) submittedDrafts.set(job.id, {prompt, providerId: draftProviderId});
      set((s) => ({ jobs: [job, ...s.jobs] }));
      return await run(job, provider);
      }finally{preparing.delete(reservation);}
    },

    retryJob: (jobId) => {
      const job = get().jobs.find((j) => j.id === jobId);
      if (!job || job.status !== 'error' || job.retryAction==='review' || hasActiveCreation(get().jobs,job.kind,job.prompt,job.providerId)) return;
      if (pendingSaves.has(jobId)) {void finishSave(job);return;}
      const provider = useApp.getState().providers.find((p) => p.id === job.providerId);
      if (!provider) {
        patchJob(jobId, { error: 'That provider was removed. Dismiss and pick another.' });
        return;
      }
      patchJob(jobId, { status: 'queued', detail: 'Starting…', error: undefined });
      run({ ...job, status: 'queued', error: undefined }, provider).catch(() => {});
    },

    dismissJob: (jobId) => {
      // A confirmation may still be open after a retry started elsewhere.
      // Dismissal is not cancellation and must never drop an active save.
      if (get().jobs.find(job => job.id === jobId)?.status !== 'error') return;
      const remove=()=>{submittedDrafts.delete(jobId);pendingSaves.delete(jobId);set(s=>({jobs:s.jobs.filter(j=>j.id!==jobId)}));};
      if(get().jobs.find(job=>job.id===jobId)?.falRecovery){
        patchJob(jobId,{status:'running',detail:'Dismissing saved request…'});
        void forgetFalRequest(jobId).then(remove).catch(()=>patchJob(jobId,{status:'error',detail:'',error:'Could not dismiss the saved request. It is still tracked on this device.'}));
      }else remove();
    },

    removeItem: async (itemId) => {
      await deleteGalleryItem(itemId);
      set((s) => ({ items: s.items.filter((i) => i.id !== itemId) }));
    },
  };
});
