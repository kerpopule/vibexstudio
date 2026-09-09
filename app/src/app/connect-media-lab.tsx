/**
 * Pair a Media Lab server. The user pastes the URL the desktop app (or
 * Spark) shows — pairing succeeds when the server's gate-exempt
 * /manifest.json answers, or scoped access succeeds with an access code.
 * Direct entries continue into Library; nested entries return to their task.
 */
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Switch, TextInput, View } from 'react-native';

import {Button} from '@/components/ui/button';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Radii, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useHostingMediaServer } from '@/hooks/use-hosting-media-server';
import { normalizeServerUrl, probeMediaLab } from '@/lib/media-pairing';
import { connectRemoteLibrary } from '@/lib/remote-library';
import { connectRemoteGeneration, disconnectRemoteGeneration, hasRemoteGenerationPermission } from '@/lib/remote-generation';
import { clearLibraryToken } from '@/lib/storage/secrets';
import { generationChoice, type PermissionChoice } from '@/lib/connection-permission';
import { useApp } from '@/lib/store';
import { canUseLocalController, localControllerStatus, installLocalController, startLocalController, discoverTailnetDevices, discoverTailnetMediaServices, type TailnetDevice, localControllerConnection } from '@/lib/local-controller';

export default function ConnectMediaLabScreen() {
  const theme = useTheme();
  // A failed vibex://pair QR scan lands here with the address prefilled.
  const params = useLocalSearchParams<{ url?: string; generation?: string }>();
  const mediaLab = useApp((s) => s.mediaLab);
  const onboardingComplete = useApp((s) => s.onboardingComplete);
  const setMediaLab = useApp((s) => s.setMediaLab);
  const hostingServer = useHostingMediaServer();
  const [method,setMethod]=useState<'local'|'tailnet'|'address'|null>(()=>params.url||mediaLab?.url?'address':null);
  const [showRequirements,setShowRequirements]=useState(false);
  useEffect(()=>{
    if(params.url||mediaLab?.url)setMethod(current=>current??'address');
  },[params.url,mediaLab?.url]);
  const [editedInput, setInput] = useState<string | null>(null);
  const input = editedInput ?? params.url ?? mediaLab?.url ?? '';
  const [installState, setInstallState] = useState<'checking' | 'unavailable' | 'existing' | 'running' | 'idle' | 'failed' | 'installed'>(canUseLocalController() ? 'checking' : 'idle');
  const [installMessage, setInstallMessage] = useState('');
  useEffect(() => {
    if (!canUseLocalController()) return;
    let active = true;
    localControllerStatus().then((status) => {
      if (!active) return;
      setInstallState(status.configured ? (status.independent ? (status.running ? 'running' : 'installed') : 'existing') : status.installationAvailable === false ? 'unavailable' : 'idle');
      setInstallMessage(status.configured ? (status.independent ? (status.running ? 'Your local controller is running.' : 'Your local controller is installed and stopped.') : 'A controller is already configured. Manage it from the desktop Media Lab menu.') : status.installationMessage ?? '');
    }).catch((cause) => {
      if (!active) return;
      setInstallState('unavailable');
      setInstallMessage(cause instanceof Error ? cause.message : String(cause));
    });
    return () => { active = false; };
  }, []);
  const [devices, setDevices] = useState<TailnetDevice[] | null>(null);
  const [showDevices,setShowDevices]=useState(true);
  const [showOffline,setShowOffline]=useState(false);
  const [code, setCode] = useState('');
  const [services,setServices]=useState<{device:string;urls:string[]}|null>(null);
  const origin = normalizeServerUrl(input);
  const requestedOrigin = params.generation === '1' ? normalizeServerUrl(params.url ?? mediaLab?.url ?? '') : null;
  const [choice, setChoice] = useState<PermissionChoice | null>(null);
  const [savedPermission, setSavedPermission] = useState<PermissionChoice | null>(null);
  const generation = generationChoice(origin, requestedOrigin, choice, savedPermission);
  useEffect(() => {
    let active = true;
    if (origin) {
      hasRemoteGenerationPermission(origin).then((allowed) => {
        if (active) setSavedPermission({origin, allowed});
      }).catch(() => { /* The user can explicitly reconnect unreadable credentials. */ });
    }
    return () => {active = false;};
  },[origin]);
  const [busy, setBusy] = useState(false);
  const [pairing,setPairing]=useState(false),[checkingDevice,setCheckingDevice]=useState<string|null>(null);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    const url = normalizeServerUrl(input);
    if (!url) {
      setError('That doesn’t look like a URL. Example: http://your-server:7863');
      return;
    }
    setBusy(true);setPairing(true);
    setError(null);
    try {
      if (generation && !code.trim()) throw new Error('Enter the access code to allow generation on this device.');
      if (generation) await connectRemoteGeneration(url,code.trim());
      else if (code.trim()) await connectRemoteLibrary(url, code.trim());
      else if (!(await probeMediaLab(url))) throw new Error('No Media Lab answered there. Check the address and server connection.');
      if (!generation) await disconnectRemoteGeneration(url);
      await setMediaLab({ url, addedAt: Date.now() });
      setCode('');
      if (router.canGoBack()) router.back();
      else if (!onboardingComplete) router.replace('/onboarding');
      else router.replace('/(tabs)/creations');
    } catch (e) {
      // DOMException is not an Error in every webview (WebKitGTK); keep its message.
      const message = e instanceof Error ? e.message : (typeof e === 'object' && e && 'message' in e && typeof (e as {message: unknown}).message === 'string') ? (e as {message: string}).message : '';
      setError(message || 'Could not connect to Media Lab.');
    }
    finally { setBusy(false);setPairing(false); }

  };

  const useLocal = async () => {
    if (busy) return;
    setBusy(true);setError(null);
    try {
      const local = await localControllerConnection();
      setInput(local.url);setCode(local.code);
      setChoice({origin:local.url,allowed:false});
    } catch (error) {setError(error instanceof Error ? error.message : String(error));}
    finally {setBusy(false);}
  };

  const installHere = async (resume: boolean) => {
    if (busy) return;
    setBusy(true); setError(null); setInstallMessage('Installing the controller. Keep this app open; dependencies may take several minutes.');
    try {
      await installLocalController(resume);
      setInstallState('installed'); setInstallMessage('Controller installed and selected. Models are installed separately.');
    } catch (cause) {
      setInstallState('failed'); setInstallMessage('');
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally { setBusy(false); }
  };
  const startHere = async () => {
    setBusy(true); setError(null);
    try { await startLocalController(); setInstallState('running'); setInstallMessage('Controller started. Choose “Use this computer” to load its connection details.'); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(false); }
  };

  const findDevices = async () => {
    setBusy(true); setError(null);
    try { setDevices(await discoverTailnetDevices()); setShowDevices(true); setShowOffline(false); }
    catch (error) { setError(error instanceof Error ? error.message : 'Device discovery failed. Enter an address instead.'); }
    finally { setBusy(false); }
  };

  const findServices=async(device:TailnetDevice)=>{
    if(busy)return;
    setShowDevices(false);setBusy(true);setCheckingDevice(device.name);setError(null);setServices(null);setInput('');setCode('');
    try{
      const urls=await discoverTailnetMediaServices(device.address);
      setServices({device:device.name,urls});
      if(urls.length===1)setInput(urls[0]);
    }catch(cause){setError(cause instanceof Error?cause.message:'Could not check this device. Enter its full Media Lab link below.');}
    finally{setBusy(false);setCheckingDevice(null);}
  };

  const remove = async () => {
    if (mediaLab) {await clearLibraryToken(mediaLab.url);await disconnectRemoteGeneration(mediaLab.url);}
    await setMediaLab(null);
    if (router.canGoBack()) router.back();
    else if (!onboardingComplete) router.replace('/onboarding');
    else router.replace('/(tabs)/settings');
  };

  return (
    <ThemedView style={styles.container}>
      <KeyboardAvoidingView style={styles.keyboard} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <ThemedText themeColor="textSecondary" style={styles.blurb}>
        Choose where Media Lab runs. Your media stays on that computer or server; this app connects to it.
      </ThemedText>
      {!method&&hostingServer ? <View style={{ gap: Spacing.two }}>
        <ThemedText type="smallBold">This app already has a server</ThemedText>
        <ThemedText themeColor="textSecondary">Use the server hosting this page. Your server files stay there, so you can reach them from another paired device. You still need its access code.</ThemedText>
        <Pressable accessibilityRole="button" disabled={busy} onPress={() => { setInput(hostingServer); setCode(''); setMethod('address'); }} style={[styles.button, { borderWidth: 1, borderColor: theme.border }]}>
          <ThemedText type="smallBold">Use this server</ThemedText>
        </Pressable>
      </View> : null}
      {!method?<View style={{gap:Spacing.three}}>
        {canUseLocalController()?<Button title="On this computer" variant="secondary" onPress={()=>setMethod('local')}/>:null}
        <Button title="On my Tailscale network" variant="secondary" onPress={()=>setMethod('tailnet')}/>
        <ThemedText themeColor="textSecondary">Use a Spark or another device on your private network. That device must stay on.</ThemedText>
        <Button title="I have a server address" variant="secondary" onPress={()=>setMethod('address')}/>
        <ThemedText themeColor="textSecondary">Use a domain or a full Media Lab link. An independent server can keep working when this device is off.</ThemedText>
      </View>:<>
      <Button title="Change setup method" variant="secondary" disabled={busy} onPress={()=>{setMethod(null);setCode('');setError(null);}}/>
      {method==='tailnet'?<View style={{gap:Spacing.two}}>
        <ThemedText type="smallBold">Connect your Tailscale device</ThemedText>
        <ThemedText>Keep Tailscale connected on both devices. Use the full Media Lab address shown by your server, including its port. An online device does not necessarily have Media Lab running.</ThemedText>
        {!canUseLocalController()?<ThemedText>This browser or phone cannot list Tailscale devices. Copy the Media Lab link from your server, or scan its pairing QR with the installed app.</ThemedText>:null}
      </View>:method==='address'?<ThemedText>Paste the full Media Lab link from your server. Keep https:// and any port number shown in that link.</ThemedText>:null}
      {method==='local'&&canUseLocalController() ? <View style={{ gap: Spacing.two }}>
        <ThemedText type="smallBold">Set up Media Lab on this computer</ThemedText>
        <Button title={showRequirements?"Hide installation details":"Installation details"} variant="secondary" onPress={()=>setShowRequirements(!showRequirements)}/>
        <ThemedText>Your computer hosts Media Lab and must stay on. Install the controller, start it, then choose Use this computer. Models are added separately.</ThemedText>
        {showRequirements?<ThemedText themeColor="textSecondary">Installs the independent controller and its Python dependencies into this app’s private folder. Local installation currently requires a Mac with Python 3.14 or ARM Linux with Python 3.12, plus uv (the Python installer). Intel Mac setup is a development preview; local model support is separate. No models are downloaded and no server starts until you choose Start. Builds without the controller package will explain the missing requirement.</ThemedText>:null}
        {installState === 'checking' ? <ThemedText>Checking local setup…</ThemedText> : null}
        {installState === 'idle' || installState === 'failed' ? <Pressable accessibilityRole="button" disabled={busy} onPress={() => void installHere(installState === 'failed')} style={styles.button}>
          <ThemedText>{busy ? 'Working…' : installState === 'failed' ? 'Retry installation' : 'Install local controller'}</ThemedText>
        </Pressable> : installState === 'installed' ? <Pressable accessibilityRole="button" disabled={busy} onPress={startHere} style={styles.button}><ThemedText>Start local controller</ThemedText></Pressable> : null}
        {installMessage ? <ThemedText accessibilityLiveRegion="polite">{installMessage}</ThemedText> : null}
      </View> : null}
      {method==='local'&&canUseLocalController() ? <Pressable accessibilityRole="button" disabled={busy} onPress={useLocal}
        style={[styles.button,{borderWidth:1,borderColor:theme.border,opacity:busy?0.6:1}]}>
        <ThemedText type="smallBold">Use this computer</ThemedText>
      </Pressable> : null}
      {method==='tailnet'&&canUseLocalController() ? <Pressable accessibilityRole="button" disabled={busy} onPress={findDevices} style={[styles.button, { borderWidth: 1, borderColor: theme.border }]}>
        <ThemedText type="smallBold">Find devices on my Tailscale network</ThemedText>
      </Pressable> : null}
      {method==='tailnet'&&devices&&showDevices ? <View style={{ gap: Spacing.two }}>
        <ThemedText themeColor="textSecondary">Choose a device to check its usual Media Lab addresses. This does not install anything or send an access code. Custom ports may need the full link from your server.</ThemedText>
        {devices.length === 0 ? <ThemedText>No other devices found. You can enter an address below.</ThemedText> : devices.filter(device=>device.online||showOffline).map((device) => <Pressable key={device.address} accessibilityRole="button" disabled={busy||!device.online} accessibilityLabel={`Check Media Lab on ${device.name}`} onPress={()=>void findServices(device)} style={[styles.device,{borderColor:theme.border,backgroundColor:theme.backgroundElement,opacity:device.online?1:0.5}]}>
          <ThemedText type="smallBold">{device.name}</ThemedText>
          <ThemedText themeColor="textSecondary">{device.online ? 'Online — check Media Lab' : 'Offline — turn this device on to connect'}</ThemedText>
        </Pressable>)}
        {devices.length>0&&!devices.some(device=>device.online)?<ThemedText>No devices are online. Turn on your server and refresh the list, or enter its full link below.</ThemedText>:null}
        {devices.some(device=>!device.online)?<Button title={showOffline?'Hide offline devices':`Show offline devices (${devices.filter(device=>!device.online).length})`} variant="secondary" disabled={busy} onPress={()=>setShowOffline(!showOffline)}/>:null}
      </View> : null}
      {method==='tailnet'&&devices&&!showDevices?<Button title="Choose another device" variant="secondary" disabled={busy} onPress={()=>setShowDevices(true)}/>:null}
      {checkingDevice?<ThemedText accessibilityLiveRegion="polite">Checking Media Lab on {checkingDevice}…</ThemedText>:null}
      {method==='tailnet'&&services?<View style={{gap:Spacing.two}}>
        <ThemedText type="smallBold">{services.urls.length?`Media Lab found on ${services.device}`:`No usual Media Lab address answered on ${services.device}`}</ThemedText>
        <ThemedText>{services.urls.length?(services.urls.length===1?'The server address is ready below. Add an access code if you want to use its Library or create media.':'Choose an address, then add your access code below. HTTPS keeps the connection encrypted.'):'Check that Media Lab is running. If it uses a custom port, paste its full link below.'}</ThemedText>
        {services.urls.length>1&&services.urls.map(url=><Button key={url} title={url} variant="secondary" disabled={busy} onPress={()=>{setInput(url);setCode('');}}/>) }
      </View>:null}
      <TextInput
        accessibilityLabel="Media Lab server address"
        editable={!busy}
        value={input}
        onChangeText={setInput}
        placeholder="http://your-server:7863"
        placeholderTextColor={theme.textSecondary}
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="url"
        style={[
          styles.input,
          { backgroundColor: theme.backgroundElement, color: theme.text, borderColor: theme.border },
        ]}
      />
      <ThemedText themeColor="textSecondary">
        {generation
          ? 'Enter the access code to create media and use saved creations in your projects.'
          : 'Enter the access code to use saved creations in your projects. Leave blank to connect only the server view.'}
      </ThemedText>
      <TextInput editable={!busy} accessibilityLabel="Media Lab access code" value={code} onChangeText={setCode} secureTextEntry autoCapitalize="none" autoCorrect={false}
        placeholder={generation ? 'Access code (required)' : 'Access code (optional)'} placeholderTextColor={theme.textSecondary}
        style={[styles.input, {backgroundColor:theme.backgroundElement,color:theme.text,borderColor:theme.border}]} />
      <View style={{gap:Spacing.two}}>
        <ThemedText>Allow this device to create media and manage its own jobs</ThemedText>
        <Switch accessibilityLabel="Allow media generation" value={generation} onValueChange={(allowed) => {if (origin) setChoice({origin, allowed});}} disabled={busy} />
      </View>
      {error ? (
        <ThemedText accessibilityRole="alert" type="small" style={{ color: theme.danger }}>
          {error}
        </ThemedText>
      ) : null}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Pair Media Lab"
        onPress={save}
        disabled={busy}
        style={[styles.button, { backgroundColor: theme.tint, opacity: busy ? 0.6 : 1 }]}>
        {pairing ? (
          <ActivityIndicator color={theme.onTint} />
        ) : (
          <ThemedText type="smallBold" style={{ color: theme.onTint }}>
            Pair Media Lab
          </ThemedText>
        )}
      </Pressable>
      </>}
      {mediaLab ? (
        <Pressable accessibilityRole="button" accessibilityLabel="Remove pairing" onPress={remove} disabled={busy} style={styles.removeRow} hitSlop={8}>
          <ThemedText type="smallBold" style={{ color: theme.danger }}>
            Remove pairing
          </ThemedText>
        </Pressable>
      ) : null}
      </ScrollView>
      </KeyboardAvoidingView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  keyboard: { flex: 1 },
  content: {
    flexGrow: 1,
    width: '100%',
    maxWidth: 900,
    alignSelf: 'center',
    padding: Spacing.three,
    gap: Spacing.three,
  },
  device: {
    borderWidth: 1,
    borderRadius: Radii.md,
    padding: Spacing.three,
    gap: Spacing.one,
    minHeight: 56,
  },
  blurb: {
    lineHeight: 20,
  },
  input: {
    borderRadius: Radii.md,
    borderWidth: 1,
    paddingHorizontal: Spacing.three,
    paddingVertical: 12,
    fontSize: 16,
  },
  button: {
    borderRadius: Radii.lg,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
  },
  removeRow: {
    alignItems: 'center',
    paddingVertical: Spacing.two,
  },
});
