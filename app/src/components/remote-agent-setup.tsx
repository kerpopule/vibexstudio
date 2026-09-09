import {useEffect,useState} from 'react';
import {TextInput,View} from 'react-native';
import * as Clipboard from 'expo-clipboard';
import {ThemedText} from '@/components/themed-text';
import {Button} from '@/components/ui/button';
import {useTheme} from '@/hooks/use-theme';
import {parseRemoteEnrollment,remoteSetupRequest,type RemoteTarget} from '@/lib/agent-connect/remote';

type Invoke=(command:string,args?:Record<string,unknown>)=>Promise<unknown>;
function invoke(command:string,args?:Record<string,unknown>) {
  const bridge=(globalThis as unknown as {__TAURI_INTERNALS__?:{invoke?:Invoke}}).__TAURI_INTERNALS__?.invoke;
  if(!bridge) return Promise.reject(new Error('Remote agent setup requires the desktop app.'));
  return bridge(command,args);
}
// Connection metadata is session-only. The native process survives screen navigation.
let sessionTarget:RemoteTarget|null=null;
export function RemoteAgentSetup({onTarget}:{onTarget:(target:RemoteTarget|null)=>void}) {
  const theme=useTheme();
  const [expanded,setExpanded]=useState(()=>sessionTarget!==null);
  const [code,setCode]=useState('');
  const [phase,setPhase]=useState('stopped');
  const [busy,setBusy]=useState(false);
  const [message,setMessage]=useState('');
  useEffect(()=>{
    let active=true;
    const poll=async()=>{
      try {
        const result=await invoke('agent_remote_status') as {phase:string};
        if(!active)return;
        setPhase(result.phase);
        onTarget(result.phase==='process-running'?sessionTarget:null);
      } catch {if(active){setPhase('failed');onTarget(null);}}
    };
    void poll();const timer=setInterval(()=>void poll(),1000);
    return ()=>{active=false;clearInterval(timer);};
  },[onTarget]);
  const run=async(action:()=>Promise<void>)=>{
    setBusy(true);setMessage('');
    try {await action();}catch(error){setMessage(error instanceof Error?error.message:String(error));}
    finally{setBusy(false);}
  };
  return <View style={{gap:12}}>
    <Button title={expanded?'Hide remote setup':'My agent is on another computer'} variant="secondary" onPress={()=>setExpanded(!expanded)}/>
    {expanded && <>
      <ThemedText type="heading">Use your own agent server</ThemedText>
      <ThemedText themeColor="textSecondary">Your desktop calls out to your server, so they do not need the same Wi-Fi or Tailscale network. The server must accept SSH connections. Keep this desktop open while the agent works.</ThemedText>
      <ThemedText themeColor="textSecondary">Your files stay here. When you approve an agent, it can read or change the projects you give it access to; that work is processed on your server. VibeX does not store it in a cloud account.</ThemedText>
      <ThemedText type="smallBold">1. Ask your server agent or administrator to prepare access</ThemedText>
      <Button title="Copy server setup request" variant="secondary" loading={busy} onPress={()=>void run(async()=>{
        const identity=await invoke('agent_device_identity') as {publicKey:string};
        await Clipboard.setStringAsync(remoteSetupRequest(identity.publicKey));
        setMessage('Copied. Give this to the agent or administrator managing your server. It contains a public device key, not a password.');
      })}/>
      <ThemedText type="smallBold">2. Paste the connection code they return</ThemedText>
      <TextInput accessibilityLabel="Server connection code" value={code} onChangeText={setCode} multiline autoCapitalize="none" autoCorrect={false} maxLength={16301} placeholder="Paste connection code" placeholderTextColor={theme.textSecondary} style={{color:theme.text,borderColor:theme.textSecondary,borderWidth:1,borderRadius:16,padding:14,minHeight:100}}/>
      <Button title="Connect to my server" loading={busy} disabled={!code.trim() || !['stopped','failed'].includes(phase)} onPress={()=>void run(async()=>{
        const enrollment=parseRemoteEnrollment(code);
        await invoke('agent_remote_stop');onTarget(null);sessionTarget=null;
        await invoke('agent_remote_start',{enrollment});
        sessionTarget={host:enrollment.host,port:enrollment.remotePort};setPhase('starting');
      })}/>
      <ThemedText accessibilityLiveRegion="polite">{phase==='process-running'?`Connection process running${sessionTarget?` for ${sessionTarget.host}`:''}. Generate an invite below and approve the agent here to verify access.`:phase==='starting'?'Opening the connection…':phase==='failed'?'Connection could not stay open. Check the server setup, network address and assigned port, then try again.':'Remote connection is off.'}</ThemedText>
      {phase!=='stopped' && <Button title="Disconnect server" variant="secondary" loading={busy} onPress={()=>void run(async()=>{await invoke('agent_remote_stop');sessionTarget=null;onTarget(null);setPhase('stopped');})}/>}
      {message ? <ThemedText accessibilityLiveRegion="polite">{message}</ThemedText>:null}
    </>}
  </View>;
}
