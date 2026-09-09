import { router } from 'expo-router';
import { ScrollView } from 'react-native';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Button } from '@/components/ui/button';
import { Glass } from '@/components/ui/glass';
import { Spacing } from '@/constants/theme';

export default function ConnectPrivateScreen() {
  return <ThemedView style={{ flex: 1 }}>
    <ScrollView contentContainerStyle={{ padding: Spacing.three, gap: Spacing.three, width: '100%', maxWidth: 800, alignSelf: 'center' }}>
      <ThemedText type="title">Connect your own AI</ThemedText>
      <Glass style={{ padding: Spacing.three, gap: Spacing.two }}>
        <ThemedText>VibeX works with your provider account or a server you control. This build no longer redeems hosted Private VibeX invites or sends AI requests through that service.</ThemedText>
        <ThemedText themeColor="textSecondary">Choose a provider API to use cloud AI without owning a computer, or connect your own compatible server.</ThemedText>
        <Button title="Connect a provider API" onPress={() => router.replace('/connect-provider')} />
        <Button title="Connect my own AI server" variant="secondary" onPress={() => router.replace({ pathname: '/connect-provider', params: { kind: 'custom' } })} />
      </Glass>
      <ThemedText type="small" themeColor="textSecondary">If you used Private VibeX before, its saved connection remains in Setup so you can remove it. Removing it requests revocation from the old service; it does not guarantee deletion of that service’s historical records.</ThemedText>
      <Button title="Back to Setup" variant="secondary" onPress={() => router.replace('/(tabs)/settings')} />
    </ScrollView>
  </ThemedView>;

}
