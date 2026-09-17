import ast
import importlib.util
import sys
from types import SimpleNamespace
from pathlib import Path


TOOL = Path(__file__).parents[1] / "tools" / "reconcile-gpu-recovery.py"


def test_recovery_tool_is_exact_proof_gated_and_restart_safe():
    text = TOOL.read_text()
    ast.parse(text)
    assert 'lease.job_id != args.job_id' in text
    assert 'protocol.recover_startup()' in text
    assert 'contextlib.redirect_stdout(io.StringIO())' in text
    assert 'sys.path.insert(0, str(ROOT))' in text
    assert 'marker.get("job_id") != args.job_id' in text
    assert 'proof.get("processes_gone") is not True' in text
    assert 'proof.get("memory_recovered") is not True' in text
    assert text.index('app.gpu_protocol().reconcile(lease, proof=proof)') < text.index('app.GPU_RECOVERY_HOLD.unlink()')
    assert 'finally:' in text
    assert 'systemctl("start", SERVICE' in text


def test_recovery_tool_can_reconcile_exact_orphan_job_only_after_full_reclaim():
    text = TOOL.read_text()
    ast.parse(text)
    assert 'if lease is None:' in text
    assert 'recovery marker exists without a durable lease' in text
    assert 'orphan_recovery_job' in text
    assert text.index('proof = app._gpu_reclaim_all(job)') < text.index(
        'for key in ("recovery_required", "recovery_reason")'
    )
    assert 'DELETE FROM' not in text and 'UPDATE gpu_lease' not in text


def test_recovery_tool_accepts_only_exact_terminal_parked_restart_hold():
    text = TOOL.read_text()
    ast.parse(text)
    assert 'terminal_parked_recovery' in text
    assert 'lease.phase == "parked"' in text
    assert 'job.get("status") in ("done", "error", "cancelled")' in text
    assert 'marker.get("job_id") is None' in text
    assert 'and not terminal_parked_recovery' in text
    assert 'durable-lease-recovery:' in text


def test_recovery_tool_accepts_exact_internal_residency_lease_without_queue_job():
    text = TOOL.read_text()
    ast.parse(text)
    assert 'internal_residency_recovery' in text
    assert 'lease.job_id.startswith("internal-")' in text
    assert 'marker.get("job_id") == job_id' in text
    assert 'and not internal_residency_recovery' in text
    assert 'app.reap_orphan_maestro_runners()' in text
    assert text.index('proof = app._gpu_reclaim_all(job)') < text.index(
        'app.gpu_protocol().reconcile(lease, proof=proof)'
    )


def test_internal_residency_marker_matches_jobless_startup_quarantine():
    spec = importlib.util.spec_from_file_location("reconcile_gpu_recovery", TOOL)
    assert spec is not None
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    lease = SimpleNamespace(
        state="recovery", job_id="internal-4321",
    )
    marker = {
        "job_id": None,
        "reason": "durable-lease-recovery:operation-uncertain:RuntimeError",
    }
    assert module.internal_residency_marker_matches(
        lease, {"reason": "operation-uncertain:RuntimeError"},
        None, marker, "internal-4321"
    ) is True


def test_main_reconciles_exact_jobless_internal_startup_hold(tmp_path, monkeypatch):
    spec = importlib.util.spec_from_file_location("reconcile_gpu_recovery_main", TOOL)
    assert spec is not None
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)

    lease = SimpleNamespace(
        state="recovery", phase="unload", job_id="internal-4321",
        engine="h3", task="t2va",
    )
    reconciled = []

    class Protocol:
        def recover_startup(self):
            return lease

        def snapshot(self):
            return {"lease": {"reason": "owner-exited"}}

        def reconcile(self, current, proof):
            reconciled.append((current, proof))

    hold = tmp_path / "gpu-recovery-hold.json"
    hold.write_text('{"job_id":null,"reason":"durable-lease-recovery:owner-exited"}')
    fake_app = SimpleNamespace(
        _gpu_active_lease=None,
        GPU_RECOVERY_HOLD=hold,
        jobs={},
        gpu_protocol=lambda: Protocol(),
        _gpu_reclaim_all=lambda _job: {
            "processes_gone": True, "memory_recovered": True,
            "available_gib": 120.0, "survivors": [], "boot_id": "boot",
        },
        pool_cmd=lambda _action: "OK",
        save_state=lambda: None,
    )
    monkeypatch.setitem(sys.modules, "app", fake_app)
    monkeypatch.setattr(module, "ROOT", tmp_path)
    monkeypatch.setattr(module, "systemctl", lambda *_args, **_kwargs: SimpleNamespace(
        returncode=0, stderr=""
    ))
    monkeypatch.setattr(sys, "argv", [str(TOOL), "--job-id", "internal-4321"])

    assert module.main() == 0
    assert reconciled and reconciled[0][0] is lease
    assert reconciled[0][1]["processes_gone"] is True
    assert not hold.exists()
