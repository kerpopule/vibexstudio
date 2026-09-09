import {mkdtemp,writeFile,unlink,rmdir} from 'node:fs/promises';
import path from 'node:path';
import {deviceIdentity} from './agent-device-identity.mjs';
import {planAgentTunnel,validateAgentPublicKey} from './agent-ssh-plan.mjs';
import {startAgentTunnel} from './agent-tunnel.mjs';

/** Consume a user-reviewed enrollment for this device; never accept another device's key. */
export async function connectAgentServer(directory,enrollment,localPort,dependencies={}) {
 const identity=await deviceIdentity(directory);
 if(validateAgentPublicKey(enrollment?.devicePublicKey)!==identity.publicKey)throw new Error('This server enrollment belongs to another device. Request enrollment using this device’s public key.');
 // Validate all server fields before creating a connection directory or process.
 planAgentTunnel(enrollment,{localPort,identityFile:identity.identityFile,knownHostsFile:path.join(directory,'pending-hosts')});
 const staging=await mkdtemp(path.join(path.dirname(identity.identityFile),'connection-'));
 const knownHostsFile=path.join(staging,'known_hosts');
 let cleaned=false;
 const cleanup=async()=>{
  if(cleaned)return;
  try{await unlink(knownHostsFile);}catch(error){if(error.code!=='ENOENT')throw error;}
  await rmdir(staging);cleaned=true;
 };
 try{
  const options={localPort,identityFile:identity.identityFile,knownHostsFile};
  const plan=planAgentTunnel(enrollment,options);
  await writeFile(knownHostsFile,plan.knownHosts,{mode:0o600,flag:'wx'});
  dependencies.beforeSpawn?.();
  const tunnel=startAgentTunnel(enrollment,options,dependencies);
  const finished=tunnel.finished.then(async state=>{await cleanup();return state;});
  return {snapshot:tunnel.snapshot,finished,stop:async()=>{await tunnel.stop();return finished;}};
 }catch(error){await cleanup();throw error;}
}
