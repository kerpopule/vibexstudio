import ast
from pathlib import Path


TOOL = Path(__file__).parents[1] / "tools" / "reconcile-gpu-recovery.py"


def test_recovery_tool_is_exact_proof_gated_and_restart_safe():
    text = TOOL.read_text()
    ast.parse(text)
    assert 'lease.job_id != args.job_id' in text
    assert 'app.gpu_protocol().recover_startup()' in text
    assert 'sys.path.insert(0, str(ROOT))' in text
    assert 'marker.get("job_id") != args.job_id' in text
    assert 'proof.get("processes_gone") is not True' in text
    assert 'proof.get("memory_recovered") is not True' in text
    assert text.index('app.gpu_protocol().reconcile(lease, proof=proof)') < text.index('app.GPU_RECOVERY_HOLD.unlink()')
    assert 'finally:' in text
    assert 'systemctl("start", SERVICE' in text
    assert 'DELETE FROM' not in text and 'UPDATE gpu_lease' not in text
