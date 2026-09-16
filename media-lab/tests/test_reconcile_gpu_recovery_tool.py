import ast
import importlib.util
from types import SimpleNamespace
from pathlib import Path


TOOL = Path(__file__).parents[1] / "tools" / "reconcile-gpu-recovery.py"


def test_recovery_tool_is_exact_proof_gated_and_restart_safe():
    text = TOOL.read_text()
    ast.parse(text)
    assert 'lease.job_id != args.job_id' in text
    assert 'app.gpu_protocol().recover_startup()' in text
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
        reason="operation-uncertain:RuntimeError",
    )
    marker = {
        "job_id": None,
        "reason": "durable-lease-recovery:operation-uncertain:RuntimeError",
    }
    assert module.internal_residency_marker_matches(
        lease, None, marker, "internal-4321"
    ) is True
