/**
 * Server-sent-events POST helper for React Native.
 *
 * RN's fetch does not expose response body streams reliably, but
 * XMLHttpRequest delivers incremental `responseText` via onprogress on both
 * platforms, which is all SSE needs.
 */

export interface SseRequest {
  url: string;
  headers: Record<string, string>;
  body: unknown;
  /** Called once per `data: …` event (JSON payloads, '[DONE]' is filtered out). */
  onEvent: (data: string) => void;
  /** Called once when response headers become readable. */
  onHeaders?: (get: (name: string) => string | null) => void;
  signal?: AbortSignal;
}

export function ssePost(req: SseRequest): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    let cursor = 0;
    let buffer = '';
    let sentHeaders = false;

    const emitHeaders = () => {
      if (!sentHeaders && xhr.readyState >= 2) {
        sentHeaders = true;
        req.onHeaders?.((name) => xhr.getResponseHeader(name));
      }
    };

    const pump = (final: boolean) => {
      const text = xhr.responseText ?? '';
      buffer += text.slice(cursor);
      cursor = text.length;
      // SSE events are separated by a blank line.
      let sep: number;
      while ((sep = buffer.search(/\r?\n\r?\n/)) !== -1) {
        const rawEvent = buffer.slice(0, sep);
        buffer = buffer.slice(sep).replace(/^\r?\n\r?\n/, '');
        dispatch(rawEvent);
      }
      if (final && buffer.trim()) dispatch(buffer);
    };

    const dispatch = (rawEvent: string) => {
      const data = rawEvent
        .split(/\r?\n/)
        .filter((line) => line.startsWith('data:'))
        .map((line) => line.slice(5).trimStart())
        .join('\n');
      if (data && data !== '[DONE]') req.onEvent(data);
    };

    xhr.open('POST', req.url);
    for (const [key, value] of Object.entries(req.headers)) xhr.setRequestHeader(key, value);
    xhr.setRequestHeader('Accept', 'text/event-stream');

    xhr.onreadystatechange = emitHeaders;
    xhr.onprogress = () => { emitHeaders(); pump(false); };
    xhr.onload = () => {
      emitHeaders();
      if (xhr.status >= 200 && xhr.status < 300) {
        pump(true);
        resolve();
      } else {
        reject(new Error(extractApiError(xhr.responseText, xhr.status)));
      }
    };
    xhr.onerror = () => reject(new Error('Network error while streaming from the model.'));
    xhr.onabort = () => reject(new DOMException('Aborted', 'AbortError'));

    if (req.signal) {
      if (req.signal.aborted) return reject(new DOMException('Aborted', 'AbortError'));
      req.signal.addEventListener('abort', () => xhr.abort(), { once: true });
    }

    xhr.send(JSON.stringify(req.body));
  });
}

export function extractApiError(responseText: string | null, status: number): string {
  if (responseText) {
    try {
      const data = JSON.parse(responseText);
      // Cover the common shapes: OpenAI/xAI/GLM ({error:{message}}), bare
      // {message}/{error}, GLM/Zhipu ({error:{code,message}} or {msg}),
      // MiniMax ({base_resp:{status_msg}}).
      const message =
        data?.error?.message ??
        data?.message ??
        data?.msg ??
        data?.base_resp?.status_msg ??
        (typeof data?.error === 'string' ? data.error : undefined);
      const code = data?.error?.code ?? data?.code;
      if (typeof message === 'string' && message) {
        return code ? `${message} (${code})` : message;
      }
    } catch {
      // Not JSON — fall through.
    }
  }
  if (status === 401 || status === 403) return 'The provider rejected your credentials. Check the API key in Settings.';
  if (status === 404) return 'Model or endpoint not found (HTTP 404) — try a different model in Settings.';
  if (status === 429) return 'Rate limited by the provider. Wait a moment and try again.';
  return `The model request failed (HTTP ${status}).`;
}
