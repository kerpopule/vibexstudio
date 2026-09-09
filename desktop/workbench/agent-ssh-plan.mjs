/** Build an outbound tunnel to a user-owned agent server; never execute a shell. */
import path from 'node:path';
import net from 'node:net';
function port(value){if(!Number.isInteger(value)||value<1024||value>65535)throw new Error('Choose an assigned port between 1024 and 65535');return value;}
function host(value){
 if(typeof value!=='string'||value.length>253||(!net.isIP(value)&&!value.split('.').every(label=>/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/.test(label))))throw new Error('Invalid SSH server hostname');
 return value;
}
export function validateAgentPublicKey(value){
 if(typeof value!=='string'||!/^ssh-ed25519 [A-Za-z0-9+/]+={0,2}$/.test(value))throw new Error('An Ed25519 public key is required');
 const key=Buffer.from(value.split(' ')[1],'base64');
 const canonical=key.toString('base64').replace(/=+$/,'');
 if(canonical!==value.split(' ')[1].replace(/=+$/,'')||key.length!==51||key.readUInt32BE(0)!==11||key.subarray(4,15).toString()!=='ssh-ed25519'||key.readUInt32BE(15)!==32)throw new Error('Invalid Ed25519 public key');
 return `ssh-ed25519 ${canonical}`;
}
export function planAgentTunnel(config,{localPort,identityFile,knownHostsFile,platform=process.platform}){
 if(config?.version!==1)throw new Error('Unsupported remote agent setup');
 const server=host(config.host);
 if(typeof config.user!=='string'||!/^[a-zA-Z_][a-zA-Z0-9_-]{0,63}$/.test(config.user))throw new Error('Invalid SSH account');
 if(!Number.isInteger(config.sshPort)||config.sshPort<1||config.sshPort>65535)throw new Error('Invalid SSH port');
 const remotePort=port(config.remotePort);port(localPort);
 validateAgentPublicKey(config.hostKey);
 const paths=platform==='win32'?path.win32:path;
 for(const file of [identityFile,knownHostsFile])if(typeof file!=='string'||!paths.isAbsolute(file)||/[\r\n\0]/.test(file))throw new Error('Use absolute private credential file paths');
 const nullFile=platform==='win32'?'NUL':'/dev/null';
 return {
  executable:'ssh',
  args:['-F',nullFile,'-N','-T','-a','-x','-p',String(config.sshPort),'-l',config.user,'-i',identityFile,
   '-o','BatchMode=yes','-o','IdentitiesOnly=yes','-o','StrictHostKeyChecking=yes',
   '-o',`UserKnownHostsFile="${knownHostsFile.replace(/\\/g,'\\\\').replace(/"/g,'\\"')}"`,'-o',`GlobalKnownHostsFile=${nullFile}`,
   '-o','ConnectTimeout=15','-o','ConnectionAttempts=1','-o','ExitOnForwardFailure=yes','-o','PermitLocalCommand=no','-o','ServerAliveInterval=30','-o','ServerAliveCountMax=3',
   '-R',`127.0.0.1:${remotePort}:127.0.0.1:${localPort}`,server],
  knownHosts:`${config.sshPort===22 ? server : `[${server}]:${config.sshPort}`} ${config.hostKey}\n`,
  remoteEndpoint:`http://127.0.0.1:${remotePort}/mcp`,
 };
}
