/**
 * Unified streaming chat across all supported wire protocols
 * (OpenAI-compatible, Anthropic Messages, Gemini generateContent).
 */
import { PROVIDERS, type WireProtocol } from '@/lib/ai/registry';
import { ssePost } from '@/lib/ai/sse';
import { SUBSCRIPTION_PROVIDERS } from '@/lib/ai/subscriptionOauth';
import type { ChatRole, ProviderConnection } from '@/lib/types';

/** Where + how to reach a connection's inference endpoint. */
interface Routing {
  baseUrl: string;
  protocol: WireProtocol;
  /** Subscription endpoints all take a bearer token, even Anthropic-shaped ones. */
  bearerAuth: boolean;
  extraHeaders?: Record<string, string>;
  isOpenRouter: boolean;
}

export function resolveRouting(connection: ProviderConnection): Routing {
  if (connection.subscription) {
    const spec = SUBSCRIPTION_PROVIDERS[connection.subscription];
    return {
      baseUrl: spec.inferenceBaseUrl.replace(/\/+$/, ''),
      protocol: spec.protocol,
      bearerAuth: true,
      extraHeaders: spec.inferenceHeaders,
      isOpenRouter: false,
    };
  }
  const spec = PROVIDERS[connection.kind];
  return {
    baseUrl: (connection.baseUrl || spec.baseUrl).replace(/\/+$/, ''),
    protocol: spec.protocol,
    bearerAuth: false,
    isOpenRouter: connection.kind === 'openrouter',
  };
}

export interface WireMessage {
  role: ChatRole;
  content: string;
}

export interface StreamChatOptions {
  connection: ProviderConnection;
  secret: string;
  model: string;
  system: string;
  messages: WireMessage[];
  onDelta: (textSoFar: string) => void;
  signal?: AbortSignal;
}

/** Streams a completion; resolves with the full assistant text. */
export async function streamChat(opts: StreamChatOptions): Promise<string> {
  const routing = resolveRouting(opts.connection);
  switch (routing.protocol) {
    case 'openai':
      return streamOpenAi(routing, opts);
    case 'anthropic':
      return streamAnthropic(routing, opts);
    case 'gemini':
      return streamGemini(routing.baseUrl, opts);
  }
}

async function streamOpenAi(routing: Routing, opts: StreamChatOptions): Promise<string> {
  let text = '';
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${opts.secret}`,
    ...routing.extraHeaders,
  };
  if (routing.isOpenRouter) {
    headers['HTTP-Referer'] = 'https://github.com/kerpopule/vibex-studio';
    headers['X-Title'] = 'VibeXStudio';
  }
  const baseUrl = routing.baseUrl;
  await ssePost({
    url: `${baseUrl}/chat/completions`,
    headers,
    body: {
      model: opts.model,
      stream: true,
      messages: [{ role: 'system', content: opts.system }, ...opts.messages],
    },
    signal: opts.signal,
    onEvent: (data) => {
      try {
        const delta = JSON.parse(data)?.choices?.[0]?.delta?.content;
        if (typeof delta === 'string') {
          text += delta;
          opts.onDelta(text);
        }
      } catch {
        // Ignore malformed keep-alive chunks.
      }
    },
  });
  return text;
}

async function streamAnthropic(routing: Routing, opts: StreamChatOptions): Promise<string> {
  let text = '';
  // Direct Anthropic uses x-api-key; subscription Anthropic-compatible
  // endpoints (MiniMax) take a bearer token instead.
  const authHeaders: Record<string, string> = routing.bearerAuth
    ? { Authorization: `Bearer ${opts.secret}` }
    : { 'x-api-key': opts.secret };
  await ssePost({
    url: `${routing.baseUrl}/v1/messages`,
    headers: {
      'Content-Type': 'application/json',
      ...authHeaders,
      'anthropic-version': '2023-06-01',
      ...routing.extraHeaders,
    },
    body: {
      model: opts.model,
      max_tokens: 32000,
      stream: true,
      system: opts.system,
      messages: opts.messages.map((m) => ({ role: m.role, content: m.content })),
    },
    signal: opts.signal,
    onEvent: (data) => {
      try {
        const event = JSON.parse(data);
        if (event.type === 'content_block_delta' && event.delta?.type === 'text_delta') {
          text += event.delta.text;
          opts.onDelta(text);
        } else if (event.type === 'error') {
          throw new Error(event.error?.message ?? 'Anthropic stream error');
        }
      } catch (e) {
        if (e instanceof SyntaxError) return; // keep-alive noise
        throw e;
      }
    },
  });
  return text;
}

async function streamGemini(baseUrl: string, opts: StreamChatOptions): Promise<string> {
  let text = '';
  await ssePost({
    url: `${baseUrl}/models/${encodeURIComponent(opts.model)}:streamGenerateContent?alt=sse`,
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': opts.secret,
    },
    body: {
      systemInstruction: { parts: [{ text: opts.system }] },
      contents: opts.messages.map((m) => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: m.content }],
      })),
    },
    signal: opts.signal,
    onEvent: (data) => {
      try {
        const parts = JSON.parse(data)?.candidates?.[0]?.content?.parts;
        if (Array.isArray(parts)) {
          for (const part of parts) {
            if (typeof part?.text === 'string') text += part.text;
          }
          opts.onDelta(text);
        }
      } catch {
        // Ignore malformed chunks.
      }
    },
  });
  return text;
}

/** Quick non-streaming sanity check used when a connection is added. */
export async function testConnection(connection: ProviderConnection, secret: string): Promise<void> {
  await streamChat({
    connection,
    secret,
    model: connection.defaultModel,
    system: 'You are a connection test. Reply with the single word: ok',
    messages: [{ role: 'user', content: 'ping' }],
    onDelta: () => {},
  });
}
