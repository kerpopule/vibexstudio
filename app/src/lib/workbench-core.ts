/**
 * Pure logic for the desktop Workbench client ("computer does the heavy
 * lifting, phone is the remote"). No Expo/native imports — everything here
 * is unit-testable (tests/workbench-core.test.ts). The effectful side
 * (fetches, keychain, file writes) lives in src/lib/workbench.ts.
 *
 * Server contract: vibexstudio-desktop/workbench/API.md (v1).
 */

/** The allowlisted tasks POST /exec accepts. Nothing else — it's not a shell. */
export type WorkbenchTask = 'install' | 'build' | 'typecheck' | 'dev' | 'stop-dev' | 'serve';

export interface WorkbenchStatusProject {
  id: string;
  name: string;
  devRunning: boolean;
  devPort?: number;
}

export interface WorkbenchStatus {
  ok: boolean;
  version: number;
  projectsRoot: string;
  projects: WorkbenchStatusProject[];
}

export interface WorkbenchJob {
  id: string;
  project: string;
  task: WorkbenchTask;
  state: 'queued' | 'running' | 'done' | 'failed';
  exitCode?: number;
  /** Last 4KB of the job's output — the failure story, verbatim. */
  logTail?: string;
  startedAt?: number;
  finishedAt?: number;
}

export interface WorkbenchEvent {
  seq: number;
  at?: number;
  type: 'job-done' | 'job-failed' | 'dev-up' | string;
  project?: string;
  task?: string;
  jobId?: string;
  port?: number;
}

export interface WorkbenchEventsResponse {
  seq: number;
  events: WorkbenchEvent[];
}

/**
 * How to bring a project up on the computer: classic static VibeX apps get
 * the built-in zero-dep static server; anything with a package.json gets the
 * real thing — npm install, then the dev server.
 */
export function workbenchRunPlan(files: { path: string }[]): WorkbenchTask[] {
  return files.some((f) => f.path === 'package.json') ? ['install', 'dev'] : ['serve'];
}

/** True for `dev`/`serve` — jobs that stay 'running' and signal via dev-up. */
export function isLongRunningTask(task: WorkbenchTask): boolean {
  return task === 'dev' || task === 'serve';
}

/**
 * The WebView URL for a project served by the workbench. The token rides as
 * `?wbt=` because WebViews can't put headers on subresource requests.
 */
export function workbenchPreviewUrl(baseUrl: string, projectId: string, token: string): string {
  const base = baseUrl.replace(/\/+$/, '');
  return `${base}/preview/${encodeURIComponent(projectId)}/?wbt=${encodeURIComponent(token)}`;
}

/**
 * Guard for paths coming BACK from the workbench (GET /projects/:id/files).
 * The server sanitizes on import; we re-check on pull so a compromised or
 * buggy server can't write outside the project's files dir on the phone.
 */
export function isSafeWorkbenchPath(path: string): boolean {
  if (!path || path.length > 1024) return false;
  if (path.startsWith('/') || /^[a-zA-Z]:/.test(path) || path.includes('\\')) return false;
  if (path.includes('\0')) return false;
  const segments = path.split('/');
  return segments.every((s) => s !== '' && s !== '.' && s !== '..');
}

/** What a batch of events says about a project's run attempt, if anything. */
export type WorkbenchRunOutcome =
  | { kind: 'dev-up'; port?: number }
  | { kind: 'job-failed'; jobId?: string; task?: string }
  | null;

/**
 * Scans an events batch for the moment a project's dev/serve came up — or
 * died trying. Events for other projects are ignored.
 */
export function findRunOutcome(events: WorkbenchEvent[], project: string): WorkbenchRunOutcome {
  for (const event of events) {
    if (event.project !== project) continue;
    if (event.type === 'dev-up') return { kind: 'dev-up', port: event.port };
    if (event.type === 'job-failed') return { kind: 'job-failed', jobId: event.jobId, task: event.task };
  }
  return null;
}

/** Did a specific job finish in this events batch? */
export function findJobOutcome(events: WorkbenchEvent[], jobId: string): 'done' | 'failed' | null {
  for (const event of events) {
    if (event.jobId !== jobId) continue;
    if (event.type === 'job-done') return 'done';
    if (event.type === 'job-failed') return 'failed';
  }
  return null;
}

/** The run phases the Share pane narrates while the computer works. */
export type WorkbenchRunPhase = 'importing' | 'install' | 'dev' | 'serve';

const PHASE_LABEL: Record<WorkbenchRunPhase, string> = {
  importing: 'Sending your app to your computer…',
  install: 'Installing on your computer…',
  dev: 'Starting the dev server on your computer…',
  serve: 'Starting the server on your computer…',
};

export function describeWorkbenchPhase(phase: WorkbenchRunPhase): string {
  return PHASE_LABEL[phase];
}

/** Trims a job logTail into an alert/row-sized failure excerpt. */
export function shortLogTail(logTail: string | undefined, maxChars = 400): string | null {
  const trimmed = (logTail ?? '').trim();
  if (!trimmed) return null;
  return trimmed.length <= maxChars ? trimmed : `…${trimmed.slice(-maxChars)}`;
}
