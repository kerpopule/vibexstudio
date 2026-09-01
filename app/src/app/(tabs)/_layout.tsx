import { Tabs } from 'expo-router';

import { TabPill, type TabPillProps } from '@/components/ui/tab-pill';
import { useTheme } from '@/hooks/use-theme';

export default function TabsLayout() {
  const theme = useTheme();
  return (
    <Tabs
      tabBar={(props) => <TabPill {...(props as unknown as TabPillProps)} />}
      screenOptions={{
        headerShown: false,
        sceneStyle: { backgroundColor: theme.background },
      }}>
      <Tabs.Screen name="index" options={{ title: 'Studio' }} />
      {/* Always present: the on-device studio works with no server paired,
          and a paired server adds its full web UI behind a toggle. */}
      <Tabs.Screen name="media-lab" options={{ title: 'Media Lab' }} />
      <Tabs.Screen name="settings" options={{ title: 'Setup' }} />
    </Tabs>
  );
}
