import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Animated, { FadeInUp } from 'react-native-reanimated';

import { Markdown } from '@/components/markdown';
import { ThemedText } from '@/components/themed-text';
import { ScalePress } from '@/components/ui/scale-press';
import { gradientColors, Radii, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import type { ChatMessage } from '@/lib/types';
import { enter } from '@/lib/motion';

export function ChatBubble({ message }: { message: ChatMessage }) {
  const theme = useTheme();
  const isUser = message.role === 'user';
  const isError = Boolean(message.error && message.error !== 'aborted');
  const [copied, setCopied] = useState(false);

  const copyText = async () => {
    if (!message.text) return;
    await Clipboard.setStringAsync(message.text);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  };

  const body = (
    <>
      {isUser ? (
        <ThemedText style={{ color: theme.onGradient }}>{message.text}</ThemedText>
      ) : (
        <Markdown text={message.text} />
      )}
      {message.error === 'no-provider' ? (
        <ScalePress
          onPress={() => router.push('/connect-provider')}
          style={[styles.cta, { backgroundColor: theme.tintSoft, borderColor: theme.tint }]}>
          <ThemedText type="smallBold" style={{ color: theme.tint }}>
            Set up your AI →
          </ThemedText>
        </ScalePress>
      ) : null}
      {message.attachments?.map((attachment) =>
        attachment.kind === 'image' ? (
          <Image key={attachment.uri} source={{ uri: attachment.uri }} style={styles.image} contentFit="cover" />
        ) : (
          <ThemedText key={attachment.uri} type="small" themeColor="textSecondary">
            🎬 Video saved to project media
          </ThemedText>
        )
      )}
    </>
  );

  return (
    <Animated.View
      entering={enter(FadeInUp.duration(280))}
      style={[styles.row, isUser ? styles.rowUser : styles.rowAssistant]}>
      {/* Long-press anywhere on a bubble copies its text. */}
      <Pressable onLongPress={copyText} delayLongPress={300}>
        {isUser ? (
          <LinearGradient
            colors={gradientColors(theme)}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={[styles.bubble, styles.bubbleUser]}>
            {body}
          </LinearGradient>
        ) : (
          <View
            style={[
              styles.bubble,
              styles.bubbleAssistant,
              { backgroundColor: theme.backgroundElement, borderColor: isError ? theme.danger : theme.border },
            ]}>
            {body}
          </View>
        )}
        {copied ? (
          <ThemedText type="small" themeColor="tint" style={[styles.copied, isUser ? styles.copiedUser : null]}>
            Copied ✓
          </ThemedText>
        ) : null}
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    paddingHorizontal: Spacing.three,
    marginVertical: 5,
  },
  rowUser: {
    justifyContent: 'flex-end',
  },
  rowAssistant: {
    justifyContent: 'flex-start',
  },
  bubble: {
    maxWidth: '85%',
    borderRadius: Radii.lg,
    paddingHorizontal: Spacing.three,
    paddingVertical: 11,
    gap: Spacing.two,
  },
  bubbleUser: {
    borderBottomRightRadius: 6,
  },
  bubbleAssistant: {
    borderBottomLeftRadius: 6,
    borderWidth: StyleSheet.hairlineWidth,
  },
  image: {
    width: 220,
    height: 220,
    borderRadius: Radii.md,
  },
  cta: {
    alignSelf: 'flex-start',
    borderRadius: Radii.pill,
    borderWidth: 1,
    paddingHorizontal: Spacing.three,
    paddingVertical: 8,
    marginTop: 2,
  },
  copied: {
    marginTop: 3,
    marginLeft: 4,
  },
  copiedUser: {
    textAlign: 'right',
    marginRight: 4,
  },
});
