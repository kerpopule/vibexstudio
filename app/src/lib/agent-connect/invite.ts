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

export function buildAgentInvite(ticket: PairingTicket, host: string): string {
  assertLanHost(host);
  const base = `http://${host}:${AGENT_CONNECT_PORT}`;
  const expires = new Date(ticket.expiresAt).toISOString();
  const tick = String.fromCharCode(96);
  const fence = tick.repeat(3);
  const authorization = `Authorization: Bearer ${'*'.repeat(3)}`;
  return `---
name: connect-vibexstudio
description: Pair this agent with the user's VibeXStudio projects over a local, confirm-on-device MCP connection.
version: 5
---

# Connect to VibeXStudio

VibeXStudio is running a small MCP server on the user's device. The device and
this agent computer must remain on the same Wi-Fi, and VibeXStudio must stay in
the foreground while you connect or use tools. Pairing is local-LAN only.

Pairing code: ${tick}${ticket.code}${tick} (single use, expires ${expires})

## 1. Redeem now

${fence}sh
curl -sS -X POST ${base}/pair \\
  -H 'Content-Type: application/json' \\
  -d '{"code":"${ticket.code}","agentName":"VibeX agent"}'
${fence}

The user must tap Allow on the device. Save the returned ${tick}token${tick} in
your own secret store. Never paste it into chat, logs, source, or a project.
Replace ${tick}***${tick} below at configuration time; every MCP request must
send ${tick}${authorization}${tick}. The MCP endpoint is ${tick}${base}/mcp${tick}.

## 2. Configure one client

### Hermes

${fence}sh
hermes mcp add vibexstudio --url ${base}/mcp --auth header
${fence}

When prompted, provide ${tick}${authorization}${tick} using the redeemed token.

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

The final tool set is exactly:

- ${tick}list_projects${tick}
- ${tick}get_project${tick}
- ${tick}read_project_file${tick} (one bounded UTF-8 text file; no binary/base64 reads)
- ${tick}write_project_files${tick} (atomic bounded UTF-8 writes with explicit ${tick}overwrite${tick})
- ${tick}append_project_message${tick}

Call ${tick}list_projects${tick} first and ask the user which project to work in.
Do not write or append anything before the user chooses a project. After the
user chooses a project, call ${tick}get_project${tick}, then use
${tick}append_project_message${tick} to add a one-line hello so the user can see
that the connection works.

Tool failures are HTTP 200 JSON-RPC results with ${tick}isError: true${tick}. If
the endpoint is unreachable, ask the user to put the device on the same Wi-Fi
and keep VibeXStudio open in the foreground. A 401 means the link was revoked;
ask for a fresh invite. An expired or used code also requires a fresh invite.
`;
}
