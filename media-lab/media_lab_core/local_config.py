"""Per-host Media Lab settings: one small env file instead of edited literals.

Every value that used to be a hard-coded hostname, tailnet address, home
directory or model path now comes from here. Resolution order, highest wins:

  1. the process environment (``MEDIA_LAB_BIND_HOST=... python -m uvicorn``),
  2. ``$MEDIA_LAB_HOME/config/local.env`` (gitignored, per machine),
  3. ``<repo>/config/local.env`` next to this package (a dev checkout),
  4. the defaults below, which describe a private single-machine install.

The file is plain ``KEY=VALUE`` lines (``export KEY=VALUE`` and quotes are
tolerated, ``#`` starts a comment) so the same file can be sourced by the
shell runners and read by ``EnvironmentFile=`` in systemd units. Stdlib only:
the runner scripts import this from a bare timer with no virtualenv.

``python -m media_lab_core.local_config`` prints the resolved values.
"""
from __future__ import annotations

import os
import sys
from pathlib import Path

DEFAULTS: dict[str, str] = {
    # Data root: jobs.json, media/, pool/, config/local.env. install.sh keeps a
    # symlink at ~/media-lab-simple when it is moved elsewhere.
    "MEDIA_LAB_HOME": "~/media-lab-simple",
    # Address uvicorn and the sidecars bind. 127.0.0.1 is private-by-default;
    # a tailnet address makes the studio reachable from paired devices.
    "MEDIA_LAB_BIND_HOST": "127.0.0.1",
    # Hostnames a reverse proxy / tunnel presents (comma separated). Requests
    # carrying one of these are treated as public-edge traffic.
    "MEDIA_LAB_PUBLIC_HOSTS": "",
    # Where engine weights live (HunyuanVideo-Avatar, MuseTalk, ...).
    "MEDIA_LAB_MODELS_ROOT": "~/.local/share/media-lab-p2-models",
    # Where engine runtimes are checked out (LatentSync.stage, comfy-*, ...).
    "MEDIA_LAB_RUNTIME_ROOT": "~/runtime",
    # This machine's tailnet address or MagicDNS name, if it has one. Trusted
    # like localhost; the bind-readiness drop-in waits for it after boot.
    "MEDIA_LAB_TAILNET_HOST": "",
    # The OpenAI-compatible text runtime (PPLX/Flash) behind the studio.
    "MEDIA_LAB_TEXT_UPSTREAM": "http://127.0.0.1:8004",
    # Optional: ssh target of the studio host for Mac-side helpers
    # (local_studio.py, tools/topaz_worker.py). Empty disables them.
    "MEDIA_LAB_SSH": "",
    # Resident text-model budget (GB) and the unified-memory ceiling app.py
    # plans against. 0 = the chat model is served remotely, nothing resident.
    "MEDIA_LAB_QWEN_GB": "0",
    "MEDIA_LAB_MEM_CAP_GB": "120",
    # Sol-H3-Spark (the whole-box H3 video engine). Empty SOL_PKG = not installed.
    "SOL_PKG": "",
    "SOL_ROOT": "~/.local/share/sol-h3-spark",
    "SOL_H3_SPARK_RUNTIME_ROOT": "",
    "SOL_H3_SPARK_QWEN_WEIGHTS_ROOT": "~/.local/share",
    "SOL_H3_SPARK_QWEN_IMAGE": "sol-h3-spark-qwen",
}

_PATH_KEYS = {"MEDIA_LAB_HOME", "MEDIA_LAB_MODELS_ROOT", "MEDIA_LAB_RUNTIME_ROOT",
              "SOL_PKG", "SOL_ROOT", "SOL_H3_SPARK_RUNTIME_ROOT",
              "SOL_H3_SPARK_QWEN_WEIGHTS_ROOT"}

SOURCE_ROOT = Path(__file__).resolve().parents[1]


def parse_env_file(path: Path) -> dict[str, str]:
    """Read KEY=VALUE lines. Missing or unreadable file -> {} (never raises)."""
    values: dict[str, str] = {}
    try:
        text = path.read_text(encoding="utf-8")
    except OSError:
        return values
    for raw in text.splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        if line.startswith("export "):
            line = line[len("export "):].lstrip()
        key, _, value = line.partition("=")
        key = key.strip()
        if not key or not key.replace("_", "").isalnum():
            continue
        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
            value = value[1:-1]
        values[key] = value
    return values


def _expand(key: str, value: str) -> str:
    value = os.path.expandvars(value)
    if key in _PATH_KEYS and value:
        value = os.path.expanduser(value)
    return value


def env_file_candidates() -> list[Path]:
    """Where local.env is looked for, in precedence order (first wins per key)."""
    home_raw = os.environ.get("MEDIA_LAB_HOME", "").strip() or DEFAULTS["MEDIA_LAB_HOME"]
    home = Path(os.path.expanduser(os.path.expandvars(home_raw)))
    candidates = [home / "config" / "local.env", SOURCE_ROOT / "config" / "local.env"]
    seen: list[Path] = []
    for c in candidates:
        if c not in seen:
            seen.append(c)
    return seen


def load(environ: dict[str, str] | None = None) -> dict[str, str]:
    """Resolve every known key: environ > local.env files > defaults."""
    environ = os.environ if environ is None else environ
    resolved: dict[str, str] = dict(DEFAULTS)
    for path in reversed(env_file_candidates()):
        for key, value in parse_env_file(path).items():
            if key in DEFAULTS:
                resolved[key] = value
    for key in DEFAULTS:
        if key in environ and environ[key] != "":
            resolved[key] = environ[key]
    return {key: _expand(key, value) for key, value in resolved.items()}


def get(key: str, default: str | None = None) -> str:
    """One resolved value. Unknown keys fall back to the environment."""
    if key in DEFAULTS:
        return load()[key]
    return os.environ.get(key, "" if default is None else default)


def path(key: str) -> Path:
    return Path(get(key))


def home() -> Path:
    return path("MEDIA_LAB_HOME")


def bind_host() -> str:
    return get("MEDIA_LAB_BIND_HOST") or "127.0.0.1"


def tailnet_host() -> str:
    return get("MEDIA_LAB_TAILNET_HOST").strip()


def public_hosts() -> set[str]:
    return {h.strip().lower() for h in get("MEDIA_LAB_PUBLIC_HOSTS").split(",") if h.strip()}


def trusted_hosts() -> set[str]:
    """Hosts whose requests are treated as local: loopback, the bind address,
    and the tailnet address when one is configured."""
    hosts = {"127.0.0.1", "localhost", bind_host()}
    if tailnet_host():
        hosts.add(tailnet_host())
    hosts.discard("0.0.0.0")
    hosts.discard("")
    return hosts


def models_root() -> Path:
    return path("MEDIA_LAB_MODELS_ROOT")


def runtime_root() -> Path:
    return path("MEDIA_LAB_RUNTIME_ROOT")


def text_upstream() -> str:
    return get("MEDIA_LAB_TEXT_UPSTREAM").rstrip("/") or "http://127.0.0.1:8004"


def studio_url(port: int = 7863) -> str:
    """The studio's own base URL as seen from this machine (watchdogs, canaries)."""
    host = bind_host()
    if host in ("0.0.0.0", "::", ""):
        host = "127.0.0.1"
    return f"http://{host}:{port}"


def int_value(key: str, default: int) -> int:
    raw = os.environ.get(key, "").strip()
    if not raw:
        for p in env_file_candidates():
            raw = parse_env_file(p).get(key, "").strip()
            if raw:
                break
    try:
        return int(raw) if raw else default
    except ValueError:
        return default


def sol() -> dict[str, str]:
    """The SOL_* keys, resolved, for the Sol-H3-Spark engine command."""
    values = load()
    return {k: values[k] for k in values if k.startswith("SOL_")}


def sol_configured() -> bool:
    return bool(sol().get("SOL_PKG"))


def subprocess_env(base: dict[str, str] | None = None) -> dict[str, str]:
    """os.environ plus every resolved key: hand this to shell runners."""
    env = dict(os.environ if base is None else base)
    env.update({k: v for k, v in load().items() if v})
    return env


def main(argv: list[str] | None = None) -> int:
    argv = sys.argv[1:] if argv is None else argv
    values = load()
    if argv and argv[0] == "--sh":
        for key, value in values.items():
            print(f"export {key}='{value}'")
        return 0
    if argv:
        for key in argv:
            print(values.get(key, os.environ.get(key, "")))
        return 0
    print("# resolved Media Lab settings (env > local.env > defaults)")
    for p in env_file_candidates():
        print(f"# {'read' if p.is_file() else 'absent'}: {p}")
    for key, value in values.items():
        print(f"{key}={value}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
