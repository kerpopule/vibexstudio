import {validateAgentPublicKey} from './agent-ssh-plan.mjs';
/** Return reviewable server enrollment files; never edit sshd or authorized_keys. */
export function planAgentServer({user,devices}) {
 if(typeof user!=='string'||!/^[a-zA-Z_][a-zA-Z0-9_-]{0,63}$/.test(user))throw new Error('Invalid dedicated SSH account');
 if(!Array.isArray(devices)||!devices.length||devices.length>1000)throw new Error('Supply 1–1000 devices');
 const ids=new Set(),ports=new Set(),keys=new Set();
 const lines=devices.map(device=>{
  if(typeof device.id!=='string'||!/^[A-Za-z0-9_-]{1,64}$/.test(device.id))throw new Error('Invalid device identity');
  if(!Number.isInteger(device.port)||device.port<1024||device.port>65535)throw new Error('Invalid assigned device port');
  const key=validateAgentPublicKey(device.publicKey);
  if(ids.has(device.id)||ports.has(device.port)||keys.has(key))throw new Error('Every device requires a unique identity, port and key');
  ids.add(device.id);ports.add(device.port);keys.add(key);
  return `restrict,port-forwarding,permitlisten="127.0.0.1:${device.port}" ${key} vibex-${device.id}`;
 });
 return {
  authorizedKeys:lines.join('\n')+'\n',
  sshdConfig:`# Apply together with the generated per-device authorized keys.\nMatch User ${user}\n    AuthenticationMethods publickey\n    PasswordAuthentication no\n    KbdInteractiveAuthentication no\n    AllowTcpForwarding remote\n    AllowStreamLocalForwarding no\n    GatewayPorts no\n    PermitOpen none\n    AllowAgentForwarding no\n    X11Forwarding no\n    PermitTTY no\n    PermitUserRC no\n    PermitTunnel no\n    MaxSessions 0\nMatch all\n`,
  requiresBothFiles:true,
 };
}
