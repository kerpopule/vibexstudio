/**
 * Unified streaming chat across all supported wire protocols
 * (OpenAI-compatible, Anthropic Messages, Gemini generateContent).
 */
import { PROVIDERS, type WireProtocol } from '@/lib/ai/registry';
import { MODEL_STREAM_TIMEOUT_MS, openAiRequestPolicy } from '@/lib/ai/request-policy';
import { ssePost } from '@/lib/ai/sse';
import { chatGptAccountIdFromToken, SUBSCRIPTION_PROVIDERS } from '@/lib/ai/subscriptionOauth';
import { assertPrivateProviderOrigin, privateBackendNotice, PRIVATE_ALLOWED_MODELS } from '@/lib/private-provider/profile';
import { getPrivateDeviceProof } from '@/lib/storage/secrets';
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
  if (connection.privateProvider) assertPrivateProviderOrigin(connection.baseUrl);
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
    case 'codex':
      return streamCodex(routing, opts);
  }
}

/**
 * ChatGPT subscription path: the Codex backend speaks the Responses API and
 * streams `response.output_text.delta` events. Reasoning summaries arrive on
 * their own event and are shown as thinking, never joined to the output.
 */
async function streamCodex(routing: Routing, opts: StreamChatOptions): Promise<string> {
  let text = '';
  let thinking = '';
  const accountId = chatGptAccountIdFromToken(opts.secret);
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${opts.secret}`,
    ...routing.extraHeaders,
  };
  if (accountId) headers['chatgpt-account-id'] = accountId;
  await ssePost({
    url: `${routing.baseUrl}/responses`,
    headers,
    body: {
      model: opts.model,
      instructions: opts.system,
      input: opts.messages.map((m) => ({
        type: 'message',
        role: m.role,
        content: [{ type: m.role === 'assistant' ? 'output_text' : 'input_text', text: m.content }],
      })),
      stream: true,
      store: false,
    },
    signal: opts.signal,
    timeoutMs: MODEL_STREAM_TIMEOUT_MS,
    onEvent: (data) => {
      let event: any;
      try {
        event = JSON.parse(data);
      } catch {
        return; // keep-alive noise
      }
      const type = typeof event?.type === 'string' ? event.type : '';
      if (type === 'response.output_text.delta' && typeof event.delta === 'string') {
        text += event.delta;
        opts.onDelta(text);
      } else if (type.startsWith('response.reasoning') && type.endsWith('.delta') && typeof event.delta === 'string') {
        if (!text) {
          thinking += event.delta;
          opts.onDelta(`💭 ${thinking}`);
        }
      } else if (type === 'response.failed' || type === 'error') {
        const message = event?.response?.error?.message ?? event?.error?.message ?? event?.message;
        throw new Error(typeof message === 'string' ? message : 'ChatGPT stream error');
      }
    },
  });
  if (!text.trim()) throw new Error('The model returned an empty stream. No project changes were applied.');
  return text;
}

async function streamOpenAi(routing: Routing, opts: StreamChatOptions): Promise<string> {
  let text = '';
  let thinking = '';
  let backendModel: string | null = null;
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${opts.secret}`,
    ...routing.extraHeaders,
  };
  if (routing.isOpenRouter) {
    headers['HTTP-Referer'] = 'https://github.com/kerpopule/vibex-studio';
    headers['X-Title'] = 'VibeXStudio';
  }
  if (opts.connection.privateProvider) {
    if (!PRIVATE_ALLOWED_MODELS.includes(opts.model as typeof PRIVATE_ALLOWED_MODELS[number]) ||
        !opts.connection.privateProvider.allowedModels.includes(opts.model)) {
      throw new Error('That model is not allowed for this private grant.');
    }
    const deviceProof = await getPrivateDeviceProof(opts.connection.id);
    if (!deviceProof) throw new Error('Private device proof is missing from Keychain.');
    headers['X-VibeX-Device-Proof'] = deviceProof;
  }
  const baseUrl = routing.baseUrl;
  const requestPolicy = openAiRequestPolicy(opts.connection, opts.model, routing.isOpenRouter);
  await ssePost({
    url: `${baseUrl}/chat/completions`,
    headers,
    body: {
      model: opts.model,
      stream: true,
      ...requestPolicy,
      messages: [{ role: 'system', content: opts.system }, ...opts.messages],
    },
    signal: opts.signal,
    timeoutMs: MODEL_STREAM_TIMEOUT_MS,
    onHeaders: (get) => { backendModel = get('X-VibeX-Backend-Model'); },
    onEvent: (data) => {
      try {
        const delta = JSON.parse(data)?.choices?.[0]?.delta;
        if (typeof delta?.content === 'string' && delta.content) {
          text += delta.content;
          opts.onDelta(text);
          return;
        }
        // Reasoning models (Grok 4.x, GLM flash, o-series via OpenRouter)
        // think for minutes on a separate channel before any content —
        // surface it so the stream card never sits empty. Thinking is
        // display-only: it never joins `text`, so the file parser only
        // ever sees real output.
        const thought = delta?.reasoning_content ?? delta?.reasoning;
        if (typeof thought === 'string' && thought && !text) {
          thinking += thought;
          opts.onDelta(`💭 ${thinking}`);
        }
      } catch {
        // Ignore malformed keep-alive chunks.
      }
    },
  });
  if (!text.trim()) throw new Error('The model returned an empty stream. No project changes were applied.');
  const notice = opts.connection.privateProvider ? privateBackendNotice(opts.model, backendModel) : null;
  if (notice) text = `${notice}\n\n${text}`;
  return text;
}

async function streamAnthropic(routing: Routing, opts: StreamChatOptions): Promise<string> {
  let text = '';
  let thinking = '';
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
        } else if (event.type === 'content_block_delta' && event.delta?.type === 'thinking_delta') {
          // Extended-thinking models: stream the thought so the card moves.
          if (typeof event.delta.thinking === 'string' && !text) {
            thinking += event.delta.thinking;
            opts.onDelta(`💭 ${thinking}`);
          }
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
