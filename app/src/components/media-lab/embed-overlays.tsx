/**
 * What the in-app Media Lab shows over its frame when the studio page cannot
 * simply open: a one-time sign-in with the Media Lab code, or a plain problem
 * card with a way out. Shared by the web iframe and the phone WebView.
 */
import Ionicons from '@expo/vector-icons/Ionicons';
import { useState } from 'react';
import { Linking, StyleSheet, TextInput, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { Glass } from '@/components/ui/glass';
import { Radii, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { connectRemoteGeneration } from '@/lib/remote-generation';

/** Where the embedded studio stands, as the app sees it. */
export type EmbedState =
  | 'opening'        // the frame is loading /embed
  | 'signing-in'     // the frame asked for a ticket; the app is handing one over
  | 'ready'          // the studio page is up and signed in
  | 'sign-in'        // this device has no usable Media Lab pass: ask for the code once
  | 'blocked'        // this browser will not keep a sign-in inside a frame
  | 'not-allowed'    // the studio does not list this app's address
  | 'timeout'        // the frame never answered (blocked from framing, or offline)
  | 'failed';        // the studio refused or could not complete sign-in

export function stateTone(state: EmbedState): 'good' | 'busy' | 'bad' {
  if (state === 'ready') return 'good';
  if (state === 'opening' || state === 'signing-in' || state === 'sign-in') return 'busy';
  return 'bad';
}

export function EmbedSignIn({ serverUrl, host, onSignedIn }: { serverUrl: string; host: string; onSignedIn: () => void }) {
  const theme = useTheme();
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async () => {
    if (!code.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      await connectRemoteGeneration(serverUrl, code.trim());
      setCode('');
      onSignedIn();
    } catch (e) {
      const message = e instanceof Error ? e.message : '';
      setError(/generation permission|could not complete this request \(403\)/i.test(message)
        ? 'That code didn’t open Media Lab. Check it and try again.'
        : message || 'Could not sign in. Try again.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <View style={styles.scrim} pointerEvents="box-none">
      <Glass radius={Radii.xl} style={styles.card}>
        <View style={[styles.badge, { backgroundColor: theme.tintSoft }]}>
          <Ionicons name="key-outline" size={20} color={theme.tint} />
        </View>
        <ThemedText type="heading" style={styles.center}>Sign in to Media Lab</ThemedText>
        <ThemedText type="small" themeColor="textSecondary" style={styles.center}>
          Enter the Media Lab code for {host} once. This device remembers it, and Media Lab opens right here in Create.
        </ThemedText>
        <TextInput
          accessibilityLabel="Media Lab code"
          value={code}
          onChangeText={setCode}
          onSubmitEditing={submit}
          editable={!busy}
          secureTextEntry
          autoCapitalize="none"
          autoCorrect={false}
          placeholder="Media Lab code"
          placeholderTextColor={theme.textSecondary}
          style={[styles.input, { color: theme.text, borderColor: theme.border, backgroundColor: theme.backgroundElement }]}
        />
        {error ? <ThemedText accessibilityRole="alert" type="small" style={{ color: theme.danger }}>{error}</ThemedText> : null}
        <Button title="Sign in" onPress={submit} loading={busy} disabled={!code.trim()} />
      </Glass>
    </View>
  );
}

export function EmbedProblem({ state, openUrl, appOrigin, onRetry }: {
  state: Exclude<EmbedState, 'opening' | 'signing-in' | 'ready' | 'sign-in'>;
  openUrl: string;
  appOrigin?: string | null;
  onRetry: () => void;
}) {
  const theme = useTheme();
  const copy = PROBLEMS[state];
  return (
    <View style={styles.scrim} pointerEvents="box-none">
      <Glass radius={Radii.xl} style={styles.card}>
        <View style={[styles.badge, { backgroundColor: theme.tintSoft }]}>
          <Ionicons name={copy.icon} size={20} color={theme.tint} />
        </View>
        <ThemedText type="heading" style={styles.center}>{copy.title}</ThemedText>
        <ThemedText type="small" themeColor="textSecondary" style={styles.center}>{copy.body}</ThemedText>
        {state === 'not-allowed' && appOrigin ? (
          <ThemedText type="small" selectable style={[styles.center, styles.code, { backgroundColor: theme.backgroundElement }]}>
            {appOrigin}
          </ThemedText>
        ) : null}
        <Button title="Open Media Lab in its own window" onPress={() => { void Linking.openURL(openUrl); }} />
        <Button title="Try again" variant="secondary" onPress={onRetry} />
      </Glass>
    </View>
  );
}

const PROBLEMS: Record<'blocked' | 'not-allowed' | 'timeout' | 'failed', { icon: keyof typeof Ionicons.glyphMap; title: string; body: string }> = {
  blocked: {
    icon: 'lock-closed-outline',
    title: 'This browser won’t keep you signed in here',
    body: 'Media Lab needs a secure (https) address to stay signed in inside the app. Open it in its own window, or pair this device with the studio’s https address.',
  },
  'not-allowed': {
    icon: 'shield-outline',
    title: 'Media Lab doesn’t know this app yet',
    body: 'The studio only opens inside apps it lists. Whoever runs it can add this app’s address to MEDIA_LAB_BROWSER_ORIGINS in its local.env:',
  },
  timeout: {
    icon: 'cloud-offline-outline',
    title: 'Media Lab didn’t open here',
    body: 'The studio didn’t answer inside the app. It may be offline, or it may not allow this app to show it yet.',
  },
  failed: {
    icon: 'alert-circle-outline',
    title: 'Sign-in didn’t finish',
    body: 'Media Lab refused this sign-in. Try again; if it keeps happening, open it in its own window.',
  },
};

const styles = StyleSheet.create({
  scrim: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
    padding: Spacing.three,
    backgroundColor: 'rgba(8,6,5,0.55)',
  },
  card: {
    width: '100%',
    maxWidth: 400,
    padding: Spacing.four,
    gap: Spacing.three,
    alignItems: 'stretch',
  },
  badge: {
    alignSelf: 'center',
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  center: { textAlign: 'center' },
  code: { paddingVertical: 8, paddingHorizontal: 12, borderRadius: Radii.sm },
  input: {
    minHeight: 48,
    borderWidth: 1,
    borderRadius: Radii.md,
    paddingHorizontal: Spacing.three,
    fontSize: 18,
    letterSpacing: 2,
    textAlign: 'center',
  },
});
