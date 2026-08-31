import * as DocumentPicker from 'expo-document-picker';
import * as Haptics from 'expo-haptics';
import { router } from 'expo-router';
import { useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Button } from '@/components/ui/button';
import { ScalePress } from '@/components/ui/scale-press';
import { TextField } from '@/components/ui/text-field';
import { Radii, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useApp } from '@/lib/store';

const EMOJI_CHOICES = ['🪄', '🎮', '📝', '🎵', '🧮', '🗺️', '📚', '💪', '🍳', '🎨', '⏱️', '🌙'];

export default function NewProjectScreen() {
  const theme = useTheme();
  const createProject = useApp((s) => s.createProject);
  const providers = useApp((s) => s.providers);
  const pendingDesignReference = useApp((s) => s.pendingDesignReference);
  const setPendingDesignReference = useApp((s) => s.setPendingDesignReference);
  const [name, setName] = useState('');
  const [emoji, setEmoji] = useState('🪄');
  const [busy, setBusy] = useState(false);
  const [shareLink, setShareLink] = useState('');

  const openSharedFile = async () => {
    const picked = await DocumentPicker.getDocumentAsync({
      type: ['application/json', 'public.json', 'public.data', 'public.item'],
      copyToCacheDirectory: true,
    });
    const uri = picked.assets?.[0]?.uri;
    if (picked.canceled || !uri) return;
    router.dismiss();
    router.push({ pathname: '/import', params: { file: encodeURIComponent(uri) } });
  };

  const openSharedLink = () => {
    const trimmed = shareLink.trim();
    if (!trimmed) return;
    router.dismiss();
    router.push({ pathname: '/import', params: { url: encodeURIComponent(trimmed) } });
  };

  const create = async () => {
    const trimmed = name.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    try {
      const meta = await createProject(trimmed, emoji);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      router.dismiss();
      router.push({ pathname: '/project/[id]', params: { id: meta.id } });
    } finally {
      setBusy(false);
    }
  };

  return (
    <ThemedView style={styles.container}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <TextField
          label="Name"
          placeholder="My habit tracker"
          value={name}
          onChangeText={setName}
          autoFocus
          autoCapitalize="words"
          returnKeyType="go"
          onSubmitEditing={create}
        />
        <View style={styles.emojiBlock}>
          <ThemedText type="smallBold" themeColor="textSecondary">
            Icon
          </ThemedText>
          <View style={styles.emojiGrid}>
            {EMOJI_CHOICES.map((choice) => {
              const selected = choice === emoji;
              return (
                <ScalePress
                  key={choice}
                  pressedScale={0.88}
                  onPress={() => setEmoji(choice)}
                  style={[
                    styles.emojiCell,
                    {
                      backgroundColor: selected ? theme.tintSoft : theme.backgroundElement,
                      borderColor: selected ? theme.tint : theme.border,
                      borderWidth: selected ? 2 : StyleSheet.hairlineWidth,
                      transform: [{ scale: selected ? 1.08 : 1 }],
                    },
                  ]}>
                  <ThemedText style={styles.emoji}>{choice}</ThemedText>
                </ScalePress>
              );
            })}
          </View>
        </View>
        <View style={styles.designBlock}>
          <ThemedText type="smallBold" themeColor="textSecondary">
            DESIGN DIRECTION
          </ThemedText>
          {pendingDesignReference ? (
            <View style={[styles.designCard, { backgroundColor: theme.backgroundElement, borderColor: theme.border }]}>
              <View style={styles.designCopy}>
                <ThemedText type="smallBold" numberOfLines={1}>{pendingDesignReference.label}</ThemedText>
                <ThemedText type="small" themeColor="textSecondary" numberOfLines={2}>
                  Captured from Refero. Chat will ask what to build before generating.
                </ThemedText>
              </View>
              <ScalePress onPress={() => router.replace('/(tabs)/templates' as never)} style={styles.designAction}>
                <ThemedText type="smallBold" style={{ color: theme.tint }}>Change</ThemedText>
              </ScalePress>
              <ScalePress onPress={() => setPendingDesignReference(null)} style={styles.designAction}>
                <ThemedText type="smallBold" style={{ color: theme.danger }}>Remove</ThemedText>
              </ScalePress>
            </View>
          ) : (
            <Button
              title="Browse Refero designs"
              variant="secondary"
              onPress={() => router.replace('/(tabs)/templates' as never)}
            />
          )}
        </View>
        {providers.length === 0 ? (
          <Animated.View entering={FadeIn.delay(250)} style={[styles.tip, { backgroundColor: theme.tintSoft }]}>
            <ThemedText type="small" style={{ color: theme.tint }}>
              ✨ Tip: connect an AI provider in Settings to start vibing — you can still create the project now.
            </ThemedText>
          </Animated.View>
        ) : null}
        <Button title="Create project" onPress={create} loading={busy} disabled={!name.trim()} />

        <View style={styles.openShared}>
          <ThemedText type="smallBold" themeColor="textSecondary">
            GOT A SHARED APP?
          </ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            Open a .vibex file from iCloud Drive, Google Drive, Dropbox, or AirDrop — or paste a share link.
          </ThemedText>
          <Button title="Open a .vibex file" variant="secondary" onPress={openSharedFile} />
          <TextField
            label="Or paste a link"
            placeholder="https://www.dropbox.com/…"
            value={shareLink}
            onChangeText={setShareLink}
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="go"
            onSubmitEditing={openSharedLink}
          />
          <Button title="Open link" variant="secondary" onPress={openSharedLink} disabled={!shareLink.trim()} />
        </View>
      </ScrollView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    padding: Spacing.three,
    paddingTop: Spacing.four,
    gap: Spacing.four,
  },
  emojiBlock: {
    gap: Spacing.two,
  },
  designBlock: {
    gap: Spacing.two,
  },
  designCard: {
    minHeight: 68,
    borderRadius: Radii.md,
    borderWidth: StyleSheet.hairlineWidth,
    padding: Spacing.three,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  designCopy: {
    flex: 1,
    gap: 2,
  },
  designAction: {
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: Spacing.one,
  },
  emojiGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.two,
  },
  emojiCell: {
    width: 54,
    height: 54,
    borderRadius: Radii.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emoji: {
    fontSize: 26,
    lineHeight: 32,
  },
  tip: {
    borderRadius: Radii.md,
    padding: Spacing.three,
  },
  openShared: {
    gap: Spacing.two + 2,
    paddingTop: Spacing.two,
  },
});
