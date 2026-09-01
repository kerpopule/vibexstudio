import { LinearGradient } from 'expo-linear-gradient';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, View } from 'react-native';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';

import { ThemedText } from '@/components/themed-text';
import { ScalePress } from '@/components/ui/scale-press';
import { Radii, Shadows, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { enter } from '@/lib/motion';

/**
 * The "vibing" panel: a tall pane of raw model output that auto-scrolls as
 * tokens stream in. Gradient fades at the top and bottom leave the middle
 * band brightest, so the text reads like a spinning wheel of code.
 */
/**
 * SSE chunks arrive in bursts, which makes the wheel jump chunk-by-chunk.
 * This paces the reveal instead: the shown text trails the real stream and
 * drains the backlog over ~1.8s at a steady character rate, so the wheel
 * rolls smoothly no matter how lumpy the network is.
 */
function useSmoothText(target: string): string {
  const [shownLength, setShownLength] = useState(0);
  const targetRef = useRef(target);
  // Keep the latest target in a ref via an effect (not during render).
  useEffect(() => {
    targetRef.current = target;
  }, [target]);

  useEffect(() => {
    const id = setInterval(() => {
      setShownLength((prev) => {
        const len = targetRef.current.length;
        // New turn (text reset) — snap back instead of "unstreaming".
        if (len < prev) return len;
        const backlog = len - prev;
        if (backlog <= 0) return prev;
        // Drain horizon: backlog/60 per 30ms tick ≈ caught up in ~1.8s.
        // The floor keeps a visible roll even when tokens trickle.
        return Math.min(len, prev + Math.max(2, Math.ceil(backlog / 60)));
      });
    }, 30);
    return () => clearInterval(id);
  }, []);

  return target.slice(0, shownLength);
}

export function StreamWheel({ text, onStop }: { text: string; onStop: () => void }) {
  const theme = useTheme();
  const scrollRef = useRef<ScrollView>(null);
  const smoothText = useSmoothText(text);

  useEffect(() => {
    scrollRef.current?.scrollToEnd({ animated: true });
  }, [smoothText]);

  return (
    <Animated.View
      entering={enter(FadeIn.duration(250))}
      exiting={enter(FadeOut.duration(200))}
      style={[styles.shell, { backgroundColor: theme.backgroundElement, borderColor: theme.border }, Shadows.card]}>
      <View style={styles.header}>
        <ActivityIndicator size="small" color={theme.tint} />
        <ThemedText type="smallBold" style={{ color: theme.tint }}>
          Vibing…
        </ThemedText>
        <View style={styles.headerSpace} />
        <ScalePress onPress={onStop} style={[styles.stop, { backgroundColor: theme.backgroundSelected }]}>
          <ThemedText type="smallBold" themeColor="danger">
            Stop
          </ThemedText>
        </ScalePress>
      </View>

      <View style={styles.window}>
        <ScrollView
          ref={scrollRef}
          showsVerticalScrollIndicator={false}
          scrollEnabled={false}
          contentContainerStyle={styles.scrollContent}>
          <ThemedText type="code" style={[styles.code, { color: theme.text }]}>
            {smoothText || ' '}
          </ThemedText>
        </ScrollView>
        {/* Wheel effect: fade the edges, leave the center band bright. */}
        <LinearGradient
          pointerEvents="none"
          colors={[theme.backgroundElement, hexFade(theme.backgroundElement)]}
          style={styles.fadeTop}
        />
        <LinearGradient
          pointerEvents="none"
          colors={[hexFade(theme.backgroundElement), theme.backgroundElement]}
          style={styles.fadeBottom}
        />
      </View>
    </Animated.View>
  );
}

/** Same color, zero alpha — gradients need both stops in the same space. */
function hexFade(hex: string): string {
  return `${hex}00`;
}

const WINDOW_HEIGHT = 300;

const styles = StyleSheet.create({
  shell: {
    marginHorizontal: Spacing.two + 2,
    marginBottom: Spacing.two,
    borderRadius: Radii.lg,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingTop: Spacing.two + 2,
  },
  headerSpace: {
    flex: 1,
  },
  stop: {
    borderRadius: Radii.pill,
    paddingHorizontal: 12,
    paddingVertical: 5,
  },
  window: {
    height: WINDOW_HEIGHT,
  },
  scrollContent: {
    padding: Spacing.three,
    paddingTop: Spacing.four,
  },
  code: {
    fontSize: 12,
    lineHeight: 19,
  },
  fadeTop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: WINDOW_HEIGHT * 0.38,
  },
  fadeBottom: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: WINDOW_HEIGHT * 0.3,
  },
});
