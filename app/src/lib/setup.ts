/**
 * One truth for "how set up is this install?" — read by onboarding, the
 * Setup tab checklist, and the Studio status chip. Pure: derives from store
 * state, never touches storage.
 */
import { canGenerateImages, canGenerateVideo } from '@/lib/ai/media';
import type { MediaLabLink, WorkbenchLink } from '@/lib/storage/settings';
import type { GitHubAccount, ProviderConnection } from '@/lib/types';

export interface SetupInputs {
  providers: ProviderConnection[];
  mediaLab: MediaLabLink | null;
  workbench: WorkbenchLink | null;
  github: GitHubAccount | null;
}

export type SetupStepId = 'ai' | 'media' | 'computer' | 'publish';

export interface SetupStep {
  id: SetupStepId;
  title: string;
  /** What the step is for, in the user's words. */
  blurb: string;
  done: boolean;
  /** Short status line shown when done. */
  status: string;
  /** Steps a first build cannot happen without. */
  required: boolean;
}

export function chatProviders(providers: ProviderConnection[]): ProviderConnection[] {
  return providers.filter((p) => p.capabilities.chat);
}

export function mediaCapable(providers: ProviderConnection[]): ProviderConnection[] {
  return providers.filter((p) => canGenerateImages(p) || canGenerateVideo(p));
}

export function setupSteps(input: SetupInputs): SetupStep[] {
  const chat = chatProviders(input.providers);
  const media = mediaCapable(input.providers);
  const mediaReady = media.length > 0 || input.mediaLab != null;
  return [
    {
      id: 'ai',
      title: 'Your AI',
      blurb: 'The plan or key that writes your apps. Use what you already pay for.',
      done: chat.length > 0,
      status: chat.length === 1 ? chat[0].label : chat.length ? `${chat.length} connected` : 'Not connected',
      required: true,
    },
    {
      id: 'media',
      title: 'Media Lab',
      blurb: 'Where images, video, and music get made — this device, your computer, a Spark, or the cloud.',
      done: mediaReady,
      status: input.mediaLab
        ? `Paired · ${hostLabel(input.mediaLab.url)}`
        : media.length
          ? `On this device · ${media[0].label}`
          : 'Not set up',
      required: false,
    },
    {
      id: 'computer',
      title: 'Your computer',
      blurb: 'Pair the desktop app so your computer installs, builds, and serves real projects for this device.',
      done: input.workbench != null,
      status: input.workbench ? `Paired · ${hostLabel(input.workbench.url)}` : 'Not paired',
      required: false,
    },
    {
      id: 'publish',
      title: 'Publish',
      blurb: 'Your own GitHub hosts the apps you share. Nothing goes through VibeX.',
      done: input.github != null,
      status: input.github ? `@${input.github.login}` : 'Not connected',
      required: false,
    },
  ];
}

/** True once a first build is possible. */
export function readyToBuild(input: SetupInputs): boolean {
  return chatProviders(input.providers).length > 0;
}

/** "192.168.1.20:7863" → "192.168.1.20", "http://spark.tail…:7863" → "spark.tail…" */
export function hostLabel(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}
