import Ionicons from '@expo/vector-icons/Ionicons';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import { useState } from 'react';
import { Image, Pressable, StyleSheet, useWindowDimensions, View } from 'react-native';
import Animated, { FadeIn, FadeInDown, FadeOut } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { thisDevice } from '@/lib/device';
import { Glass } from '@/components/ui/glass';
import { ScalePress } from '@/components/ui/scale-press';
import { gradientColors, Radii, Shadows, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { workspaceLayoutForWidth } from '@/lib/layout';
import { useApp } from '@/lib/store';

const APP_ICON = require('../../assets/images/icon.png');

const STEPS = [
  {
    eyebrow: 'YOUR POCKET STUDIO',
    title: 'An idea is enough.',
    body: 'Describe the app you want. VibeX writes the files, renders the result, and keeps the whole project on your device.',
    icon: 'sparkles' as const,
    demo: 'chat' as const,
  },
  {
    eyebrow: 'BUILD, THEN REMIX',
    title: 'Every message changes the app.',
    body: 'Say “make it bolder” or “move that up.” Follow-up turns are implementation by default — not empty promises.',
    icon: 'color-wand' as const,
    demo: 'remix' as const,
  },
  {
    eyebrow: 'LOCAL-FIRST',
    title: 'Your work stays yours.',
    body: `Projects live on ${thisDevice}. Provider keys stay in the secure keychain. VibeX adds no analytics, tracking, or account layer.`,
    icon: 'lock-closed' as const,
    demo: 'privacy' as const,
  },
  {
    eyebrow: 'READY WHEN YOU ARE',
    title: 'Build here. Share anywhere.',
    body: 'Preview instantly, export a backup, or publish a normal web link through your own GitHub when you are ready.',
    icon: 'rocket' as const,
    demo: 'launch' as const,
  },
];

export default function OnboardingScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const wide = workspaceLayoutForWidth(width) === 'wide';
  const completeOnboarding = useApp((s) => s.completeOnboarding);
  const [step, setStep] = useState(0);
  const item = STEPS[step];

  const finish = async () => {
    await completeOnboarding();
    router.replace('/(tabs)');
  };

  return (
    <View style={[styles.screen, { backgroundColor: theme.background, paddingTop: insets.top + 8, paddingBottom: insets.bottom + 12 }]}>
      <LinearGradient colors={[theme.glowSoft, 'transparent']} style={styles.ambientTop} pointerEvents="none" />
      <LinearGradient colors={['transparent', theme.glowSoft]} style={styles.ambientBottom} pointerEvents="none" />

      <View style={[styles.shell, wide && styles.shellWide]}>
        <View style={styles.topbar}>
          <View style={styles.brand}>
            <Image
              source={APP_ICON}
              style={styles.brandMark}
              accessibilityLabel="VibeX Studio logo"
              accessibilityIgnoresInvertColors
            />
            <ThemedText type="smallBold">VibeX Studio</ThemedText>
          </View>
          <Pressable accessibilityRole="button" onPress={finish} hitSlop={12}>
            <ThemedText type="small" themeColor="textSecondary">Skip</ThemedText>
          </Pressable>
        </View>

        <View style={[styles.stage, wide && styles.stageWide]}>
          <Animated.View
            key={`visual-${step}`}
            entering={FadeIn.duration(350)}
            exiting={FadeOut.duration(150)}
            style={[styles.visualWrap, wide && styles.visualWide]}>
            <StudioDemo kind={item.demo} />
          </Animated.View>

          <View style={[styles.details, wide && styles.detailsWide]}>
            <Animated.View key={`copy-${step}`} entering={FadeInDown.duration(420)} style={styles.copy}>
              <View style={[styles.eyebrowRow, { backgroundColor: theme.tintSoft }]}>
                <Ionicons name={item.icon} size={13} color={theme.tint} />
                <ThemedText type="smallBold" style={{ color: theme.tint, fontSize: 11 }}>{item.eyebrow}</ThemedText>
              </View>
              <ThemedText type="title" style={styles.title}>{item.title}</ThemedText>
              <ThemedText themeColor="textSecondary" style={styles.body}>{item.body}</ThemedText>
            </Animated.View>

            <View style={styles.bottom}>
              <View style={styles.dots}>
                {STEPS.map((_, index) => (
                  <View
                    key={index}
                    style={[
                      styles.dot,
                      { backgroundColor: index === step ? theme.tint : theme.border, width: index === step ? 24 : 7 },
                    ]}
                  />
                ))}
              </View>
              <ScalePress
                accessibilityRole="button"
                onPress={() => (step === STEPS.length - 1 ? finish() : setStep((value) => value + 1))}
                style={[styles.nextShadow, { shadowColor: theme.glow }, Shadows.float]}>
                <LinearGradient colors={gradientColors(theme)} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.next}>
                  <ThemedText type="smallBold" style={{ color: theme.onGradient }}>
                    {step === STEPS.length - 1 ? 'Enter the studio' : 'Continue'}
                  </ThemedText>
                  <Ionicons name={step === STEPS.length - 1 ? 'sparkles' : 'arrow-forward'} size={18} color={theme.onGradient} />
                </LinearGradient>
              </ScalePress>
            </View>
          </View>
        </View>
      </View>
    </View>
  );
}

function StudioDemo({ kind }: { kind: (typeof STEPS)[number]['demo'] }) {
  const theme = useTheme();
  return (
    <Glass radius={34} style={styles.device}>
      <View style={[styles.deviceTop, { borderBottomColor: theme.border }]}>
        <View style={styles.traffic}><View style={[styles.trafficDot, { backgroundColor: theme.danger }]} /><View style={[styles.trafficDot, { backgroundColor: theme.warning }]} /><View style={[styles.trafficDot, { backgroundColor: theme.success }]} /></View>
        <View style={[styles.island, { backgroundColor: theme.text }]} />
        <Ionicons name="ellipsis-horizontal" size={16} color={theme.textSecondary} />
      </View>
      <View style={styles.demoBody}>
        {kind === 'chat' || kind === 'remix' ? (
          <>
            <View style={[styles.userBubble, { backgroundColor: theme.tint }]}>
              <ThemedText type="small" style={{ color: theme.onTint }}>{kind === 'chat' ? 'Build a dreamy habit tracker' : 'More playful. Bigger streak card.'}</ThemedText>
            </View>
            <View style={[styles.codeCard, { backgroundColor: theme.backgroundElement, borderColor: theme.border }]}>
              <View style={styles.codeHeader}><Ionicons name="code-slash" size={14} color={theme.tint} /><ThemedText type="smallBold">index.html</ThemedText><View style={[styles.livePill, { backgroundColor: theme.tintSoft }]}><ThemedText type="smallBold" style={{ color: theme.tint, fontSize: 9 }}>WRITING</ThemedText></View></View>
              {[82, 64, 91, 50].map((width, i) => <View key={i} style={[styles.codeLine, { width: `${width}%`, backgroundColor: i === 1 ? theme.tint : theme.border }]} />)}
            </View>
          </>
        ) : kind === 'privacy' ? (
          <View style={styles.privacyGrid}>
            {[
              ['phone-portrait', 'Projects', `On ${thisDevice}`],
              ['key', 'Keys', 'Secure keychain'],
              ['eye-off', 'Tracking', 'None. Ever.'],
            ].map(([icon, title, body]) => (
              <View key={title} style={[styles.privacyCard, { backgroundColor: theme.backgroundElement, borderColor: theme.border }]}>
                <View style={[styles.iconWell, { backgroundColor: theme.tintSoft }]}><Ionicons name={icon as never} size={20} color={theme.tint} /></View>
                <ThemedText type="smallBold">{title}</ThemedText><ThemedText type="small" themeColor="textSecondary">{body}</ThemedText>
              </View>
            ))}
          </View>
        ) : (
          <View style={styles.launchWrap}>
            <LinearGradient colors={gradientColors(theme)} style={styles.launchOrb}><Ionicons name="rocket" size={38} color={theme.onGradient} /></LinearGradient>
            <ThemedText type="heading">Your app is live</ThemedText>
            <View style={[styles.urlBar, { backgroundColor: theme.backgroundElement, borderColor: theme.border }]}><Ionicons name="lock-closed" size={12} color={theme.success} /><ThemedText type="small" numberOfLines={1}>your-app.github.io</ThemedText></View>
          </View>
        )}
      </View>
    </Glass>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, paddingHorizontal: 20, overflow: 'hidden' },
  shell: { flex: 1, width: '100%', alignSelf: 'center' },
  shellWide: { maxWidth: 1180 },
  stage: { flex: 1 },
  stageWide: { flexDirection: 'row', alignItems: 'center', gap: 48, paddingVertical: 48 },
  details: { gap: 18 },
  detailsWide: { flex: 0.82, maxWidth: 440, justifyContent: 'center' },
  ambientTop: { position: 'absolute', top: 0, left: 0, right: 0, height: 330 },
  ambientBottom: { position: 'absolute', bottom: 0, left: 0, right: 0, height: 260 },
  topbar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', height: 48 },
  brand: { flexDirection: 'row', alignItems: 'center', gap: 9 },
  brandMark: { width: 32, height: 32, borderRadius: 11, resizeMode: 'cover' },
  visualWrap: { flex: 1, justifyContent: 'center', paddingVertical: 18 },
  visualWide: { paddingVertical: 0 },
  device: { minHeight: 280, overflow: 'hidden' },
  deviceTop: { height: 46, paddingHorizontal: 14, borderBottomWidth: StyleSheet.hairlineWidth, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  traffic: { flexDirection: 'row', gap: 5 }, trafficDot: { width: 7, height: 7, borderRadius: 4 },
  island: { width: 70, height: 20, borderRadius: 11, opacity: 0.9 },
  demoBody: { flex: 1, padding: 18, justifyContent: 'center', gap: 14 },
  userBubble: { alignSelf: 'flex-end', maxWidth: '86%', borderRadius: 18, borderBottomRightRadius: 6, paddingHorizontal: 14, paddingVertical: 11 },
  codeCard: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 18, padding: 14, gap: 9 },
  codeHeader: { flexDirection: 'row', alignItems: 'center', gap: 7, marginBottom: 3 },
  livePill: { marginLeft: 'auto', borderRadius: Radii.pill, paddingHorizontal: 7, paddingVertical: 3 },
  codeLine: { height: 7, borderRadius: 5, opacity: 0.78 },
  privacyGrid: { gap: 10 },
  privacyCard: { flexDirection: 'row', alignItems: 'center', gap: 11, borderRadius: 18, borderWidth: StyleSheet.hairlineWidth, padding: 12 },
  iconWell: { width: 40, height: 40, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  launchWrap: { alignItems: 'center', gap: 12 },
  launchOrb: { width: 82, height: 82, borderRadius: 28, alignItems: 'center', justifyContent: 'center', marginBottom: 4 },
  urlBar: { flexDirection: 'row', alignItems: 'center', gap: 7, borderWidth: StyleSheet.hairlineWidth, borderRadius: Radii.pill, paddingHorizontal: 14, paddingVertical: 9 },
  copy: { gap: 12, paddingBottom: 18 },
  eyebrowRow: { alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: Radii.pill, paddingHorizontal: 10, paddingVertical: 6 },
  title: { fontSize: 38, lineHeight: 40, letterSpacing: -1.2 },
  body: { fontSize: 16, lineHeight: 23, maxWidth: 520 },
  bottom: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.three },
  dots: { flexDirection: 'row', alignItems: 'center', gap: 6 }, dot: { height: 7, borderRadius: 4 },
  nextShadow: { borderRadius: Radii.pill },
  next: { minHeight: 50, borderRadius: Radii.pill, paddingHorizontal: 20, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 9 },
});
