# Prepare a user-owned agent server

This helper produces a reviewable enrollment bundle for an administrator or server agent. It does **not** install an SSH account, modify system configuration, reload SSH, or make a server reachable. Desktop pairing is a separate approval step after server setup.

Use Node.js and a VibeX source checkout. Save public configuration as `server.json`:

```json
{
  "host": "spark.example.com",
  "user": "vibex_agent",
  "sshPort": 22,
  "hostKey": "ssh-ed25519 REPLACE_WITH_SERVER_PUBLIC_KEY",
  "devices": [
    {
      "id": "my_desktop",
      "port": 19841,
      "publicKey": "ssh-ed25519 REPLACE_WITH_DEVICE_PUBLIC_KEY"
    }
  ]
}
```

Obtain the device public key from **Agent Connect → My agent is on another computer → Copy server setup request**. Obtain the server's Ed25519 host public key directly from the server administrator. Use a dedicated account and a distinct available loopback port per device. Do not supply private keys or passwords.

From the source checkout:

```sh
node desktop/scripts/prepare-agent-server.mjs --output /absolute/new/enrollment-directory < server.json
```

The output directory must not already exist. All devices are validated before it is created. The helper writes:

- `authorized_keys`: forwarding restrictions for each device key.
- `sshd-policy.conf`: the corresponding dedicated-account policy; both files are required.
- `connection-codes.json`: an `enrollment` object for each device.
- `README.txt`: administrator installation and verification steps.

Install both restrictions, verify the effective server policy, and confirm the host key/address and available ports before sharing an enrollment. Paste only the matching device's **enrollment object** into Studio's connection-code field, then connect. Choose **Agent on my server**, generate the invite, and give it to the agent running on that server. Approve access in Studio. Keep the desktop open.

The connection is outbound from the desktop, so sharing a Tailscale network is not required if the SSH endpoint is otherwise reachable. A private Tailscale-only hostname still requires access to its network. The server endpoint listens only on loopback; this does not publish an MCP service on the internet.

Studio provides no cloud storage. An approved agent can read project data through this connection and process or retain it on the user-owned server according to that agent's behavior. Disconnecting stops transport; unlinking the agent revokes its credential.

Current qualification: restricted OpenSSH policies and native Mac pairing tested against an isolated daemon. Automatic server installation, real cross-network deployment, and Windows identity storage remain separate acceptance gates.
