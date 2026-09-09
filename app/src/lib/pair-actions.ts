import {claimWorkbenchInvite,DeviceEnrollmentError} from '@/lib/device-enrollment';
import { probeMediaLab, type PairPayload } from '@/lib/media-pairing';
import { useApp } from '@/lib/store';
import { probeWorkbench } from '@/lib/workbench';

/**
 * Result of acting on one pair deep link — the /pair screen renders this.
 * Each half is independent: a link can carry either or both.
 */
export interface PairOutcome {
  workbench?: { ok: boolean; url: string; reason?: string };
  mediaLab?: { ok: boolean; url: string; reason?: string };
}

/**
 * Probe and pair each half of a `vibex://pair` payload. Pure side-effects on
 * the store/keychain — all UI (spinners, alerts, follow-up navigation) is the
 * caller's job, so this works from any screen.
 */
export async function performPair(payload: PairPayload): Promise<PairOutcome> {
  const outcome: PairOutcome = {};
  if (payload.workbench) {
    let reached = false;
    try {
      const token=payload.workbench.invitation?await claimWorkbenchInvite(payload.workbench.url,payload.workbench.invitation):payload.workbench.token;
      if(!token)throw new Error('Missing pairing credential');
      const probe = await probeWorkbench(payload.workbench.url, token);
      if (probe.ok) {
        reached = true;
        await useApp.getState().pairWorkbench(payload.workbench.url, token);
        outcome.workbench = { ok: true, url: payload.workbench.url };
      } else {
        outcome.workbench = { ok: false, url: payload.workbench.url, reason: probe.reason };
      }
    } catch (error) {
      outcome.workbench = {ok:false, url:payload.workbench.url,
        reason:error instanceof DeviceEnrollmentError?error.message:reached
          ? 'Your server answered, but this device could not save its connection securely. Restart Studio and try again. If it continues, update or repair this app installation.'
          : 'Could not reach your Workbench server. Check its address and network connection in Setup and try again.'};
    }
  }
  if (payload.mediaLab) {
    let reached = false;
    try {
      if (await probeMediaLab(payload.mediaLab)) {
        reached = true;
        await useApp.getState().setMediaLab({ url: payload.mediaLab, addedAt: Date.now() });
        outcome.mediaLab = { ok: true, url: payload.mediaLab };
      } else {
        outcome.mediaLab = { ok: false, url: payload.mediaLab, reason:'No Media Lab answered there.' };
      }
    } catch {
      outcome.mediaLab = {ok:false, url:payload.mediaLab,
        reason:reached
          ? 'Media Lab answered, but this device could not save the connection. Check that your device has free storage, restart Studio, and try again.'
          : 'Could not reach Media Lab. Check its address and network connection in Setup and try again.'};
    }
  }
  return outcome;
}
