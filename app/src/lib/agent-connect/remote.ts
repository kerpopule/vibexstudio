export interface RemoteEnrollment {
  version: 1; host: string; user: string; sshPort: number; remotePort: number;
  hostKey: string; devicePublicKey: string;
}
export interface RemoteTarget { host: string; port: number }
const serverName = (value: unknown): value is string => typeof value === 'string' && value.length <= 253 && value.split('.').every(label => /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/.test(label));
export function parseRemoteEnrollment(text: string): RemoteEnrollment {
  if (text.length > 16300) throw new Error('This connection code is too long. Ask your server administrator for a new one.');
  let value: RemoteEnrollment;
  try { value = JSON.parse(text); } catch { throw new Error('Paste the complete connection code from your server.'); }
  if (!value || value.version !== 1 || !serverName(value.host) || typeof value.user !== 'string' || !/^[a-zA-Z_][a-zA-Z0-9_-]{0,63}$/.test(value.user)
    || !Number.isInteger(value.sshPort) || value.sshPort < 1 || value.sshPort > 65535
    || !Number.isInteger(value.remotePort) || value.remotePort < 1024 || value.remotePort > 65535
    || ![value.hostKey,value.devicePublicKey].every(key => typeof key === 'string' && /^ssh-ed25519 [A-Za-z0-9+/]+={0,2}$/.test(key) && key.length < 128)) {
    throw new Error('This connection code is incomplete or unsupported. Ask your server administrator to check it.');
  }
  // Only pass the expected fields. Native enrollment validates both key blobs and device ownership.
  return {version:1,host:value.host,user:value.user,sshPort:value.sshPort,remotePort:value.remotePort,hostKey:value.hostKey,devicePublicKey:value.devicePublicKey};
}
export function remoteSetupRequest(publicKey: string): string {
  return `Prepare remote VibeX Studio agent access on a server I own. This is a setup request, not an agent pairing token.\n\nDevice public key: ${publicKey}\n\nUse a dedicated SSH account restricted to reverse TCP forwarding, with a unique server-loopback port for this device. Disable shell, command execution, local/stream forwarding, agent forwarding, TTY, X11 and public listening. Keep normal SSH access unchanged. Use desktop/scripts/prepare-agent-server.mjs from the VibeX source checkout (JSON configuration on stdin; --output followed by a new absolute directory) to prepare both the per-device authorized key and matching sshd policy; review and validate the configuration before applying it.\n\nReturn a JSON connection code with version: 1, host (reachable DNS name or IPv4), user (dedicated account), sshPort, remotePort (1024–65535), hostKey (server Ed25519 public key obtained directly from the server), and devicePublicKey (the key above). Never return private keys or passwords.\n\nThe desktop opens an outbound SSH tunnel. My agent runs on this server and accesses only its assigned loopback port. VibeX does not provide cloud file storage. Project data accessed by the agent is processed on this user-owned server; the desktop must remain open. Agent pairing and approval are separate, after connection setup.\n`;
}
