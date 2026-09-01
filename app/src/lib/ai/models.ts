/**
 * Live model discovery. When the user opens the model picker we hit the
 * provider's "list models" endpoint so the choices stay current without app
 * updates. Every path falls back to the curated static list on any error.
 */
import { resolveRouting } from '@/lib/ai/chat';
import { shortModelLabel } from '@/lib/ai/model-label';
import { PROVIDERS } from '@/lib/ai/registry';
import { SUBSCRIPTION_PROVIDERS } from '@/lib/ai/subscriptionOauth';
import { PRIVATE_ALLOWED_MODELS } from '@/lib/private-provider/profile';
import { getPrivateDeviceProof } from '@/lib/storage/secrets';
import type { ProviderConnection } from '@/lib/types';

export { shortModelLabel };

/** Curated fallback models for a connection. */
export function staticModels(c: ProviderConnection): string[] {
  if (c.privateProvider) return c.privateProvider.allowedModels.filter((model) =>
    PRIVATE_ALLOWED_MODELS.includes(model as typeof PRIVATE_ALLOWED_MODELS[number]));
  return c.subscription
    ? SUBSCRIPTION_PROVIDERS[c.subscription].suggestedModels
    : PROVIDERS[c.kind].suggestedModels;
}

function uniq(ids: string[]): string[] {
  return [...new Set(ids.filter(Boolean))];
}

/**
 * Fetch the live model list for a connection, with the current model and the
 * curated list folded in (current first) so the picker is never empty.
 */
export async function fetchModels(connection: ProviderConnection, secret: string): Promise<string[]> {
  const fallback = uniq([connection.defaultModel, ...staticModels(connection)]);
  const routing = resolveRouting(connection);
  try {
    let live: string[] = [];
    if (routing.protocol === 'gemini') {
      const res = await fetch(`${routing.baseUrl}/models?key=${encodeURIComponent(secret)}&pageSize=1000`);
      const json = await res.json();
      live = (json.models ?? [])
        .map((m: { name?: string }) => String(m.name ?? '').replace(/^models\//, ''))
        .filter((id: string) => id.includes('gemini') && !/embedding|aqa|imagen|veo/i.test(id));
    } else if (routing.protocol === 'anthropic' && !connection.subscription) {
      const res = await fetch(`${routing.baseUrl}/v1/models?limit=1000`, {
        headers: { 'x-api-key': secret, 'anthropic-version': '2023-06-01' },
      });
      const json = await res.json();
      live = (json.data ?? []).map((m: { id: string }) => m.id);
    } else {
      // OpenAI-style GET /models with bearer (covers openai, xai, zai, kimi,
      // openrouter, custom, and subscription bearer endpoints). MiniMax's
      // Anthropic-mode base has no /models → 404 → graceful fallback.
      const bases = [routing.baseUrl];
      // Z.ai keys come in two flavors on different bases (Coding Plan vs
      // pay-as-you-go). Probe both so the picker populates either way.
      if (connection.kind === 'zai') {
        const alt = routing.baseUrl.includes('/coding/')
          ? routing.baseUrl.replace('/api/coding/paas/', '/api/paas/')
          : routing.baseUrl.replace('/api/paas/', '/api/coding/paas/');
        bases.push(alt);
      }
      for (const base of bases) {
        const deviceProof = connection.privateProvider ? await getPrivateDeviceProof(connection.id) : null;
        const res = await fetch(`${base}/models`, {
          headers: {
            Authorization: `Bearer ${secret}`,
            ...(deviceProof ? { 'X-VibeX-Device-Proof': deviceProof } : {}),
            ...(routing.extraHeaders ?? {}),
          },
        });
        const json = await res.json();
        live = (json.data ?? []).map((m: { id: string }) => m.id);
        if (live.length) break;
      }
    }
    if (connection.privateProvider) {
      live = live.filter((model) => connection.privateProvider!.allowedModels.includes(model));
    }
    live = live.filter(Boolean).sort();
    return live.length ? uniq([connection.defaultModel, ...live]) : fallback;
  } catch {
    return fallback;
  }
}

/** Emoji glyph for a connection's vendor, for the chat model bar. */
export function providerGlyph(c: ProviderConnection): string {
  if (c.privateProvider) return '🔐';
  if (c.subscription === 'chatgpt-oauth') return '🟢';
  if (c.subscription === 'minimax-oauth') return '🟠';
  if (c.subscription === 'kimi-oauth') return '🌙';
  if (c.subscription === 'xai-oauth') return '✖️';
  switch (c.kind) {
    case 'openrouter':
      return '🧭';
    case 'anthropic':
      return '🤖';
    case 'openai':
      return '🟢';
    case 'gemini':
      return '✦';
    case 'xai':
      return '✖️';
    case 'zai':
      return '🇿';
    default:
      return '⚙️';
  }
}
