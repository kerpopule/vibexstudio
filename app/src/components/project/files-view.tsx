import { Alert } from '@/lib/app-alert';
import * as Clipboard from 'expo-clipboard';
import { useCallback, useEffect, useState } from 'react';
import { FlatList, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import {ProjectMediaPreview} from '@/components/project-media-preview';
import {SpriteInspector} from '@/components/sprite-inspector';
import {readProjectSprite, type ProjectSprite} from '@/lib/project-sprite';
import { ModelInspector } from '@/components/model-inspector';
import { Button } from '@/components/ui/button';
import { Fonts, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { createModelPlacement, modelPlacementPath, readModelPlacement, type ModelRotation } from '@/lib/model-placement';
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
  const [sprite, setSprite] = useState<{value:ProjectSprite;file:ProjectFile}|null>(null);
  const [asset, setAsset] = useState<ProjectFile | null>(null);
  const [placement, setPlacement] = useState<ModelRotation | undefined>();
  const [placementError, setPlacementError] = useState('');
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState(false);
  const [draft, setDraft] = useState('');
  const [dirty, setDirty] = useState(false);

  const refresh = useCallback(() => {
    listFiles(projectId).then(setFiles);
  }, [projectId]);

  useEffect(refresh, [refresh, reloadKey]);

  const open = async (file: ProjectFile) => {
    const path = file.path;
    if (file.encoding === 'base64' || isBinaryPath(path)) {
      let rotation: ModelRotation | undefined;
      setPlacementError('');
      if (path.toLowerCase().endsWith('.glb')) {
        try {
          const saved = await readFile(projectId, modelPlacementPath(path));
          if (saved !== null) rotation = readModelPlacement(saved, path).rotation;
        } catch {setPlacementError('Saved orientation could not be read. Showing the original model.');}
      }
      setPlacement(rotation);setAsset(file);setCopied(false);setCopyError(false);return;
    }
    const atlas=readProjectSprite(file,files);
    if (atlas) {setSprite({value:atlas,file});return;}
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

  if (sprite) return <ScrollView contentContainerStyle={styles.list}>
    <Button title="Back to files" variant="secondary" onPress={()=>setSprite(null)} />
    <SpriteInspector key={sprite.file.path} sprite={sprite.value} />
    <Button title="Edit frame data" variant="secondary" onPress={()=>{
      setOpenPath(sprite.file.path);setDraft(sprite.file.content);setDirty(false);setSprite(null);
    }} />
  </ScrollView>;

  if (asset) {
    return <ScrollView contentContainerStyle={styles.list}>
      <Button title="Back to files" variant="secondary" onPress={() => setAsset(null)} />
      <ThemedText type="heading">{asset.path.toLowerCase().endsWith('.glb') ? '3D model' : 'Project asset'}</ThemedText>
      <ThemedText selectable>{asset.path}</ThemedText>
      <ProjectMediaPreview key={asset.path} path={asset.path} base64={asset.content} />
      {placementError ? <ThemedText accessibilityRole="alert">{placementError}</ThemedText> : null}
      {asset.path.toLowerCase().endsWith('.glb') ? <ModelInspector key={asset.path} base64={asset.content} initialRotation={placement} onSave={async rotation => {
        const target = modelPlacementPath(asset.path);
        const existing = await readFile(projectId, target);
        if (existing !== null) {
          try {readModelPlacement(existing, asset.path);}
          catch {throw new Error('The existing orientation file is not recognized and has not been changed. Open it in Files to review its contents.');}
        }
        await writeFile(projectId, target, JSON.stringify(createModelPlacement(asset.path, rotation), null, 2));
        setPlacementError(''); refresh(); onFilesChanged();
      }} /> : null}
      <ThemedText themeColor="textSecondary">This file is saved in your project. Tell the builder how to use it, or copy its path into your code. Project exports include the file.</ThemedText>
      <Button title={copied ? 'Path copied' : 'Copy file path'} onPress={() => {
        setCopied(false);setCopyError(false);
        void Clipboard.setStringAsync(asset.path).then(success => {setCopied(success);setCopyError(!success);}).catch(() => setCopyError(true));
      }} />
      {copyError ? <ThemedText accessibilityRole="alert">Could not copy the path. Select the path above to copy it manually.</ThemedText> : null}
    </ScrollView>;
  }

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
          accessibilityRole="button"
          accessibilityLabel={`Open ${item.path}`}
          onPress={() => open(item)}
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
  if (ext === 'glb') return '🧊';
  if (['mp3', 'wav', 'flac', 'm4a', 'ogg'].includes(ext)) return '🎵';
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
