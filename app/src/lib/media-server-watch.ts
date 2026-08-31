/**
 * Watches the paired Media Lab server's queue and turns finished jobs into
 * notifications. Runs while the app is alive (foreground polls every 20s;
 * a background flip triggers one last check), rides the WebView's shared
 * session cookie on iOS, and stays silent on any failure — the server
 * being asleep is normal, not an error.
 *
 * Tapping a notification routes to the Media Lab tab with the job focused
 * (the server opens `?job=<id>` straight to that screening).
 */
import * as BackgroundTask from 'expo-background-task';
import * as TaskManager from 'expo-task-manager';
import { AppState, Platform } from 'react-native';

import { useChat } from '@/lib/chat-engine';
import { settleFinishedMediaJobs, type SettledMediaJob } from '@/lib/medialab-tool';
import { notifyWithData } from '@/lib/notifications';
import { useApp } from '@/lib/store';

const POLL_MS = 20_000;
const BG_TASK = 'vibex-media-lab-watch';

const KIND_LABEL: Record<string, string> = {
  video: 'video',
  image: 'image',
  music: 'song',
  character: 'character',
};

let timer: ReturnType<typeof setInterval> | null = null;
let seenDone: Set<string> | null = null;

// The baseline persists so a cold background wake (OS task) can tell new
// finishes from old ones instead of silently re-baselining.
const SEEN_KEY = 'vibex.mediaLabWatch.seenDone';

async function loadSeen(): Promise<Set<string>> {
  try {
    const AsyncStorage = (await import('@react-native-async-storage/async-storage')).default;
    const raw = await AsyncStorage.getItem(SEEN_KEY);
    return new Set(raw ? (JSON.parse(raw) as string[]) : []);
  } catch {
    return new Set();
  }
}

async function saveSeen(seen: Set<string>): Promise<void> {
  try {
    const AsyncStorage = (await import('@react-native-async-storage/async-storage')).default;
    await AsyncStorage.setItem(SEEN_KEY, JSON.stringify([...seen].slice(-200)));
  } catch {
    // Best-effort.
  }
}

async function check(): Promise<void> {
  const { mediaLab } = useApp.getState();
  if (!mediaLab) {
    seenDone = null;
    return;
  }
  try {
    const base = mediaLab.url.replace(/\/+$/, '');
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), 8000);
    const res = await fetch(`${base}/api/queue`, { signal: controller.signal });
    clearTimeout(t);
    if (!res.ok) return;
    const data = (await res.json()) as {
      history?: { id?: string; status?: string; kind?: string; prompt?: string; url?: string }[];
    };
    const history = data.history ?? [];

    // Project-bound jobs first: agent-requested media (```medialab fences)
    // lands INSIDE its project — download, unblock the preview, and route
    // the notification tap to the project, not the Media Lab tab.
    const tracked = await settleProjectJobs(base, history);

    const done = history.filter((j) => j.status === 'done' && j.id && !tracked.has(j.id));
    if (seenDone == null) seenDone = await loadSeen();
    if (seenDone.size === 0 && done.length > 0) {
      // Very first look ever: everything already finished is old news.
      seenDone = new Set(done.map((j) => j.id as string));
      await saveSeen(seenDone);
      return;
    }
    let changed = false;
    for (const job of done) {
      const id = job.id as string;
      if (seenDone.has(id)) continue;
      seenDone.add(id);
      changed = true;
      const label = KIND_LABEL[job.kind ?? ''] ?? 'creation';
      const prompt = (job.prompt ?? '').slice(0, 80);
      await notifyWithData(
        `🎬 Your ${label} is ready`,
        prompt || 'Tap to watch it in Media Lab.',
        { mediaLabJob: id }
      );
    }
    if (changed) await saveSeen(seenDone);
  } catch {
    // Server asleep/unreachable — quietly try again next round.
  }
}

/**
 * Resolves finished agent-requested jobs into their projects (download →
 * marker cleanup happens in medialab-tool), then bumps the project preview
 * and notifies with projectId routing. Returns the job ids handled here so
 * the generic "ready in Media Lab" notice doesn't double-fire for them.
 */
async function settleProjectJobs(
  base: string,
  history: { id?: string; status?: string; kind?: string; prompt?: string; url?: string }[]
): Promise<Set<string>> {
  let settled: SettledMediaJob[] = [];
  try {
    settled = await settleFinishedMediaJobs(base, history);
  } catch {
    return new Set();
  }
  const { projects } = useApp.getState();
  for (const { job, ok } of settled) {
    const project = projects.find((p) => p.id === job.projectId);
    const where = project ? `${project.emoji} ${project.name}` : 'your project';
    if (ok) {
      useChat.getState().bumpFiles(job.projectId);
      await notifyWithData(
        `🎬 Your ${job.kind} landed in ${where}`,
        `${job.targetPath} is live — tap to see it in place.`,
        { projectId: job.projectId }
      );
    } else {
      await notifyWithData(
        `🎬 A ${job.kind} for ${where} hit a snag`,
        `Media Lab couldn't finish ${job.targetPath} — ask VibeX to try again.`,
        { projectId: job.projectId }
      );
    }
  }
  return new Set(settled.map((s) => s.job.jobId));
}

// Closed-app coverage: iOS/Android Background App Refresh wakes this task
// on the OS's schedule (~15 min granularity at best, and only when the
// system feels like it) — so long renders still notify with the phone in a
// pocket, honestly best-effort. The task must register at module scope.
TaskManager.defineTask(BG_TASK, async () => {
  await check();
  return BackgroundTask.BackgroundTaskResult.Success;
});

/** Call once from the root layout. Idempotent. */
export function initMediaServerWatch(): void {
  if (Platform.OS === 'web' || timer) return;
  timer = setInterval(check, POLL_MS);
  check();
  AppState.addEventListener('change', (state) => {
    // One extra look as we head to the background, so a job that finishes
    // moments later still had a fresh baseline; and a refresh on return.
    if (state === 'active' || state === 'background') check();
  });
  BackgroundTask.registerTaskAsync(BG_TASK, { minimumInterval: 15 }).catch(() => {
    // Unavailable (simulator, web, restricted) — foreground polling remains.
  });
}
