#!/usr/bin/env python3
"""Feed a bounded private overnight refinement plan into Media Lab's canonical queue.

One invocation reconciles receipts and submits at most one job. A systemd timer
runs it every two minutes. It never renders directly, never bypasses the queue,
and refuses to submit unless the canonical Spark GPU lock already has an owner.
"""
from __future__ import annotations

import argparse
import fcntl
import json
import os
import subprocess
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime
from pathlib import Path

HOME = Path.home()
ROOT = HOME / "media-lab-simple"
PLAN = ROOT / "runner" / "overnight_refinement_plan_2026_08_20.json"
STATE = ROOT / "pool" / "overnight-refinement-2026-08-20-state.json"
EVENTS = ROOT / "pool" / "overnight-refinement-2026-08-20-events.jsonl"
RUN_LOCK = Path("/run/user/1000/media-lab-overnight-refinement.lock")
GPU_LOCK = Path("/run/user/1000/spark-gpu.lock")
BASE = "http://YOUR_TAILNET_IP:7863"
QUEUE_URL = BASE + "/api/queue?limit=1000"
TIMER = "media-lab-overnight-refinement.timer"
TRANSIENT = (
    "busy", "try again", "crew is down", "engine", "temporarily", "timeout",
    "connection", "unreachable", "restarted mid-take", "stopped by the studio",
)


def now_iso() -> str:
    return datetime.now().astimezone().isoformat(timespec="seconds")


def log(event: str, **fields) -> None:
    row = {"ts": now_iso(), "event": event, **fields}
    EVENTS.parent.mkdir(parents=True, exist_ok=True)
    with EVENTS.open("a", encoding="utf-8") as f:
        f.write(json.dumps(row, sort_keys=True) + "\n")
    print("[overnight-refinement]", json.dumps(row, sort_keys=True), flush=True)


def load_json(path: Path, default):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        return default


def save_json(path: Path, value) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(value, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    os.replace(tmp, path)


def api(path: str, body=None, timeout: int = 30):
    data = json.dumps(body).encode("utf-8") if body is not None else None
    req = urllib.request.Request(
        BASE + path,
        data=data,
        headers={"Content-Type": "application/json"} if data else {},
        method="POST" if data is not None else "GET",
    )
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read())


def queue_snapshot():
    with urllib.request.urlopen(QUEUE_URL, timeout=20) as resp:
        return json.loads(resp.read())


def gpu_lock_has_owner() -> bool:
    if not GPU_LOCK.exists():
        return False
    proc = subprocess.run(
        ["fuser", str(GPU_LOCK)], capture_output=True, text=True, timeout=10
    )
    return proc.returncode == 0 and bool((proc.stdout + proc.stderr).strip())


def service_active(unit: str) -> bool:
    return subprocess.run(
        ["systemctl", "--user", "is-active", "--quiet", unit],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    ).returncode == 0


def stop_timer(reason: str) -> None:
    log("timer-stop", reason=reason)
    subprocess.run(
        ["systemctl", "--user", "stop", TIMER],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        check=False,
    )


def is_transient(message: str) -> bool:
    text = (message or "").lower()
    return any(term in text for term in TRANSIENT)


def reconcile(plan: dict, state: dict, snapshot: dict) -> None:
    rows = {
        row.get("id"): row
        for row in snapshot.get("active", []) + snapshot.get("history", [])
        if row.get("id")
    }
    jobs = state.setdefault("jobs", {})
    for spec in plan["jobs"]:
        label = spec["label"]
        rec = jobs.setdefault(label, {"status": "pending", "attempts": 0})
        if rec.get("status") != "submitted" or not rec.get("job_id"):
            continue
        row = rows.get(rec["job_id"])
        if not row:
            log("submitted-job-not-in-snapshot", label=label, job_id=rec["job_id"])
            continue
        status = row.get("status")
        rec["last_seen"] = now_iso()
        rec["stage"] = row.get("stage")
        if status == "done":
            rec.update(
                status="done",
                completed_at=now_iso(),
                output_url=row.get("url"),
                poster=row.get("poster"),
                runtime_request=row.get("request"),
            )
            log("job-done", label=label, job_id=rec["job_id"], url=row.get("url"))
        elif status == "error":
            message = str(row.get("message") or "unknown render error")[:1000]
            rec.update(message=message, failed_at=now_iso())
            if rec.get("attempts", 0) < 2 and is_transient(message):
                rec.update(status="pending", previous_job_id=rec.get("job_id"))
                rec.pop("job_id", None)
                log("job-retry-armed", label=label, message=message)
            else:
                rec["status"] = "failed"
                log("job-failed-loudly", label=label, message=message)


def dependency_ready(spec: dict, state: dict) -> tuple[bool, str]:
    dep = spec.get("depends_on")
    if not dep:
        return True, ""
    status = (state.get("jobs", {}).get(dep) or {}).get("status")
    if status == "done":
        return True, ""
    if status in ("failed", "skipped"):
        return False, f"dependency {dep} {status}"
    return False, "waiting"


def dynamic_source(spec: dict, state: dict) -> str:
    label = spec.get("source_from")
    if not label:
        return ""
    rec = state.get("jobs", {}).get(label) or {}
    url = str(rec.get("output_url") or "")
    if not url.startswith("/media/"):
        raise RuntimeError(f"dependency {label} has no usable Media Lab output URL")
    suffix = Path(url).suffix.lower()
    if suffix not in (".png", ".jpg", ".jpeg", ".webp"):
        raise RuntimeError(
            f"dependency {label} output is {suffix or 'extensionless'}, not a single-scene image"
        )
    return url


def submit(spec: dict, state: dict):
    kind = spec["kind"]
    if kind == "maestro":
        return api("/api/maestro", {"title": spec["title"], "settings": spec["settings"]})
    if kind == "generate":
        payload = json.loads(json.dumps(spec["payload"]))
        source = dynamic_source(spec, state)
        if source:
            payload["source"] = source
        return api("/api/generate", payload)
    if kind == "say":
        payload = json.loads(json.dumps(spec["payload"]))
        cid = payload.pop("character_id")
        # Enforce the runtime law here as well as in app.py.
        if payload.get("engine") == "h3":
            payload.pop("audio_scale", None)
        return api(f"/api/characters/{cid}/say", payload)
    raise ValueError(f"unsupported overnight job kind: {kind}")


def run_once() -> int:
    plan = load_json(PLAN, None)
    if not plan or not isinstance(plan.get("jobs"), list):
        log("fatal", reason=f"missing or invalid plan: {PLAN}")
        return 2
    state = load_json(
        STATE,
        {"plan": plan["name"], "created_at": now_iso(), "jobs": {}, "finished": False},
    )
    deadline = datetime.fromisoformat(plan["deadline"])
    now = datetime.now().astimezone()

    try:
        snapshot = queue_snapshot()
    except Exception as exc:
        log("queue-unreachable", error=str(exc)[:500])
        return 3

    reconcile(plan, state, snapshot)
    save_json(STATE, state)

    active = snapshot.get("active", [])
    if active:
        log(
            "queue-busy",
            active=[
                {"id": x.get("id"), "status": x.get("status"), "stage": x.get("stage")}
                for x in active
            ],
        )
        return 0

    terminal_states = {"done", "failed", "skipped"}
    if all(
        (state.get("jobs", {}).get(j["label"]) or {}).get("status") in terminal_states
        for j in plan["jobs"]
    ):
        state.update(finished=True, finished_at=now_iso(), finish_reason="plan exhausted")
        save_json(STATE, state)
        stop_timer("plan exhausted")
        return 0

    if now >= deadline:
        state.update(finished=True, finished_at=now_iso(), finish_reason="deadline reached")
        save_json(STATE, state)
        stop_timer("deadline reached; active render, if any, was not interrupted")
        return 0

    if not service_active("media-lab-simple.service"):
        log("prerequisite-failed", reason="media-lab-simple.service is not active")
        return 4
    if not gpu_lock_has_owner():
        log("prerequisite-failed", reason="canonical GPU lock has no owner; refusing to render around it")
        return 5

    for spec in plan["jobs"]:
        label = spec["label"]
        rec = state.setdefault("jobs", {}).setdefault(label, {"status": "pending", "attempts": 0})
        if rec.get("status") != "pending":
            continue
        ready, reason = dependency_ready(spec, state)
        if not ready:
            if reason != "waiting":
                rec.update(status="skipped", skipped_at=now_iso(), message=reason)
                log("job-skipped", label=label, reason=reason)
                save_json(STATE, state)
            continue

        # Close the queue race immediately before mutation.
        fresh = queue_snapshot()
        if fresh.get("active"):
            log("queue-became-busy", label=label)
            return 0
        try:
            result = submit(spec, state)
            job_id = str(result["id"])
        except urllib.error.HTTPError as exc:
            body = exc.read().decode("utf-8", "replace")[:1000]
            rec.update(status="failed", failed_at=now_iso(), message=f"HTTP {exc.code}: {body}")
            log("submission-failed-loudly", label=label, error=rec["message"])
            save_json(STATE, state)
            return 6
        except Exception as exc:
            rec.update(status="failed", failed_at=now_iso(), message=str(exc)[:1000])
            log("submission-failed-loudly", label=label, error=rec["message"])
            save_json(STATE, state)
            return 7

        rec.update(
            status="submitted",
            job_id=job_id,
            submitted_at=now_iso(),
            attempts=int(rec.get("attempts") or 0) + 1,
            kind=spec["kind"],
            title=spec.get("title") or label,
        )
        state["last_submission"] = {"label": label, "job_id": job_id, "ts": now_iso()}
        save_json(STATE, state)
        log("job-submitted", label=label, job_id=job_id, kind=spec["kind"])
        return 0

    log("no-runnable-job", reason="all pending jobs are waiting on dependencies")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--once", action="store_true", help="reconcile and submit at most one job")
    parser.parse_args()
    RUN_LOCK.parent.mkdir(parents=True, exist_ok=True)
    with RUN_LOCK.open("w") as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            log("already-running")
            return 0
        return run_once()


if __name__ == "__main__":
    raise SystemExit(main())
