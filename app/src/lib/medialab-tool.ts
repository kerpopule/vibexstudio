/**
 * Executes the media requests a vibe turn parsed out of ```medialab fences
 * (see docs/AGENT-MEDIA.md and src/lib/medialab-core.ts for the pure logic).
 *
 * With a paired Media Lab server: jobs are POSTed to its queue, remembered
 * in an AsyncStorage pending list, and a placeholder is written into the
 * project immediately (1-px PNG for images, a .pending.txt marker for
 * video). The queue watcher (src/lib/media-server-watch.ts) settles them
 * into real files when they finish. Without a server: images generate
 * on-device via the user's providers, bounded so a turn can't hang forever;
 * video gets an honest "can't do that here" line.
 *
 * Requests ride the iOS shared cookie store like every other Media Lab
 * fetch, and every failure degrades to a status line in chat — the server
 * being asleep is normal, not an error.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { File } from 'expo-file-system';

import { canGenerateImages, generateImage } from '@/lib/ai/media';
import {
  absoluteMediaUrl,
  addPendingJob,
  buildImageJobBody,
  buildVideoJobBody,
  matchFinishedJobs,
  PLACEHOLDER_PNG_BASE64,
  pendingMarkerContent,
  pendingMarkerPath,
  retryPendingJob,
  type HistoryJob,
  type MediaRequest,
  type PendingMediaJob,
} from '@/lib/medialab-core';
import type { MediaLabPromptContext } from '@/lib/ai/prompts';
import { filesRootUri, writeBinaryFile, writeFile } from '@/lib/storage/projects';
import * as secrets from '@/lib/storage/secrets';
import { useApp } from '@/lib/store';
import type { ProjectMeta, ProviderConnection } from '@/lib/types';

const PENDING_KEY = 'vibex.mediaLab.pendingProjectJobs';
const CHARACTER_TTL_MS = 5 * 60 * 1000;
const SUBMIT_TIMEOUT_MS = 20_000;
const ON_DEVICE_IMAGE_TIMEOUT_MS = 90_000;

// ---------------------------------------------------------------------------
// Character list → system prompt context (cached, 5-minute TTL)
// ---------------------------------------------------------------------------

let characterCache: { url: string; at: number; characters: { id: string; name: string }[] } | null =
  null;

/**
 * Null when no Media Lab is paired (prompt advertises images only). When
 * paired, carries the server's character roster — best-effort: a sleeping
 * server still yields a paired context, just without castable people.
 */
export async function getMediaLabPromptContext(): Promise<MediaLabPromptContext | null> {
  const { mediaLab } = useApp.getState();
  if (!mediaLab) return null;
  const base = mediaLab.url.replace(/\/+$/, '');
  if (characterCache && characterCache.url === base && Date.now() - characterCache.at < CHARACTER_TTL_MS) {
    return { characters: characterCache.characters };
  }
  try {
    const res = await fetchWithTimeout(`${base}/api/characters`, undefined, 8000);
    if (!res.ok) throw new Error(String(res.status));
    const data = (await res.json()) as { id?: unknown; name?: unknown }[];
    const characters = (Array.isArray(data) ? data : [])
      .filter((c) => c && c.id != null && typeof c.name === 'string' && c.name.trim())
      .map((c) => ({ id: String(c.id), name: (c.name as string).trim() }));
    characterCache = { url: base, at: Date.now(), characters };
    return { characters };
  } catch {
    return { characters: characterCache?.url === base ? characterCache.characters : [] };
  }
}

// ---------------------------------------------------------------------------
// Turn-time execution
// ---------------------------------------------------------------------------

export interface MediaTurnOutcome {
  /** Short lines appended to the assistant message ("🎬 Rendering …"). */
  statusLines: string[];
  /** Placeholder/marker/final paths written now — count as files written. */
  writtenPaths: string[];
}

/** Runs every parsed media request for one turn. Never throws. */
export async function handleMediaRequests(
  project: ProjectMeta,
  requests: MediaRequest[]
): Promise<MediaTurnOutcome> {
  const outcome: MediaTurnOutcome = { statusLines: [], writtenPaths: [] };
  for (const request of requests) {
    try {
      await handleOne(project, request, outcome);
    } catch (e) {
      outcome.statusLines.push(
        `⚠️ ${request.file} failed: ${e instanceof Error ? e.message : 'unknown error'}`
      );
    }
  }
  return outcome;
}

async function handleOne(
  project: ProjectMeta,
  request: MediaRequest,
  outcome: MediaTurnOutcome
): Promise<void> {
  const { mediaLab } = useApp.getState();
  if (mediaLab) {
    const submitted = await submitToServer(mediaLab.url, project.id, request).catch(() => false);
    if (submitted) {
      // Placeholder NOW, so the app the model just wrote never 404s: images
      // get a real (1-px) file at the exact path; video can't be faked with
      // a valid stub, so a marker sits beside the promised path and the
      // prompt contract already made the <video> tag carry its own fallback.
      if (request.kind === 'image') {
        await writeBinaryFile(project.id, request.file, PLACEHOLDER_PNG_BASE64);
        outcome.writtenPaths.push(request.file);
      } else {
        const marker = pendingMarkerPath(request.file);
        await writeFile(project.id, marker, pendingMarkerContent(request));
        outcome.writtenPaths.push(marker);
      }
      outcome.statusLines.push(
        `🎬 Rendering the ${request.kind} on your Media Lab — it'll drop into ${request.file} when it's done.`
      );
      return;
    }
    if (request.kind === 'video') {
      outcome.statusLines.push(
        `⚠️ Couldn't reach your Media Lab, so ${request.file} wasn't queued — wake the server and ask me again.`
      );
      return;
    }
    // Image with an unreachable server → fall through to on-device.
  } else if (request.kind === 'video') {
    outcome.statusLines.push(
      `⚠️ Video needs a paired Media Lab server — pair one from the Media Lab tab, then ask again for ${request.file}.`
    );
    return;
  }
  await generateImageOnDevice(project, request, outcome);
}

/** POSTs a job to the paired server and records it as pending. */
async function submitToServer(
  serverUrl: string,
  projectId: string,
  request: MediaRequest
): Promise<boolean> {
  const base = serverUrl.replace(/\/+$/, '');
  const endpoint = request.kind === 'video' ? '/api/generate' : '/api/image';
  const body = request.kind === 'video' ? buildVideoJobBody(request) : buildImageJobBody(request);
  const res = await fetchWithTimeout(
    `${base}${endpoint}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    },
    SUBMIT_TIMEOUT_MS
  );
  if (!res.ok) return false;
  const data = (await res.json()) as { id?: string };
  if (!data.id) return false;
  const pending = await loadPendingJobs();
  await savePendingJobs(
    addPendingJob(pending, {
      jobId: data.id,
      projectId,
      targetPath: request.file,
      kind: request.kind,
      prompt: request.prompt,
      createdAt: Date.now(),
    })
  );
  return true;
}

/** On-device image path (no server): synchronous during the turn, bounded. */
async function generateImageOnDevice(
  project: ProjectMeta,
  request: MediaRequest,
  outcome: MediaTurnOutcome
): Promise<void> {
  const provider = pickImageProvider(project);
  if (!provider) {
    outcome.statusLines.push(
      `⚠️ No image-capable AI is connected, so ${request.file} wasn't generated — add Gemini, OpenAI, Grok, or fal in Settings.`
    );
    return;
  }
  if (provider.subscription) {
    await useApp.getState().refreshSubscriptionIfNeeded(provider.id).catch(() => {});
  }
  const secret = await secrets.getProviderSecret(provider.id);
  if (!secret) {
    outcome.statusLines.push(
      `⚠️ The key for ${provider.label} is missing from the keychain, so ${request.file} wasn't generated.`
    );
    return;
  }
  try {
    const image = await withTimeout(
      generateImage(provider, secret, request.prompt),
      ON_DEVICE_IMAGE_TIMEOUT_MS,
      'Image generation took too long.'
    );
    await writeBinaryFile(project.id, request.file, image.base64);
    outcome.writtenPaths.push(request.file);
    outcome.statusLines.push(`🖼 Generated ${request.file} with ${provider.label}.`);
  } catch (e) {
    outcome.statusLines.push(
      `⚠️ Couldn't generate ${request.file}: ${e instanceof Error ? e.message : 'unknown error'} Try the 🖼 button to retry.`
    );
  }
}

function pickImageProvider(project: ProjectMeta): ProviderConnection | null {
  const { providers } = useApp.getState();
  const capable = providers.filter(canGenerateImages);
  return capable.find((p) => p.id === project.ai?.connectionId) ?? capable[0] ?? null;
}

// ---------------------------------------------------------------------------
// Settlement — called by media-server-watch on every queue poll
// ---------------------------------------------------------------------------

export interface SettledMediaJob {
  job: PendingMediaJob;
  /** True: the file landed in the project. False: the job failed for good. */
  ok: boolean;
}

/**
 * Matches a /api/queue history snapshot against the pending list, downloads
 * finished results into their projects, and removes markers. Retryable
 * download failures stay pending (bounded attempts) and are NOT reported.
 */
export async function settleFinishedMediaJobs(
  serverUrl: string,
  history: HistoryJob[]
): Promise<SettledMediaJob[]> {
  const pending = await loadPendingJobs();
  if (pending.length === 0) return [];
  const { resolved, failed, remaining } = matchFinishedJobs(pending, history);
  const settled: SettledMediaJob[] = [];
  const keep = [...remaining];

  for (const { job, url } of resolved) {
    try {
      const target = new File(`${filesRootUri(job.projectId).replace(/\/+$/, '')}/${job.targetPath}`);
      const parent = target.parentDirectory;
      if (!parent.exists) parent.create({ intermediates: true });
      await File.downloadFileAsync(absoluteMediaUrl(serverUrl, url), target, { idempotent: true });
      removeMarker(job);
      settled.push({ job, ok: true });
    } catch {
      const retry = retryPendingJob(job);
      if (retry) keep.push(retry);
      else settled.push({ job, ok: false });
    }
  }
  for (const job of failed) settled.push({ job, ok: false });

  if (settled.length || keep.length !== pending.length) await savePendingJobs(keep);
  return settled;
}

function removeMarker(job: PendingMediaJob): void {
  try {
    const marker = new File(
      `${filesRootUri(job.projectId).replace(/\/+$/, '')}/${pendingMarkerPath(job.targetPath)}`
    );
    if (marker.exists) marker.delete();
  } catch {
    // A stray marker is cosmetic; never fail the landing over it.
  }
}

// ---------------------------------------------------------------------------
// Pending-list persistence
// ---------------------------------------------------------------------------

export async function loadPendingJobs(): Promise<PendingMediaJob[]> {
  try {
    const raw = await AsyncStorage.getItem(PENDING_KEY);
    const parsed = raw ? (JSON.parse(raw) as PendingMediaJob[]) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function savePendingJobs(list: PendingMediaJob[]): Promise<void> {
  try {
    await AsyncStorage.setItem(PENDING_KEY, JSON.stringify(list));
  } catch {
    // Best-effort; the 24h age cap in matchFinishedJobs bounds any drift.
  }
}

// ---------------------------------------------------------------------------

async function fetchWithTimeout(url: string, init: RequestInit | undefined, ms: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}
