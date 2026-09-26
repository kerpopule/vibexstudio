#!/usr/bin/env python3
"""Clear the harmless kind of GPU recovery hold, through the sanctioned tool only.

Run by media-lab-hold-autorecover.timer every 5 minutes. Stdlib only.

A controller restart while a warm engine is parked leaves the durable lease in
``recovery`` with reason ``owner-exited`` (or ``controller-restarted``) and a
``gpu-recovery-hold.json`` marker. Nothing is wrong with the GPU: the owner
simply went away. Until 2026-09 every such hold waited for a person (6.5 to
67.5 hours each) and helpers improvised unsafe clears (deleting the lease row
or the marker by hand). This script is the one sanctioned self-heal:

* it acts ONLY on a startup hold (marker reason ``durable-lease-recovery:
  owner-exited`` / ``...:controller-restarted``, no job in the marker) whose
  durable row says the same, on the SAME boot, for a jobless residency lease
  (``idle-restore-*`` / ``internal-*``) or a parked lease whose job is finished;
* only when the hold is at least 10 minutes old (a person gets the first
  chance), no job is running (asked of the studio itself), no operator baton or
  engine-maintenance marker exists, the H3 safety stop and memwatch latch are
  absent, the control-plane guard heartbeat is current and ready/monitoring,
  the old owner process is gone, and MemAvailable is above a floor;
* its only action is ``tools/reconcile-gpu-recovery.py --job-id <lease job>``,
  the same exact-proof tool an operator runs;
* limits: one attempt per hold, at most 3 attempts per 24 h, a backoff of
  10 min / 30 min / 2 h after failures, and after 2 consecutive failures (or a
  hold it already tried) it writes ``pool/autorecover-gaveup.json`` and stops
  acting until a person removes that file. The health check alerts on it.

It never touches ``operation-uncertain``, guard trips, safety stops,
``boot-changed`` holds or anything while a job runs: those reasons are simply
not on the list. Off unless MEDIA_LAB_HOLD_AUTORECOVER=1 (config/local.env).

    runner/hold_autorecover.py            # one pass (the timer)
    runner/hold_autorecover.py --dry-run  # print the decision, change nothing
"""
from __future__ import annotations

import argparse
import json
import os
import sqlite3
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
from media_lab_core import local_config   # noqa: E402  stdlib only
from media_lab_core import local_token    # noqa: E402  stdlib only

FLAG = "MEDIA_LAB_HOLD_AUTORECOVER"
SAFE_REASONS = ("owner-exited", "controller-restarted")
JOBLESS_PREFIXES = ("idle-restore-", "internal-")
TERMINAL = ("done", "error", "cancelled")
MIN_AGE_S = 600
DAILY_CAP = 3
BACKOFF_S = (600, 1800, 7200)
GIVE_UP_AFTER = 2
MIN_AVAILABLE_GIB = 6.0
GUARD_MAX_AGE_S = 30.0
RECONCILE_TIMEOUT_S = 1200
CONTROLLER_MARKERS = ("uvicorn", "app:app")


def log(msg: str) -> None:
    print(f"[hold-autorecover] {msg}", flush=True)


class Paths:
    def __init__(self, root: Path | None = None, runtime: Path | None = None,
                 sol_root: Path | None = None):
        self.root = Path(root or local_config.home())
        self.pool = self.root / "pool"
        self.hold = self.pool / "gpu-recovery-hold.json"
        self.db = Path(os.environ.get("MEDIA_LAB_GPU_LEASE_DB") or self.pool / "gpu-lease.sqlite3")
        self.state = self.pool / "autorecover-state.json"
        self.gaveup = self.pool / "autorecover-gaveup.json"
        self.log = self.pool / "autorecover.log"
        self.jobs = self.root / "jobs.json"
        self.baton = self.root / ".operator-baton"
        self.engine_maintenance = self.root / ".engine-maintenance"
        self.runtime = Path(runtime or local_config.runtime_dir())
        self.latch = self.runtime / "flashnext-memwatch.latch"
        self.guard = Path(os.environ.get("SOL_H3_GUARD_HEARTBEAT")
                          or self.runtime / "solh3-control-plane-guard.json")
        self.sol_root = Path(sol_root or os.path.expanduser(
            local_config.get("SOL_ROOT") or "~/.local/share/sol-h3-spark"))
        self.safety_stop = self.sol_root / "safety-stop.json"
        self.tool = self.root / "tools" / "reconcile-gpu-recovery.py"
        venv = self.root / ".venv" / "bin" / "python"
        self.python = str(venv) if venv.exists() else sys.executable


def _read_json(path: Path):
    try:
        return json.loads(path.read_text())
    except (OSError, ValueError):
        return None


def _boot_id() -> str:
    try:
        return Path("/proc/sys/kernel/random/boot_id").read_text().strip()
    except OSError:
        return ""


def _mem_available_gib() -> float | None:
    try:
        for line in Path("/proc/meminfo").read_text().splitlines():
            if line.startswith("MemAvailable:"):
                return int(line.split()[1]) / 1024 / 1024
    except (OSError, ValueError, IndexError):
        pass
    return None


def _pid_is_controller(pid: int) -> bool:
    """True when ``pid`` is alive AND looks like a studio controller."""
    try:
        cmd = Path(f"/proc/{pid}/cmdline").read_bytes().replace(b"\0", b" ").decode(errors="replace")
    except OSError:
        return False
    return any(m in cmd for m in CONTROLLER_MARKERS)


def lease_row(db: Path) -> dict | None:
    """The durable lease, read-only. Raises when the database cannot be read."""
    if not db.exists():
        return None
    con = sqlite3.connect(f"file:{db}?mode=ro", uri=True, timeout=5)
    try:
        con.row_factory = sqlite3.Row
        row = con.execute("SELECT * FROM gpu_lease WHERE singleton=1").fetchone()
        return dict(row) if row is not None else None
    finally:
        con.close()


def studio_running_jobs(timeout: float = 15.0) -> int | None:
    """Running jobs as the studio itself reports them; None if it cannot answer."""
    url = local_config.studio_url() + "/api/queue?hist=0"
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    try:
        with opener.open(local_token.authorize(urllib.request.Request(url)), timeout=timeout) as r:
            data = json.load(r)
    except Exception:
        return None
    active = data.get("active") if isinstance(data, dict) else None
    if not isinstance(active, list):
        return None
    return sum(1 for j in active if isinstance(j, dict) and j.get("status") == "running")


def gather(paths: Paths, *, now: float | None = None) -> dict:
    """Every fact the decision needs. Read-only."""
    now = time.time() if now is None else now
    facts: dict = {"now": now, "boot_id": _boot_id()}
    facts["hold"] = _read_json(paths.hold) if paths.hold.exists() else None
    facts["hold_exists"] = paths.hold.exists()
    try:
        facts["lease"] = lease_row(paths.db)
    except sqlite3.Error as exc:
        facts["lease"] = None
        facts["lease_error"] = str(exc)
    lease = facts["lease"] or {}
    jobs = (_read_json(paths.jobs) or {}).get("jobs") if paths.jobs.exists() else {}
    jobs = jobs if isinstance(jobs, dict) else {}
    job = jobs.get(str(lease.get("job_id") or "")) if lease else None
    facts["lease_job_status"] = job.get("status") if isinstance(job, dict) else None
    facts["persisted_running"] = sum(1 for j in jobs.values()
                                     if isinstance(j, dict) and j.get("status") == "running")
    facts["studio_running"] = studio_running_jobs()
    facts["baton"] = paths.baton.exists()
    facts["engine_maintenance"] = paths.engine_maintenance.exists()
    facts["safety_stop"] = paths.safety_stop.exists()
    facts["latch"] = paths.latch.exists()
    guard = _read_json(paths.guard)
    facts["guard_state"] = guard.get("state") if isinstance(guard, dict) else None
    facts["guard_fresh"] = bool(
        isinstance(guard, dict) and guard.get("boot_id") == facts["boot_id"]
        and isinstance(guard.get("written_at"), (int, float))
        and 0 <= now - float(guard["written_at"]) <= GUARD_MAX_AGE_S)
    pid = lease.get("pid") if lease else None
    facts["owner_is_controller"] = bool(pid) and _pid_is_controller(int(pid))
    facts["mem_available_gib"] = _mem_available_gib()
    return facts


def hold_key(facts: dict) -> str | None:
    hold, lease = facts.get("hold") or {}, facts.get("lease") or {}
    if not lease:
        return None
    return f"{lease.get('fence')}:{lease.get('job_id')}:{hold.get('created')}"


def _recent(state: dict, now: float) -> list[dict]:
    return [a for a in state.get("attempts", []) if now - float(a.get("ts", 0)) < 86400]


def decide(facts: dict, state: dict, *, enabled: bool, gaveup: bool,
           min_age_s: float = MIN_AGE_S, min_available_gib: float = MIN_AVAILABLE_GIB) -> tuple[str, str]:
    """Return (action, reason). action is one of: idle, wait, skip, giveup, reconcile."""
    now = float(facts["now"])
    if not facts.get("hold_exists"):
        return "idle", "no recovery hold"
    if not enabled:
        return "skip", f"{FLAG} is off"
    if gaveup:
        return "skip", "gave up earlier; a person must look (remove autorecover-gaveup.json after)"
    hold = facts.get("hold")
    lease = facts.get("lease")
    if not isinstance(hold, dict):
        return "skip", "hold marker is unreadable"
    if not lease:
        return "skip", "hold without a durable lease (ambiguous)"
    reason = str(lease.get("reason") or "")
    if lease.get("state") != "recovery" or reason not in SAFE_REASONS:
        return "skip", f"lease is {lease.get('state')}:{reason or 'none'} (not a harmless restart hold)"
    if hold.get("job_id") is not None or hold.get("reason") != f"durable-lease-recovery:{reason}":
        return "skip", "hold marker is not the startup restart hold"
    if not facts.get("boot_id") or lease.get("boot_id") != facts["boot_id"]:
        return "skip", "lease is from another boot (needs boot clearance, not auto-recovery)"
    job_id = str(lease.get("job_id") or "")
    jobless = job_id.startswith(JOBLESS_PREFIXES)
    finished_parked = lease.get("phase") == "parked" and facts.get("lease_job_status") in TERMINAL
    if not (jobless or finished_parked):
        return "skip", f"lease belongs to job {job_id} that is not finished"
    try:
        age = now - float(hold.get("created"))
    except (TypeError, ValueError):
        return "skip", "hold has no creation time"
    if age < min_age_s:
        return "wait", f"hold is {age / 60:.0f} min old; a person gets the first {min_age_s / 60:.0f} min"
    if facts.get("studio_running") is None:
        return "wait", "the studio did not answer the queue probe"
    if facts.get("studio_running") or facts.get("persisted_running"):
        return "wait", "a job is running"
    for key, what in (("baton", ".operator-baton"), ("engine_maintenance", ".engine-maintenance"),
                      ("safety_stop", "the H3 safety stop"), ("latch", "the memwatch latch")):
        if facts.get(key):
            return "skip", f"{what} is present"
    if not facts.get("guard_fresh") or facts.get("guard_state") not in ("ready", "monitoring"):
        return "skip", f"control-plane guard is not current/ready ({facts.get('guard_state')})"
    if facts.get("owner_is_controller"):
        return "skip", "the old owner process is still a live controller"
    avail = facts.get("mem_available_gib")
    if avail is None or avail < min_available_gib:
        return "wait", f"MemAvailable {avail} GiB is below {min_available_gib} GiB"
    key = hold_key(facts)
    if any(a.get("hold") == key for a in state.get("attempts", [])):
        return "giveup", "this hold was already tried once and is still there"
    recent = _recent(state, now)
    if len(recent) >= DAILY_CAP:
        return "giveup", f"{DAILY_CAP} attempts in 24 h already"
    failures = int(state.get("consecutive_failures", 0))
    if failures >= GIVE_UP_AFTER:
        return "giveup", f"{failures} consecutive failures"
    if failures:
        wait = BACKOFF_S[min(failures, len(BACKOFF_S)) - 1]
        last = max((float(a.get("ts", 0)) for a in state.get("attempts", [])), default=0.0)
        if now - last < wait:
            return "wait", f"backing off {wait // 60} min after a failure"
    return "reconcile", f"harmless {reason} hold for {job_id}, {age / 60:.0f} min old"


def _save(path: Path, value: dict) -> None:
    tmp = path.with_name(f".{path.name}.tmp")
    tmp.write_text(json.dumps(value, sort_keys=True))
    os.replace(tmp, path)


def _audit(paths: Paths, row: dict) -> None:
    try:
        if paths.log.exists() and paths.log.stat().st_size > 1_000_000:
            os.replace(paths.log, paths.log.with_suffix(".log.1"))
        with paths.log.open("a") as fh:
            fh.write(json.dumps(row, sort_keys=True) + "\n")
    except OSError:
        pass


def run_reconcile(paths: Paths, job_id: str) -> tuple[bool, dict]:
    """The sanctioned tool; it stops and restarts the studio itself."""
    try:
        r = subprocess.run([paths.python, str(paths.tool), "--job-id", job_id],
                           cwd=str(paths.root), capture_output=True, text=True,
                           timeout=RECONCILE_TIMEOUT_S)
    except subprocess.TimeoutExpired:
        return False, {"error": "reconcile timed out"}
    receipt: dict = {"rc": r.returncode}
    for line in reversed((r.stdout or "").splitlines()):
        try:
            parsed = json.loads(line)
        except ValueError:
            continue
        if isinstance(parsed, dict):
            receipt["result"] = {k: parsed.get(k) for k in (
                "reconciled_job", "internal_residency_recovery", "terminal_parked_recovery",
                "hold_exists", "pool_restored")}
            receipt["proof"] = {k: (parsed.get("proof") or {}).get(k) for k in (
                "processes_gone", "memory_recovered", "available_gib")}
            break
    if r.returncode != 0:
        receipt["error"] = (r.stderr or r.stdout or "").strip()[-400:]
    ok = r.returncode == 0 and (receipt.get("result") or {}).get("hold_exists") is False
    return ok, receipt


def main(argv: list[str] | None = None, *, paths: Paths | None = None,
         reconcile=run_reconcile, facts: dict | None = None) -> dict:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--dry-run", action="store_true", help="print the decision, change nothing")
    args = ap.parse_args(argv)
    paths = paths or Paths()
    facts = facts if facts is not None else gather(paths)
    state = _read_json(paths.state) or {}
    if state.get("gaveup_at") and not paths.gaveup.exists() and not args.dry_run:
        # A person looked and removed the give-up flag: start counting afresh.
        state["consecutive_failures"] = 0
        state.pop("gaveup_at", None)
        _save(paths.state, state)
    enabled = local_config.int_value(FLAG, 0) == 1
    action, why = decide(facts, state, enabled=enabled, gaveup=paths.gaveup.exists())
    lease = facts.get("lease") or {}
    out = {"ts": facts["now"], "action": action, "why": why, "dry_run": args.dry_run,
           "lease_job": lease.get("job_id"), "lease_reason": lease.get("reason")}
    if args.dry_run or action in ("idle",):
        log(f"{action}: {why}" + (" (dry run)" if args.dry_run else ""))
        return out
    if action in ("wait", "skip"):
        log(f"{action}: {why}")
        if action == "skip" or state.get("last_logged") != why:
            _audit(paths, out)
        state["last_logged"] = why
        _save(paths.state, state)
        return out
    if action == "giveup":
        state["gaveup_at"] = facts["now"]
        _save(paths.state, state)
        _save(paths.gaveup, {"ts": facts["now"], "why": why, "lease_job": lease.get("job_id"),
                             "lease_reason": lease.get("reason"),
                             "next_step": "Look at the hold, clear it with "
                                          "tools/reconcile-gpu-recovery.py --job-id <job>, "
                                          "then remove pool/autorecover-gaveup.json"})
        log(f"GIVING UP: {why}")
        _audit(paths, out)
        return out
    log(f"RECONCILING: {why}")
    started = time.time()
    ok, receipt = reconcile(paths, str(lease.get("job_id")))
    attempt = {"ts": facts["now"], "hold": hold_key(facts), "ok": ok,
               "seconds": round(time.time() - started, 1)}
    state.setdefault("attempts", []).append(attempt)
    state["attempts"] = state["attempts"][-20:]
    state["consecutive_failures"] = 0 if ok else int(state.get("consecutive_failures", 0)) + 1
    state["last_logged"] = None
    _save(paths.state, state)
    out.update(ok=ok, receipt=receipt)
    _audit(paths, out)
    log(("cleared the hold" if ok else "reconcile did NOT clear the hold") + f": {receipt}")
    if not ok and state["consecutive_failures"] >= GIVE_UP_AFTER:
        state["gaveup_at"] = facts["now"]
        _save(paths.state, state)
        _save(paths.gaveup, {"ts": facts["now"], "why": f"{GIVE_UP_AFTER} failed attempts",
                             "lease_job": lease.get("job_id"), "receipt": receipt})
    return out


if __name__ == "__main__":
    main()
