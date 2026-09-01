/**
 * One-shot loopback OAuth catcher. Some vendors (OpenAI's Codex login) only
 * redirect to `http://localhost:<port>/…`. On a phone nothing usually
 * listens there — so for the few seconds a sign-in takes, VibeX does. The
 * in-app browser lands on our tiny "you're signed in" page, we capture the
 * `code`, and the listener closes itself. Reuses the Agent Connect HTTP
 * server, so it inherits its request limits.
 */
import { startLocalHttpServer, type LocalHttpServer } from '@/lib/agent-connect/http-server';

export interface LoopbackCapture {
  /** Resolves with the full callback URL (path + query) once it arrives. */
  result: Promise<string>;
  cancel: () => void;
}

const DONE_PAGE = (ok: boolean) => `<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1">
<title>VibeX Studio</title>
<style>html{background:#0B0806;color:#fff;font:500 17px/1.5 -apple-system,system-ui,sans-serif}
body{margin:0;min-height:100dvh;display:grid;place-items:center;text-align:center;padding:32px}
h1{font-size:28px;margin:0 0 8px;letter-spacing:-.4px}p{margin:0;opacity:.78}
a{display:inline-block;margin-top:22px;padding:14px 22px;border-radius:999px;background:#5EC2FF;color:#04121C;text-decoration:none;font-weight:700}</style>
<div><h1>${ok ? 'Signed in ✓' : 'Sign-in failed'}</h1><p>${ok ? 'You can close this and head back to VibeX Studio.' : 'Head back to VibeX Studio and try again.'}</p><a href="vibex://oauth-done">Back to VibeX Studio</a></div>`;

export function captureLoopbackCallback(port: number, path: string, timeoutMs: number): LoopbackCapture {
  let server: LocalHttpServer | null = null;
  let settled = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let resolveResult!: (url: string) => void;
  let rejectResult!: (error: Error) => void;
  const result = new Promise<string>((resolve, reject) => {
    resolveResult = resolve;
    rejectResult = reject;
  });

  const finish = (fn: () => void) => {
    if (settled) return;
    settled = true;
    if (timer) clearTimeout(timer);
    server?.close();
    server = null;
    fn();
  };

  startLocalHttpServer(port, async (request) => {
    const [reqPath, query = ''] = request.path.split('?');
    if (request.method !== 'GET' || reqPath !== path) {
      return { status: 404, body: '{"error":"not the callback"}' };
    }
    const ok = !/(^|&)error=/.test(query);
    // Answer first, then settle: the browser gets its page either way.
    setTimeout(() => finish(() => resolveResult(`http://localhost:${port}${request.path}`)), 30);
    return { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' }, body: DONE_PAGE(ok) };
  })
    .then((started) => {
      if (settled) {
        started.close();
        return;
      }
      server = started;
    })
    .catch((error: unknown) => finish(() => rejectResult(error instanceof Error ? error : new Error(String(error)))));

  timer = setTimeout(() => finish(() => rejectResult(new Error('Timed out waiting for the sign-in to come back.'))), timeoutMs);

  return {
    result,
    cancel: () => finish(() => rejectResult(new Error('cancelled'))),
  };
}

export const LOOPBACK_SUPPORTED = true;
