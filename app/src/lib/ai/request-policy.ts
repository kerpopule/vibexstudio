import type { ProviderConnection } from '@/lib/types';

/**
 * Product-level ceilings for OpenAI-shaped chat APIs.
 *
 * OpenRouter deliberately forwards provider defaults when a parameter is
 * omitted. Some reasoning models expose six-figure completion limits and may
 * otherwise spend many minutes thinking without producing a savable file. A
 * VibeX build needs enough room for complete source files, but it must still be
 * bounded and recoverable.
 */
export const DEFAULT_OPENAI_MAX_OUTPUT_TOKENS = 32_000;
export const GLM_53_FLASH_MAX_OUTPUT_TOKENS = 16_384;
export const MODEL_STREAM_TIMEOUT_MS = 20 * 60 * 1_000;

export interface OpenAiRequestPolicy {
  max_tokens: number;
  reasoning?: { effort: 'low' };
}

/** Return explicit request controls for every OpenAI-compatible provider. */
export function openAiRequestPolicy(
  connection: ProviderConnection,
  model: string,
  isOpenRouter: boolean
): OpenAiRequestPolicy {
  const privateLimit = connection.privateProvider?.limits.maxOutputTokens;
  const ceiling =
    typeof privateLimit === 'number' && Number.isFinite(privateLimit) && privateLimit > 0
      ? Math.floor(privateLimit)
      : DEFAULT_OPENAI_MAX_OUTPUT_TOKENS;

  // OpenRouter reports GLM 5.3 Flash as mandatory-reasoning with `max` as its
  // provider default. Low is the smallest supported effort; explicit output
  // bounds prevent a stalled-looking, effectively unbounded build.
  if (isOpenRouter && model === 'z-ai/glm-5.3-flash') {
    return {
      max_tokens: Math.min(ceiling, GLM_53_FLASH_MAX_OUTPUT_TOKENS),
      reasoning: { effort: 'low' },
    };
  }

  return { max_tokens: ceiling };
}
