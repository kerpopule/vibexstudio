/** Honor an explicit independent-host declaration; old manifests stay compatible. */
export function createLegacyQueueSupport(fetcher: typeof fetch = fetch, clock = Date.now) {
  const cache = new Map<string, {legacy: boolean; checked: number}>();
  return async (origin: string): Promise<boolean> => {
    const base = new URL(origin).origin;
    const previous = cache.get(base);
    if (previous && clock() - previous.checked < 60_000) return previous.legacy;
    let legacy = previous?.legacy ?? true;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    try {
      const response = await fetcher(`${base}/manifest.json`, {
        signal: controller.signal, credentials: 'omit', redirect: 'error',
      });
      if (response.ok) {
        const data = await response.json();
        legacy = !(data?.vibexStudio?.version === 1 && data.vibexStudio.legacyQueue === false);
      }
    } catch {
      // A temporary failure cannot undo an already observed independent host.
    } finally {
      clearTimeout(timer);
    }
    cache.delete(base);
    cache.set(base, {legacy, checked: clock()});
    if (cache.size > 8) cache.delete(cache.keys().next().value!);
    return legacy;
  };
}
