import Ionicons from '@expo/vector-icons/Ionicons';
import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import { LinearGradient } from 'expo-linear-gradient';
import {
  ExpoSpeechRecognitionModule,
  useSpeechRecognitionEvent,
} from 'expo-speech-recognition';
import { useEffect, useRef, useState } from 'react';
import { router } from 'expo-router';
import {
  ActionSheetIOS,
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ChatBubble } from '@/components/chat-bubble';
import { StreamWheel } from '@/components/stream-wheel';
import { ThemedText } from '@/components/themed-text';
import { Glass } from '@/components/ui/glass';
import { ScalePress } from '@/components/ui/scale-press';
import { gradientColors, Radii, Shadows, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { providerGlyph, shortModelLabel } from '@/lib/ai/models';
import { EMPTY_SESSION, useChat } from '@/lib/chat-engine';
import { useApp } from '@/lib/store';
import type { ChatMessage, ProjectMeta, ProviderConnection } from '@/lib/types';
import { enter } from '@/lib/motion';

type ComposeMode = 'chat' | 'image' | 'video';

const STARTER_IDEAS = [
  { emoji: '🍅', prompt: 'A pomodoro timer with a dark synthwave look' },
  { emoji: '💸', prompt: 'A tip calculator that splits the bill between friends' },
  { emoji: '🃏', prompt: 'Flashcards for learning Spanish, with flip animations' },
  { emoji: '🌦️', prompt: 'A cozy weather dashboard with animated icons' },
];

export function ChatView({ project }: { project: ProjectMeta }) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const providers = useApp((s) => s.providers);

  const refreshSubscriptionIfNeeded = useApp((s) => s.refreshSubscriptionIfNeeded);
  const refreshPrivateProviderIfNeeded = useApp((s) => s.refreshPrivateProviderIfNeeded);
  const session = useChat((s) => s.sessions[project.id]) ?? EMPTY_SESSION;
  const { load, sendChat, sendMedia, attachFile, abort } = useChat();
  const [input, setInput] = useState('');
  const [mode, setMode] = useState<ComposeMode>('chat');
  const [listening, setListening] = useState(false);
  const [connectionId, setConnectionId] = useState<string | null>(project.ai?.connectionId ?? null);
  const listRef = useRef<FlatList<ChatMessage>>(null);

  const chatProviders = providers.filter((p) => p.capabilities.chat);
  const connection: ProviderConnection | null =
    chatProviders.find((p) => p.id === connectionId) ?? chatProviders[0] ?? null;
  const imageProvider = providers.find((p) => p.capabilities.image) ?? null;
  const videoProvider = providers.find((p) => p.capabilities.video) ?? null;

  useEffect(() => {
    load(project.id);
  }, [project.id, load]);

  // Live dictation: stream interim transcripts straight into the input.
  useSpeechRecognitionEvent('result', (event) => {
    const transcript = event.results[0]?.transcript;
    if (typeof transcript === 'string') setInput(transcript);
  });
  useSpeechRecognitionEvent('end', () => setListening(false));
  useSpeechRecognitionEvent('error', () => setListening(false));

  const toggleDictation = async () => {
    if (listening) {
      ExpoSpeechRecognitionModule.stop();
      return;
    }
    const permission = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
    if (!permission.granted) {
      Alert.alert('Microphone unavailable', 'Enable microphone and speech recognition access in iOS Settings.');
      return;
    }
    setListening(true);
    ExpoSpeechRecognitionModule.start({ lang: 'en-US', interimResults: true, continuous: false });
  };

  const send = async () => {
    const text = input.trim();
    if (!text || session.busy) return;
    setInput('');
    const activeMode = mode;
    setMode('chat');
    // Top up a subscription token before ANY turn if it's about to expire —
    // media generation can run on a subscription provider too, not just chat.
    const turnProvider =
      activeMode === 'image' ? imageProvider : activeMode === 'video' ? videoProvider : connection;
    if (turnProvider?.subscription) await refreshSubscriptionIfNeeded(turnProvider.id).catch(() => {});
    if (turnProvider?.privateProvider) await refreshPrivateProviderIfNeeded(turnProvider.id);

    if (activeMode === 'image') await sendMedia(project, text, 'image', imageProvider);
    else if (activeMode === 'video') await sendMedia(project, text, 'video', videoProvider);
    else await sendChat(project, text, connection);
  };

  // Re-run the last user prompt with the currently-selected provider/model —
  // handy after swiping the bar to a different model.
  const hasUserMessage = session.messages.some((m) => m.role === 'user');
  const retryLast = async () => {
    if (session.busy) return;
    const lastUser = [...session.messages].reverse().find((m) => m.role === 'user');
    if (!lastUser) return;
    const text = lastUser.text.replace(/^Generate (image|video): /, '');
    if (connection?.subscription) await refreshSubscriptionIfNeeded(connection.id).catch(() => {});
    if (connection?.privateProvider) await refreshPrivateProviderIfNeeded(connection.id);
    await sendChat(project, text, connection);
  };

  // Background-interrupted turns are resumed app-wide by the chat engine's
  // AppState listener (chat-engine.ts) — nothing to do per-view.

  const pickFromLibrary = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images', 'videos'], quality: 0.9 });
    const asset = result.assets?.[0];
    if (!asset) return;
    const name = asset.fileName ?? `media-${Date.now()}.${asset.type === 'video' ? 'mp4' : 'jpg'}`;
    await attachFile(project, asset.uri, name, asset.type === 'video' ? 'video' : 'image');
  };

  const takePhoto = async () => {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) {
      Alert.alert('Camera unavailable', 'Enable camera access in iOS Settings.');
      return;
    }
    const result = await ImagePicker.launchCameraAsync({ quality: 0.9 });
    const asset = result.assets?.[0];
    if (!asset) return;
    await attachFile(project, asset.uri, asset.fileName ?? `photo-${Date.now()}.jpg`, 'image');
  };

  const pickDocument = async () => {
    const result = await DocumentPicker.getDocumentAsync({ copyToCacheDirectory: true });
    const asset = result.assets?.[0];
    if (!asset) return;
    await attachFile(project, asset.uri, asset.name);
  };

  const openAttachSheet = () => {
    const options: { label: string; action: () => void }[] = [
      { label: 'Photo library', action: pickFromLibrary },
      { label: 'Take photo', action: takePhoto },
      { label: 'Choose file', action: pickDocument },
    ];
    if (imageProvider) options.push({ label: '✨ Generate image…', action: () => setMode('image') });
    if (videoProvider) options.push({ label: '✨ Generate video…', action: () => setMode('video') });

    if (Platform.OS === 'ios') {
      ActionSheetIOS.showActionSheetWithOptions(
        { options: [...options.map((o) => o.label), 'Cancel'], cancelButtonIndex: options.length },
        (index) => {
          if (index < options.length) options[index].action();
        }
      );
    } else {
      Alert.alert('Add to project', undefined, [
        ...options.map((o) => ({ text: o.label, onPress: o.action })),
        { text: 'Cancel', style: 'cancel' as const },
      ]);
    }
  };

  const placeholder =
    mode === 'image'
      ? 'Describe the image to generate…'
      : mode === 'video'
        ? 'Describe the video to generate…'
        : listening
          ? 'Listening…'
          : session.messages.length === 0
            ? 'Describe the app you want to build…'
            : 'What should we change?';


  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      // Header (56) + tab bar (46) + status bar: what sits above this view.
      keyboardVerticalOffset={insets.top + 102}>

      {chatProviders.length > 0 ? (
        <View style={styles.barRow}>
          {/* Horizontal ScrollView (not a nested FlatList) so it can't collapse
              or fight the message list for the pan responder. Fixed height. */}
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            style={styles.providerBar}
            contentContainerStyle={styles.providerBarContent}>
            {chatProviders.map((item) => {
              const active = item.id === connection?.id;
              return (
                <Pressable
                  key={item.id}
                  // Tap to switch; tap the active one to change its model.
                  onPress={() =>
                    active
                      ? router.push({ pathname: '/edit-model', params: { connectionId: item.id } })
                      : setConnectionId(item.id)
                  }
                  style={[
                    styles.providerChip,
                    {
                      backgroundColor: active ? theme.tintSoft : theme.backgroundElement,
                      borderColor: active ? theme.tint : 'transparent',
                    },
                  ]}>
                  <ThemedText type="small">{providerGlyph(item)}</ThemedText>
                  <ThemedText
                    type="small"
                    numberOfLines={1}
                    style={active ? { color: theme.tint } : undefined}>
                    {shortModelLabel(item.defaultModel)}
                  </ThemedText>
                </Pressable>
              );
            })}
          </ScrollView>
          {hasUserMessage && !session.busy ? (
            <Pressable
              onPress={retryLast}
              hitSlop={8}
              style={[styles.retryBtn, { backgroundColor: theme.backgroundElement }]}>
              <Ionicons name="refresh" size={16} color={theme.textSecondary} />
            </Pressable>
          ) : null}
        </View>
      ) : null}

      <FlatList
        ref={listRef}
        data={session.messages}
        keyExtractor={(m) => m.id}
        renderItem={({ item }) => <ChatBubble message={item} />}
        contentContainerStyle={styles.messages}
        onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: true })}
        ListEmptyComponent={
          session.loaded ? (
            <View style={styles.hint}>
              <ThemedText type="subtitle" style={styles.hintTitle}>
                What should we build?
              </ThemedText>
              <ThemedText type="small" themeColor="textSecondary" style={styles.hintText}>
                Describe it in your own words, or riff on one of these:
              </ThemedText>
              <View style={styles.ideas}>
                {STARTER_IDEAS.map((idea, i) => (
                  <Animated.View key={idea.prompt} entering={enter(FadeInDown.delay(120 + i * 70).duration(350))}>
                    <ScalePress
                      onPress={() => setInput(idea.prompt)}
                      style={[styles.ideaChip, { backgroundColor: theme.backgroundElement }, Shadows.card]}>
                      <ThemedText style={styles.ideaEmoji}>{idea.emoji}</ThemedText>
                      <ThemedText type="small" style={styles.ideaText}>
                        {idea.prompt}
                      </ThemedText>
                    </ScalePress>
                  </Animated.View>
                ))}
              </View>
            </View>
          ) : null
        }
      />

      {session.busy ? <StreamWheel text={session.streamText ?? ''} onStop={() => abort(project.id)} /> : null}

      <Glass
        radius={Radii.xl}
        style={[
          styles.composer,
          { marginBottom: Math.max(insets.bottom, Spacing.two) + Spacing.one },
          Shadows.card,
        ]}>
        <Pressable onPress={openAttachSheet} style={styles.modeButton} hitSlop={6}>
          <Ionicons name="attach" size={22} color={theme.textSecondary} />
        </Pressable>
        {mode !== 'chat' ? (
          <Pressable
            onPress={() => setMode('chat')}
            style={[styles.modePill, { backgroundColor: theme.tintSoft }]}>
            <Ionicons name={mode === 'image' ? 'image' : 'videocam'} size={14} color={theme.tint} />
            <Ionicons name="close" size={14} color={theme.tint} />
          </Pressable>
        ) : null}
        <TextInput
          style={[styles.input, { color: theme.text }]}
          placeholder={placeholder}
          placeholderTextColor={theme.textSecondary}
          value={input}
          onChangeText={setInput}
          multiline
          editable={!session.busy}
        />
        <Pressable onPress={toggleDictation} style={styles.modeButton} hitSlop={6}>
          <Ionicons name={listening ? 'mic' : 'mic-outline'} size={22} color={listening ? theme.accent : theme.textSecondary} />
        </Pressable>
        <ScalePress
          onPress={send}
          disabled={session.busy || !input.trim()}
          pressedScale={0.9}
          style={[styles.sendShell, { opacity: session.busy || !input.trim() ? 0.45 : 1 }]}>
          <LinearGradient
            colors={gradientColors(theme)}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.sendButton}>
            <Ionicons name="arrow-up" size={20} color={theme.onGradient} />
          </LinearGradient>
        </ScalePress>
      </Glass>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  barRow: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 48,
    paddingRight: Spacing.two,
  },
  providerBar: {
    flexGrow: 1,
    flexShrink: 1,
  },
  providerBarContent: {
    alignItems: 'center',
    paddingHorizontal: Spacing.three,
    gap: Spacing.two,
  },
  providerChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    maxWidth: 180,
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  retryBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
  },
  messages: {
    paddingVertical: Spacing.two,
    flexGrow: 1,
  },
  hint: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.two,
    padding: Spacing.four,
  },
  hintTitle: {
    textAlign: 'center',
  },
  hintText: {
    textAlign: 'center',
    marginBottom: Spacing.two,
  },
  ideas: {
    gap: 10,
    alignSelf: 'stretch',
  },
  ideaChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two + 2,
    borderRadius: Radii.lg,
    paddingHorizontal: Spacing.three,
    paddingVertical: 12,
  },
  ideaEmoji: {
    fontSize: 20,
    lineHeight: 26,
  },
  ideaText: {
    flex: 1,
  },
  composer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 2,
    marginHorizontal: Spacing.two + 2,
    padding: 6,
  },
  modeButton: {
    width: 38,
    height: 40,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    borderRadius: Radii.pill,
    paddingHorizontal: 8,
    height: 28,
    alignSelf: 'center',
  },
  input: {
    flex: 1,
    paddingHorizontal: Spacing.two,
    paddingTop: 10,
    paddingBottom: 10,
    fontSize: 16,
    maxHeight: 120,
  },
  sendShell: {
    borderRadius: 20,
  },
  sendButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
