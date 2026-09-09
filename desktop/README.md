# VibeX Studio Desktop

The Tauri shell packages the Studio web frontend for macOS, Windows and Linux.
It includes Workbench for project operations, device pairing and agent transport.
The supported build recipe also packages the independent Media Lab controller;
installing and starting that controller are separate, explicit setup actions.

This branch is a development review. See [capability status](../docs/CAPABILITY-STATUS.md)
for test evidence and remaining work. A successful build is not proof that every
platform, model or workflow is ready for release.

## First launch and storage

Start with Studio's setup flow. Use your own AI API credentials, connect to an
existing server, or install the independent controller on a supported computer.
Cloud-provider requests go to the provider you choose; files do not require a
VibeX-hosted storage account.

Projects currently persist in the frontend's local storage. Storage setup offers
full project backups, a user-selected sync folder or a paired Workbench server.
A folder already managed by iCloud Drive or Google Drive can be used where the
platform supports folder access. Direct iCloud/Google account integration and
seamless automatic sync on every platform are not finished. GitHub/code-only
exports and full project backups have different contents; use the in-app labels
to choose the appropriate transfer.

API keys and agent credentials use native `secret_set`, `secret_get` and
`secret_delete` commands backed by macOS Keychain, Windows Credential Manager or
Linux Secret Service. Only `vibex.*` keys are accepted. Review app identifiers
have separate credential namespaces. The OS may require the user to approve
vault access; the application does not bypass that approval.

Desktop sidecar settings live in the application data directory, for example
`~/Library/Application Support/studio.vibex.desktop/` on macOS. Keep this directory
private: `workbench.json` contains a Workbench token as well as its port and
project-root settings. `medialab.json` records the selected controller installation.
Do not share configuration files or pairing links as public diagnostics.

## Independent Media Lab setup

A packaged build offers **Install**, **Retry**, and a separate **Start** action.
Installation validates the controller resource package against the SHA-256 pinned
into that build, creates an isolated Python environment, installs hash-locked
dependencies and initializes a private host. It does not download model weights
or start a service. Failed dependency/initialization stages can be resumed without
replacing an existing host's credentials or media.

Current dependency locks cover macOS ARM64/Python 3.14, macOS x86_64/Python 3.14
and Linux ARM64/Python 3.12. Intel Mac installation is a development preview: the
packaged installer and actual loopback pairing passed with Intel Python under
Rosetta, but physical Intel hardware and model execution remain unverified.
The installer needs a matching installed Python and `uv`; it does not download
Python automatically. It checks versioned executables in common installation
locations and PATH, skips incompatible interpreters and bounds discovery time.
Python discovery and installation run off the desktop UI thread. Other desktop platforms can use an external server or
supported API workflows, but their local controller installation is not qualified.

Alternatively, choose **Use an existing independent installation…** and select
its root containing `installation.json`, `source`, `venv` and `host`. Selection
validates the installation and leaves it stopped. Start/Stop manages that selected
controller and its desktop startup setting. Existing configurations are not
silently replaced.

After Start, the Studio connection screen's **Use this computer** fills the local
address and masked access code. Review generation permission and press Pair.
This handoff requires an installation with desktop-origin support. It does not
put the access code in a URL or log. The independent controller defaults to
loopback port 7864; it does not automatically expose a LAN or public endpoint.

The desktop-owned controller stops when the app exits. To keep Media Lab running
without a Mac, install and supervise it on the user's server. A server service
and its HTTPS routing must be configured and verified separately. A link hosted
on the Mac remains dependent on that Mac.

Legacy configurations retain compatibility code for existing installations.
Fresh setup does not enter the legacy installer. The standard package excludes
legacy Media Lab source, model weights and private runtime configuration.

## Build from this repository

Install the normal Tauri system dependencies for your platform, Python 3 and
Node.js. From the repository root:

```sh
cd app
npm ci
npx expo export --platform web --output-dir ../desktop/dist
cd ../desktop
npm ci
python3 scripts/build-independent-desktop.py --frontend dist --output /new/build/staging
```

Choose a new staging directory for each build; existing output is refused. On
Windows, use `python` if that is the installed Python command. Build output goes
to `desktop/src-tauri/target/release/bundle`. Signing/updater prerequisites still
apply; this command does not publish a release, install the app or start services.

Use `--prepare-only` to produce resources, `tauri.independent.json` and a
`build-receipt.json` without compiling. The receipt records the exact package
hash and build environment. Omit that option to compile, or add `--no-bundle`
to compile without distribution packaging.

The generated Tauri merge patch removes inherited resources and includes only
Workbench and the pinned independent controller package. Do not use
`stage-medialab.sh` for this build: it stages the legacy runtime. A direct
`npx tauri build` uses the base Workbench-only resource list and does not provide
a pinned controller installer. Use the recipe above for the complete package.

For frontend development, run Expo web on port 8098 in `app`, then
`npx tauri dev` in `desktop`. This does not stage the controller package.

## Checks and verified scope

From the repository root (with the corresponding Python/Node/Rust test tools
installed):

```sh
python3 -m pytest desktop/tests/test_independent_build.py
python3 -m pytest desktop/tests/test_sidecar_supervisor.py
node --test desktop/tests/independent-status.test.mjs desktop/tests/independent-welcome.test.mjs
cd desktop/src-tauri
cargo test
```

The ignored live keychain test requires actual OS credential access. Do not use
it as an unattended check. Workbench's contract suite is
`bash desktop/workbench/test.sh` from the repository root.

Isolated unsigned macOS review builds have exercised controller Install → Start →
Use this computer → Pair, stopped the owned controller on Quit, and verified
project/media portability with test assets. Generic HTTP MCP pairing, permission
scoping and revocation have also passed native checks. An installed Hermes client
has passed pairing and media search against the fresh packaged Mac review app,
including permission scoping and rejection after unlink. An older review binary
had a discovery timeout whose cause is still unresolved; the fresh test does not
prove credential migration across rebuilt app identities.
These results do not qualify signed distribution, all media-generation workflows,
Windows/Linux native behavior or remote agent access across networks.

The supervisor owns the direct server child through a private stdin pipe and
waits up to seven seconds during shutdown before fallback termination. Its tests
cover port release and child exit codes, not independently spawned model processes.

## Headless controller tools

The scripts below can be used independently of the desktop GUI:

- `scripts/stage-independent-controller.py --output /new/source` stages controller
  source, license and dependency locks with a SHA-256 manifest.
- `scripts/install-independent-controller.py --source /staged/source
  --manifest-sha256 REVIEWED_MANIFEST_SHA256 --destination /new/private/install
  --python /path/to/tested/python` verifies and installs that source. `--uv` can
  select uv; `--resume` resumes supported failed stages with the same source and
  platform. Completed installations and concurrent installers are refused.
- `scripts/run-independent-controller.py --installation /private/install inspect`
  validates an installation. Replace `inspect` with `pair` to display its private
  access code or `serve --port 7864` to run in the foreground. Keep the installer
  and launcher scripts together. Serving verifies the completed installation and
  defaults to loopback.

These commands prepare or run the controller; they do not qualify models or
configure a service manager, domain, Tailscale, upgrades or uninstall.

## Releases and updates

`.github/workflows/build-desktop.yml` exports the current frontend and stages the
independent package for every build. The artifact matrix covers macOS, Windows
x64, Linux x64 and Linux ARM64. The release job publishes Windows/Linux installers
and signed updater artifacts; its macOS build remains an unsigned CI artifact.
The separately authorized `scripts/release-mac.sh` performs Mac signing,
notarization and publication using the same independent packaging recipe.
Do not run that script for local verification: it publishes externally.

The app checks the GitHub updater manifest on launch and offers installation
when a newer version is available. `VIBEX_NO_UPDATE_CHECK=1` disables the startup
check for isolated review runs. Manual checking is in the native application
menu (Help on Windows/Linux). Releases need matching version metadata, protected
signing credentials and actual platform verification. These recipes have not
been dispatched or published as part of this review.

## License and credits

The Studio/controller source is Apache-2.0; see the repository license. Third-party
dependencies and optional model runtimes retain their own terms. A source hash or
successful package build does not establish redistribution permission for every
optional engine. The independent package contains no model weights or legacy H3
runtime. See the capability status and controller documentation for qualification
limits before adding engines to a distribution.

Built with Tauri, the Studio Expo frontend and the independent Media Lab controller.
