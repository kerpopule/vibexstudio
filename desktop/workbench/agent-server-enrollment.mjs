import {mkdir,writeFile,rm} from 'node:fs/promises';
import path from 'node:path';
import {planAgentServer} from './agent-server-plan.mjs';
import {planAgentTunnel,validateAgentPublicKey} from './agent-ssh-plan.mjs';

/** Prepare all device codes and restricted policy together, without changing SSH. */
export function prepareAgentServerEnrollment(config) {
 const plan=planAgentServer(config);
 const hostKey=validateAgentPublicKey(config.hostKey);
 const devices=config.devices.map(device=>{
  const enrollment={version:1,host:config.host,user:config.user,sshPort:config.sshPort,
   remotePort:device.port,hostKey,devicePublicKey:validateAgentPublicKey(device.publicKey)};
  // Share the same endpoint validation as the desktop tunnel.
  planAgentTunnel(enrollment,{localPort:1024,identityFile:path.resolve('identity'),knownHostsFile:path.resolve('known_hosts')});
  return {id:device.id,enrollment};
 });
 return {status:'prepared',requiresInstallation:true,...plan,devices};
}
export async function writeAgentServerEnrollment(config,output) {
 const prepared=prepareAgentServerEnrollment(config);
 if(typeof output!=='string'||!path.isAbsolute(output)||/[\r\n\0]/.test(output))throw new Error('Choose an absolute output directory');
 // Never overwrite an existing directory, file, or symlink.
 await mkdir(output,{mode:0o700});
 try {
  const put=(name,data)=>writeFile(path.join(output,name),data,{mode:0o600,flag:'wx'});
  await put('authorized_keys',prepared.authorizedKeys);
  await put('sshd-policy.conf',prepared.sshdConfig);
  await put('connection-codes.json',JSON.stringify({version:1,devices:prepared.devices},null,2)+'\n');
  await put('README.txt',`PREPARED — NOT INSTALLED\n\nThese files do not configure or start a server.\n\n1. Use a dedicated SSH account named ${config.user}. Do not use an existing administrator or ordinary login account: this policy disables its interactive login and commands.\n2. Install authorized_keys for that account and apply sshd-policy.conf together. The per-key restrictions alone are insufficient. Preserve existing access, file ownership and permissions.\n3. Validate the complete effective SSH configuration for this account with the server's sshd before reloading. Check that authorized keys cannot be edited by untrusted accounts, only remote TCP forwarding is allowed, GatewayPorts is off, and MaxSessions is zero.\n4. Confirm the supplied host public key is the Ed25519 key served at the supplied hostname and SSH port. The desktop rejects a different key.\n5. Confirm each assigned loopback port is free. Give each device only its matching enrollment from connection-codes.json after installation.\n6. Connect in Studio, then generate a remote agent invite and approve it on the desktop. The agent runs on this server; Studio must stay open.\n\nNo VibeX cloud storage is involved. Approved agents can process project data on this server. No private keys or passwords are included in this bundle.\n`);
  return {status:'prepared',requiresInstallation:true,output,devices:prepared.devices.length};
 }catch(error){await rm(output,{recursive:true,force:true});throw error;}
}
