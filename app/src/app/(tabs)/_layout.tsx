import Ionicons from '@expo/vector-icons/Ionicons';
import { Tabs } from 'expo-router';
import { Platform } from 'react-native';

import { Fonts } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useApp } from '@/lib/store';

export default function TabsLayout() {
  const theme = useTheme();
  const mediaLab = useApp((s) => s.mediaLab);
  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: theme.tint,
        tabBarInactiveTintColor: theme.textSecondary,
        headerShown: false,
        tabBarStyle: {
          position: 'relative',
          backgroundColor: theme.glass,
          borderTopWidth: 0,
          elevation: 0,
          height: Platform.OS === 'ios' ? 72 : 66,
        },
        tabBarItemStyle: { paddingTop: 7 },
        tabBarLabelStyle: { fontFamily: Fonts.rounded, fontWeight: '700', fontSize: 11 },
        sceneStyle: { backgroundColor: theme.background },
      }}>
      <Tabs.Screen
        name="index"
        options={{
          title: 'Projects',
          tabBarIcon: ({ color, size }) => <Ionicons name="color-wand" color={color} size={size} />,
        }}
      />
      {/* The Media Lab tab exists only once a server is paired in Settings. */}
      <Tabs.Screen
        name="media-lab"
        options={{
          title: 'Media Lab',
          href: mediaLab ? undefined : null,
          tabBarIcon: ({ color, size }) => <Ionicons name="film" color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: 'Settings',
          tabBarIcon: ({ color, size }) => <Ionicons name="settings-sharp" color={color} size={size} />,
        }}
      />
    </Tabs>
  );
}
