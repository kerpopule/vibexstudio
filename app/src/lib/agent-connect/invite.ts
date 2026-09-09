export const AGENT_CONNECT_PORT = 8791;
export const PAIRING_TTL_MS = 15 * 60_000;

export interface PairingTicket {
  code: string;
  createdAt: number;
  expiresAt: number;
  redeemed: boolean;
}

function assertLanHost(host: string): void {
  const ipv4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  const localName = /^[A-Za-z0-9][A-Za-z0-9.-]{0,252}\.local$/.test(host);
  if ((!ipv4 || ipv4.slice(1).some((part) => Number(part) > 255)) && !localName) {
    throw new Error('A plain LAN IPv4 or .local host is required.');
  }
}

export function buildAgentInvite(ticket: PairingTicket, host: string, options: {port?:number;localComputer?:boolean;remoteServer?:string} = {}): string {
  assertLanHost(host);
  const port=options.port??AGENT_CONNECT_PORT;
  if(!Number.isInteger(port)||port<1||port>65535)throw new Error('Invalid agent port.');
  if(options.localComputer && host!=='127.0.0.1')throw new Error('Desktop invites require loopback.');
  if(options.remoteServer !== undefined) {
    if(options.localComputer || host!=='127.0.0.1' || options.port===undefined || port<1024)throw new Error('Remote invites require the assigned server loopback port.');
    if(options.remoteServer.length>253 || !options.remoteServer.split('.').every(label=>/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/.test(label)))throw new Error('Invalid remote server name.');
  }
  const base = `http://${host}:${port}`;
  const connectionHelp=options.remoteServer
    ? `Run this invite on the user-owned agent server ${options.remoteServer}. The loopback address below belongs to that server, not your laptop or phone. The desktop must have its outbound SSH tunnel to this server running and VibeXStudio must stay open. The two computers do not need the same Wi-Fi or Tailscale network. This invite does not create the tunnel or provision server access.`
    : options.localComputer
    ? 'This invite works only for an agent on the same computer as the desktop app. Keep VibeXStudio open. Remote routing is not configured by this invite.'
    : 'The device and agent computer must remain on the same Wi-Fi, and VibeXStudio must stay in the foreground. Pairing is local-LAN only.';
  const expires = new Date(ticket.expiresAt).toISOString();
  const tick = String.fromCharCode(96);
  const fence = tick.repeat(3);
  const authorization = `Authorization: Bearer ${'*'.repeat(3)}`;
  return `---
name: connect-vibexstudio
description: Pair this agent with the user's VibeXStudio projects over a confirm-on-device MCP connection.
version: 5
---

# Connect to VibeXStudio

VibeXStudio is running a small MCP server on the user's device.
${connectionHelp}

Pairing code: ${tick}${ticket.code}${tick} (single use, expires ${expires})

## 1. Redeem now

${fence}sh
curl -sS -X POST ${base}/pair \\
  -H 'Content-Type: application/json' \\
  -d '{"code":"${ticket.code}","agentName":"VibeX agent"}'
${fence}

The user must approve the requested access on the device. Save the returned ${tick}token${tick} in
your own secret store. Never paste it into chat, logs, source, or a project.
Replace ${tick}***${tick} below at configuration time; every MCP request must
send ${tick}${authorization}${tick}. The MCP endpoint is ${tick}${base}/mcp${tick}.

## 2. Configure one client

### Hermes

${fence}sh
hermes mcp add vibexstudio --url ${base}/mcp --auth header
${fence}

When asked whether authentication is required, answer yes. At the
${tick}API key / Bearer token${tick} prompt, enter only the redeemed token itself.
Do not include ${tick}Authorization:${tick} or ${tick}Bearer ${tick}; Hermes adds
the header and prefix automatically. Hermes saves it in its own local credential
configuration, outside your VibeX project.

### Codex

${fence}sh
codex mcp add vibexstudio --url ${base}/mcp
${fence}

Then add ${tick}http_headers = { "Authorization" = "Bearer ***" }${tick} under
${tick}[mcp_servers.vibexstudio]${tick} in ${tick}~/.codex/config.toml${tick}.

### Claude Code

${fence}sh
claude mcp add --transport http vibexstudio ${base}/mcp --header "${authorization}"
${fence}

### OpenCode

Add this remote MCP entry to OpenCode's ${tick}opencode.json${tick} configuration, replacing
the placeholder with the redeemed token (or OpenCode's supported secret/environment interpolation):

${fence}json
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "vibexstudio": {
      "type": "remote",
      "url": "${base}/mcp",
      "headers": { "Authorization": "Bearer ***" }
    }
  }
}
${fence}

Keep the redeemed token in the agent's secret store, never in a project file.

### Generic MCP / HTTP

Use Streamable HTTP at ${tick}${base}/mcp${tick}. Send JSON-RPC 2.0 over POST
with ${tick}Content-Type: application/json${tick} and
${tick}${authorization}${tick}. Start with ${tick}initialize${tick}, then
${tick}notifications/initialized${tick}, then ${tick}tools/list${tick}.

${fence}sh
curl -sS -X POST ${base}/mcp \\
  -H 'Content-Type: application/json' \\
  -H '${authorization}' \\
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"generic-mcp-client","version":"1"}}}'
${fence}

## 3. Verify, let the user choose, then say hello

The project tool set is:

- ${tick}create_project${tick} (an empty local build; only when the user requests a new project)
- ${tick}list_projects${tick}
- ${tick}get_project${tick}
- ${tick}read_project_file${tick} (one bounded UTF-8 text file; no binary/base64 reads)
- ${tick}write_project_files${tick} (atomic bounded UTF-8 writes with explicit ${tick}overwrite${tick})
- ${tick}append_project_message${tick}

If the user separately approves media library access, ${tick}list_media_assets${tick}
also lists their connected Media Lab creations. Use folder for an exact Library
folder path, and includeSubfolders=false for only that folder’s files.
Follow nextCursor as after with
the same filters until it is null to browse beyond 100 matches. Restart from the
first page to include newly added creations. It returns metadata, not file bytes,
and does not grant media generation or deletion. ${tick}get_media_capabilities${tick}
reports supported server operations and missing setup; it cannot start jobs.
With separate background-removal approval, ${tick}remove_media_background${tick}
can use an already configured engine on a library image. The same approval allows ${tick}save_agent_image_to_library${tick} to save its own completed cutout for reuse, with no new generation. Save a stable requestId
before calling, reuse it with identical arguments after errors, and poll
${tick}get_agent_media_request${tick}. To cancel a saved request, even if its submission response was lost, call
${tick}cancel_agent_media_request${tick} with that requestId, then check status.
Unknown-acceptance cancellation requires an updated Media Lab server and never submits new work.
Cancellation is a request; the job may already have finished. These tools do not install models or enable
paid providers. With media-import approval as well, ${tick}import_agent_media_result${tick}
can save your completed background-removal result to a new assets/*.png project path. Check ${tick}tools/list${tick}
for the permissions actually granted.

Call ${tick}list_projects${tick} first. If the user requested a new project, use ${tick}create_project${tick} with their chosen name and use the returned id. Otherwise ask the user which project to work in.
Do not write or append anything before the user chooses a project. After the
user chooses a project, call ${tick}get_project${tick}, then use
${tick}append_project_message${tick} to add a one-line hello so the user can see
that the connection works.

Tool failures are HTTP 200 JSON-RPC results with ${tick}isError: true${tick}. If
the endpoint is unreachable, check the connection requirements above and keep VibeXStudio open. A 401 means the link was revoked;
ask for a fresh invite. An expired or used code also requires a fresh invite.
`;
}
