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
import { onboardingLayoutForViewport } from '@/lib/layout';
import { useApp } from '@/lib/store';
import { enter } from '@/lib/motion';

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
  {
    eyebrow: 'MAKE MEDIA TOO',
    title: 'Images and video, your way.',
    body: 'Media Lab creates art for your apps — right on your device, through the desktop app, or on cloud GPUs. Pick what fits; you can always add more later.',
    icon: 'film' as const,
    demo: 'medialab' as const,
  },
];

/**
 * The 60-second studio tour — the five marketing slides, replayable from
 * Setup. (First-run setup is onboarding.tsx; this is the "what can it do"
 * layer.)
 */
export default function StudioTourScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const layout = onboardingLayoutForViewport(width, height);
  const wide = layout === 'wide';
  const compactHeight = layout === 'compact-height';
  const completeOnboarding = useApp((s) => s.completeOnboarding);
  const [step, setStep] = useState(0);
  const item = STEPS[step];

  const finish = async () => {
    await completeOnboarding();
    if (router.canGoBack()) router.back();
    else router.replace('/(tabs)');
  };

  const finishAndSetupMediaLab = async () => {
    await finish();
    router.push('/media-lab-setup');
  };

  return (
    <View style={[styles.screen, compactHeight && styles.screenCompactHeight, { backgroundColor: theme.background, paddingTop: insets.top + 8, paddingBottom: insets.bottom + 12 }]}>
      <LinearGradient colors={[theme.glowSoft, 'transparent']} style={styles.ambientTop} pointerEvents="none" />
      <LinearGradient colors={['transparent', theme.glowSoft]} style={styles.ambientBottom} pointerEvents="none" />

      <View style={[styles.shell, wide && styles.shellWide]}>
        <View style={[styles.topbar, compactHeight && styles.topbarCompactHeight]}>
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
            <ThemedText type="small" themeColor="textSecondary">Done</ThemedText>
          </Pressable>
        </View>

        <View style={[styles.stage, compactHeight && styles.stageCompactHeight, wide && styles.stageWide]}>
          <Animated.View
            key={`visual-${step}`}
            entering={enter(FadeIn.duration(350))}
            exiting={enter(FadeOut.duration(150))}
            style={[styles.visualWrap, compactHeight && styles.visualWrapCompactHeight, wide && styles.visualWide]}>
            <StudioDemo kind={item.demo} compactHeight={compactHeight} />
          </Animated.View>

          <View style={[styles.details, compactHeight && styles.detailsCompactHeight, wide && styles.detailsWide]}>
            <Animated.View key={`copy-${step}`} entering={enter(FadeInDown.duration(420))} style={[styles.copy, compactHeight && styles.copyCompactHeight]}>
              <View style={[styles.eyebrowRow, { backgroundColor: theme.tintSoft }]}>
                <Ionicons name={item.icon} size={13} color={theme.tint} />
                <ThemedText type="smallBold" style={{ color: theme.tint, fontSize: 11 }}>{item.eyebrow}</ThemedText>
              </View>
              <ThemedText type="title" style={[styles.title, compactHeight && styles.titleCompactHeight]}>{item.title}</ThemedText>
              <ThemedText themeColor="textSecondary" style={[styles.body, compactHeight && styles.bodyCompactHeight]}>{item.body}</ThemedText>
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
                onPress={() =>
                  step === STEPS.length - 1 ? finishAndSetupMediaLab() : setStep((value) => value + 1)
                }
                style={[styles.nextShadow, { shadowColor: theme.glow }, Shadows.float]}>
                <LinearGradient colors={gradientColors(theme)} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.next}>
                  <ThemedText type="smallBold" style={{ color: theme.onGradient }}>
                    {step === STEPS.length - 1 ? 'Set up Media Lab' : 'Continue'}
                  </ThemedText>
                  <Ionicons name={step === STEPS.length - 1 ? 'sparkles' : 'arrow-forward'} size={18} color={theme.onGradient} />
                </LinearGradient>
              </ScalePress>
            </View>
            {step === STEPS.length - 1 ? (
              <Pressable accessibilityRole="button" onPress={finish} hitSlop={8} style={styles.laterRow}>
                <ThemedText type="small" themeColor="textSecondary">Set up later — enter the studio</ThemedText>
              </Pressable>
            ) : null}
          </View>
        </View>
      </View>
    </View>
  );
}

function StudioDemo({ kind, compactHeight }: { kind: (typeof STEPS)[number]['demo']; compactHeight: boolean }) {
  const theme = useTheme();
  return (
    <Glass radius={34} style={[styles.device, compactHeight && styles.deviceCompactHeight]}>
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
        ) : kind === 'medialab' ? (
          <View style={styles.privacyGrid}>
            {[
              ['phone-portrait', 'Just this device', 'Zero setup — ready now'],
              ['desktop-outline', 'Desktop app', 'Scan a QR, paired'],
              ['cloud-outline', 'Cloud rendering', 'Big GPUs by the second'],
            ].map(([icon, title, body]) => (
              <View key={title} style={[styles.privacyCard, { backgroundColor: theme.backgroundElement, borderColor: theme.border }]}>
                <View style={[styles.iconWell, { backgroundColor: theme.tintSoft }]}><Ionicons name={icon as never} size={20} color={theme.tint} /></View>
                <ThemedText type="smallBold">{title}</ThemedText><ThemedText type="small" themeColor="textSecondary">{body}</ThemedText>
              </View>
            ))}
          </View>
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
  screenCompactHeight: { paddingHorizontal: 16 },
  shell: { flex: 1, width: '100%', alignSelf: 'center' },
  shellWide: { maxWidth: 1180 },
  stage: { flex: 1 },
  stageCompactHeight: { minHeight: 0 },
  stageWide: { flexDirection: 'row', alignItems: 'center', gap: 48, paddingVertical: 48 },
  details: { gap: 18 },
  detailsCompactHeight: { gap: 10 },
  detailsWide: { flex: 0.82, maxWidth: 440, justifyContent: 'center' },
  ambientTop: { position: 'absolute', top: 0, left: 0, right: 0, height: 330 },
  ambientBottom: { position: 'absolute', bottom: 0, left: 0, right: 0, height: 260 },
  topbar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', height: 48 },
  topbarCompactHeight: { height: 42 },
  brand: { flexDirection: 'row', alignItems: 'center', gap: 9 },
  brandMark: { width: 32, height: 32, borderRadius: 11, resizeMode: 'cover' },
  visualWrap: { flex: 1, justifyContent: 'center', paddingVertical: 18 },
  visualWrapCompactHeight: { minHeight: 0, paddingVertical: 6 },
  visualWide: { paddingVertical: 0 },
  device: { minHeight: 280, overflow: 'hidden' },
  deviceCompactHeight: { minHeight: 230 },
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
  copyCompactHeight: { gap: 8, paddingBottom: 8 },
  eyebrowRow: { alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: Radii.pill, paddingHorizontal: 10, paddingVertical: 6 },
  title: { fontSize: 38, lineHeight: 40, letterSpacing: -1.2 },
  titleCompactHeight: { fontSize: 32, lineHeight: 34 },
  body: { fontSize: 16, lineHeight: 23, maxWidth: 520 },
  bodyCompactHeight: { fontSize: 15, lineHeight: 20 },
  bottom: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.three },
  dots: { flexDirection: 'row', alignItems: 'center', gap: 6 }, dot: { height: 7, borderRadius: 4 },
  nextShadow: { borderRadius: Radii.pill },
  laterRow: { alignSelf: 'center', paddingTop: 14 },
  next: { minHeight: 50, borderRadius: Radii.pill, paddingHorizontal: 20, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 9 },
});
