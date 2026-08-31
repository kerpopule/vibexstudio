/**
 * Pure logic for the agent→Media Lab `medialab` fence protocol: request
 * validation, server job bodies, and the pending-job bookkeeping the queue
 * watcher settles against. No Expo/native imports — everything here is
 * unit-testable (tests/medialab-core.test.ts). The effectful side (fetches,
 * AsyncStorage, file writes) lives in src/lib/medialab-tool.ts.
 */

export type MediaKind = 'video' | 'image';

/** One parsed ```medialab fence from an assistant reply. */
export interface MediaRequest {
  kind: MediaKind;
  /** Media Lab character id to cast in the shot (server-paired only). */
  character?: string;
  /** Target project path, always under assets/ (parser-sanitized). */
  file: string;
  /** The generation prompt (the fence body). */
  prompt: string;
}

/** A submitted server job we still owe the project a file for. */
export interface PendingMediaJob {
  jobId: string;
  projectId: string;
  targetPath: string;
  kind: MediaKind;
  prompt: string;
  createdAt: number;
  /** Failed result-download attempts so far (job finished, fetch didn't). */
  attempts?: number;
}

export const MEDIA_FILE_PATTERN = /^assets\/[\w. -]+\.(mp4|png|jpg|jpeg|webp)$/i;

const KIND_EXTENSIONS: Record<MediaKind, RegExp> = {
  video: /\.mp4$/i,
  image: /\.(png|jpg|jpeg|webp)$/i,
};

/** True when `file` is a legal target for `kind` (under assets/, right ext). */
export function isValidMediaTarget(kind: MediaKind, file: string): boolean {
  return MEDIA_FILE_PATTERN.test(file) && KIND_EXTENSIONS[kind].test(file);
}

/**
 * Minimal valid body for the Media Lab's POST /api/generate (video queue).
 * GenReq requires only `prompt`; `model` defaults to ltx25 server-side and
 * `cast` carries the character's canonical look into the render prompt.
 */
export function buildVideoJobBody(request: MediaRequest): Record<string, unknown> {
  return {
    prompt: request.prompt,
    model: 'ltx25',
    ...(request.character ? { cast: [request.character] } : {}),
  };
}

/** Minimal valid body for POST /api/image (ImageReq: prompt + optional cast). */
export function buildImageJobBody(request: MediaRequest): Record<string, unknown> {
  return {
    prompt: request.prompt,
    ...(request.character ? { cast: [request.character] } : {}),
  };
}

/** The marker file written while a server video renders (deleted on landing). */
export function pendingMarkerPath(targetPath: string): string {
  return `${targetPath}.pending.txt`;
}

export function pendingMarkerContent(job: { kind: MediaKind; prompt: string }): string {
  return `Media Lab is rendering this ${job.kind} — it will replace this marker when done.\nPrompt: ${job.prompt}\n`;
}

/** 1×1 transparent PNG, the instant placeholder for server-rendered images. */
export const PLACEHOLDER_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

const MAX_PENDING = 100;
const MAX_DOWNLOAD_ATTEMPTS = 5;
const MAX_PENDING_AGE_MS = 24 * 60 * 60 * 1000;

/** Adds a job to the pending list, bounded so storage can't grow forever. */
export function addPendingJob(list: PendingMediaJob[], job: PendingMediaJob): PendingMediaJob[] {
  return [...list.filter((j) => j.jobId !== job.jobId), job].slice(-MAX_PENDING);
}

export interface HistoryJob {
  id?: string;
  status?: string;
  url?: string;
}

export interface PendingMatchResult {
  /** Finished with a downloadable result. */
  resolved: { job: PendingMediaJob; url: string }[];
  /** The server gave up on these — surface the failure, stop tracking. */
  failed: PendingMediaJob[];
  /** Still in flight (or awaiting a retry) — persist these. */
  remaining: PendingMediaJob[];
}

/**
 * Splits the pending list against a /api/queue history snapshot. Jobs that
 * finished without a result URL count as failed — a "done" we can't download
 * is not a success. Stale entries (24h) are silently dropped so a wiped
 * server can't leave immortal ghosts.
 */
export function matchFinishedJobs(
  list: PendingMediaJob[],
  history: HistoryJob[],
  now: number = Date.now()
): PendingMatchResult {
  const byId = new Map(history.filter((j) => j.id).map((j) => [j.id as string, j]));
  const result: PendingMatchResult = { resolved: [], failed: [], remaining: [] };
  for (const job of list) {
    if (now - job.createdAt > MAX_PENDING_AGE_MS) continue;
    const server = byId.get(job.jobId);
    if (!server) {
      result.remaining.push(job);
    } else if (server.status === 'done' && server.url) {
      result.resolved.push({ job, url: server.url });
    } else if (server.status === 'done' || server.status === 'error') {
      result.failed.push(job);
    } else {
      result.remaining.push(job);
    }
  }
  return result;
}

/**
 * Re-queues a job whose finished result failed to download; null once its
 * retry budget is spent (the caller then treats it as failed).
 */
export function retryPendingJob(job: PendingMediaJob): PendingMediaJob | null {
  const attempts = (job.attempts ?? 0) + 1;
  return attempts >= MAX_DOWNLOAD_ATTEMPTS ? null : { ...job, attempts };
}

/** Joins a server-relative result URL ("/media/x.mp4") onto the lab origin. */
export function absoluteMediaUrl(serverUrl: string, resultUrl: string): string {
  if (/^https?:\/\//i.test(resultUrl)) return resultUrl;
  return `${serverUrl.replace(/\/+$/, '')}/${resultUrl.replace(/^\/+/, '')}`;
}
