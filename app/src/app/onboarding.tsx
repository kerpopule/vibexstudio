/**
 * First run — a real setup, not a slideshow. Four short steps, each one a
 * question about what the person already HAS, each one skippable, each one
 * revisitable from the Setup tab later:
 *
 *   1. Which AI do you already have?      (the one required step)
 *   2. Where should media get made?
 *   3. Is there a computer to pair?
 *   4. Ready — build, or take the tour.
 *
 * Connecting happens in the normal modal screens; this screen just watches
 * the store and lights up ✓ when something connects.
 */
import Ionicons from '@expo/vector-icons/Ionicons';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import { useState } from 'react';
import { Image, Pressable, ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';
import Animated, { FadeIn, FadeInDown } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { Glass } from '@/components/ui/glass';
import { ScalePress } from '@/components/ui/scale-press';
import { Fonts, gradientColors, Radii, Shadows, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { PROVIDERS } from '@/lib/ai/registry';
import { SUBSCRIPTION_ORDER, SUBSCRIPTION_PROVIDERS, type SubscriptionProviderId } from '@/lib/ai/subscriptionOauth';
import { thisDevice } from '@/lib/device';
import { onboardingLayoutForViewport } from '@/lib/layout';
import { enter } from '@/lib/motion';
import { hostLabel, mediaCapable, readyToBuild } from '@/lib/setup';
import { useApp } from '@/lib/store';
import type { ProviderKind } from '@/lib/types';

const APP_ICON = require('../../assets/images/icon.png');


type StepId = 'welcome' | 'ai' | 'media' | 'computer' | 'done';
const ORDER: StepId[] = ['welcome', 'ai', 'media', 'computer', 'done'];

const SUB_GLYPH: Record<SubscriptionProviderId, string> = {
  'chatgpt-oauth': '🟢',
  'xai-oauth': '✖️',
  'minimax-oauth': '🟠',
  'kimi-oauth': '🌙',
};
const SUB_SHORT: Record<SubscriptionProviderId, string> = {
  'chatgpt-oauth': 'ChatGPT',
  'xai-oauth': 'Grok / X Premium',
  'minimax-oauth': 'MiniMax',
  'kimi-oauth': 'Kimi',
};

const KEY_KINDS: { kind: ProviderKind; glyph: string; title: string; hint: string }[] = [
  { kind: 'openrouter', glyph: '🛣️', title: 'OpenRouter', hint: 'Sign in — hundreds of models, one account' },
  { kind: 'anthropic', glyph: '🧠', title: 'Claude', hint: 'Anthropic API key' },
  { kind: 'openai', glyph: '🔑', title: 'OpenAI', hint: 'API key (platform.openai.com)' },
  { kind: 'gemini', glyph: '💎', title: 'Gemini', hint: 'Google AI Studio key · images + Veo video' },
  { kind: 'zai', glyph: '🐉', title: 'Z.ai GLM', hint: 'Coding Plan key' },
  { kind: 'custom', glyph: '🏠', title: 'Local or custom', hint: 'Ollama, LM Studio, vLLM, any OpenAI-style URL' },
];

export default function OnboardingScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const wide = onboardingLayoutForViewport(width, height) === 'wide';
  const completeOnboarding = useApp((s) => s.completeOnboarding);
  const providers = useApp((s) => s.providers);
  const mediaLab = useApp((s) => s.mediaLab);
  const workbench = useApp((s) => s.workbench);
  const github = useApp((s) => s.github);
  const [index, setIndex] = useState(0);
  const step = ORDER[index];
  const canBuild = readyToBuild({ providers, mediaLab, workbench, github });

  const finish = async (then?: () => void) => {
    await completeOnboarding();
    router.replace('/(tabs)');
    then?.();
  };
  const next = () => setIndex((i) => Math.min(ORDER.length - 1, i + 1));
  const back = () => setIndex((i) => Math.max(0, i - 1));

  return (
    <View style={[styles.screen, { backgroundColor: theme.background, paddingTop: insets.top + 6, paddingBottom: insets.bottom + 10 }]}>
      <LinearGradient colors={[theme.glowSoft, 'transparent']} style={styles.ambientTop} pointerEvents="none" />

      <View style={[styles.shell, wide && styles.shellWide]}>
        <View style={styles.topbar}>
          <View style={styles.brand}>
            <Image source={APP_ICON} style={styles.brandMark} accessibilityLabel="VibeX Studio logo" accessibilityIgnoresInvertColors />
            <ThemedText type="heading">VibeX Studio</ThemedText>
          </View>
          {step !== 'welcome' && step !== 'done' ? (
            <Pressable accessibilityRole="button" onPress={() => finish()} hitSlop={12}>
              <ThemedText type="small" themeColor="textSecondary">Skip setup</ThemedText>
            </Pressable>
          ) : null}
        </View>

        {step !== 'welcome' ? (
          <View style={styles.progress}>
            {ORDER.slice(1).map((id, i) => (
              <View
                key={id}
                style={[styles.progressSeg, { backgroundColor: i + 1 <= index ? theme.tint : theme.border }]}
              />
            ))}
          </View>
        ) : null}

        <ScrollView
          key={step}
          contentContainerStyle={styles.body}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}>
          <Animated.View entering={enter(FadeInDown.duration(380))} style={styles.copy}>
            {step === 'welcome' ? <Welcome /> : null}
            {step === 'ai' ? <AiStep /> : null}
            {step === 'media' ? <MediaStep /> : null}
            {step === 'computer' ? <ComputerStep /> : null}
            {step === 'done' ? <DoneStep canBuild={canBuild} /> : null}
          </Animated.View>
        </ScrollView>

        <Animated.View entering={enter(FadeIn.duration(300))} style={styles.footer}>
          {index > 0 && step !== 'done' ? (
            <Pressable accessibilityRole="button" onPress={back} hitSlop={10} style={styles.backBtn}>
              <Ionicons name="chevron-back" size={18} color={theme.textSecondary} />
              <ThemedText type="smallBold" themeColor="textSecondary">Back</ThemedText>
            </Pressable>
          ) : (
            <View />
          )}
          {step === 'done' ? (
            <View style={styles.doneActions}>
              <Pressable accessibilityRole="button" onPress={() => finish(() => router.push('/studio-tour' as never))} hitSlop={8}>
                <ThemedText type="smallBold" themeColor="textSecondary">60-second tour</ThemedText>
              </Pressable>
              <GradientButton
                title={canBuild ? 'Start building' : 'Enter the studio'}
                icon="sparkles"
                onPress={() => finish(canBuild ? () => router.push('/new-project') : undefined)}
              />
            </View>
          ) : (
            <GradientButton
              title={step === 'welcome' ? 'Get started' : step === 'ai' && !canBuild ? 'Skip for now' : 'Continue'}
              icon="arrow-forward"
              subtle={step === 'ai' && !canBuild}
              onPress={next}
            />
          )}
        </Animated.View>
      </View>
    </View>
  );
}

// ---------------------------------------------------------------------------

function Welcome() {
  const theme = useTheme();
  return (
    <View style={styles.welcome}>
      <LinearGradient colors={gradientColors(theme)} style={styles.orb}>
        <ThemedText style={styles.orbEmoji}>🪄</ThemedText>
      </LinearGradient>
      <ThemedText type="title" style={styles.title}>Create anything.{'\n'}Keep it yours.</ThemedText>
      <ThemedText themeColor="textSecondary" style={styles.lede}>
        Describe an app and watch it become real. Make images, video, and music. Use the AI you already pay
        for. Everything stays on {thisDevice} — no account, no servers, no tracking.
      </ThemedText>
      <ThemedText type="small" themeColor="textSecondary" style={styles.lede}>
        Setup takes about a minute. Every step can be skipped and finished later.
      </ThemedText>
    </View>
  );
}

function StepHeader({ eyebrow, title, body }: { eyebrow: string; title: string; body: string }) {
  const theme = useTheme();
  return (
    <View style={styles.header}>
      <ThemedText style={[styles.eyebrow, { color: theme.tint }]}>{eyebrow}</ThemedText>
      <ThemedText type="title" style={styles.stepTitle}>{title}</ThemedText>
      <ThemedText themeColor="textSecondary" style={styles.stepBody}>{body}</ThemedText>
    </View>
  );
}

function AiStep() {
  const providers = useApp((s) => s.providers);
  const connectedSubs = new Set(providers.map((p) => p.subscription).filter(Boolean));
  const connectedKinds = new Set(providers.filter((p) => !p.subscription).map((p) => p.kind));
  return (
    <>
      <StepHeader
        eyebrow="STEP 1 · YOUR AI"
        title="Which AI do you already have?"
        body="Pick any you use. A subscription signs in with the vendor’s own app id — no key. Keys go in the secure keychain and are only ever sent to that provider."
      />
      <GroupLabel text="SIGN IN WITH A SUBSCRIPTION" />
      <View style={styles.grid}>
        {SUBSCRIPTION_ORDER.map((id) => (
          <ChoiceTile
            key={id}
            glyph={SUB_GLYPH[id]}
            title={SUB_SHORT[id]}
            hint={connectedSubs.has(id) ? 'Connected' : SUBSCRIPTION_PROVIDERS[id].defaultModel}
            done={connectedSubs.has(id)}
            onPress={() => router.push({ pathname: '/connect-subscription', params: { provider: id } })}
          />
        ))}
      </View>
      <GroupLabel text="OR USE A KEY" />
      <View style={styles.grid}>
        {KEY_KINDS.map((k) => (
          <ChoiceTile
            key={k.kind}
            glyph={k.glyph}
            title={k.title}
            hint={connectedKinds.has(k.kind) ? 'Connected' : k.hint}
            done={connectedKinds.has(k.kind)}
            onPress={() => router.push({ pathname: '/connect-provider', params: { kind: k.kind } })}
          />
        ))}
      </View>
      <ThemedText type="small" themeColor="textSecondary" style={styles.foot}>
        Free option: OpenRouter has free-tier models, and a local Ollama on your computer costs nothing. Default
        models are curated — change them any time. {PROVIDERS.openrouter.name} sign-in needs no key at all.
      </ThemedText>
    </>
  );
}

function MediaStep() {
  const providers = useApp((s) => s.providers);
  const mediaLab = useApp((s) => s.mediaLab);
  const onDevice = mediaCapable(providers);
  const hasFal = providers.some((p) => p.kind === 'fal');
  return (
    <>
      <StepHeader
        eyebrow="STEP 2 · MEDIA LAB"
        title="Where should media get made?"
        body="Images, video, and music. Pick what fits today — every door stays open in Setup."
      />
      <View style={styles.doors}>
        <DoorRow
          glyph="📱"
          title={`Just ${thisDevice}`}
          body={
            onDevice.length
              ? `Ready — ${onDevice[0].label} can make ${onDevice.some((p) => p.capabilities.video) ? 'images and video' : 'images'}.`
              : 'Uses an AI you connect that can make images (ChatGPT, Grok, Gemini, OpenAI). Nothing to install.'
          }
          done={onDevice.length > 0}
          badge={onDevice.length ? undefined : 'Default'}
          onPress={() => router.push({ pathname: '/connect-provider', params: { kind: 'gemini' } })}
        />
        <DoorRow
          glyph="🖥️"
          title="My computer or a GPU box"
          body={
            mediaLab
              ? `Paired with ${hostLabel(mediaLab.url)} — the full studio lives in the Media Lab tab.`
              : 'The desktop app includes Media Lab; a DGX Spark runs the full studio. Scan its QR — done.'
          }
          done={mediaLab != null}
          onPress={() => router.push('/pair-scan' as never)}
        />
        <DoorRow
          glyph="☁️"
          title="Cloud rendering (fal.ai)"
          body={hasFal ? 'Connected — big GPUs by the second, on your own key.' : 'Rent big GPUs by the second. A short walkthrough gets you a key and the best models.'}
          done={hasFal}
          onPress={() => router.push('/fal-setup')}
        />
      </View>
    </>
  );
}

function ComputerStep() {
  const workbench = useApp((s) => s.workbench);
  const github = useApp((s) => s.github);
  return (
    <>
      <StepHeader
        eyebrow="STEP 3 · YOUR COMPUTER"
        title="Got a computer nearby?"
        body="Pair the free desktop app and your computer does the heavy lifting: real npm installs, dev servers, and builds — previewed right here. Optional, and always available later."
      />
      <View style={styles.doors}>
        <DoorRow
          glyph="🔗"
          title={workbench ? 'Computer paired' : 'Pair with a QR code'}
          body={
            workbench
              ? `${hostLabel(workbench.url)} builds and serves projects for this device.`
              : 'On the computer: VibeX Studio → Media Lab → Pair your device. Then scan.'
          }
          done={workbench != null}
          onPress={() => router.push('/pair-scan' as never)}
        />
        <DoorRow
          glyph="🐙"
          title={github ? `GitHub · @${github.login}` : 'Connect GitHub'}
          body={github ? 'Your repos host the apps you publish.' : 'Publish finished apps to your own GitHub Pages and share a link. Optional.'}
          done={github != null}
          onPress={() => router.push('/connect-github')}
        />
      </View>
      <ThemedText type="small" themeColor="textSecondary" style={styles.foot}>
        Don’t have the desktop app? It’s free for macOS, Windows, and Linux at github.com/kerpopule/vibexstudio.
      </ThemedText>
    </>
  );
}

function DoneStep({ canBuild }: { canBuild: boolean }) {
  const theme = useTheme();
  const providers = useApp((s) => s.providers);
  const mediaLab = useApp((s) => s.mediaLab);
  const workbench = useApp((s) => s.workbench);
  const github = useApp((s) => s.github);
  const lines = [
    providers.length ? `✓ ${providers.map((p) => p.label).join(', ')}` : '○ No AI yet — add one from Setup any time',
    mediaLab ? `✓ Media Lab paired (${hostLabel(mediaLab.url)})` : mediaCapable(providers).length ? '✓ Media on this device' : '○ Media Lab — set up later',
    workbench ? `✓ Computer paired (${hostLabel(workbench.url)})` : '○ No computer paired',
    github ? `✓ GitHub @${github.login}` : '○ GitHub — connect when you want to publish',
  ];
  return (
    <View style={styles.welcome}>
      <LinearGradient colors={gradientColors(theme)} style={styles.orb}>
        <ThemedText style={styles.orbEmoji}>{canBuild ? '🚀' : '✨'}</ThemedText>
      </LinearGradient>
      <ThemedText type="title" style={styles.title}>{canBuild ? 'You’re set.' : 'Welcome in.'}</ThemedText>
      <Glass radius={Radii.xl} style={styles.summary}>
        {lines.map((line) => (
          <ThemedText key={line} type="small" style={styles.summaryLine}>{line}</ThemedText>
        ))}
      </Glass>
      <ThemedText type="small" themeColor="textSecondary" style={styles.lede}>
        Everything above lives in the Setup tab. Change it whenever you like.
      </ThemedText>
    </View>
  );
}

// ---------------------------------------------------------------------------

function GroupLabel({ text }: { text: string }) {
  return <ThemedText style={styles.groupLabel} themeColor="textSecondary">{text}</ThemedText>;
}

function ChoiceTile({ glyph, title, hint, done, onPress }: { glyph: string; title: string; hint: string; done: boolean; onPress: () => void }) {
  const theme = useTheme();
  return (
    <ScalePress
      accessibilityRole="button"
      onPress={onPress}
      style={[
        styles.tile,
        { backgroundColor: done ? theme.tintSoft : theme.backgroundElement, borderColor: done ? theme.tint : theme.border },
      ]}>
      <View style={styles.tileTop}>
        <ThemedText style={styles.tileGlyph}>{glyph}</ThemedText>
        {done ? <Ionicons name="checkmark-circle" size={18} color={theme.tint} /> : null}
      </View>
      <ThemedText type="heading" numberOfLines={1}>{title}</ThemedText>
      <ThemedText type="small" themeColor="textSecondary" numberOfLines={2}>{hint}</ThemedText>
    </ScalePress>
  );
}

function DoorRow({ glyph, title, body, done, badge, onPress }: { glyph: string; title: string; body: string; done: boolean; badge?: string; onPress: () => void }) {
  const theme = useTheme();
  return (
    <ScalePress
      accessibilityRole="button"
      onPress={onPress}
      style={[styles.door, { backgroundColor: done ? theme.tintSoft : theme.backgroundElement, borderColor: done ? theme.tint : theme.border }]}>
      <View style={[styles.doorGlyph, { backgroundColor: done ? theme.tint : theme.tintSoft }]}>
        <ThemedText style={styles.doorGlyphText}>{glyph}</ThemedText>
      </View>
      <View style={styles.doorBody}>
        <View style={styles.doorTitleRow}>
          <ThemedText type="heading">{title}</ThemedText>
          {badge ? (
            <View style={[styles.badge, { backgroundColor: theme.tint }]}>
              <ThemedText style={[styles.badgeText, { color: theme.onTint }]}>{badge.toUpperCase()}</ThemedText>
            </View>
          ) : null}
        </View>
        <ThemedText type="small" themeColor="textSecondary">{body}</ThemedText>
      </View>
      <Ionicons name={done ? 'checkmark-circle' : 'chevron-forward'} size={18} color={done ? theme.tint : theme.textSecondary} />
    </ScalePress>
  );
}

function GradientButton({ title, icon, onPress, subtle }: { title: string; icon: keyof typeof Ionicons.glyphMap; onPress: () => void; subtle?: boolean }) {
  const theme = useTheme();
  if (subtle) {
    return (
      <ScalePress accessibilityRole="button" onPress={onPress} style={[styles.next, { backgroundColor: theme.backgroundSelected }]}>
        <ThemedText type="smallBold">{title}</ThemedText>
        <Ionicons name={icon} size={18} color={theme.text} />
      </ScalePress>
    );
  }
  return (
    <ScalePress accessibilityRole="button" onPress={onPress} style={[styles.nextShadow, { shadowColor: theme.glow }, Shadows.float]}>
      <LinearGradient colors={gradientColors(theme)} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.next}>
        <ThemedText type="smallBold" style={{ color: theme.onGradient }}>{title}</ThemedText>
        <Ionicons name={icon} size={18} color={theme.onGradient} />
      </LinearGradient>
    </ScalePress>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, paddingHorizontal: 18, overflow: 'hidden' },
  shell: { flex: 1, width: '100%', alignSelf: 'center' },
  shellWide: { maxWidth: 720 },
  ambientTop: { position: 'absolute', top: 0, left: 0, right: 0, height: 320 },
  topbar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', height: 48 },
  brand: { flexDirection: 'row', alignItems: 'center', gap: 9 },
  brandMark: { width: 30, height: 30, borderRadius: 10, resizeMode: 'cover' },
  progress: { flexDirection: 'row', gap: 6, marginTop: 4, marginBottom: 6 },
  progressSeg: { flex: 1, height: 4, borderRadius: 2 },
  body: { paddingVertical: Spacing.three, paddingBottom: Spacing.four },
  copy: { gap: Spacing.three },
  welcome: { alignItems: 'center', gap: Spacing.three, paddingTop: Spacing.four },
  orb: { width: 108, height: 108, borderRadius: 54, alignItems: 'center', justifyContent: 'center', opacity: 0.9 },
  orbEmoji: { fontSize: 50, lineHeight: 60 },
  title: { fontSize: 38, lineHeight: 42, textAlign: 'center', letterSpacing: -1 },
  lede: { fontSize: 16, lineHeight: 23, textAlign: 'center', maxWidth: 480 },
  header: { gap: 8 },
  eyebrow: { fontFamily: Fonts.display, fontSize: 11, letterSpacing: 1.4 },
  stepTitle: { fontSize: 32, lineHeight: 36, letterSpacing: -0.8 },
  stepBody: { fontSize: 15, lineHeight: 21 },
  groupLabel: { fontFamily: Fonts.display, fontSize: 10.5, letterSpacing: 1.3, marginTop: 4 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  tile: { width: '48%', flexGrow: 1, borderRadius: Radii.lg, borderWidth: StyleSheet.hairlineWidth, padding: 14, gap: 4, minHeight: 104 },
  tileTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  tileGlyph: { fontSize: 24, lineHeight: 30 },
  foot: { lineHeight: 19 },
  doors: { gap: 10 },
  door: { flexDirection: 'row', alignItems: 'center', gap: 12, borderRadius: Radii.xl, borderWidth: StyleSheet.hairlineWidth, padding: 14 },
  doorGlyph: { width: 46, height: 46, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  doorGlyphText: { fontSize: 22, lineHeight: 28 },
  doorBody: { flex: 1, gap: 3 },
  doorTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  badge: { borderRadius: Radii.pill, paddingHorizontal: 8, paddingVertical: 3 },
  badgeText: { fontFamily: Fonts.display, fontSize: 9, letterSpacing: 1 },
  summary: { alignSelf: 'stretch', padding: Spacing.three, gap: 6 },
  summaryLine: { lineHeight: 20 },
  footer: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingTop: Spacing.two },
  backBtn: { flexDirection: 'row', alignItems: 'center', gap: 2, paddingVertical: 8 },
  doneActions: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: Spacing.four },
  nextShadow: { borderRadius: Radii.pill },
  next: { minHeight: 50, borderRadius: Radii.pill, paddingHorizontal: 22, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 9 },
});
