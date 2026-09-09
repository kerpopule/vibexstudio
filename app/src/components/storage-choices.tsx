import { useState } from 'react';
import { router } from 'expo-router';
import { Button } from '@/components/ui/button';
import { DesktopFolderStorage } from '@/components/desktop-folder-storage';
import { PairedServerStorage } from '@/components/paired-server-storage';
import { ProjectBackups } from '@/components/project-backups';
import { desktopFolderAvailable } from '@/lib/sync/desktop-folder';
import { useApp } from '@/lib/store';
import { Platform, Pressable, View } from 'react-native';
import { ThemedText } from '@/components/themed-text';
import { Glass } from '@/components/ui/glass';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

const choices = [
  { id: 'local', title: 'Just this device', subtitle: 'Start here. No storage account needed.', detail: 'Projects stay in this app on this device. Save a project copy before clearing app or browser data, or moving to another device.' },
  { id: 'icloud', title: 'My iCloud Drive', subtitle: 'Keep project copies with your Apple files.', detail: 'Back up a project to Files → iCloud Drive when available, then restore it on your other device. On desktop, you can also choose an iCloud Drive folder for sync below. Direct automatic iCloud app sync is not connected.' },
  { id: 'drive', title: 'My Google Drive', subtitle: 'Keep project copies in your own Drive.', detail: 'Back up a project to Drive through your device’s share options, or upload the downloaded backup yourself. Restore it in VibeX to continue. On desktop, you can also sync through a folder managed by Google Drive. Direct Google account sync is not connected.' },
  { id: 'github', title: 'My GitHub', subtitle: 'Version and share your project’s code.', detail: 'Connect GitHub in Setup, then choose a repository from your project. Review what you publish and who can see it. GitHub is a code workflow; it does not automatically back up your chats, API connections, or entire media library.' },
  { id: 'folder', title: 'A folder I control', subtitle: 'Local disk, NAS, or a synced desktop folder.', detail: 'Keep code, chats and embedded project assets in a folder you choose. On desktop, Studio can check that folder while it is open. Your storage app handles copying it between computers.' },
  { id: 'server', title: 'My computer or server', subtitle: 'Share projects directly between your devices.', detail: 'Use your own always-on computer or server to sync code, chats and embedded assets. Each device connects directly to it. If that machine is off, sync waits until it is available again. A Media Lab generation connection alone does not enable project sync.' },
] as const;

/** Explain real storage paths without representing an unimplemented adapter as connected. */
export function StorageChoices({localBackups = false}: {localBackups?: boolean}) {
  const theme = useTheme();
  const [selected, setSelected] = useState<string>('local');
  const [visited, setVisited] = useState<Set<string>>(() => new Set());
  const folderAvailable = desktopFolderAvailable();
  const github = useApp(state => state.github);
  const workbench = useApp(state => state.workbench);
  const select = (id: string) => { setSelected(id); setVisited(previous => new Set([...previous, id])); };
  const folderSelected = ['folder','icloud','drive'].includes(selected);
  const choice = choices.find((item) => item.id === selected)!;
  return <View style={{ gap: Spacing.two }}>
    <ThemedText themeColor="textSecondary">Start on this device. Add your own storage whenever you need a copy elsewhere.</ThemedText>
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two }}>
      {choices.map((item) => <Pressable key={item.id} accessibilityRole="button" accessibilityState={{ selected: item.id === selected }} accessibilityLabel={item.title} onPress={() => select(item.id)} style={{ flexGrow: 1, flexBasis: 240 }}>
        <Glass style={{ padding: Spacing.three, gap: Spacing.one, ...(Platform.OS === 'web' ? { height: '100%' as const } : {}), ...(item.id === selected ? { borderColor: theme.tint, backgroundColor: theme.tintSoft } : {}) }}>
          <ThemedText type="smallBold">{item.title}</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">{item.subtitle}</ThemedText>
        </Glass>
      </Pressable>)}
    </View>
    <Glass style={{ padding: Spacing.three, gap: Spacing.two }}>
      <ThemedText type="heading">{choice.title}</ThemedText>
      <ThemedText>{choice.detail}</ThemedText>
      {['icloud','drive'].includes(selected) ? <ThemedText type="small" themeColor="textSecondary">{Platform.OS === 'web' ? 'In this browser, backing up downloads a file. Move it to your chosen storage afterward.' : 'Available destinations depend on the file and storage apps installed on this device.'}</ThemedText> : null}
    </Glass>
    {selected === 'github' ? <Button title={github ? `GitHub connected · @${github.login}` : 'Connect my GitHub'} variant="secondary" onPress={() => router.push('/connect-github')} /> : null}
    {selected === 'server' ? <Button title={workbench ? 'Pair a different computer or server' : 'Connect my computer or server'} variant="secondary" onPress={() => router.push('/pair-scan' as never)} /> : null}
    {selected === 'folder' && !folderAvailable ? <ThemedText>Direct folder sync is available in the desktop app. Here, save a backup to your device’s file picker, or connect your own server for project sync.</ThemedText> : null}
    {/* Keep opened setup panels mounted so changing a choice cannot discard an
        in-flight operation's result or create a second operation lock. */}
    {folderAvailable && ['folder','icloud','drive'].some(id => visited.has(id)) ? <View style={{display:folderSelected?'flex':'none'}}><DesktopFolderStorage /></View> : null}
    {visited.has('server') ? <View style={{display:selected==='server'?'flex':'none'}}><PairedServerStorage /></View> : null}
    {(localBackups || ['icloud','drive','folder'].some(id => visited.has(id))) ? <View style={{display:(localBackups || folderSelected)?'flex':'none'}}><ProjectBackups /></View> : null}
    <ThemedText type="small" themeColor="textSecondary">Choosing a card does not move files or connect an account. Use its setup or backup button when you are ready. AI keys stay on each device.</ThemedText>
    <ThemedText type="small" themeColor="textSecondary">Storage and AI are separate choices. Prompts and selected files go to the AI service you use. Your storage choice does not change that service’s handling of requests.</ThemedText>
  </View>;
}
