import { Platform, View } from 'react-native';
import { SparkyDirector } from '@/components/sparky-director';
import { Tabs, useSegments } from 'expo-router';

import { TabPill, type TabPillProps } from '@/components/ui/tab-pill';
import { useUiChrome } from '@/lib/ui-chrome';
import { useTheme } from '@/hooks/use-theme';

export default function TabsLayout() {
  const theme = useTheme();
  const segments = useSegments();
  const libraryActive = segments[segments.length - 1] === 'creations';
  const embeddedTools = useUiChrome(state => state.tabPillHidden);
  return (
    <View style={{flex:1}}>
    <Tabs
      tabBar={(props) => <TabPill {...(props as unknown as TabPillProps)} />}
      screenOptions={{
        headerShown: false,
        sceneStyle: { backgroundColor: theme.background },
      }}>
      <Tabs.Screen name="index" options={{ title: 'Build' }} />
      {/* Always present: a paired Media Lab opens here first (its own page,
          inside the app), and the on-device studio is one tap away — or the
          whole tab when no server is paired. */}
      <Tabs.Screen name="media-lab" options={{ title: 'Create' }} />
      <Tabs.Screen name="creations" options={{ title: 'Library' }} />
      <Tabs.Screen name="settings" options={{ title: 'Setup' }} />
    </Tabs>
    <SparkyDirector visible={!libraryActive && (Platform.OS === 'web' || !embeddedTools)} />
    </View>
  );
}
