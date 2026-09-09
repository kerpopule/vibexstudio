import { useRef, useState } from 'react';
import { router } from 'expo-router';
import { ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StorageChoices } from '@/components/storage-choices';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Button } from '@/components/ui/button';
import { Glass } from '@/components/ui/glass';
import { Spacing } from '@/constants/theme';
import { exportProjectBundle } from '@/lib/share/exportProject';
import { useApp } from '@/lib/store';

export default function StorageScreen() {
  const projects = useApp((s) => s.projects);
  const insets = useSafeAreaInsets();
  const saving = useRef(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const [sharingOpen, setSharingOpen] = useState(false);
  async function save(id: string) {
    if (saving.current) return;
    saving.current = true;
    setBusy(id);
    setMessage('');
    try {
      await exportProjectBundle(id);
      setMessage('Export handed to your device. Check your chosen destination to confirm the copy was saved.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not prepare a copy. Your project is still on this device.');
    } finally {
      saving.current = false;
      setBusy(null);
    }
  }
  return <ThemedView style={{ flex: 1 }}>
    <ScrollView contentContainerStyle={{ padding: Spacing.three, paddingBottom: insets.bottom + Spacing.four, gap: Spacing.three, width: '100%', maxWidth: 1000, alignSelf: 'center' }}>
      <ThemedText type="title">Your files, your storage</ThemedText>
      <StorageChoices localBackups />
      <Glass style={{ padding: Spacing.three, gap: Spacing.two }}>
        <ThemedText type="heading">Share code without chat history</ThemedText>
        <ThemedText themeColor="textSecondary">Use a full backup above to move your own work. Use a code copy when you want to give someone the project without your conversations.</ThemedText>
        <Button title={sharingOpen ? 'Hide code sharing' : 'Show code sharing options'} variant="secondary" disabled={busy != null} onPress={() => setSharingOpen(value => !value)} />
        {sharingOpen ? <View style={{ gap: Spacing.two }}>
        <ThemedText themeColor="textSecondary">A .vibex code copy includes code and embedded project assets. Chat history, account connections and media outside the project are excluded. Anyone you give the file to can read its contents. Review your code for private information before sharing.</ThemedText>
        {projects.length ? projects.map((project) => <View key={project.id} style={{ gap: Spacing.one }}>
          <Button title={busy === project.id ? 'Preparing copy…' : `Export code copy · ${project.name}`} variant="secondary" disabled={busy != null} onPress={() => void save(project.id)} />
        </View>) : <ThemedText>No projects yet. Build or import a project first.</ThemedText>}
        {message ? <ThemedText accessibilityRole="alert">{message}</ThemedText> : null}
        <Button title="Import a code copy (.vibex)" variant="secondary" onPress={() => router.push('/import')} />
        </View> : null}
      </Glass>
      <Button title="Done" variant="secondary" onPress={() => router.back()} />
    </ScrollView>
  </ThemedView>;
}
