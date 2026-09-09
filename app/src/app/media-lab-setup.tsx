import {probeMediaHost} from '@/lib/media-host-probe';
/** Choose a generation host. Configured connections are highlighted without
 * claiming an untested provider is healthy or that inference runs locally. */
import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Linking, ScrollView, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Button } from '@/components/ui/button';
import { ScalePress } from '@/components/ui/scale-press';
import { Radii, Spacing } from '@/constants/theme';
import { useApp } from '@/lib/store';
import { modelSetupUrl } from '@/lib/setup';
import { useTheme } from '@/hooks/use-theme';

export default function MediaLabSetupScreen() {
  const theme = useTheme();
  const [showDesktopSteps, setShowDesktopSteps] = useState(false);
  const hasMediaProvider = useApp((s) => s.providers.some((p) => p.capabilities.image || p.capabilities.video));
  const serverUrl = useApp((s) => s.mediaLab?.url);

  const [modelManager,setModelManager]=useState<{origin:string;available:boolean}|null>(null);
  useEffect(()=>{
    let active=true;
    if(serverUrl)void probeMediaHost(serverUrl).then(host=>{if(active)setModelManager({origin:serverUrl,available:host?.modelSetup===true});});
    return()=>{active=false;};
  },[serverUrl]);
  const setupUrl = modelManager?.origin===serverUrl&&modelManager?.available?modelSetupUrl(serverUrl):null;
  const [openError, setOpenError] = useState('');

  return (
    <ThemedView style={styles.container}>
      <ScrollView contentContainerStyle={styles.content}>
        <ThemedText themeColor="textSecondary" style={styles.blurb}>
          How do you want to make images and video? Pick what fits — you can add the others any time.
        </ThemedText>

        {/* Use an existing provider or connect one. */}
        <DoorCard
          icon="phone-portrait"
          title="Use a connected AI"
          body="Use your own provider or local model. Generation runs wherever that AI is hosted."
          badge={hasMediaProvider ? 'Configured' : undefined}
          selected={hasMediaProvider && !serverUrl}
          onPress={() => router.push(hasMediaProvider ? '/(tabs)/media-lab' : '/connect-provider')}
        />

        <DoorCard
          icon="server-outline"
          title="Use my computer or server"
          body="Connect a Spark, another computer, or your Media Lab domain. An independent server can keep running while this device is off."
          badge={serverUrl ? 'Paired' : undefined}
          selected={Boolean(serverUrl)}
          onPress={() => router.push('/connect-media-lab')}
        />

        {setupUrl ? (
          <DoorCard
            icon="options-outline"
            title="Manage server models"
            body="Install, enable or remove background removal on your paired server. Opens in your browser and requires the server administrator code. Available on servers with independent model setup enabled."
            onPress={() => {
              setOpenError('');
              void Linking.openURL(setupUrl).catch(() => setOpenError('Could not open server setup. Check that your server is reachable and try again.'));
            }}
          />
        ) : null}
        {openError ? <ThemedText accessibilityRole="alert">{openError}</ThemedText> : null}

        {/* Door 2 — desktop app QR pairing. */}
        <DoorCard
          icon="desktop-outline"
          title="I have the desktop app"
          body="Pair your phone with the desktop app using its QR code. Tasks hosted by that computer need it to stay on. Local media generation also needs installed models."
          onPress={() => setShowDesktopSteps((v) => !v)}
        />
        {showDesktopSteps ? (
          <View style={[styles.steps, { backgroundColor: theme.backgroundElement }]}>
            {[
              'Open VibeX Studio on your computer',
              'Choose “Pair your device”',
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
              Scan the QR code with VibeX installed, then follow the pairing prompts. To keep working when your computer is off, connect directly to an independent server or your own cloud AI provider.
            </ThemedText>
          </View>
        ) : null}

        {/* Door 3 — fal.ai walkthrough. */}
        <DoorCard
          icon="cloud-outline"
          title="I want cloud rendering (fal.ai)"
          body="Use a paid cloud provider when you need more GPU power. Setup explains the key and model choices."
          onPress={() => router.push('/fal-setup')}
        />

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
    flexWrap: 'wrap',
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
  done: {
    marginTop: Spacing.two,
  },
});
