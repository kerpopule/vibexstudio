/**
 * Turn slots: a small FIFO gate in front of the chat engine so any number of
 * projects can be *started* while only a hardware-appropriate number stream
 * at once. Queued turns hold their session in a "waiting" state and begin
 * automatically as slots free up. In-memory only — a killed app drops the
 * queue (each project's chat history still shows what was asked).
 */
import * as Device from 'expo-device';

import { turnLimitForMemory } from '@/lib/turn-limits';

const LIMIT = turnLimitForMemory(Device.totalMemory ?? null);

let running = 0;
const waiters: { resolve: () => void; reject: (e: Error) => void; signal?: AbortSignal }[] = [];

export function turnSlotLimit(): number {
  return LIMIT;
}

/** How many turns are streaming right now (for UI badges). */
export function turnsRunning(): number {
  return running;
}

/**
 * Waits for a streaming slot. Resolves immediately when under the limit;
 * otherwise queues FIFO. Rejects with an AbortError-shaped Error if the
 * signal fires while queued. Callers MUST pair with `releaseTurnSlot()`.
 */
export function acquireTurnSlot(opts?: { signal?: AbortSignal; onQueued?: () => void }): Promise<void> {
  if (running < LIMIT) {
    running++;
    return Promise.resolve();
  }
  opts?.onQueued?.();
  return new Promise<void>((resolve, reject) => {
    const waiter = {
      resolve: () => {
        running++;
        resolve();
      },
      reject,
      signal: opts?.signal,
    };
    waiters.push(waiter);
    opts?.signal?.addEventListener('abort', () => {
      const i = waiters.indexOf(waiter);
      if (i >= 0) {
        waiters.splice(i, 1);
        reject(new Error('aborted-while-queued'));
      }
    });
  });
}

export function releaseTurnSlot(): void {
  running = Math.max(0, running - 1);
  // Hand the freed slot to the oldest waiter (its resolve re-increments).
  const next = waiters.shift();
  next?.resolve();
}
