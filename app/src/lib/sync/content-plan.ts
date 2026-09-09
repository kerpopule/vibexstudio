/** Three-way content comparison. Device clocks never decide which work survives. */
export type ContentSyncAction = 'push' | 'pull' | 'equal' | 'conflict';
export function contentSyncAction(local: string | null, remote: string | null, base: string | null): ContentSyncAction {
  if (local === remote) return 'equal';
  if (base === null) {
    if (remote === null) return 'push';
    if (local === null) return 'pull';
    return 'conflict';
  }
  // Missing established data might be a deletion or a provider failure. Never
  // silently recreate or delete a project until the user resolves it.
  if (local === null || remote === null) return 'conflict';
  if (remote === base) return 'push';
  if (local === base) return 'pull';
  return 'conflict';
}

/** Stable content serialization even when folder enumeration order changes. */
export function syncContent(meta: unknown, chat: unknown, files: { path: string; content: string; encoding?: string }[]): string {
  const canonical = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(canonical);
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, child]) => [key, canonical(child)]));
    return value;
  };
  return JSON.stringify(canonical({ meta, chat, files: [...files].sort((a, b) => a.path.localeCompare(b.path)).map((f) => ({ path: f.path, content: f.content, encoding: f.encoding === 'base64' ? 'base64' : 'utf-8' })) }));
}
