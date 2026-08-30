#!/usr/bin/env python3
"""Media Lab queue watchdog — detects a stalled queue and self-heals.

Run by media-lab-queue-watchdog.timer every 2 minutes. Stdlib only.

What it protects against (each one has actually happened):
  A. Worker thread dead/blocked: jobs queued, nothing running, for 2+ checks.
     -> restart media-lab-simple.service (safe: nothing is running).
     (2026-08-16: a hung Apple web-push with no timeout blocked the worker;
      16 jobs sat "queued" until a human noticed.)
  B. A running job wedged: same job id + stage unchanged for > STALL_RUNNING_MIN.
     -> restart the app; the app marks the job "studio restarted mid-take — hit
     Retry". The interruption is logged loudly.
  C. App unreachable while the service claims active -> restart.
  D. GPU pool lock not held after a reboot -> pool_lock.sh acquire (idempotent).

State between runs lives in watchdog-state.json next to this script's data dir.
Never restarts more often than RESTART_COOLDOWN_MIN.
"""
import json, os, subprocess, sys, time, urllib.error, urllib.request

HOME = os.path.expanduser("~")
ROOT = os.path.join(HOME, "media-lab-simple")
STATE = os.path.join(ROOT, "watchdog-state.json")
QUEUE_URL = "http://YOUR_TAILNET_IP:7863/api/queue"
TUNNEL_URL = "https://media.autoedu.ai/"
TUNNEL_METRICS_URL = "http://127.0.0.1:20241/metrics"
TUNNEL_PROBE_UA = "MediaLabWatchdog/1.0"
TUNNEL_ORIGIN_FAILURE_CODES = (0, 502, 503, 504, 521, 522, 523, 530)
POOL_LOCK = "/run/user/1000/spark-gpu.lock"
POOL_SH = os.path.join(ROOT, "runner", "pool_lock.sh")

STALL_IDLE_CHECKS = 2        # consecutive checks with queued>0, running==0
STALL_RUNNING_MIN = 45       # minutes a running job may sit on one stage
# ...unless the engine says it is mid-generation. H3 at its TRAINED canvas
# (1344x768) packs 2.2x the tokens of the old 864x480 preview preset and a take
# legitimately runs 45-70 min. Killing that is worse than waiting: judge by the
# engine's own busy flag, and only fall back to the clock if it cannot answer.
ENGINE_HEALTH = ("http://127.0.0.1:8290/health", "http://127.0.0.1:8291/health")
STALL_HARD_MIN = 120
RESTART_COOLDOWN_MIN = 10

ENV = dict(os.environ,
           XDG_RUNTIME_DIR="/run/user/1000",
           DBUS_SESSION_BUS_ADDRESS="unix:path=/run/user/1000/bus")


def log(msg):
    print(f"[queue-watchdog] {msg}", flush=True)


def load_state():
    try:
        with open(STATE) as f:
            return json.load(f)
    except Exception:
        return {}


def save_state(st):
    tmp = STATE + ".tmp"
    with open(tmp, "w") as f:
        json.dump(st, f)
    os.replace(tmp, STATE)


def restart_app(st, reason):
    last = st.get("last_restart", 0)
    if time.time() - last < RESTART_COOLDOWN_MIN * 60:
        log(f"WOULD restart ({reason}) but cooldown active — skipping")
        return
    log(f"RESTARTING media-lab-simple.service — {reason}")
    subprocess.run(["systemctl", "--user", "restart", "media-lab-simple.service"],
                   env=ENV, check=False)
    st["last_restart"] = time.time()
    st["idle_strikes"] = 0
    st.pop("run_seen", None)


def ensure_pool_lock():
    # pool_lock.sh acquire is idempotent: OK / BUSY(62) / FAIL(63).
    # BUSY means someone (possibly an outside production) holds it — that is fine.
    if not os.path.exists(POOL_SH):
        return
    for unit in ("media-lab-pool.service", "media-lab-gpu-reservation.service"):
        up = subprocess.run(["systemctl", "--user", "is-active", "--quiet", unit], env=ENV)
        if up.returncode == 0:
            return                  # warm pool OR intended idle reservation is healthy
    r = subprocess.run(["bash", POOL_SH, "acquire"], env=ENV,
                       capture_output=True, text=True)
    if r.returncode == 0:
        log(f"pool holder was missing — re-acquired: {(r.stdout or '').strip() or 'OK'}")
    elif r.returncode == 63:
        log(f"pool lock acquire FAILED: {r.stdout} {r.stderr}")


def an_engine_is_working():
    """True when a video engine reports busy — real evidence of progress."""
    for url in ENGINE_HEALTH:
        try:
            with urllib.request.urlopen(url, timeout=5) as r:
                if json.load(r).get("busy"):
                    return True
        except Exception:
            continue
    return False


def public_tunnel_code():
    """Return the edge status without Cloudflare blocking Python's default UA.

    Cloudflare error 1010 returns HTTP 403 to Python's stock urllib user-agent.
    Treating every 403 as proof of a healthy connector masked a real 1033/530
    outage on 2026-08-21, so connector metrics are checked independently below.
    """
    try:
        req = urllib.request.Request(
            TUNNEL_URL,
            headers={"User-Agent": TUNNEL_PROBE_UA, "Accept": "text/html"},
            method="GET",
        )
        return urllib.request.urlopen(req, timeout=15).getcode()
    except urllib.error.HTTPError as e:
        return e.code
    except Exception:
        return 0


def tunnel_ha_connections():
    """Return cloudflared's active connector count, or None if unobservable."""
    try:
        with urllib.request.urlopen(TUNNEL_METRICS_URL, timeout=5) as resp:
            text = resp.read().decode("utf-8", "replace")
        prefix = "cloudflared_tunnel_ha_connections "
        for line in text.splitlines():
            if line.startswith(prefix):
                return int(float(line[len(prefix):].strip()))
    except Exception:
        pass
    return None


def check_tunnel(st):
    """Restart a connectorless or origin-unreachable public tunnel after 2 hits.

    Public status alone is ambiguous because Cloudflare can reject an automated
    probe before it reaches the tunnel. The local HA metric is authoritative for
    connector residency; the public response verifies the edge-to-origin path.
    """
    code = public_tunnel_code()
    ha = tunnel_ha_connections()
    unhealthy = code in TUNNEL_ORIGIN_FAILURE_CODES or ha == 0
    if not unhealthy:
        st["tunnel_strikes"] = 0
        return
    st["tunnel_strikes"] = st.get("tunnel_strikes", 0) + 1
    log(f"public tunnel unhealthy (HTTP {code}, HA connectors={ha}) — "
        f"strike {st['tunnel_strikes']}/2")
    if st["tunnel_strikes"] >= 2:
        log("RESTARTING media-lab-tunnel.service")
        subprocess.run(["systemctl", "--user", "restart", "media-lab-tunnel.service"],
                       env=ENV, check=False)
        st["tunnel_strikes"] = 0

def main():
    st = load_state()

    # --- reach the app ---
    try:
        with urllib.request.urlopen(QUEUE_URL, timeout=15) as resp:
            d = json.load(resp)
    except Exception as e:
        active_state = subprocess.run(
            ["systemctl", "--user", "is-active", "media-lab-simple.service"],
            env=ENV, capture_output=True, text=True).stdout.strip()
        log(f"/api/queue unreachable ({e}); service is '{active_state}'")
        if active_state == "active":
            restart_app(st, "service active but API unreachable")
        else:
            subprocess.run(["systemctl", "--user", "restart",
                            "media-lab-simple.service"], env=ENV, check=False)
            st["last_restart"] = time.time()
            log("service was not active — started it")
        save_state(st)
        return

    active = d.get("active", [])
    running = [j for j in active if j.get("status") == "running"]
    queued = [j for j in active if j.get("status") == "queued"]

    # --- case D: make sure the GPU pool lock has a holder (post-reboot gap) ---
    ensure_pool_lock()

    # --- case E: the public tunnel can die while the app is healthy ---
    check_tunnel(st)

    # --- case A: queued work but the worker is doing nothing ---
    if queued and not running:
        st["idle_strikes"] = st.get("idle_strikes", 0) + 1
        log(f"queued={len(queued)} running=0 — idle strike "
            f"{st['idle_strikes']}/{STALL_IDLE_CHECKS}")
        if st["idle_strikes"] >= STALL_IDLE_CHECKS:
            restart_app(st, f"worker stalled: {len(queued)} queued, none running "
                            f"for {st['idle_strikes']} checks")
    else:
        st["idle_strikes"] = 0

    # --- case B: a running job frozen on one stage too long ---
    if running:
        j = running[0]
        sig = f"{j.get('id')}:{j.get('stage')}"
        seen = st.get("run_seen")
        if seen and seen.get("sig") == sig:
            mins = (time.time() - seen["since"]) / 60
            if mins > STALL_RUNNING_MIN and an_engine_is_working():
                log(f"job {j.get('id')} has been on '{j.get('stage')}' for {mins:.0f} min, "
                    f"but an engine reports busy — it is rendering, not wedged")
            elif mins > STALL_RUNNING_MIN:
                log(f"job {j.get('id')} ({j.get('kind')}) stuck on stage "
                    f"'{j.get('stage')}' for {mins:.0f} min — treating as wedged. "
                    f"INTERRUPTING IT: the app will mark it for Retry.")
                restart_app(st, f"wedged running job {j.get('id')}")
        else:
            st["run_seen"] = {"sig": sig, "since": time.time()}
    else:
        st.pop("run_seen", None)

    save_state(st)


if __name__ == "__main__":
    main()
