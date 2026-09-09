import {getFalRequest,forgetFalRequest} from '@/lib/ai/fal-recovery';
import { retryRequest } from '@/lib/retry-request';
/**
 * Per-project chat sessions as a global store. Generation runs here — not in
 * a component — so an in-flight vibe turn keeps streaming no matter which
 * pane is showing or whether the user backs out to the project list. The
 * `filesVersion` counter is the live-preview heartbeat: it bumps every time
 * the model writes files, and the preview WebView reloads off it.
 */
import * as Haptics from 'expo-haptics';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { AppState } from 'react-native';
import { create } from 'zustand';

import { generateImage, generateVideo } from '@/lib/ai/media';
import { acquireTurnSlot, releaseTurnSlot } from '@/lib/concurrency';
import { notifyProjectEvent, primeNotifications } from '@/lib/notifications';
import { newId, readChat, writeBinaryFile, writeChat } from '@/lib/storage/projects';
import { importProjectAsset, writeImportedAsset } from '@/lib/storage/import-asset';
import * as secrets from '@/lib/storage/secrets';
import { useApp } from '@/lib/store';
import type { ChatMessage, ProjectMeta, ProviderConnection } from '@/lib/types';
import { runVibeTurn } from '@/lib/vibe';

export interface ChatSession {
  messages: ChatMessage[];
  busy: boolean;
  /** Raw streaming tail while a turn is running (feeds the stream wheel). */
  streamText: string | null;
  /** Bumped whenever generation writes project files. */
  filesVersion: number;
  /** Bumped the first time a turn produces a renderable index.html — the
      project screen watches this to auto-jump to the Preview pane. */
  previewReadySignal: number;
  loaded: boolean;
}

export const EMPTY_SESSION: ChatSession = {
  messages: [],
  busy: false,
  streamText: null,
  filesVersion: 0,
  previewReadySignal: 0,
  loaded: false,
};

interface ChatEngine {
  sessions: Record<string, ChatSession>;
  /** Hydrate a session's messages from disk (no-op once loaded). */
  load: (projectId: string) => Promise<void>;
  /** Force-refresh messages after an out-of-chat write such as attaching a design. */
  reload: (projectId: string) => Promise<void>;
  sendChat: (project: ProjectMeta, text: string, connection: ProviderConnection | null) => Promise<void>;
  sendMedia: (
    project: ProjectMeta,
    prompt: string,
    kind: 'image' | 'video',
    provider: ProviderConnection | null,
    retryMessageId?: string
  ) => Promise<void>;
  /** Copy a user-picked local file into the project's assets/ folder. */
  attachFile: (project: ProjectMeta, srcUri: string | Uint8Array, fileName: string, kind?: 'image' | 'video' | 'audio') => Promise<string>;
  /** Signal that project files changed outside a chat turn (manual edits). */
  bumpFiles: (projectId: string) => void;
  abort: (projectId: string) => void;
}

/** In-flight controllers stay out of state — they're not renderable. */
const aborters = new Map<string, AbortController>();
const KEEP_AWAKE_TAG = 'vibex-generation';

const mediaRequestsInFlight=new Set<string>();

export const useChat = create<ChatEngine>((set, get) => {
  const patch = (id: string, partial: Partial<ChatSession>) =>
    set((s) => ({ sessions: { ...s.sessions, [id]: { ...(s.sessions[id] ?? EMPTY_SESSION), ...partial } } }));

  const appendPersisted = async (projectId: string, extra: ChatMessage[]) => {
    const next = [...(await readChat(projectId)), ...extra];
    await writeChat(projectId, next);
    patch(projectId, { messages: next });
  };

  return {
    sessions: {},

    load: async (projectId) => {
      if (get().sessions[projectId]?.loaded) return;
      const messages = await readChat(projectId);
      patch(projectId, { messages, loaded: true });
    },

    reload: async (projectId) => {
      const messages = await readChat(projectId);
      patch(projectId, { messages, loaded: true });
    },

    abort: (projectId) => {
      aborters.get(projectId)?.abort();
    },

    bumpFiles: (projectId) => {
      patch(projectId, { filesVersion: (get().sessions[projectId]?.filesVersion ?? 0) + 1 });
    },

    sendChat: async (project, text, connection) => {
      const id = project.id;
      if (get().sessions[id]?.busy) return;
      if (!connection) {
        await appendPersisted(id, [
          { id: newId(), role: 'user', text, request: { mode: 'chat', prompt: text }, createdAt: Date.now() },
          {
            id: newId(),
            role: 'assistant',
            text: 'No AI connected yet — tap below to pick one. OpenRouter takes about 20 seconds with OAuth, then we can build this. ⚡',
            createdAt: Date.now(),
            error: 'no-provider',
          },
        ]);
        return;
      }
      const secret = await secrets.getProviderSecret(connection.id);
      if (!secret) {
        await appendPersisted(id, [
          { id: newId(), role: 'user', text, request: { mode: 'chat', prompt: text }, createdAt: Date.now() },
          {
            id: newId(),
            role: 'assistant',
            text: `The key for ${connection.label} is missing from this device’s saved connection. Remove and re-add it in Settings.`,
            createdAt: Date.now(),
            error: 'no-secret',
          },
        ]);
        return;
      }

      const controller = new AbortController();
      aborters.set(id, controller);
      patch(id, { busy: true, streamText: null });
      // Ask for notification permission while the user is engaged, so
      // background completion alerts can fire later. Fire-and-forget.
      primeNotifications().catch(() => {});
      // Respect the hardware turn ceiling: any number of projects can be
      // started, but only N stream at once — the rest wait here FIFO.
      try {
        await acquireTurnSlot({
          signal: controller.signal,
          onQueued: () => patch(id, { streamText: 'Waiting for a free build slot…' }),
        });
      } catch {
        // Aborted while queued — record the stop like a mid-turn abort would.
        aborters.delete(id);
        patch(id, { busy: false, streamText: null });
        await appendPersisted(id, [
          { id: newId(), role: 'user', text, request: { mode: 'chat', prompt: text }, createdAt: Date.now() },
          { id: newId(), role: 'assistant', text: 'Stopped.', createdAt: Date.now(), error: 'aborted' },
        ]);
        return;
      }
      patch(id, { streamText: null });
      // Hold the screen awake while generating so the OS doesn't suspend the
      // app (and kill the stream) when the user sets the phone down.
      activateKeepAwakeAsync(KEEP_AWAKE_TAG).catch(() => {});
      let wroteFiles = false;
      let revealed = false;
      try {
        await runVibeTurn({
          project,
          userText: text,
          connection,
          secret,
          model: project.ai?.model ?? connection.defaultModel,
          signal: controller.signal,
          callbacks: {
            onStream: (partial) => patch(id, { streamText: partial.slice(-2000) }),
            onMessages: (messages) => patch(id, { messages }),
            onFilesChanged: (paths) => {
              wroteFiles = true;
              const cur = get().sessions[id] ?? EMPTY_SESSION;
              const next: Partial<ChatSession> = { filesVersion: cur.filesVersion + 1 };
              // First renderable output of this turn → tell the UI to reveal it.
              if (paths.some((p) => p === 'index.html')) {
                next.previewReadySignal = cur.previewReadySignal + 1;
                revealed = true;
              }
              patch(id, next);
            },
          },
        });
        if (wroteFiles) {
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          // Edits that didn't touch index.html (css/js/assets only) still need
          // to land on the refreshed preview. If index.html was written this
          // turn the mid-stream bump already revealed it — don't double-fire.
          if (!revealed) {
            const cur = get().sessions[id] ?? EMPTY_SESSION;
            patch(id, { previewReadySignal: cur.previewReadySignal + 1 });
          }
        }
      } finally {
        aborters.delete(id);
        patch(id, { busy: false, streamText: null });
        releaseTurnSlot();
        deactivateKeepAwake(KEEP_AWAKE_TAG).catch(() => {});
      }
      // Surface the outcome when the user isn't looking (backgrounded, or
      // deep in another project). runVibeTurn never throws — the result is
      // the final assistant message.
      const finalMessages = get().sessions[id]?.messages ?? [];
      const outcome = finalMessages[finalMessages.length - 1];
      if (outcome?.role === 'assistant' && outcome.error !== 'aborted') {
        // Network deaths auto-resume on foreground, so tell the user to come
        // back rather than calling it a failure.
        const event = outcome.error
          ? outcome.error.startsWith('Network error')
            ? 'paused'
            : 'error'
          : wroteFiles
            ? 'done'
            : 'reply';
        notifyProjectEvent(project, event).catch(() => {});
      }
    },

    sendMedia: async (project, prompt, kind, provider, retryMessageId) => {
      const id = project.id;
      if (get().sessions[id]?.busy || mediaRequestsInFlight.has(id)) return;
      mediaRequestsInFlight.add(id);
      try {
      const recovered=retryMessageId?await getFalRequest(retryMessageId):null;
      if(recovered){
        if(recovered.projectId!==id||recovered.prompt!==prompt||recovered.kind!==kind)throw new Error('This saved generation belongs to another request or project.');
        const original=useApp.getState().providers.find(row=>row.id===recovered.providerId&&row.kind==='fal');
        if(!original)throw new Error('Reconnect the original fal.ai provider to resume this job.');
        provider={...original,mediaModels:{...original.mediaModels,[kind]:recovered.model}};
        if((await readChat(id)).some(message=>message.id===`fal-result-${recovered.id}`)){
          await forgetFalRequest(recovered.id);return;
        }
      }
      const label = kind === 'image' ? 'image' : 'video';
      const userMessage: ChatMessage = {
        id: recovered?.id ?? newId(),
        role: 'user',
        text: `Generate ${label}: ${prompt}`,
        request: { mode: kind, prompt },
        createdAt: Date.now(),
      };
      if (!provider) {
        await appendPersisted(id, [
          ...(!recovered?[userMessage]:[]),
          {
            id: newId(),
            role: 'assistant',
            text:
              kind === 'image'
                ? 'No image-capable provider connected. Add Gemini, OpenAI, or Grok in Settings.'
                : 'Video generation needs a Google Gemini connection (Veo). Add one in Settings.',
            createdAt: Date.now(),
            error: 'no-provider',
          },
        ]);
        return;
      }
      const secret = await secrets.getProviderSecret(provider.id);
      if (!secret) {
        await appendPersisted(id, [
          ...(!recovered?[userMessage]:[]),
          {
            id: newId(),
            role: 'assistant',
            text: `The saved connection for ${provider.label} is missing its key. Reconnect it in Settings, then retry this request.`,
            createdAt: Date.now(),
            error: 'no-secret',
          },
        ]);
        return;
      }
      if(!recovered)await appendPersisted(id, [userMessage]);
      patch(id, { busy: true, streamText: kind === 'image' ? 'Generating image…' : 'Generating video…' });
      primeNotifications().catch(() => {});
      try {
        await acquireTurnSlot({
          onQueued: () => patch(id, { streamText: 'Waiting for a free build slot…' }),
        });
      } catch {
        patch(id, { busy: false, streamText: null });
        return;
      }
      patch(id, { streamText: kind === 'image' ? 'Generating image…' : 'Generating video…' });
      let mediaOk = false;
      try {
        if (kind === 'image') {
          const image = provider.kind==='fal'?await generateImage(provider, secret, prompt,userMessage.id,id):await generateImage(provider, secret, prompt);
          const ext = image.mimeType.includes('jpeg') ? 'jpg' : 'png';
          const path = `assets/img-${newId()}.${ext}`;
          const uri = await writeBinaryFile(id, path, image.base64);
          await appendPersisted(id, [
            {
              id: provider.kind==='fal'?`fal-result-${userMessage.id}`:newId(),
              role: 'assistant',
              text: `Image saved to ${path} — ask me to use it in the app!`,
              createdAt: Date.now(),
              attachments: [{ kind: 'image', uri, prompt }],
            },
          ]);
        } else {
          const progress=(detail:string)=>patch(id,{streamText:detail});
          const video = provider.kind==='fal'?await generateVideo(provider,secret,prompt,progress,userMessage.id,id):await generateVideo(provider,secret,prompt,progress);
          const path = `assets/vid-${newId()}.mp4`;
          const uri = await importProjectAsset(id, path, video.url);
          await appendPersisted(id, [
            {
              id: provider.kind==='fal'?`fal-result-${userMessage.id}`:newId(),
              role: 'assistant',
              text: `Video saved to ${path} — ask me to use it in the app!`,
              createdAt: Date.now(),
              attachments: [{ kind: 'video', uri, prompt }],
            },
          ]);
        }
        patch(id, { filesVersion: (get().sessions[id]?.filesVersion ?? 0) + 1 });
        if(provider.kind==='fal')await forgetFalRequest(userMessage.id);
        mediaOk = true;
      } catch (e) {
        await appendPersisted(id, [
          {
            id: newId(),
            role: 'assistant',
            text: e instanceof Error ? e.message : `Could not generate the ${label}.`,
            createdAt: Date.now(),
            error: 'media-failed',
          },
        ]);
      } finally {
        patch(id, { busy: false, streamText: null });
        releaseTurnSlot();
      }
      notifyProjectEvent(project, mediaOk ? 'done' : 'error').catch(() => {});
      } finally {mediaRequestsInFlight.delete(id);}
    },

    attachFile: async (project, srcUri, fileName, kind) => {
      const id = project.id;
      const safe = fileName.replace(/[^\w.\-]+/g, '-').replace(/^-+|-+$/g, '') || `file-${Date.now()}`;
      const path = `assets/${newId()}-${safe}`;
      const uri = typeof srcUri === 'string' ? await importProjectAsset(id, path, srcUri) : await writeImportedAsset(id, path, srcUri);
      await appendPersisted(id, [
        {
          id: newId(),
          role: 'user',
          text: `Added ${path} to the project — you can reference it from the app.`,
          createdAt: Date.now(),
          attachments: kind ? [{ kind, uri }] : undefined,
        },
      ]);
      patch(id, { filesVersion: (get().sessions[id]?.filesVersion ?? 0) + 1 });
      return path;
    },
  };
});

/**
 * App-wide resume: iOS/Android eventually cut a stream when the app sits in
 * the background. When we return to the foreground, every project whose last
 * turn died with a network interruption (not a user "Stop") is re-sent —
 * regardless of which screen is open — so builds "continue" from the user's
 * point of view. Each failed message is resumed at most once.
 */
const resumedFailures = new Set<string>();

AppState.addEventListener('change', (state) => {
  if (state !== 'active') return;
  const { sessions } = useChat.getState();
  const { projects, providers, refreshSubscriptionIfNeeded } = useApp.getState();
  const chatProviders = providers.filter((p) => p.capabilities.chat);
  for (const project of projects) {
    const s = sessions[project.id];
    if (!s?.loaded || s.busy) continue;
    const last = s.messages[s.messages.length - 1];
    if (!last || last.role !== 'assistant' || !last.error?.startsWith('Network error')) continue;
    if (resumedFailures.has(last.id)) continue;
    const lastUser = [...s.messages].reverse().find((m) => m.role === 'user');
    if (!lastUser) continue;
    resumedFailures.add(last.id);
    const connection =
      chatProviders.find((p) => p.id === project.ai?.connectionId) ?? chatProviders[0] ?? null;
    const request = retryRequest(lastUser);
    // Media requests can already be running remotely; retry them explicitly.
    if (request.mode !== 'chat') continue;
    const text = request.prompt;
    void (async () => {
      if (connection?.subscription) await refreshSubscriptionIfNeeded(connection.id).catch(() => {});
      await useChat.getState().sendChat(project, text, connection);
    })();
  }
});
