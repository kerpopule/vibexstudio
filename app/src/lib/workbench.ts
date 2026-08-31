/**
 * Client for the desktop Workbench server (vibexstudio-desktop/workbench/
 * API.md v1): the phone snapshots a project up, tells the computer to
 * install/build/serve it, and points the Preview WebView at the result.
 *
 * Effectful side only — pure planning/parsing lives in workbench-core.ts.
 * The pairing URL sits in AsyncStorage settings; the token is a SECRET and
 * comes from the keychain (secrets.ts). Every request carries
 * X-Workbench-Token; preview URLs carry ?wbt= instead (WebView subresources
 * can't set headers).
 */
import { useChat } from '@/lib/chat-engine';
import { notifyWithData } from '@/lib/notifications';
import {
  isBinaryPath,
  listFiles,
  touchProject,
  writeBinaryFile,
  writeFileWithoutTouch,
} from '@/lib/storage/projects';
import { getWorkbenchToken } from '@/lib/storage/secrets';
import { getWorkbench } from '@/lib/storage/settings';
import type { ProjectFile, ProjectMeta } from '@/lib/types';
import {
  findJobOutcome,
  findRunOutcome,
  isLongRunningTask,
  isSafeWorkbenchPath,
  shortLogTail,
  workbenchPreviewUrl,
  workbenchRunPlan,
  type WorkbenchEventsResponse,
  type WorkbenchJob,
  type WorkbenchRunPhase,
  type WorkbenchStatus,
  type WorkbenchTask,
} from '@/lib/workbench-core';

export interface WorkbenchPairing {
  url: string;
  token: string;
}

const REQUEST_TIMEOUT_MS = 10_000;
/** /events holds ≤25s server-side; give the round trip headroom. */
const EVENTS_TIMEOUT_MS = 30_000;
const INSTALL_DEADLINE_MS = 5 * 60_000;
const DEV_UP_DEADLINE_MS = 120_000;

/** A run failure that carries the job's log tail for the UI. */
export class WorkbenchRunError extends Error {
  logTail: string | null;
  constructor(message: string, logTail: string | null = null) {
    super(message);
    this.name = 'WorkbenchRunError';
    this.logTail = logTail;
  }
}

/** The paired workbench (url + keychain token), or null when unpaired. */
export async function getWorkbenchPairing(): Promise<WorkbenchPairing | null> {
  const [link, token] = await Promise.all([getWorkbench(), getWorkbenchToken()]);
  if (!link || !token) return null;
  return { url: link.url.replace(/\/+$/, ''), token };
}

async function request<T>(
  pairing: WorkbenchPairing,
  path: string,
  init?: { method?: string; body?: unknown },
  timeoutMs = REQUEST_TIMEOUT_MS
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let res: Response;
  try {
    res = await fetch(`${pairing.url}${path}`, {
      method: init?.method ?? 'GET',
      headers: {
        'X-Workbench-Token': pairing.token,
        ...(init?.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
      signal: controller.signal,
    });
  } catch (e) {
    throw new Error(
      e instanceof Error && e.name === 'AbortError'
        ? 'Your computer did not answer in time. Is it awake and on the same network?'
        : 'Could not reach your computer. Same Wi-Fi (or tailnet)?'
    );
  } finally {
    clearTimeout(timer);
  }
  if (res.status === 401) {
    throw new Error('Your computer rejected the pairing token — re-pair from the desktop QR.');
  }
  if (!res.ok) {
    let detail = '';
    try {
      const data = (await res.json()) as { error?: string };
      if (typeof data.error === 'string') detail = ` — ${data.error}`;
    } catch {
      // Non-JSON error body; the status code is the story.
    }
    throw new Error(`Workbench replied ${res.status}${detail}`);
  }
  return (await res.json()) as T;
}

/** GET /status. */
export async function status(pairing: WorkbenchPairing): Promise<WorkbenchStatus> {
  return request<WorkbenchStatus>(pairing, '/status');
}

/**
 * Pairing probe: GET /status with the QR's token. Returns a human-readable
 * failure reason instead of throwing, so the deep-link handler can alert.
 */
export async function probeWorkbench(
  url: string,
  token: string
): Promise<{ ok: true } | { ok: false; reason: string }> {
  try {
    const result = await status({ url: url.replace(/\/+$/, ''), token });
    if (!result.ok) return { ok: false, reason: 'The workbench answered but reported it is not ok.' };
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : 'The workbench could not be reached.' };
  }
}

/**
 * Snapshot the whole project up to the computer (POST /projects/import —
 * "phone is truth on import": the server overwrites its tree).
 */
export async function importProject(
  pairing: WorkbenchPairing,
  project: ProjectMeta,
  files?: ProjectFile[]
): Promise<{ ok: boolean; dir: string }> {
  const snapshot = files ?? (await listFiles(project.id));
  return request<{ ok: boolean; dir: string }>(pairing, '/projects/import', {
    method: 'POST',
    body: { id: project.id, name: project.name, files: snapshot },
  });
}

/** POST /exec — returns the job id. Tasks are the server's allowlist only. */
export async function exec(
  pairing: WorkbenchPairing,
  project: string,
  task: WorkbenchTask
): Promise<string> {
  const result = await request<{ ok: boolean; job: string }>(pairing, '/exec', {
    method: 'POST',
    body: { project, task },
  });
  return result.job;
}

/** GET /jobs/:id. */
export async function job(pairing: WorkbenchPairing, id: string): Promise<WorkbenchJob> {
  return request<WorkbenchJob>(pairing, `/jobs/${encodeURIComponent(id)}`);
}

/** One GET /events?since= long-poll round (≤25s server hold). */
export async function pollEvents(
  pairing: WorkbenchPairing,
  since: number
): Promise<WorkbenchEventsResponse> {
  return request<WorkbenchEventsResponse>(
    pairing,
    `/events?since=${encodeURIComponent(since)}`,
    undefined,
    EVENTS_TIMEOUT_MS
  );
}

/**
 * Pull the computer's tree back into the phone project (after builds or
 * agent work on the desktop). Paths are re-sanitized here — the phone never
 * trusts the server's snapshot blindly. Returns how many files landed.
 */
export async function pullFiles(pairing: WorkbenchPairing, projectId: string): Promise<number> {
  const result = await request<{ files?: ProjectFile[] } | ProjectFile[]>(
    pairing,
    `/projects/${encodeURIComponent(projectId)}/files`,
    undefined,
    60_000
  );
  const files = Array.isArray(result) ? result : (result.files ?? []);
  let written = 0;
  for (const file of files) {
    if (!isSafeWorkbenchPath(file.path) || typeof file.content !== 'string') continue;
    const binary = file.encoding === 'base64' || isBinaryPath(file.path);
    if (binary) await writeBinaryFile(projectId, file.path, file.content);
    else writeFileWithoutTouch(projectId, file.path, file.content);
    written += 1;
  }
  if (written > 0) {
    await touchProject(projectId);
    useChat.getState().bumpFiles(projectId);
  }
  return written;
}

async function failFromJob(
  pairing: WorkbenchPairing,
  jobId: string | undefined,
  fallback: string
): Promise<never> {
  let logTail: string | null = null;
  if (jobId) {
    try {
      logTail = shortLogTail((await job(pairing, jobId)).logTail);
    } catch {
      // The failure itself is the story; a missing log tail is fine.
    }
  }
  throw new WorkbenchRunError(fallback, logTail);
}

/**
 * Wait for a specific outcome by long-polling /events from `since`. The
 * predicate maps each batch to a result (or null to keep waiting).
 */
async function waitForEvents<T>(
  pairing: WorkbenchPairing,
  since: number,
  deadlineMs: number,
  pick: (events: WorkbenchEventsResponse['events']) => T | null,
  timeoutMessage: string
): Promise<{ value: T; since: number }> {
  const deadline = Date.now() + deadlineMs;
  let cursor = since;
  while (Date.now() < deadline) {
    const batch = await pollEvents(pairing, cursor);
    cursor = Math.max(cursor, batch.seq);
    const value = pick(batch.events);
    if (value != null) return { value, since: cursor };
  }
  throw new WorkbenchRunError(timeoutMessage);
}

/**
 * The whole "Run on my computer" flow: import the snapshot, then either
 * `serve` (classic static apps) or `install` → `dev` (package.json present),
 * long-polling /events until the server proxy is live. Resolves with the
 * tokenized preview URL for the WebView. Fires a background notification
 * either way (existing project-routing pattern).
 */
export async function runProjectOnWorkbench(
  project: ProjectMeta,
  onPhase: (phase: WorkbenchRunPhase) => void
): Promise<{ previewUrl: string }> {
  const pairing = await getWorkbenchPairing();
  if (!pairing) throw new WorkbenchRunError('No workbench is paired. Scan the QR on your desktop app.');

  try {
    onPhase('importing');
    const files = await listFiles(project.id);
    if (files.length === 0) {
      throw new WorkbenchRunError('This project has no files yet — build something in Chat first.');
    }
    const plan = workbenchRunPlan(files);

    // Baseline the event cursor BEFORE anything runs so nothing slips past
    // between exec and the first poll. since=0 returns immediately.
    let since = (await pollEvents(pairing, 0)).seq;

    // A previous run may still be serving stale files — stop it, re-import.
    try {
      const current = await status(pairing);
      if (current.projects.some((p) => p.id === project.id && p.devRunning)) {
        await exec(pairing, project.id, 'stop-dev');
      }
    } catch {
      // Best-effort; a failed stop just means dev-up may arrive from a restart.
    }

    await importProject(pairing, project, files);

    for (const task of plan) {
      onPhase(task === 'install' ? 'install' : task === 'serve' ? 'serve' : 'dev');
      const jobId = await exec(pairing, project.id, task);
      if (isLongRunningTask(task)) {
        const { value } = await waitForEvents(
          pairing,
          since,
          DEV_UP_DEADLINE_MS,
          (events) => findRunOutcome(events, project.id),
          'The server on your computer did not come up in time.'
        );
        if (value.kind === 'job-failed') {
          await failFromJob(pairing, value.jobId ?? jobId, 'The server on your computer failed to start.');
        }
      } else {
        const waited = await waitForEvents(
          pairing,
          since,
          task === 'install' ? INSTALL_DEADLINE_MS : DEV_UP_DEADLINE_MS,
          (events) => findJobOutcome(events, jobId),
          `The ${task} step on your computer did not finish in time.`
        );
        since = waited.since;
        if (waited.value === 'failed') {
          await failFromJob(pairing, jobId, `The ${task} step failed on your computer.`);
        }
      }
    }

    const previewUrl = workbenchPreviewUrl(pairing.url, project.id, pairing.token);
    await notifyWithData(
      `${project.emoji} ${project.name} is live on your computer`,
      'Tap to open the preview served from your desktop.',
      { projectId: project.id }
    );
    return { previewUrl };
  } catch (e) {
    await notifyWithData(
      `${project.emoji} ${project.name} hit a snag on your computer`,
      e instanceof Error ? e.message : 'The workbench run failed — tap to take a look.',
      { projectId: project.id }
    );
    throw e;
  }
}
