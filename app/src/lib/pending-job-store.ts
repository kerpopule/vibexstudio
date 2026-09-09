import type { PendingMediaJob } from '@/lib/medialab-core';

interface Storage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
}

/** Serialize read/modify/write, including result landing, within this app runtime.
 * A failed read or write must not erase pending work or claim successful tracking.
 */
export function createPendingJobStore(storage: Storage, key: string) {
  let tail: Promise<unknown> = Promise.resolve();
  const read = async (): Promise<PendingMediaJob[]> => {
    const raw = await storage.getItem(key);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) throw new Error('Saved Media Lab jobs could not be read.');
    return parsed as PendingMediaJob[];
  };
  const update = <T>(work: (jobs: PendingMediaJob[]) => Promise<{ jobs: PendingMediaJob[]; result: T }> | { jobs: PendingMediaJob[]; result: T }): Promise<T> => {
    const operation = tail.then(async () => {
      const next = await work(await read());
      await storage.setItem(key, JSON.stringify(next.jobs));
      return next.result;
    });
    tail = operation.catch(() => {});
    return operation;
  };
  return { read, update };
}
