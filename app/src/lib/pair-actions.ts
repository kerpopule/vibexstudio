import { probeMediaLab, type PairPayload } from '@/lib/media-pairing';
import { useApp } from '@/lib/store';
import { probeWorkbench } from '@/lib/workbench';

/**
 * Result of acting on one pair deep link — the /pair screen renders this.
 * Each half is independent: a link can carry either or both.
 */
export interface PairOutcome {
  workbench?: { ok: boolean; url: string; reason?: string };
  mediaLab?: { ok: boolean; url: string };
}

/**
 * Probe and pair each half of a `vibex://pair` payload. Pure side-effects on
 * the store/keychain — all UI (spinners, alerts, follow-up navigation) is the
 * caller's job, so this works from any screen.
 */
export async function performPair(payload: PairPayload): Promise<PairOutcome> {
  const outcome: PairOutcome = {};
  if (payload.workbench) {
    const probe = await probeWorkbench(payload.workbench.url, payload.workbench.token);
    if (probe.ok) {
      await useApp.getState().pairWorkbench(payload.workbench.url, payload.workbench.token);
      outcome.workbench = { ok: true, url: payload.workbench.url };
    } else {
      outcome.workbench = { ok: false, url: payload.workbench.url, reason: probe.reason };
    }
  }
  if (payload.mediaLab) {
    if (await probeMediaLab(payload.mediaLab)) {
      await useApp.getState().setMediaLab({ url: payload.mediaLab, addedAt: Date.now() });
      outcome.mediaLab = { ok: true, url: payload.mediaLab };
    } else {
      outcome.mediaLab = { ok: false, url: payload.mediaLab };
    }
  }
  return outcome;
}
