# Install Media Lab

One command. No accounts, no telemetry, nothing downloaded except Python
packages. Model weights and engines are installed later, by you, from inside
the app — each one shows its own license and size first.

```sh
git clone <this repository>
cd media-lab-studio
./install.sh
```

When it finishes it prints the URLs, the access code, and a QR code. Point
your phone's camera at the QR and the **VibeXStudio** app pairs to this
studio. Run `media-lab pair` any time to print it again.

`install.sh` is safe to re-run: it reuses the venv, never overwrites a code
file or anything under the data root, and re-renders the service. That makes
`git pull && ./install.sh` the update path.

## Which machine?

### A plain Mac (cloud-only)

No NVIDIA GPU, so the local engines are off. Run `./install.sh` — it starts the
studio in the foreground (Ctrl-C stops it). Open the printed URL, then in the
theme sheet → **Cloud providers**, paste your [fal.ai](https://fal.ai) key.
`fal-image` and `fal-video` appear as engines. Your key, your bill.

To keep it running without a terminal, install it as a launchd user agent:

```sh
./install.sh --service
```

It starts at login and restarts if it dies. `media-lab stop|start|restart|logs`
drive it.

### A DGX Spark or any Linux GPU box (the full studio)

`./install.sh` installs a **systemd --user** service (`media-lab.service`),
enables lingering so the studio survives logout and reboot, starts it and
waits until it answers. Then open the printed URL: the first-run engine shelf
offers LTX and the other local engines. Each shows its terms, size and time
before anything happens; the download and install run in the background and
you get a push when it is ready. Engines this repo has no automated path for
say so instead of pretending.

Needs Python ≥ 3.11 (or [uv](https://docs.astral.sh/uv/), which brings its
own), `ffmpeg`, and for the engines `docker` with the NVIDIA runtime.
`install.sh` tells you exactly what is missing and the apt line that fixes it.

### "I already run it"

You deployed Media Lab by hand, with your own unit or a copied tree. Run
`./install.sh` from the clone anyway: it builds the venv and the `media-lab`
CLI, sees your running server on the port, **leaves it alone**, and prints
the pairing QR for it. It never overwrites a service file it did not write
(look for `managed by media-lab install.sh` at the top). A data root that is a
real directory (not a symlink to the repo) is treated as a deployed copy and
left as it is.

## Flags

| flag | meaning |
| --- | --- |
| `--port N` | listen port (default 7863) |
| `--bind ADDR` | bind address (default `0.0.0.0`; use a tailnet IP to hide from the LAN) |
| `--service` / `--no-service` | service install on/off (default: on for Linux, off for macOS) |
| `--detach` | no service: start in the background, print, exit |
| `--yes` | never ask — for agents and scripts |
| `--uninstall` | remove the service and `.venv`; models, media, jobs and codes stay |

`MEDIA_LAB_HOME=/big/disk/media-lab ./install.sh` puts the data root
somewhere else. The server itself reads `~/media-lab-simple`, so the installer
keeps a symlink there pointing at your directory.

## Pairing from the phone

1. Install **VibeXStudio** on the phone.
2. Put the phone on the same Wi-Fi as the studio, **or** sign both into the
   same Tailscale tailnet (then it works from anywhere, including cellular).
3. Scan the QR the installer printed (`media-lab pair` shows it again). The
   link is `vibex://pair?medialab=<your studio URL>`; the app probes
   `/manifest.json` and adds a Media Lab tab.
4. No camera? In the app: **Media Lab → More options**, type the URL
   (`http://<ip>:7863`) and the access code.

The QR prefers the tailnet address when Tailscale is up, else the LAN address.
It is drawn for a dark terminal; on a light theme use `media-lab pair --no-invert`.

Two codes open the same door: the **access code** (`access-code.txt`) and the
**admin code** (`admin-pin.txt`), both under the data root. `media-lab code`
prints the access code, `media-lab code --rotate --restart` replaces it (and
signs every phone out).

## The desktop app

The VibeXStudio desktop app can host Media Lab as a sidecar: it runs the same
server from its own bundle and shows the same QR. If you run both, give the
sidecar another port — or point the desktop app at this server's URL instead.

## `media-lab`

`install.sh` links `tools/media-lab` into `~/.local/bin` when that directory
exists; otherwise call it by path.

```
media-lab status [--json]      health, GPU, engines, service state
media-lab pair   [--json]      pairing QR, URLs, access code
media-lab code   [--rotate]    show / rotate the access code (--admin for the other)
media-lab start|stop|restart   service-aware; foreground fallback (start --foreground)
media-lab logs   [-f]          journal / launchd log / pid-mode log
media-lab setup  [--list]      the catalog planner + where the web wizard lives
media-lab uninstall [--yes]    same as ./install.sh --uninstall
```

`--json` on `status` and `pair` is for agents: `status` exits 0 only when
`/manifest.json` answers.

## Updating

```sh
git pull && ./install.sh
```

Re-renders the service and restarts it. Jobs, media, characters and voices
are untouched. A render in flight is interrupted — check `media-lab status`
first.

## Uninstall

```sh
./install.sh --uninstall
```

Stops and removes the service (or the background process), deletes `.venv`
and `install.json`. The data root — models, media, jobs, characters, voices,
access codes — is kept. Delete it yourself if you mean it. Engines installed
from the web shelf (docker images, ComfyUI runtimes) are also left in place.

## Troubleshooting

**"port 7863 is already taken"** — something else listens there. Another
Media Lab? `media-lab status` says. Otherwise `./install.sh --port 7870`.

**The phone says "No Media Lab answered there."** — the phone cannot reach
the address in the QR.
- Same Wi-Fi? Guest networks and "client isolation" block phone-to-laptop.
  Use Tailscale on both instead.
- Firewall: the server must accept inbound TCP on the port. Linux:
  `sudo ufw allow 7863/tcp`. macOS: System Settings → Network → Firewall →
  allow incoming for Python, or turn the firewall off for the test.
- Bound to the wrong interface? `--bind 0.0.0.0` (the default) listens on
  everything; a specific `--bind` listens only there.
- From the phone's browser, open `http://<ip>:7863/manifest.json`. JSON
  means the network is fine and the app is the problem; a timeout means the
  network is.

**Tailnet address shown but the phone is not on Tailscale** — scan anyway,
then use **More options** with the LAN URL from the summary instead.

**Service will not start** — `media-lab logs`. On Linux also
`systemctl --user status media-lab`; if `systemctl --user` itself fails you
have no user session bus — log in once over SSH as that user, or run
`./install.sh --no-service`.

**Stops when I log out (Linux)** — lingering could not be enabled. Run
`sudo loginctl enable-linger $USER` once.

**No QR, just a link** — the `qrcode` package is missing from the venv.
`./install.sh` again fixes it; the link and the typed-in fallback work
without it.

**Python too old** — needs 3.11+. Install `uv` and re-run: it fetches its own.
