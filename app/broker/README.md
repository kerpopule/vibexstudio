# VibeXStudio private-model broker (local/staged V1)

This broker is intentionally not a generic proxy. Its only inference route is a validated OpenAI-compatible streaming chat request to one configured upstream. Client-supplied URLs, query parameters, headers, tools, remote media, image/video/H3 routes, and non-allowlisted models are rejected.

## Local run

Use Node 22 or later. Copy `config.example.env` into your own secret-management environment (do not make a filled-in copy in this repository), generate an Ed25519 signing key outside the repository, export the variables, then run:

```sh
npm run broker:start
npm run broker:issue -- "Synthetic recipient"
```

The JSON store is mode `0600`, contains only keyed hashes of invite/device/refresh credentials, and is local state. The invite command prints the raw invite once so an authorized operator can deliver it. No production service, DNS, tunnel, ACL, or credential change is performed by this candidate.

## Rollback

Stop the local broker process, disable invite issuance, revoke device records (or remove the local test store), and remove any separately approved broker-to-private-gateway ACL. The upstream master bearer remains unchanged unless an independent exposure response authorizes rotation.
