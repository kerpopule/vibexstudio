"""The hold auto-recoverer acts only on the harmless restart hold, within limits."""
import json
import os
import time
from pathlib import Path

import pytest

from media_lab_core.durable_gpu_protocol import DurableGpuProtocol
from runner import hold_autorecover as har

NOW = 1_800_000_000.0


def facts(**over):
    base = {
        "now": NOW, "boot_id": "boot-a", "hold_exists": True,
        "hold": {"reason": "durable-lease-recovery:owner-exited", "job_id": None,
                 "created": NOW - 900},
        "lease": {"state": "recovery", "reason": "owner-exited", "boot_id": "boot-a",
                  "job_id": "idle-restore-h3", "phase": "parked", "fence": 7, "pid": 1},
        "lease_job_status": None, "persisted_running": 0, "studio_running": 0,
        "baton": False, "engine_maintenance": False, "safety_stop": False, "latch": False,
        "guard_state": "monitoring", "guard_fresh": True, "owner_is_controller": False,
        "mem_available_gib": 20.0,
    }
    for key, value in over.items():
        if key.startswith("lease_") and key != "lease_job_status":
            base["lease"] = {**base["lease"], key[6:]: value}
        elif key.startswith("hold_") and key != "hold_exists":
            base["hold"] = {**base["hold"], key[5:]: value}
        else:
            base[key] = value
    return base


def decide(f, state=None, **kw):
    return har.decide(f, state or {}, enabled=kw.pop("enabled", True),
                      gaveup=kw.pop("gaveup", False), **kw)


def test_harmless_idle_restart_hold_is_reconciled():
    assert decide(facts())[0] == "reconcile"
    assert decide(facts(lease_reason="controller-restarted",
                        hold_reason="durable-lease-recovery:controller-restarted"))[0] == "reconcile"
    finished = facts(lease_job_id="abc123", lease_job_status="done")
    assert decide(finished)[0] == "reconcile"


@pytest.mark.parametrize("over,action", [
    ({"hold_exists": False}, "idle"),
    ({"lease_reason": "operation-uncertain:TimeoutError"}, "skip"),
    ({"lease_reason": "boot-changed"}, "skip"),
    ({"lease_reason": "capacity-rejected-before-safe-release"}, "skip"),
    ({"hold_reason": "operation-finished-without-exact-idle-residency"}, "skip"),
    ({"hold_job_id": "abc123"}, "skip"),                       # a job-bound hold
    ({"lease_boot_id": "boot-old"}, "skip"),                   # another boot
    ({"lease_state": "active"}, "skip"),
    ({"lease": None}, "skip"),
    ({"hold": None}, "skip"),
    ({"lease_job_id": "abc123", "lease_job_status": "queued"}, "skip"),
    ({"lease_job_id": "abc123", "lease_job_status": "done", "lease_phase": "render"}, "skip"),
    ({"hold_created": NOW - 60}, "wait"),                      # a person gets 10 min
    ({"studio_running": 1}, "wait"),
    ({"persisted_running": 1}, "wait"),
    ({"studio_running": None}, "wait"),
    ({"baton": True}, "skip"),
    ({"engine_maintenance": True}, "skip"),
    ({"safety_stop": True}, "skip"),
    ({"latch": True}, "skip"),
    ({"guard_state": "tripped"}, "skip"),
    ({"guard_fresh": False}, "skip"),
    ({"owner_is_controller": True}, "skip"),
    ({"mem_available_gib": 2.0}, "wait"),
    ({"mem_available_gib": None}, "wait"),
])
def test_everything_else_is_left_alone(over, action):
    assert decide(facts(**over))[0] == action


def test_flag_off_and_gave_up_never_act():
    assert decide(facts(), enabled=False)[0] == "skip"
    assert decide(facts(), gaveup=True)[0] == "skip"


def test_limits_one_try_per_hold_daily_cap_backoff_and_give_up():
    f = facts()
    key = har.hold_key(f)
    assert decide(f, {"attempts": [{"ts": NOW - 400, "hold": key, "ok": False}]})[0] == "giveup"
    three = [{"ts": NOW - 3600 * i, "hold": f"other-{i}", "ok": True} for i in (1, 2, 3)]
    assert decide(f, {"attempts": three})[0] == "giveup"
    old = [{"ts": NOW - 90000, "hold": "old", "ok": True}] * 3
    assert decide(f, {"attempts": old})[0] == "reconcile"
    one_fail = {"attempts": [{"ts": NOW - 300, "hold": "x", "ok": False}], "consecutive_failures": 1}
    assert decide(f, one_fail)[0] == "wait"                      # 10 min backoff
    one_fail["attempts"][0]["ts"] = NOW - 700
    assert decide(f, one_fail)[0] == "reconcile"
    assert decide(f, {"attempts": [], "consecutive_failures": 2})[0] == "giveup"


# ---------------------------------------------------------------- whole pass

class FakePaths(har.Paths):
    def __init__(self, root: Path):
        super().__init__(root=root, runtime=root / "run", sol_root=root / "sol")
        self.pool.mkdir(parents=True, exist_ok=True)


def _enable(monkeypatch, on=True):
    monkeypatch.setenv(har.FLAG, "1" if on else "0")


def test_pass_reconciles_once_then_gives_up_if_hold_remains(tmp_path, monkeypatch):
    _enable(monkeypatch)
    paths = FakePaths(tmp_path)
    calls = []

    def fake_reconcile(p, job_id):
        calls.append(job_id)
        return False, {"rc": 1, "error": "memory did not recover"}

    first = har.main([], paths=paths, reconcile=fake_reconcile, facts=facts())
    assert first["action"] == "reconcile" and first["ok"] is False and calls == ["idle-restore-h3"]
    second = har.main([], paths=paths, reconcile=fake_reconcile, facts=facts(now=NOW + 700))
    assert second["action"] == "giveup" and calls == ["idle-restore-h3"]
    gave = json.loads(paths.gaveup.read_text())
    assert "reconcile-gpu-recovery.py" in gave["next_step"]
    third = har.main([], paths=paths, reconcile=fake_reconcile, facts=facts(now=NOW + 1400))
    assert third["action"] == "skip" and calls == ["idle-restore-h3"]
    lines = [json.loads(l) for l in paths.log.read_text().splitlines()]
    assert [l["action"] for l in lines] == ["reconcile", "giveup", "skip"]


def test_pass_success_resets_failures(tmp_path, monkeypatch):
    _enable(monkeypatch)
    paths = FakePaths(tmp_path)
    out = har.main([], paths=paths, reconcile=lambda p, j: (True, {"rc": 0}), facts=facts())
    assert out["ok"] is True
    state = json.loads(paths.state.read_text())
    assert state["consecutive_failures"] == 0 and len(state["attempts"]) == 1
    assert not paths.gaveup.exists()


def test_dry_run_and_flag_off_change_nothing(tmp_path, monkeypatch):
    paths = FakePaths(tmp_path)
    boom = lambda p, j: pytest.fail("must not reconcile")
    _enable(monkeypatch, on=False)
    assert har.main([], paths=paths, reconcile=boom, facts=facts())["action"] == "skip"
    _enable(monkeypatch)
    assert har.main(["--dry-run"], paths=paths, reconcile=boom, facts=facts())["action"] == "reconcile"
    assert not paths.gaveup.exists()
    assert not (paths.state.exists() and json.loads(paths.state.read_text()).get("attempts"))


def test_gather_reads_the_real_lease_database_read_only(tmp_path, monkeypatch):
    paths = FakePaths(tmp_path)
    boot = Path("/proc/sys/kernel/random/boot_id")
    boot_id = boot.read_text().strip() if boot.exists() else ""
    p = DurableGpuProtocol(paths.db, tmp_path / "gpu.lock", boot_id=lambda: boot_id,
                           available_gib=lambda: 120.0, pid_alive=lambda pid: False)
    p.qualify("h3", "t2va", peak_gib=10, warm_render_gib=2, reserve_gib=2, evidence="x")
    lease = p.acquire(job_id="idle-restore-h3", engine="h3", task="t2va", owner="old")
    for phase in ("unload", "reclaim", "load", "render"):
        p.advance(lease, phase)
    p.bind_process(lease, pid=4242, identity="x")
    p.park(lease, proof={"engine": "h3", "task": "t2va", "healthy": True, "busy": False})
    lease._fd.close()
    p.recover_startup()
    paths.hold.write_text(json.dumps({"reason": "durable-lease-recovery:owner-exited",
                                      "job_id": None, "created": time.time() - 900}))
    before = paths.db.stat().st_mtime_ns
    monkeypatch.setattr(har, "studio_running_jobs", lambda timeout=15.0: 0)
    f = har.gather(paths)
    assert f["lease"]["reason"] == "owner-exited" and f["lease"]["job_id"] == "idle-restore-h3"
    assert f["hold_exists"] and f["studio_running"] == 0
    assert paths.db.stat().st_mtime_ns == before


def test_timer_and_service_are_shipped():
    root = Path(__file__).parents[1] / "config"
    service = (root / "media-lab-hold-autorecover.service").read_text()
    timer = (root / "media-lab-hold-autorecover.timer").read_text()
    assert "runner/hold_autorecover.py" in service and "Type=oneshot" in service
    assert "OnUnitActiveSec=5min" in timer


def test_removing_the_give_up_flag_resets_the_failure_count(tmp_path, monkeypatch):
    _enable(monkeypatch)
    paths = FakePaths(tmp_path)
    fail = lambda p, j: (False, {"rc": 1})
    har.main([], paths=paths, reconcile=fail, facts=facts())
    har.main([], paths=paths, reconcile=fail, facts=facts(hold_created=NOW - 800, now=NOW + 5000))
    assert json.loads(paths.state.read_text())["consecutive_failures"] == 2
    assert paths.gaveup.exists()
    paths.gaveup.unlink()                      # a person looked and cleared it
    calls = []
    ok = lambda p, j: calls.append(j) or (True, {"rc": 0})
    out = har.main([], paths=paths, reconcile=ok, facts=facts(hold_created=NOW - 700, now=NOW + 20000))
    assert out["action"] == "reconcile" and calls == ["idle-restore-h3"]
    assert json.loads(paths.state.read_text())["consecutive_failures"] == 0
