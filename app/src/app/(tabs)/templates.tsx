import Ionicons from '@expo/vector-icons/Ionicons';
import { randomUUID } from 'expo-crypto';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Linking,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { WebView, type WebViewMessageEvent, type WebViewNavigation } from 'react-native-webview';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Button } from '@/components/ui/button';
import { Glass } from '@/components/ui/glass';
import { EmojiTile } from '@/components/ui/emoji-tile';
import { Radii, Shadows, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useChat } from '@/lib/chat-engine';
import {
  buildDesignReferenceFromCapture,
  classifyReferoNavigation,
  completeExistingProjectDesignHandoff,
  isEligibleReferoStyleUrl,
  resolveTemplateSelectionDestination,
} from '@/lib/design/references';
import {
  buildReferoCaptureScript,
  consumeReferoCaptureMessage,
  createPendingReferoCapture,
  type PendingReferoCapture,
} from '@/lib/design/refero-capture';
import { REFERO_MEDIA_POLICY_SCRIPT, referoWebViewMediaProps } from '@/lib/design/refero-media-policy';
import { useApp } from '@/lib/store';
import type { DesignReference } from '@/lib/types';

const REFERO_HOME = 'https://styles.refero.design/';

export default function TemplatesScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const webRef = useRef<WebView>(null);
  const { projectId } = useLocalSearchParams<{ projectId?: string }>();
  const projects = useApp((state) => state.projects);
  const setPendingDesignReference = useApp((state) => state.setPendingDesignReference);
  const setProjectDesignReference = useApp((state) => state.setProjectDesignReference);
  const [currentUrl, setCurrentUrl] = useState(REFERO_HOME);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [capturing, setCapturing] = useState(false);
  const [pendingChoice, setPendingChoice] = useState<DesignReference | null>(null);
  const captureTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingCapture = useRef<PendingReferoCapture | null>(null);

  const selectionEligible = isEligibleReferoStyleUrl(currentUrl);
  const sortedProjects = useMemo(
    () => [...projects].sort((a, b) => b.updatedAt - a.updatedAt),
    [projects]
  );

  useEffect(
    () => () => {
      if (captureTimer.current) clearTimeout(captureTimer.current);
      pendingCapture.current = null;
    },
    []
  );

  const retry = () => {
    setLoadError(null);
    setLoading(true);
    webRef.current?.reload();
  };

  const openExternal = (url: string) => {
    let host = 'external site';
    try {
      host = new URL(url).hostname;
    } catch {
      return;
    }
    Alert.alert('Open external link?', `This leaves the Refero browser and opens ${host}.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Open',
        onPress: async () => {
          if (await Linking.canOpenURL(url)) await Linking.openURL(url);
        },
      },
    ]);
  };

  const allowNavigation = (url: string): boolean => {
    const disposition = classifyReferoNavigation(url);
    if (disposition === 'browse' || disposition === 'selectable-style') return true;
    if (disposition === 'external') openExternal(url);
    return false;
  };

  const chooseDesign = () => {
    if (!selectionEligible || capturing) return;
    const request = createPendingReferoCapture(currentUrl, randomUUID(), randomUUID());
    pendingCapture.current = request;
    setCapturing(true);
    if (captureTimer.current) clearTimeout(captureTimer.current);
    captureTimer.current = setTimeout(() => {
      if (pendingCapture.current?.requestId !== request.requestId) return;
      pendingCapture.current = null;
      captureTimer.current = null;
      setCapturing(false);
      Alert.alert('Design capture unavailable', 'Refero did not expose readable style details on this page. Nothing was attached.');
    }, 5_000);
    webRef.current?.injectJavaScript(buildReferoCaptureScript(request));
  };

  const attachToProject = async (id: string, reference: DesignReference) => {
    try {
      await completeExistingProjectDesignHandoff(id, reference, {
        persistDesignAndAppendHandoff: setProjectDesignReference,
        reloadChat: (projectIdToReload) => useChat.getState().reload(projectIdToReload),
        routeToProject: (destination) => {
          setPendingChoice(null);
          router.replace({ pathname: destination.pathname, params: destination.params });
        },
      });
    } catch (error) {
      Alert.alert('Could not attach design', error instanceof Error ? error.message : String(error));
    }
  };

  const startNewProject = (reference: DesignReference) => {
    setPendingDesignReference(reference);
    setPendingChoice(null);
    const destination = resolveTemplateSelectionDestination();
    router.push(destination.pathname);
  };

  const onMessage = (event: WebViewMessageEvent) => {
    const result = consumeReferoCaptureMessage(
      pendingCapture.current,
      currentUrl,
      event.nativeEvent.data
    );
    if (!result.ok) return;

    pendingCapture.current = result.pending;
    if (captureTimer.current) clearTimeout(captureTimer.current);
    captureTimer.current = null;
    setCapturing(false);
    try {
      const reference = buildDesignReferenceFromCapture(result.message.canonicalUrl, result.message.payload);
      if (projectId) {
        void attachToProject(projectId, reference);
      } else {
        setPendingChoice(reference);
      }
    } catch (error) {
      Alert.alert('This page is not selectable', error instanceof Error ? error.message : String(error));
    }
  };

  const onNavigationStateChange = (navigation: WebViewNavigation) => {
    pendingCapture.current = null;
    if (captureTimer.current) clearTimeout(captureTimer.current);
    captureTimer.current = null;
    setCapturing(false);
    setCurrentUrl(navigation.url);
    setLoading(navigation.loading);
    if (!navigation.loading) setLoadError(null);
  };

  return (
    <ThemedView style={styles.screen}>
      <View style={[styles.header, { paddingTop: insets.top + Spacing.two }]}>
        <View>
          <ThemedText type="title">Templates</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            Browse live Refero styles, then bring the visual language into VibeX.
          </ThemedText>
        </View>
        <View style={[styles.liveBadge, { backgroundColor: theme.tintSoft }]}>
          <View style={[styles.liveDot, { backgroundColor: theme.success }]} />
          <ThemedText type="smallBold" style={{ color: theme.tint }}>LIVE</ThemedText>
        </View>
      </View>

      <View style={[styles.browserShell, { borderColor: theme.border, backgroundColor: theme.backgroundElement }, Shadows.card]}>
        <WebView
          ref={webRef}
          source={{ uri: REFERO_HOME }}
          {...referoWebViewMediaProps}
          injectedJavaScriptBeforeContentLoaded={REFERO_MEDIA_POLICY_SCRIPT}
          injectedJavaScript={REFERO_MEDIA_POLICY_SCRIPT}
          style={styles.webView}
          onMessage={onMessage}
          onNavigationStateChange={onNavigationStateChange}
          onShouldStartLoadWithRequest={(request) => allowNavigation(request.url)}
          onOpenWindow={(event) => {
            const url = event.nativeEvent.targetUrl;
            if (classifyReferoNavigation(url) === 'external') openExternal(url);
            else if (allowNavigation(url)) webRef.current?.injectJavaScript(`location.href=${JSON.stringify(url)}; true;`);
          }}
          onLoadStart={() => {
            setLoading(true);
            setLoadError(null);
          }}
          onLoadEnd={() => setLoading(false)}
          onError={(event) => {
            setLoading(false);
            setLoadError(event.nativeEvent.description || 'Refero could not be reached.');
          }}
          onHttpError={(event) => {
            if (event.nativeEvent.url !== currentUrl) return;
            setLoading(false);
            setLoadError(`Refero returned HTTP ${event.nativeEvent.statusCode}.`);
          }}
          allowsBackForwardNavigationGestures
          javaScriptEnabled
          sharedCookiesEnabled={false}
          thirdPartyCookiesEnabled={false}
          setSupportMultipleWindows={false}
        />

        {loading && !loadError ? (
          <View style={[styles.overlay, { backgroundColor: theme.background }]} pointerEvents="none">
            <ActivityIndicator color={theme.tint} />
            <ThemedText type="small" themeColor="textSecondary">Loading Refero styles…</ThemedText>
          </View>
        ) : null}

        {loadError ? (
          <View style={[styles.overlay, { backgroundColor: theme.background }]}>
            <EmojiTile emoji="📡" size={48} />
            <ThemedText type="subtitle">Refero is offline</ThemedText>
            <ThemedText type="small" themeColor="textSecondary" style={styles.errorText}>
              {loadError}
            </ThemedText>
            <Button title="Retry" variant="secondary" onPress={retry} />
          </View>
        ) : null}
      </View>

      <Glass radius={Radii.xl} style={[styles.cta, { paddingBottom: Math.max(insets.bottom, Spacing.two) }]}>
        <View style={styles.ctaCopy}>
          <ThemedText type="smallBold">
            {selectionEligible ? 'Style detail ready' : 'Open a Refero style detail'}
          </ThemedText>
          <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
            {selectionEligible ? 'Capture its visible design language for a project.' : 'Search and previews stay live above.'}
          </ThemedText>
        </View>
        <Button
          title="Use this design"
          onPress={chooseDesign}
          loading={capturing}
          disabled={!selectionEligible || Boolean(loadError)}
          style={styles.ctaButton}
        />
      </Glass>

      <Modal
        visible={Boolean(pendingChoice)}
        transparent
        animationType="slide"
        onRequestClose={() => setPendingChoice(null)}>
        <Pressable style={styles.modalBackdrop} onPress={() => setPendingChoice(null)}>
          <Pressable
            accessibilityViewIsModal
            style={[styles.sheet, { backgroundColor: theme.background }]}
            onPress={(event) => event.stopPropagation()}>
            <View style={[styles.sheetHandle, { backgroundColor: theme.border }]} />
            <ThemedText type="title">Use {pendingChoice?.label}</ThemedText>
            <ThemedText themeColor="textSecondary">
              Start a new project or attach it to one you already have. Nothing generates until you answer in Chat.
            </ThemedText>
            {pendingChoice ? <Button title="Start a new project" onPress={() => startNewProject(pendingChoice)} /> : null}
            {sortedProjects.length ? (
              <>
                <ThemedText type="smallBold" themeColor="textSecondary">OR ATTACH TO</ThemedText>
                <ScrollView style={styles.projectList} contentContainerStyle={styles.projectListContent}>
                  {sortedProjects.map((project) => (
                    <Pressable
                      key={project.id}
                      accessibilityRole="button"
                      onPress={() => pendingChoice && void attachToProject(project.id, pendingChoice)}
                      style={[styles.projectRow, { backgroundColor: theme.backgroundElement, borderColor: theme.border }]}>
                      <ThemedText style={styles.projectEmoji}>{project.emoji}</ThemedText>
                      <View style={styles.projectBody}>
                        <ThemedText type="smallBold" numberOfLines={1}>{project.name}</ThemedText>
                        <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
                          {project.designReference ? `Replace ${project.designReference.label}` : 'Attach design language'}
                        </ThemedText>
                      </View>
                      <Ionicons name="chevron-forward" size={18} color={theme.textSecondary} />
                    </Pressable>
                  ))}
                </ScrollView>
              </>
            ) : null}
            <Button title="Cancel" variant="secondary" onPress={() => setPendingChoice(null)} />
          </Pressable>
        </Pressable>
      </Modal>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  header: {
    paddingHorizontal: Spacing.three,
    paddingBottom: Spacing.two,
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    gap: Spacing.two,
  },
  liveBadge: {
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  liveDot: { width: 7, height: 7, borderRadius: 4 },
  browserShell: {
    flex: 1,
    marginHorizontal: Spacing.two,
    borderRadius: Radii.lg,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  webView: { flex: 1, backgroundColor: 'transparent' },
  overlay: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.three,
    padding: Spacing.four,
  },
  errorText: { textAlign: 'center', maxWidth: 320 },
  cta: {
    margin: Spacing.two,
    marginBottom: Spacing.one,
    padding: Spacing.two,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  ctaCopy: { flex: 1, gap: 2 },
  ctaButton: { minWidth: 148 },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.48)',
    justifyContent: 'flex-end',
  },
  sheet: {
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    padding: Spacing.four,
    paddingBottom: 36,
    gap: Spacing.three,
    maxHeight: '78%',
  },
  sheetHandle: { width: 42, height: 5, borderRadius: 3, alignSelf: 'center' },
  projectList: { maxHeight: 270 },
  projectListContent: { gap: Spacing.two },
  projectRow: {
    minHeight: 58,
    borderRadius: Radii.md,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: Spacing.three,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
  },
  projectEmoji: { fontSize: 24 },
  projectBody: { flex: 1, gap: 2 },
});
