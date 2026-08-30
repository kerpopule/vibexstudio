/**
 * Pure model-id → short display name. Kept import-free (no native deps) so it
 * can be unit-tested and reused anywhere.
 */

/** Shortest practical display name for a model id (vendor prefix stripped). */
export function shortModelLabel(id: string): string {
  if (!id) return 'model';
  const base = id.includes('/') ? id.split('/').pop()! : id;

  let m: RegExpMatchArray | null;
  // Anthropic ids use 4-6, OpenRouter uses 4.6 — accept either separator.
  if ((m = base.match(/^claude-(sonnet|opus|haiku)-(\d+)[.-](\d+)/i))) {
    return `${cap(m[1])} ${m[2]}.${m[3]}`;
  }
  if ((m = base.match(/^grok-?(.+)$/i))) return `Grok ${m[1].replace(/-/g, ' ')}`;
  if ((m = base.match(/^glm-?(.+)$/i))) return `GLM ${m[1].replace(/-/g, ' ')}`;
  if ((m = base.match(/^gpt-?(.+)$/i))) return `GPT-${m[1]}`;
  if ((m = base.match(/^gemini-?(.+)$/i))) return `Gemini ${m[1].replace(/-/g, ' ')}`;
  if (/^minimax/i.test(base)) return base.replace(/-/g, ' ');
  if ((m = base.match(/^kimi-?(.+)$/i))) return `Kimi ${m[1].replace(/-/g, ' ')}`;
  return base;
}

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
