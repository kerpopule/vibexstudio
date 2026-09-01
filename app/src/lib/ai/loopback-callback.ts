/**
 * Web/desktop build: the page can't open a socket, so there is no loopback
 * listener — the sign-in screen falls back to "paste the link". (The Tauri
 * shell can grow a native listener later; this module is the seam.)
 */
export interface LoopbackCapture {
  result: Promise<string>;
  cancel: () => void;
}

export function captureLoopbackCallback(_port: number, _path: string, _timeoutMs: number): LoopbackCapture {
  return {
    result: Promise.reject(new Error('Loopback listening is unavailable in this build.')),
    cancel: () => {},
  };
}

export const LOOPBACK_SUPPORTED = false;
