/**
 * The `.vibex` bundle — one self-contained file holding a whole project, so
 * an app can travel anywhere a file can: Files, Google Drive, Dropbox,
 * AirDrop, Messages. The recipient taps it, VibeXStudio imports it, the
 * preview renders, and they can keep editing in chat and share back.
 *
 * Format: a JSON envelope (text files inline as UTF-8, binaries as base64).
 * Pure module — no Expo imports — so it stays unit-testable.
 */
import type { ProjectFile } from '@/lib/types';

export const BUNDLE_FORMAT = 'vibex/bundle';
export const BUNDLE_VERSION = 1;
export const BUNDLE_EXTENSION = 'vibex';

/** Hard ceiling so a hostile bundle can't balloon device storage. */
const MAX_FILES = 500;
const MAX_TOTAL_CHARS = 25_000_000; // ~25 MB of JSON payload

export interface VibexBundle {
  name: string;
  emoji: string;
  description: string;
  files: ProjectFile[];
}

interface Envelope {
  format: typeof BUNDLE_FORMAT;
  version: number;
  exportedAt: number;
  name: string;
  emoji: string;
  description: string;
  files: ProjectFile[];
}

export function encodeBundle(bundle: VibexBundle, exportedAt: number): string {
  const envelope: Envelope = {
    format: BUNDLE_FORMAT,
    version: BUNDLE_VERSION,
    exportedAt,
    name: bundle.name,
    emoji: bundle.emoji,
    description: bundle.description,
    files: bundle.files.map((f) => ({ ...f, path: assertSafePath(f.path) })),
  };
  return JSON.stringify(envelope);
}

/** Parses + validates bundle text. Throws a user-readable Error when it isn't one of ours. */
export function decodeBundle(text: string): VibexBundle {
  if (text.length > MAX_TOTAL_CHARS) throw new Error('That bundle is too large to import.');
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error("That file isn't a VibeX app bundle.");
  }
  const env = data as Partial<Envelope>;
  if (env?.format !== BUNDLE_FORMAT || !Array.isArray(env.files)) {
    throw new Error("That file isn't a VibeX app bundle.");
  }
  if (typeof env.version === 'number' && env.version > BUNDLE_VERSION) {
    throw new Error('This bundle was made by a newer VibeXStudio — update the app to open it.');
  }
  if (env.files.length === 0) throw new Error('This bundle has no app files in it.');
  if (env.files.length > MAX_FILES) throw new Error('That bundle has too many files to import.');

  const files: ProjectFile[] = env.files.map((f) => {
    if (typeof f?.path !== 'string' || typeof f?.content !== 'string') {
      throw new Error('This bundle is damaged (bad file entry).');
    }
    return {
      path: assertSafePath(f.path),
      content: f.content,
      encoding: f.encoding === 'base64' ? 'base64' : 'utf-8',
    };
  });

  return {
    name: typeof env.name === 'string' && env.name.trim() ? env.name.trim().slice(0, 80) : 'Shared app',
    emoji: typeof env.emoji === 'string' && env.emoji ? env.emoji.slice(0, 8) : '📦',
    description: typeof env.description === 'string' ? env.description.slice(0, 500) : '',
    files,
  };
}

/**
 * Keeps bundle paths inside the project's files dir: relative, no `..`
 * hops, no backslashes, no hidden control characters.
 */
export function assertSafePath(path: string): string {
  const cleaned = path.replace(/^\/+/, '').trim();
  const segments = cleaned.split('/');
  const ok =
    cleaned.length > 0 &&
    cleaned.length < 300 &&
    !cleaned.includes('\\') &&
    !/[\u0000-\u001f]/.test(cleaned) &&
    segments.every((s) => s.length > 0 && s !== '.' && s !== '..');
  if (!ok) throw new Error(`This bundle is damaged (unsafe path: ${JSON.stringify(path.slice(0, 60))}).`);
  return cleaned;
}

/** A share-sheet-friendly file name for the exported bundle. */
export function bundleFileName(projectName: string): string {
  const base = projectName
    .trim()
    .replace(/[^\p{L}\p{N} _-]+/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 60);
  return `${base || 'VibeX app'}.${BUNDLE_EXTENSION}`;
}
