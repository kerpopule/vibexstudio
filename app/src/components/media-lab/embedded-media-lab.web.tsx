/**
 * The paired Media Lab, inside Create on web and desktop (Metro resolves
 * `.web.tsx` here; the phone uses embedded-media-lab.tsx).
 *
 * An iframe of the studio's `/embed` handshake page. The app answers only
 * messages that come from this iframe's window AND from the studio's exact
 * origin, and addresses everything it sends to that origin, so a ticket can
 * never reach another page. The studio decides who may frame it (CSP
 * frame-ancestors): see media-lab/media_lab_core/embed_gate.py.
 */
import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import { StyleSheet, View } from 'react-native';

import { EmbedProblem, EmbedSignIn, type EmbedState } from '@/components/media-lab/embed-overlays';
import { useEmbedHandshake } from '@/components/media-lab/use-embed-handshake';
import { useTheme } from '@/hooks/use-theme';
import { embedEntryUrl, frameEnvelope, hostLabel, parseFrameMessage, type AppMessage, type EmbedPage } from '@/lib/media-lab-embed';
import { mediaServerOrigin } from '@/lib/medialab-core';

export type EmbeddedMediaLabProps = {
  serverUrl: string;
  /** A studio page to open instead of the home (Cut after an upload, a finished job). */
  page: string | null;
  /** Bumped by the app's reload button. */
  reloadKey: number;
  onPage?: (page: EmbedPage) => void;
  onState?: (state: EmbedState) => void;
};

export function EmbeddedMediaLab({ serverUrl, page, reloadKey, onPage, onState }: EmbeddedMediaLabProps) {
  const theme = useTheme();
  const origin = mediaServerOrigin(serverUrl);
  const src = embedEntryUrl(serverUrl, page);
  const frameRef = useRef<HTMLIFrameElement | null>(null);
  const [retry, setRetry] = useState(0);
  const loadKey = `${src}#${reloadKey}#${retry}`;

  const send = useCallback((message: AppMessage) => {
    const target = frameRef.current?.contentWindow;
    if (target && origin) target.postMessage(frameEnvelope(message), origin);
  }, [origin]);
  const { state, handle, deliver } = useEmbedHandshake({ serverUrl, loadKey, send, onPage });

  useEffect(() => { onState?.(state); }, [state, onState]);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      const frame = frameRef.current?.contentWindow;
      if (!frame || event.source !== frame || event.origin !== origin) return;
      const message = parseFrameMessage(event.data);
      if (message) handle(message);
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [origin, handle]);

  if (!src || !origin) return null;
  const home = `${origin}/`;

  return (
    <View style={[styles.container, { backgroundColor: theme.background }]}>
      <iframe
        key={loadKey}
        ref={frameRef}
        src={src}
        title="Media Lab"
        // Delegated to the studio's own origin only (the allow attribute's default).
        allow="autoplay; fullscreen; clipboard-read; clipboard-write; microphone; camera"
        referrerPolicy="strict-origin-when-cross-origin"
        style={frameStyle}
      />
      {state === 'sign-in' ? (
        <EmbedSignIn serverUrl={serverUrl} host={hostLabel(serverUrl)} onSignedIn={() => void deliver()} />
      ) : state === 'blocked' || state === 'not-allowed' || state === 'timeout' || state === 'failed' ? (
        <EmbedProblem
          state={state}
          openUrl={home}
          appOrigin={typeof window !== 'undefined' ? window.location.origin : null}
          onRetry={() => setRetry(value => value + 1)}
        />
      ) : null}
    </View>
  );
}

const frameStyle: CSSProperties = { border: 0, width: '100%', height: '100%', display: 'block', background: 'transparent' };

const styles = StyleSheet.create({
  container: { flex: 1 },
});
