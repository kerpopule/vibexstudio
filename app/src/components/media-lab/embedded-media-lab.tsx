/**
 * The paired Media Lab, inside Create on phones: the studio page in a WebView
 * (web and desktop use embedded-media-lab.web.tsx, an iframe).
 *
 * The WebView starts at the studio's `/embed` handshake page. When it asks for
 * a ticket, the app mints one with its device pass and injects it through the
 * page's native bridge — only while the WebView is still on the studio's own
 * origin, and the injected script checks that again before handing it over.
 * Server side: media-lab/media_lab_core/embed_gate.py.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';

import { EmbedProblem, EmbedSignIn, type EmbedState } from '@/components/media-lab/embed-overlays';
import { useEmbedHandshake } from '@/components/media-lab/use-embed-handshake';
import { useTheme } from '@/hooks/use-theme';
import { embedEntryUrl, hostLabel, messageOrigin, nativeDeliverScript, parseFrameMessage, type AppMessage, type EmbedPage } from '@/lib/media-lab-embed';
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
  const webRef = useRef<WebView>(null);
  const currentOrigin = useRef<string | null>(null);
  const [retry, setRetry] = useState(0);
  const loadKey = `${src}#${reloadKey}#${retry}`;

  const send = useCallback((message: AppMessage) => {
    // Never inject into a page that is not the studio.
    if (!origin || currentOrigin.current !== origin) return;
    webRef.current?.injectJavaScript(nativeDeliverScript(origin, message));
  }, [origin]);
  const { state, handle, deliver } = useEmbedHandshake({ serverUrl, loadKey, send, onPage });

  useEffect(() => { onState?.(state); }, [state, onState]);

  const onMessage = useCallback((event: WebViewMessageEvent) => {
    const from = messageOrigin(event.nativeEvent.url);
    currentOrigin.current = from;
    if (!origin || from !== origin) return;
    const message = parseFrameMessage(event.nativeEvent.data);
    if (message) handle(message);
  }, [origin, handle]);

  if (!src || !origin) return null;

  return (
    <View style={[styles.container, { backgroundColor: theme.background }]}>
      <WebView
        key={loadKey}
        ref={webRef}
        source={{ uri: src }}
        style={styles.web}
        onMessage={onMessage}
        onNavigationStateChange={(nav) => { currentOrigin.current = messageOrigin(nav.url); }}
        allowsBackForwardNavigationGestures
        sharedCookiesEnabled
        mediaPlaybackRequiresUserAction={false}
        allowsInlineMediaPlayback
      />
      {state === 'sign-in' ? (
        <EmbedSignIn serverUrl={serverUrl} host={hostLabel(serverUrl)} onSignedIn={() => void deliver()} />
      ) : state === 'blocked' || state === 'not-allowed' || state === 'timeout' || state === 'failed' ? (
        <EmbedProblem state={state} openUrl={`${origin}/`} onRetry={() => setRetry(value => value + 1)} />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  web: { flex: 1, backgroundColor: 'transparent' },
});
