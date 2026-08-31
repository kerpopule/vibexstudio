/**
 * Media Lab setup — the four doors. Each card is worded by what the user HAS,
 * never by how it works. "Just my phone" is the pre-selected zero-setup
 * default; the other doors are upgrades, and none of them is one-shot — every
 * door can be revisited later.
 */
import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Button } from '@/components/ui/button';
import { ScalePress } from '@/components/ui/scale-press';
import { Radii, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export default function MediaLabSetupScreen() {
  const theme = useTheme();
  const [showDesktopSteps, setShowDesktopSteps] = useState(false);
  const [showMore, setShowMore] = useState(false);

  return (
    <ThemedView style={styles.container}>
      <ScrollView contentContainerStyle={styles.content}>
        <ThemedText themeColor="textSecondary" style={styles.blurb}>
          How do you want to make images and video? Pick what fits — you can add the others any time.
        </ThemedText>

        {/* Door 1 — the pre-selected zero-setup default. */}
        <DoorCard
          icon="phone-portrait"
          title="Just my phone"
          body="Generate right here with the AI you already connected. Nothing to install."
          badge="Ready now"
          selected
          onPress={() => router.back()}
        />

        {/* Door 2 — desktop app QR pairing. */}
        <DoorCard
          icon="desktop-outline"
          title="I have the desktop app"
          body="The desktop app includes Media Lab. Scan its QR code and you're paired — no typing."
          onPress={() => setShowDesktopSteps((v) => !v)}
        />
        {showDesktopSteps ? (
          <View style={[styles.steps, { backgroundColor: theme.backgroundElement }]}>
            {[
              'Open VibeX Studio on your computer',
              'Choose “Pair your phone”',
              'Point your camera at the QR code',
            ].map((step, i) => (
              <View key={step} style={styles.stepRow}>
                <View style={[styles.stepDot, { backgroundColor: theme.tintSoft }]}>
                  <ThemedText type="smallBold" style={{ color: theme.tint, fontSize: 12 }}>
                    {i + 1}
                  </ThemedText>
                </View>
                <ThemedText type="small" style={styles.stepText}>
                  {step}
                </ThemedText>
              </View>
            ))}
            <ThemedText type="small" themeColor="textSecondary">
              Your phone’s regular camera works — the code opens VibeX and pairs automatically.
            </ThemedText>
          </View>
        ) : null}

        {/* Door 3 — fal.ai walkthrough. */}
        <DoorCard
          icon="cloud-outline"
          title="I want cloud rendering (fal.ai)"
          body="Rent big GPUs by the second. A short walkthrough gets you a key and the best models."
          onPress={() => router.push('/fal-setup')}
        />

        {/* Door 4 — advanced, folded behind "More options". */}
        <Pressable onPress={() => setShowMore((v) => !v)} style={styles.moreRow} hitSlop={8}>
          <ThemedText type="smallBold" themeColor="textSecondary">
            More options
          </ThemedText>
          <Ionicons
            name={showMore ? 'chevron-up' : 'chevron-down'}
            size={14}
            color={theme.textSecondary}
          />
        </Pressable>
        {showMore ? (
          <DoorCard
            icon="server-outline"
            title="I run my own server"
            body="Point VibeX at a Media Lab you host yourself — paste its address."
            onPress={() => router.push('/connect-media-lab')}
          />
        ) : null}

        <Button title="Done" variant="secondary" onPress={() => router.back()} style={styles.done} />
      </ScrollView>
    </ThemedView>
  );
}

function DoorCard({
  icon,
  title,
  body,
  badge,
  selected,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  body: string;
  badge?: string;
  selected?: boolean;
  onPress: () => void;
}) {
  const theme = useTheme();
  return (
    <ScalePress
      accessibilityRole="button"
      onPress={onPress}
      style={[
        styles.card,
        {
          backgroundColor: selected ? theme.tintSoft : theme.backgroundElement,
          borderColor: selected ? theme.tint : 'transparent',
        },
      ]}>
      <View style={[styles.iconWell, { backgroundColor: selected ? theme.tint : theme.tintSoft }]}>
        <Ionicons name={icon} size={20} color={selected ? theme.onTint : theme.tint} />
      </View>
      <View style={styles.cardBody}>
        <View style={styles.titleRow}>
          <ThemedText type="smallBold">{title}</ThemedText>
          {badge ? (
            <View style={[styles.badge, { backgroundColor: theme.tint }]}>
              <ThemedText type="smallBold" style={{ color: theme.onTint, fontSize: 10 }}>
                {badge}
              </ThemedText>
            </View>
          ) : null}
        </View>
        <ThemedText type="small" themeColor="textSecondary">
          {body}
        </ThemedText>
      </View>
      <Ionicons name="chevron-forward" size={16} color={theme.textSecondary} />
    </ScalePress>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    padding: Spacing.three,
    gap: Spacing.two,
  },
  blurb: {
    lineHeight: 20,
    marginBottom: Spacing.one,
  },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    borderRadius: Radii.lg,
    borderWidth: 1,
    padding: Spacing.three,
  },
  iconWell: {
    width: 40,
    height: 40,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardBody: {
    flex: 1,
    gap: 3,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one,
  },
  badge: {
    borderRadius: Radii.pill,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  steps: {
    borderRadius: Radii.lg,
    padding: Spacing.three,
    gap: Spacing.two,
  },
  stepRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  stepDot: {
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepText: {
    flex: 1,
  },
  moreRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: Spacing.one,
    alignSelf: 'flex-start',
  },
  done: {
    marginTop: Spacing.two,
  },
});
