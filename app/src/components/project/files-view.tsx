import { useCallback, useEffect, useState } from 'react';
import { Alert, FlatList, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { Fonts, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { deleteFile, isBinaryPath, listFiles, readFile, writeFile } from '@/lib/storage/projects';
import type { ProjectFile } from '@/lib/types';

export function FilesView({
  projectId,
  reloadKey,
  onFilesChanged,
}: {
  projectId: string;
  reloadKey: number;
  onFilesChanged: () => void;
}) {
  const theme = useTheme();
  const [files, setFiles] = useState<ProjectFile[]>([]);
  const [openPath, setOpenPath] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [dirty, setDirty] = useState(false);

  const refresh = useCallback(() => {
    listFiles(projectId).then(setFiles);
  }, [projectId]);

  useEffect(refresh, [refresh, reloadKey]);

  const open = async (path: string) => {
    if (isBinaryPath(path)) return;
    const content = await readFile(projectId, path);
    setDraft(content ?? '');
    setDirty(false);
    setOpenPath(path);
  };

  const save = async () => {
    if (openPath == null) return;
    await writeFile(projectId, openPath, draft);
    setDirty(false);
    onFilesChanged();
  };

  const confirmDelete = (path: string) => {
    Alert.alert(`Delete ${path}?`, undefined, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          await deleteFile(projectId, path);
          refresh();
          onFilesChanged();
        },
      },
    ]);
  };

  if (openPath != null) {
    return (
      <View style={styles.container}>
        <View style={[styles.editorBar, { borderBottomColor: theme.border }]}>
          <Pressable onPress={() => setOpenPath(null)}>
            <ThemedText themeColor="tint">‹ Files</ThemedText>
          </Pressable>
          <ThemedText type="smallBold" numberOfLines={1} style={styles.editorTitle}>
            {openPath}
          </ThemedText>
          {dirty ? <Button title="Save" onPress={save} style={styles.saveButton} /> : null}
        </View>
        <ScrollView style={styles.editorScroll} keyboardShouldPersistTaps="handled">
          <TextInput
            style={[styles.editor, { color: theme.text }]}
            value={draft}
            onChangeText={(text) => {
              setDraft(text);
              setDirty(true);
            }}
            multiline
            autoCapitalize="none"
            autoCorrect={false}
            spellCheck={false}
            textAlignVertical="top"
          />
        </ScrollView>
      </View>
    );
  }

  return (
    <FlatList
      data={files}
      keyExtractor={(f) => f.path}
      contentContainerStyle={styles.list}
      ListEmptyComponent={
        <View style={styles.empty}>
          <ThemedText themeColor="textSecondary" style={styles.center}>
            No files yet — the AI writes them as you chat.
          </ThemedText>
        </View>
      }
      renderItem={({ item }) => (
        <Pressable
          onPress={() => open(item.path)}
          onLongPress={() => confirmDelete(item.path)}
          style={({ pressed }) => [
            styles.row,
            { backgroundColor: theme.backgroundElement, opacity: pressed ? 0.7 : 1 },
          ]}>
          <ThemedText style={styles.fileIcon}>{iconFor(item.path)}</ThemedText>
          <View style={styles.rowBody}>
            <ThemedText type="smallBold" numberOfLines={1}>
              {item.path}
            </ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              {item.encoding === 'base64' ? 'binary asset' : `${item.content.length.toLocaleString()} chars`}
            </ThemedText>
          </View>
        </Pressable>
      )}
    />
  );
}

function iconFor(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase() ?? '';
  if (ext === 'html') return '🌐';
  if (ext === 'css') return '🎨';
  if (ext === 'js') return '⚙️';
  if (ext === 'json') return '🧾';
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'].includes(ext)) return '🖼️';
  if (['mp4', 'webm'].includes(ext)) return '🎬';
  return '📄';
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  list: {
    padding: Spacing.three,
    gap: Spacing.two,
    flexGrow: 1,
  },
  empty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: Spacing.four,
  },
  center: {
    textAlign: 'center',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    borderRadius: 14,
    padding: Spacing.three,
  },
  fileIcon: {
    fontSize: 22,
    lineHeight: 28,
  },
  rowBody: {
    flex: 1,
    gap: 2,
  },
  editorBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    borderBottomWidth: StyleSheet.hairlineWidth,
    minHeight: 48,
  },
  editorTitle: {
    flex: 1,
  },
  saveButton: {
    minHeight: 36,
    paddingVertical: 6,
    paddingHorizontal: Spacing.three,
  },
  editorScroll: {
    flex: 1,
  },
  editor: {
    fontFamily: Fonts.mono,
    fontSize: 13,
    lineHeight: 19,
    padding: Spacing.three,
    minHeight: 400,
  },
});
