/**
 * The floating glass tab pill — Media Lab's bottom navigation, brought to
 * native. A centred liquid-glass capsule that hovers above the safe area,
 * one icon+label per tab, the active tab lifted on a tinted well. Screens
 * pad their bottom content by `TAB_PILL_CLEARANCE` so nothing hides under it.
 */
import Ionicons from '@expo/vector-icons/Ionicons';
import * as Haptics from 'expo-haptics';
import { Platform, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { Glass } from '@/components/ui/glass';
import { Fonts, Radii, Shadows } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

/** Bottom padding a scrolling screen needs so its last row clears the pill. */
export const TAB_PILL_CLEARANCE = 96;

export const TAB_ICONS: Record<string, { on: keyof typeof Ionicons.glyphMap; off: keyof typeof Ionicons.glyphMap }> = {
  index: { on: 'color-wand', off: 'color-wand-outline' },
  'media-lab': { on: 'film', off: 'film-outline' },
  settings: { on: 'options', off: 'options-outline' },
};

/**
 * Structural subset of React Navigation's BottomTabBarProps — enough to
 * render and drive the pill without depending on the navigator package.
 */
export interface TabPillProps {
  state: { index: number; routes: { key: string; name: string }[] };
  descriptors: Record<string, { options: { title?: string; tabBarAccessibilityLabel?: string } }>;
  navigation: {
    emit: (event: { type: string; target?: string; canPreventDefault?: boolean }) => { defaultPrevented: boolean };
    navigate: (name: string) => void;
  };
}

export function TabPill({ state, descriptors, navigation }: TabPillProps) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const bottom = Math.max(insets.bottom, 10) + (Platform.OS === 'web' ? 6 : 0);

  return (
    <View pointerEvents="box-none" style={[styles.host, { bottom }]}>
      <Glass radius={Radii.pill} style={[styles.pill, Shadows.card, { borderColor: theme.glassBorder }]}>
        {state.routes.map((route, index) => {
          const { options } = descriptors[route.key];
          const label =
            typeof options.title === 'string' ? options.title : route.name;
          const focused = state.index === index;
          const icon = TAB_ICONS[route.name] ?? { on: 'ellipse', off: 'ellipse-outline' };
          const onPress = () => {
            const event = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
            if (!focused && !event.defaultPrevented) {
              Haptics.selectionAsync().catch(() => {});
              navigation.navigate(route.name);
            }
          };
          return (
            <Pressable
              key={route.key}
              accessibilityRole="tab"
              accessibilityState={{ selected: focused }}
              accessibilityLabel={options.tabBarAccessibilityLabel ?? label}
              onPress={onPress}
              onLongPress={() => navigation.emit({ type: 'tabLongPress', target: route.key })}
              style={[styles.tab, focused && { backgroundColor: theme.tintSoft }]}>
              <Ionicons
                name={focused ? icon.on : icon.off}
                size={20}
                color={focused ? theme.tint : theme.textSecondary}
              />
              <ThemedText
                style={[styles.label, { color: focused ? theme.tint : theme.textSecondary }]}
                numberOfLines={1}>
                {label.toUpperCase()}
              </ThemedText>
            </Pressable>
          );
        })}
      </Glass>
    </View>
  );
}

const styles = StyleSheet.create({
  host: {
    position: 'absolute',
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 5,
    gap: 2,
    borderWidth: StyleSheet.hairlineWidth,
  },
  tab: {
    minWidth: 78,
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: Radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 3,
  },
  label: {
    fontFamily: Fonts.display,
    fontSize: 9.5,
    letterSpacing: 1.1,
    lineHeight: 12,
  },
});
