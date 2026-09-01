/**
 * Pair a computer — the one in-app door for both halves of the desktop QR
 * (Media Lab + Workbench) and for a Spark or any Media Lab server.
 *
 *   • Scan: the camera reads the `vibex://pair?…` QR the desktop app or the
 *     Spark installer shows. No typing.
 *   • Type: paste the pair link itself, or just a server address
 *     (`192.168.1.20:7863`, `spark.tail1234.ts.net:7863`).
 *
 * Both roads end on /pair, which probes each half and reports what paired.
 */
import Ionicons from '@expo/vector-icons/Ionicons';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';
import { router } from 'expo-router';
import { useRef, useState } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Button } from '@/components/ui/button';
import { TextField } from '@/components/ui/text-field';
import { Radii, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { pairParamsFromInput } from '@/lib/media-pairing';

export default function PairScanScreen() {
  const theme = useTheme();
  const [permission, requestPermission] = useCameraPermissions();
  const [typed, setTyped] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [scanning, setScanning] = useState(Platform.OS !== 'web');
  const handled = useRef(false);

  const go = (raw: string) => {
    const params = pairParamsFromInput(raw);
    if (!params) {
      setError('That isn’t a pair code or a server address. Scan the QR from the desktop app, or type something like 192.168.1.20:7863.');
      handled.current = false;
      return;
    }
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    router.replace({ pathname: '/pair', params });
  };

  const onScanned = ({ data }: { data: string }) => {
    if (handled.current) return;
    handled.current = true;
    go(data);
  };

  const pasteAndGo = async () => {
    const text = (await Clipboard.getStringAsync()).trim();
    if (text) {
      setTyped(text);
      go(text);
    }
  };

  const cameraAllowed = permission?.granted === true;

  return (
    <ThemedView style={styles.container}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <ThemedText themeColor="textSecondary">
          On the computer: open VibeX Studio → <ThemedText type="smallBold">Media Lab → Pair your device</ThemedText>. On a
          Spark, run <ThemedText type="code">media-lab pair</ThemedText>. Then point the camera at the QR.
        </ThemedText>

        {scanning ? (
          <View style={[styles.viewfinder, { backgroundColor: theme.backgroundElement, borderColor: theme.border }]}>
            {cameraAllowed ? (
              <CameraView
                style={StyleSheet.absoluteFill}
                facing="back"
                barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
                onBarcodeScanned={onScanned}
              />
            ) : (
              <View style={styles.permission}>
                <Ionicons name="qr-code-outline" size={44} color={theme.tint} />
                <ThemedText type="heading" style={styles.center}>Scan the pairing QR</ThemedText>
                <ThemedText type="small" themeColor="textSecondary" style={styles.center}>
                  VibeX only uses the camera to read the code. Nothing is recorded.
                </ThemedText>
                <Button title="Allow camera" onPress={() => requestPermission()} />
              </View>
            )}
            {cameraAllowed ? (
              <View pointerEvents="none" style={styles.frame}>
                {(['tl', 'tr', 'bl', 'br'] as const).map((corner) => (
                  <View key={corner} style={[styles.corner, styles[corner], { borderColor: theme.tint }]} />
                ))}
              </View>
            ) : null}
          </View>
        ) : null}

        <View style={styles.orRow}>
          <View style={[styles.rule, { backgroundColor: theme.border }]} />
          <ThemedText type="small" themeColor="textSecondary">or type it</ThemedText>
          <View style={[styles.rule, { backgroundColor: theme.border }]} />
        </View>

        <TextField
          label="Pair link or server address"
          placeholder="192.168.1.20:7863  ·  vibex://pair?…"
          value={typed}
          onChangeText={(v) => {
            setTyped(v);
            setError(null);
          }}
          keyboardType="url"
          mono
          onSubmitEditing={() => go(typed)}
          returnKeyType="go"
        />
        <View style={styles.actions}>
          <Pressable onPress={pasteAndGo} hitSlop={8} style={styles.inline}>
            <Ionicons name="clipboard-outline" size={15} color={theme.tint} />
            <ThemedText type="smallBold" themeColor="tint">Paste</ThemedText>
          </Pressable>
          {!scanning && Platform.OS !== 'web' ? (
            <Pressable onPress={() => setScanning(true)} hitSlop={8} style={styles.inline}>
              <Ionicons name="camera-outline" size={15} color={theme.tint} />
              <ThemedText type="smallBold" themeColor="tint">Scan instead</ThemedText>
            </Pressable>
          ) : null}
        </View>
        <Button title="Pair" onPress={() => go(typed)} disabled={!typed.trim()} />
        {error ? <ThemedText type="small" style={{ color: theme.danger }}>{error}</ThemedText> : null}

        <ThemedText type="small" themeColor="textSecondary" style={styles.foot}>
          Pairing is local: this device and the computer talk over your own Wi-Fi or tailnet. The Workbench token in
          the QR is the only key, and it never leaves your devices.
        </ThemedText>
      </ScrollView>
    </ThemedView>
  );
}

const CORNER = 26;

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { padding: Spacing.three, gap: Spacing.three },
  viewfinder: {
    aspectRatio: 1,
    borderRadius: Radii.xl,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  permission: { alignItems: 'center', gap: Spacing.two, padding: Spacing.four },
  center: { textAlign: 'center' },
  frame: { position: 'absolute', top: 34, left: 34, right: 34, bottom: 34 },
  corner: { position: 'absolute', width: CORNER, height: CORNER, borderWidth: 3 },
  tl: { top: 0, left: 0, borderRightWidth: 0, borderBottomWidth: 0, borderTopLeftRadius: 10 },
  tr: { top: 0, right: 0, borderLeftWidth: 0, borderBottomWidth: 0, borderTopRightRadius: 10 },
  bl: { bottom: 0, left: 0, borderRightWidth: 0, borderTopWidth: 0, borderBottomLeftRadius: 10 },
  br: { bottom: 0, right: 0, borderLeftWidth: 0, borderTopWidth: 0, borderBottomRightRadius: 10 },
  orRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  rule: { flex: 1, height: StyleSheet.hairlineWidth },
  actions: { flexDirection: 'row', gap: Spacing.four },
  inline: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  foot: { lineHeight: 19 },
});
