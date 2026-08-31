/**
 * Parses assistant output into file blocks + display text.
 *
 * Recognized block headers (forgiving about what models actually emit):
 *   ```html file=index.html
 *   ```file:index.html
 *   ```js path=app/main.js
 *
 * Fallbacks for models that ignore the file= contract (Grok, notably):
 *   - a filename on the line right before a plain fence ("**index.html**",
 *     "### index.html", "// index.html") names the block
 *   - a plain html block that starts with <!doctype html>/<html> is the app —
 *     it becomes index.html
 */
import { parseWebFence, webRequestKey, type WebRequest } from '@/lib/ai/web-tools-core';
import { isValidMediaTarget, type MediaRequest } from '@/lib/medialab-core';
import type { ProjectFile } from '@/lib/types';

const OPEN_FENCE = /^```([^\s`]*)\s*(.*)$/;
const FILE_ATTR = /(?:^|\s)(?:file|path)[:=]([^\s`]+)/;
const MEDIA_KIND_ATTR = /(?:^|\s)kind[:=](video|image)\b/i;
const MEDIA_CHARACTER_ATTR = /(?:^|\s)character[:=]([^\s`]+)/i;
// A filename with a known web extension, however the model dresses it up
// (bold, heading, backticks, comment syntax).
const NEARBY_FILENAME = /([\w./ -]+\.(?:html|css|js|mjs|json|svg))\b/i;

export interface ParsedReply {
  /** Commentary with file blocks replaced by short placeholders. */
  text: string;
  files: ProjectFile[];
  /** Parsed ```medialab fences — generation requests, not file contents. */
  media: MediaRequest[];
  /** Parsed ```web fences — research requests the turn loop may execute. */
  web: WebRequest[];
}

export function parseAssistantReply(raw: string): ParsedReply {
  const lines = raw.split('\n');
  const files: ProjectFile[] = [];
  const media: MediaRequest[] = [];
  const web: WebRequest[] = [];
  const textParts: string[] = [];

  let i = 0;
  while (i < lines.length) {
    const open = lines[i].match(OPEN_FENCE);
    if (!open) {
      textParts.push(lines[i]);
      i += 1;
      continue;
    }

    // Find the matching closing fence.
    let end = i + 1;
    while (end < lines.length && !/^```\s*$/.test(lines[end])) end += 1;
    const body = lines.slice(i + 1, end).join('\n');

    // A ```medialab fence is a generation REQUEST — the body is a prompt,
    // never file content. Malformed ones stay in the visible text rather
    // than being half-executed.
    if (open[1].toLowerCase() === 'medialab') {
      const request = parseMediaFence(open[2], body);
      if (request) {
        media.push(request);
        textParts.push(`🎬 Requested ${request.kind} → \`${request.file}\``);
        i = end + 1;
        continue;
      }
      textParts.push(...lines.slice(i, Math.min(end + 1, lines.length)));
      i = end + 1;
      continue;
    }

    // A ```web fence is a research REQUEST (docs/AGENT-WEB.md) — the body is
    // ignored by contract. Malformed ones stay in the visible text.
    if (open[1].toLowerCase() === 'web') {
      const request = parseWebFence(open[2]);
      if (request) {
        web.push(request);
        textParts.push(
          request.type === 'search'
            ? `🔎 Web search: \`${request.query}\``
            : `📄 Web page: ${request.url}`
        );
        i = end + 1;
        continue;
      }
      textParts.push(...lines.slice(i, Math.min(end + 1, lines.length)));
      i = end + 1;
      continue;
    }

    // A path can live in the info string ("html file=x") or as the first
    // token ("file:x").
    const info = `${open[1]} ${open[2]}`.trim();
    const fileMatch = info.match(FILE_ATTR);
    let path = fileMatch ? sanitizePath(fileMatch[1]) : null;

    // Fallback 1: filename on the line just above the fence
    // ("**index.html**", "### style.css", "// app.js").
    if (!path) {
      const prev = (textParts[textParts.length - 1] ?? '').trim();
      const nearby = prev.length <= 80 ? prev.match(NEARBY_FILENAME) : null;
      if (nearby) {
        path = sanitizePath(nearby[1].trim());
        if (path) textParts.pop();
      }
    }

    // Fallback 2: an unattributed COMPLETE html document = the app. Requiring a
    // full doc (doctype, or <html>…</html>) avoids capturing an illustrative
    // <html> fragment the model might include while explaining something.
    if (!path) {
      const lower = body.toLowerCase();
      const head = lower.trimStart().slice(0, 200);
      const lang = open[1].toLowerCase();
      const isFullDoc = head.startsWith('<!doctype') || (head.startsWith('<html') && lower.includes('</html>'));
      if (isFullDoc && (lang === 'html' || lang === '')) path = 'index.html';
    }

    if (path) {
      files.push({ path, content: body.endsWith('\n') ? body : `${body}\n` });
      textParts.push(`📄 Updated \`${path}\``);
      i = end + 1;
      continue;
    }

    // Regular code block — keep it in the visible text.
    textParts.push(...lines.slice(i, Math.min(end + 1, lines.length)));
    i = end + 1;
  }

  // De-dupe: when a model outputs the same path twice, the last block wins.
  const byPath = new Map<string, ProjectFile>();
  for (const file of files) byPath.set(file.path, file);
  const mediaByFile = new Map<string, MediaRequest>();
  for (const request of media) mediaByFile.set(request.file, request);
  const webByKey = new Map<string, WebRequest>();
  for (const request of web) webByKey.set(webRequestKey(request), request);

  return {
    text: textParts.join('\n').replace(/\n{3,}/g, '\n\n').trim(),
    files: [...byPath.values()],
    media: [...mediaByFile.values()],
    web: [...webByKey.values()],
  };
}

/** Validates one medialab fence; null keeps the raw block in the chat text. */
function parseMediaFence(infoRest: string, body: string): MediaRequest | null {
  const kindMatch = infoRest.match(MEDIA_KIND_ATTR);
  const fileMatch = infoRest.match(FILE_ATTR);
  const prompt = body.trim();
  if (!kindMatch || !fileMatch || !prompt) return null;
  const kind = kindMatch[1].toLowerCase() as MediaRequest['kind'];
  const file = sanitizePath(fileMatch[1]);
  if (!file || !isValidMediaTarget(kind, file)) return null;
  const character = infoRest.match(MEDIA_CHARACTER_ATTR)?.[1];
  return { kind, file, prompt, ...(character ? { character } : {}) };
}

/** Rejects absolute paths and traversal so the model can't escape the project dir. */
export function sanitizePath(path: string): string | null {
  const cleaned = path.replace(/^\.\//, '').replace(/^\/+/, '');
  if (!cleaned || cleaned.length > 200) return null;
  const segments = cleaned.split('/');
  if (segments.some((s) => s === '' || s === '.' || s === '..')) return null;
  if (!/^[\w./ -]+$/.test(cleaned)) return null;
  return cleaned;
}
