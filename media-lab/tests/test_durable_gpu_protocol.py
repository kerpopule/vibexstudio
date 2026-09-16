import pytest

from media_lab_core.durable_gpu_protocol import (
    CapacityUnqualified,
    DurableGpuProtocol,
    LeaseBusy,
    StaleFence,
)


def protocol(tmp_path, *, boot_id="boot-a", available_gib=120.0):
    return DurableGpuProtocol(
        tmp_path / "gpu.sqlite3",
        tmp_path / "gpu.lock",
        boot_id=lambda: boot_id,
        available_gib=lambda: available_gib,
        pid_alive=lambda _pid: True,
    )


def test_duplicate_job_submission_is_idempotent(tmp_path):
    p = protocol(tmp_path)
    first = p.submit("job-1", lane="local", engine="h3", task="t2va", payload_hash="abc")
    again = p.submit("job-1", lane="local", engine="h3", task="t2va", payload_hash="abc")
    assert again == first
    with pytest.raises(ValueError, match="idempotency conflict"):
        p.submit("job-1", lane="local", engine="h3", task="fl2va", payload_hash="different")


def test_fenced_owner_spans_load_render_unload_and_reclaim(tmp_path):
    p = protocol(tmp_path)
    p.qualify("h3", "t2va", peak_gib=104.0, reserve_gib=12.0, evidence="receipt-1")
    lease = p.acquire(job_id="job-1", engine="h3", task="t2va", owner="worker-a")
    assert lease.phase == "drain"
    for phase in ("unload", "reclaim", "load", "render", "unload", "reclaim"):
        lease = p.advance(lease, phase)
        assert lease.phase == phase
    p.release(lease, proof={"processes_gone": True, "memory_recovered": True,
                            "boot_id": "boot-a"})
    assert p.snapshot()["lease"] is None


def test_stale_owner_cannot_release_new_owner(tmp_path):
    p = protocol(tmp_path)
    p.qualify("h3", "t2va", peak_gib=10.0, reserve_gib=2.0, evidence="fixture")
    old = p.acquire(job_id="old", engine="h3", task="t2va", owner="worker-a")
    p.mark_recovery(old, "owner-crashed")
    p.reconcile(old, proof={"processes_gone": True, "memory_recovered": True, "boot_id": "boot-a"})
    new = p.acquire(job_id="new", engine="h3", task="t2va", owner="worker-b")
    with pytest.raises(StaleFence):
        p.release(old, proof={"processes_gone": True, "memory_recovered": True,
                              "boot_id": "boot-a"})
    assert p.snapshot()["lease"]["fence"] == new.fence


def test_timeout_retains_exclusion_until_exact_reconciliation(tmp_path):
    p = protocol(tmp_path)
    p.qualify("h3", "t2va", peak_gib=10.0, reserve_gib=2.0, evidence="fixture")
    lease = p.acquire(job_id="unknown", engine="h3", task="t2va", owner="worker-a")
    p.mark_recovery(lease, "transport-timeout")
    with pytest.raises(LeaseBusy):
        p.acquire(job_id="next", engine="ltx", task="t2va", owner="worker-b")
    with pytest.raises(ValueError, match="process proof"):
        p.reconcile(lease, proof={"processes_gone": False, "memory_recovered": True, "boot_id": "boot-a"})
    with pytest.raises(ValueError, match="memory proof"):
        p.reconcile(lease, proof={"processes_gone": True, "memory_recovered": False, "boot_id": "boot-a"})
    p.reconcile(lease, proof={"processes_gone": True, "memory_recovered": True, "boot_id": "boot-a"})


def test_reboot_quarantines_preboot_owner(tmp_path):
    state = {"boot": "boot-a"}
    p = DurableGpuProtocol(
        tmp_path / "gpu.sqlite3", tmp_path / "gpu.lock",
        boot_id=lambda: state["boot"], available_gib=lambda: 120.0, pid_alive=lambda _pid: False,
    )
    p.qualify("h3", "t2va", peak_gib=10.0, reserve_gib=2.0, evidence="fixture")
    lease = p.acquire(job_id="job", engine="h3", task="t2va", owner="worker-a")
    assert lease._fd is not None
    lease._fd.close()
    lease._fd = None
    state["boot"] = "boot-b"
    recovered = p.recover_startup()
    snap = p.snapshot()["lease"]
    assert snap["state"] == "recovery"
    assert snap["reason"] == "boot-changed"
    assert recovered is not None and recovered.state == "recovery"
    assert recovered._fd is not None
    with pytest.raises(LeaseBusy):
        p.acquire(job_id="new", engine="h3", task="t2va", owner="worker-b")


def test_task_specific_capacity_is_required_and_includes_reserve(tmp_path):
    p = protocol(tmp_path, available_gib=115.0)
    lease = p.acquire(job_id="ref", engine="h3", task="ref2va", owner="worker-a")
    p.advance(lease, "unload"); p.advance(lease, "reclaim")
    with pytest.raises(CapacityUnqualified, match="h3/ref2va"):
        p.advance(lease, "load")
    p.mark_recovery(lease, "fixture-end")
    p.reconcile(lease, proof={"processes_gone": True, "memory_recovered": True,
                              "boot_id": "boot-a"})
    p.qualify("h3", "ref2va", peak_gib=104.0, reserve_gib=12.0, evidence="measured-ref")
    lease = p.acquire(job_id="ref-2", engine="h3", task="ref2va", owner="worker-a")
    p.advance(lease, "unload"); p.advance(lease, "reclaim")
    with pytest.raises(CapacityUnqualified, match="requires 116.0 GiB"):
        p.advance(lease, "load")


def test_cancel_and_stale_callback_are_fenced(tmp_path):
    p = protocol(tmp_path)
    p.submit("job", lane="local", engine="h3", task="t2va", payload_hash="abc")
    p.cancel("job")
    assert p.job("job")["state"] == "cancelled"
    assert p.complete("job", fence=9, result_hash="late") is False
    assert p.job("job")["state"] == "cancelled"


def test_cloud_job_progresses_while_local_lease_is_blocked(tmp_path):
    p = protocol(tmp_path)
    p.qualify("h3", "t2va", peak_gib=10.0, reserve_gib=2.0, evidence="fixture")
    lease = p.acquire(job_id="local", engine="h3", task="t2va", owner="worker-a")
    p.mark_recovery(lease, "unknown")
    p.submit("cloud", lane="cloud", engine="fal", task="video", payload_hash="cloud-1")
    claim = p.claim_next(lane="cloud", owner="cloud-worker")
    assert claim["job_id"] == "cloud"
    assert p.complete("cloud", fence=claim["fence"], result_hash="ok") is True
    assert p.job("cloud")["state"] == "done"


def test_only_one_local_owner_across_protocol_instances(tmp_path):
    p1 = protocol(tmp_path)
    p2 = protocol(tmp_path)
    p1.qualify("h3", "t2va", peak_gib=10.0, reserve_gib=2.0, evidence="fixture")
    lease = p1.acquire(job_id="one", engine="h3", task="t2va", owner="worker-a")
    with pytest.raises(LeaseBusy):
        p2.acquire(job_id="two", engine="ltx", task="t2va", owner="worker-b")
    p1.mark_recovery(lease, "fixture-end")


def test_engine_admission_requires_exact_delegated_fence(tmp_path):
    p = protocol(tmp_path)
    p.qualify("h3", "fl2va", peak_gib=10.0, reserve_gib=2.0, evidence="fixture")
    lease = p.acquire(job_id="job", engine="h3", task="fl2va", owner="controller")
    assert p.authorize(fence=lease.fence, job_id="job", engine="h3", task="fl2va") is False
    for phase in ("unload", "reclaim", "load", "render"):
        p.advance(lease, phase)
    assert p.authorize(fence=lease.fence, job_id="job", engine="h3", task="fl2va") is True
    assert p.authorize(fence=lease.fence - 1, job_id="job", engine="h3", task="fl2va") is False
    assert p.authorize(fence=lease.fence, job_id="other", engine="h3", task="fl2va") is False
    p.mark_recovery(lease, "fixture-end")
    assert p.authorize(fence=lease.fence, job_id="job", engine="h3", task="fl2va") is False


def test_mixed_local_transition_sequence_never_overlaps_residency(tmp_path):
    from media_lab_core.durable_gpu_protocol import TransitionHooks, run_transition_sequence

    p = protocol(tmp_path)
    for engine, task in (("h3", "t2va"), ("h3", "fl2va"), ("h3", "ref2va"), ("ltx", "t2va")):
        p.qualify(engine, task, peak_gib=10.0, reserve_gib=2.0, evidence="fixture")

    resident = set()
    events = []

    def unload(_lease):
        events.append(("unload", tuple(sorted(resident))))
        resident.clear()
        return {"processes_gone": True}

    def reclaim(_lease):
        events.append(("reclaim", tuple(sorted(resident))))
        return {"memory_recovered": not resident}

    def load(lease):
        assert not resident
        resident.add((lease.engine, lease.task))
        events.append(("load", tuple(sorted(resident))))

    def render(lease, item):
        assert resident == {(lease.engine, lease.task)}
        events.append(("render", item["job_id"]))
        return "artifact-" + item["job_id"]

    hooks = TransitionHooks(drain=lambda _lease: events.append(("drain", None)),
                            unload=unload, reclaim=reclaim, load=load, render=render)
    results = run_transition_sequence(p, [
        {"job_id": "a", "engine": "h3", "task": "t2va"},
        {"job_id": "b", "engine": "h3", "task": "fl2va"},
        {"job_id": "c", "engine": "h3", "task": "ref2va"},
        {"job_id": "d", "engine": "ltx", "task": "t2va"},
    ], hooks=hooks, owner="fixture-worker")

    assert results == ["artifact-a", "artifact-b", "artifact-c", "artifact-d"]
    assert resident == set()
    assert p.snapshot()["lease"] is None
    assert [e for e in events if e[0] == "render"] == [
        ("render", "a"), ("render", "b"), ("render", "c"), ("render", "d")]


def test_transition_failure_latches_recovery_and_stops_later_work(tmp_path):
    from media_lab_core.durable_gpu_protocol import TransitionHooks, run_transition_sequence

    p = protocol(tmp_path)
    p.qualify("h3", "t2va", peak_gib=10.0, reserve_gib=2.0, evidence="fixture")
    called = []
    hooks = TransitionHooks(
        drain=lambda _lease: called.append("drain"),
        unload=lambda _lease: {"processes_gone": True},
        reclaim=lambda _lease: {"memory_recovered": True},
        load=lambda _lease: called.append("load"),
        render=lambda _lease, _item: (_ for _ in ()).throw(TimeoutError("unknown")),
    )
    with pytest.raises(TimeoutError):
        run_transition_sequence(p, [
            {"job_id": "a", "engine": "h3", "task": "t2va"},
            {"job_id": "b", "engine": "h3", "task": "t2va"},
        ], hooks=hooks, owner="fixture-worker")
    snap = p.snapshot()["lease"]
    assert snap["state"] == "recovery"
    assert snap["reason"].startswith("transition-failed:")
    assert called == ["drain", "load"]
