/**
 * Catalog of supported AI providers: how to reach them, how users connect
 * them, and what they can do. Adding a provider here is the only step needed
 * for it to show up in the Connect screen.
 */
import type { ProviderCapabilities, ProviderKind } from '@/lib/types';

export type WireProtocol = 'openai' | 'anthropic' | 'gemini';

export interface ProviderSpec {
  kind: ProviderKind;
  name: string;
  blurb: string;
  protocol: WireProtocol;
  baseUrl: string;
  /** True when the provider supports in-app OAuth (no copy-pasting keys). */
  supportsOAuth: boolean;
  keyUrl?: string;
  defaultModel: string;
  suggestedModels: string[];
  capabilities: ProviderCapabilities;
}

export const PROVIDERS: Record<ProviderKind, ProviderSpec> = {
  openrouter: {
    kind: 'openrouter',
    name: 'OpenRouter',
    blurb: 'One key for hundreds of models. Sign in with OAuth — no key copying.',
    protocol: 'openai',
    baseUrl: 'https://openrouter.ai/api/v1',
    supportsOAuth: true,
    keyUrl: 'https://openrouter.ai/keys',
    defaultModel: 'anthropic/claude-sonnet-4.6',
    suggestedModels: [
      'anthropic/claude-sonnet-4.6',
      'anthropic/claude-opus-4.8',
      'openai/gpt-5.2',
      'google/gemini-3-pro',
      'x-ai/grok-4.3',
    ],
    capabilities: { chat: true, image: false, video: false },
  },
  anthropic: {
    kind: 'anthropic',
    name: 'Anthropic',
    blurb: 'Claude models, straight from the source.',
    protocol: 'anthropic',
    baseUrl: 'https://api.anthropic.com',
    supportsOAuth: false,
    keyUrl: 'https://console.anthropic.com/settings/keys',
    defaultModel: 'claude-sonnet-4-6',
    suggestedModels: ['claude-sonnet-4-6', 'claude-opus-4-8', 'claude-haiku-4-5-20251001'],
    capabilities: { chat: true, image: false, video: false },
  },
  openai: {
    kind: 'openai',
    name: 'OpenAI',
    blurb: 'GPT models with an OpenAI API key.',
    protocol: 'openai',
    baseUrl: 'https://api.openai.com/v1',
    supportsOAuth: false,
    keyUrl: 'https://platform.openai.com/api-keys',
    defaultModel: 'gpt-5.2',
    suggestedModels: ['gpt-5.2', 'gpt-5-mini'],
    capabilities: { chat: true, image: true, video: false },
  },
  gemini: {
    kind: 'gemini',
    name: 'Google Gemini',
    blurb: 'Gemini chat plus image and video generation (Imagen / Veo).',
    protocol: 'gemini',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    supportsOAuth: false,
    keyUrl: 'https://aistudio.google.com/apikey',
    defaultModel: 'gemini-3-pro',
    suggestedModels: ['gemini-3-pro', 'gemini-3.5-flash', 'gemini-2.5-pro'],
    capabilities: { chat: true, image: true, video: true },
  },
  xai: {
    kind: 'xai',
    name: 'xAI (Grok)',
    blurb: 'Grok chat and image generation with an xAI key or subscription API.',
    protocol: 'openai',
    baseUrl: 'https://api.x.ai/v1',
    supportsOAuth: false,
    keyUrl: 'https://console.x.ai',
    // grok-4 was retired by xAI 2026-05-15; grok-4.3 is the current flagship.
    defaultModel: 'grok-4.3',
    suggestedModels: ['grok-4.3', 'grok-4-fast', 'grok-3-mini'],
    capabilities: { chat: true, image: true, video: false },
  },
  zai: {
    kind: 'zai',
    name: 'Z.ai (GLM)',
    blurb:
      'GLM models with a Z.ai key — GLM Coding Plan keys work too (that plan IS the subscription; paste its key here).',
    protocol: 'openai',
    // Coding Plan endpoint (the common case). Pay-as-you-go keys instead use
    // https://api.z.ai/api/paas/v4 — settable via the base URL override.
    baseUrl: 'https://api.z.ai/api/coding/paas/v4',
    supportsOAuth: false,
    keyUrl: 'https://z.ai/manage-apikey/apikey-list',
    defaultModel: 'glm-5.2',
    suggestedModels: ['glm-5.2', 'glm-5.1', 'glm-5', 'glm-4.7'],
    capabilities: { chat: true, image: false, video: false },
  },
  fal: {
    kind: 'fal',
    name: 'fal.ai',
    blurb: 'Cloud rendering for images and video — pay only for what you make.',
    // Media-only: fal never chats, so it stays out of PROVIDER_ORDER (the
    // chat Connect screen). Its home is the Media Lab setup walkthrough.
    protocol: 'openai',
    baseUrl: 'https://queue.fal.run',
    supportsOAuth: false,
    keyUrl: 'https://fal.ai/dashboard/keys',
    defaultModel: '',
    suggestedModels: [],
    capabilities: { chat: false, image: true, video: true },
  },
  custom: {
    kind: 'custom',
    name: 'Custom (OpenAI-compatible)',
    blurb: 'Any OpenAI-compatible endpoint: Ollama, LM Studio, vLLM, a proxy…',
    protocol: 'openai',
    baseUrl: '',
    supportsOAuth: false,
    defaultModel: '',
    suggestedModels: [],
    capabilities: { chat: true, image: false, video: false },
  },
};

export const PROVIDER_ORDER: ProviderKind[] = [
  'openrouter',
  'anthropic',
  'openai',
  'gemini',
  'xai',
  'zai',
  'custom',
];
