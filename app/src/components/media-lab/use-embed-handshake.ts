/**
 * The app's side of the Media Lab frame handshake, shared by the web iframe
 * and the phone WebView: answer the frame's ticket request with a one-time
 * ticket (or ask for the code once), follow which studio page is showing, and
 * notice a frame that never answers.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

import type { EmbedState } from '@/components/media-lab/embed-overlays';
import type { AppMessage, EmbedPage, FrameMessage } from '@/lib/media-lab-embed';
import { requestEmbedTicket } from '@/lib/remote-generation';

/** How long a frame may stay silent before the app offers a way out. */
export const FRAME_SILENCE_MS = 15_000;

export function useEmbedHandshake({ serverUrl, loadKey, send, onPage }: {
  serverUrl: string;
  /** Changes whenever the frame (re)loads: a new page, a reload. */
  loadKey: string;
  /** Deliver a message to the studio frame, addressed to its exact origin. */
  send: (message: AppMessage) => void;
  onPage?: (page: EmbedPage) => void;
}) {
  // The state belongs to one load of the frame: a new load starts at 'opening'.
  const [record, setRecord] = useState<{ key: string; state: EmbedState }>({ key: loadKey, state: 'opening' });
  const state: EmbedState = record.key === loadKey ? record.state : 'opening';
  const keyRef = useRef(loadKey);
  const alive = useRef(false);
  const delivering = useRef(false);
  const sendRef = useRef(send);
  const pageRef = useRef(onPage);
  useEffect(() => { sendRef.current = send; pageRef.current = onPage; }, [send, onPage]);

  const setState = useCallback((next: EmbedState | ((previous: EmbedState) => EmbedState)) => {
    setRecord(previous => {
      const base = previous.key === keyRef.current ? previous.state : 'opening';
      return { key: keyRef.current, state: typeof next === 'function' ? next(base) : next };
    });
  }, []);

  useEffect(() => {
    keyRef.current = loadKey;
    alive.current = false;
    const timer = setTimeout(() => {
      if (!alive.current) setState('timeout');
    }, FRAME_SILENCE_MS);
    return () => clearTimeout(timer);
  }, [loadKey, setState]);

  const deliver = useCallback(async () => {
    if (delivering.current) return;
    delivering.current = true;
    setState('signing-in');
    try {
      const result = await requestEmbedTicket(serverUrl);
      if (result.ok) {
        sendRef.current({ type: 'ticket', ticket: result.ticket });
        return;
      }
      sendRef.current({ type: 'no-ticket' });
      setState(result.reason === 'no-pass' || result.reason === 'pass-refused' ? 'sign-in'
        : result.reason === 'origin-not-allowed' ? 'not-allowed' : 'failed');
    } finally {
      delivering.current = false;
    }
  }, [serverUrl, setState]);

  const handle = useCallback((message: FrameMessage) => {
    alive.current = true;
    switch (message.type) {
      case 'hello':
        setState(previous => (previous === 'timeout' ? 'opening' : previous));
        break;
      case 'need-ticket':
        void deliver();
        break;
      case 'signed-in':
        setState('ready');
        break;
      case 'ready':
        setState('ready');
        pageRef.current?.(message.page);
        break;
      case 'blocked':
        setState('blocked');
        break;
      case 'failed':
        setState('failed');
        break;
    }
  }, [deliver, setState]);

  return { state, handle, deliver };
}
