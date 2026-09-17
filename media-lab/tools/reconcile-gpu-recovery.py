#!/usr/bin/env python3
"""Reconcile one exact Media Lab durable GPU recovery hold.

Run only after operator approval. The tool stops admission, adopts the existing
recovery fence (or proves that only one exact orphaned job flag remains), reclaims
every managed GPU companion, requires exact process and memory proof, reconciles
the protocol, removes only the matching hold, restores the legacy idle pool, and
restarts Media Lab in a finally block.
"""
from __future__ import annotations

import argparse
import contextlib
import io
import json
import os
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SERVICE = "media-lab-simple.service"


def systemctl(*args: str, check: bool = True) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        ["systemctl", "--user", *args], check=check, text=True,
        stdout=subprocess.PIPE, stderr=subprocess.PIPE,
    )


def internal_residency_marker_matches(
    lease, durable_row, job, marker, job_id: str,
) -> bool:
    """Bind a jobless internal hold to one exact durable recovery lease."""
    if not (
        lease is not None and lease.state == "recovery"
        and lease.job_id == job_id and job is None
        and (lease.job_id.startswith("internal-")
             or lease.job_id.startswith("idle-restore-"))
        and marker is not None
    ):
        return False
    if marker.get("job_id") == job_id:
        return True
    if marker.get("job_id") is not None:
        return False
    lease_reason = str((durable_row or {}).get("reason") or "unknown")
    return str(marker.get("reason") or "") in {
        lease_reason,
        f"durable-lease-{lease.state}:{lease_reason}",
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--job-id", required=True)
    args = parser.parse_args()
    os.chdir(ROOT)
    if str(ROOT) not in sys.path:
        sys.path.insert(0, str(ROOT))
    os.environ["MEDIA_LAB_DISABLE_BACKGROUND_WORKERS"] = "1"

    systemctl("stop", SERVICE)
    try:
        # app.py logs door codes at import for the interactive service. Recovery
        # receipts must never expose those secrets to operator logs.
        with contextlib.redirect_stdout(io.StringIO()):
            import app

        protocol = app.gpu_protocol()
        lease = app._gpu_active_lease or protocol.recover_startup()
        app._gpu_active_lease = lease
        durable_row = protocol.snapshot().get("lease") or {}
        orphan_recovery_job = lease is None
        marker = None
        if app.GPU_RECOVERY_HOLD.exists():
            marker = json.loads(app.GPU_RECOVERY_HOLD.read_text())

        job = app.jobs.get(args.job_id)
        internal_residency_recovery = internal_residency_marker_matches(
            lease, durable_row, job, marker, args.job_id
        )
        terminal_parked_recovery = bool(
            lease is not None and lease.state == "recovery" and lease.phase == "parked"
            and lease.job_id == args.job_id and job
            and job.get("status") in ("done", "error", "cancelled")
            and marker is not None and marker.get("job_id") is None
            and str(marker.get("reason") or "").startswith("durable-lease-recovery:")
        )
        if ((not job and not internal_residency_recovery) or
                (job and job.get("recovery_required") is not True
                 and not terminal_parked_recovery)):
            raise RuntimeError(
                "matching target is neither recovery_required, an exact internal residency lease, "
                "nor an exact terminal parked restart"
            )

        if lease is None:
            # A previous exact reconciliation can leave only the persisted job
            # flag behind if the controller crashes between protocol/marker
            # cleanup and jobs.json persistence. A remaining marker is not that
            # case: without its matching durable fence it is ambiguous and must
            # stay blocked for an operator.
            if marker is not None:
                raise RuntimeError("recovery marker exists without a durable lease")
        else:
            if lease.state != "recovery" or lease.job_id != args.job_id:
                raise RuntimeError(
                    f"exact recovery lease not found for {args.job_id}: "
                    f"{(lease.job_id, lease.state)}"
                )
            if (marker is None or
                    (marker.get("job_id") != args.job_id
                     and not terminal_parked_recovery
                     and not internal_residency_recovery)):
                raise RuntimeError(
                    f"recovery marker belongs to {None if marker is None else marker.get('job_id')!r}"
                )

        target_engine = str(
            getattr(lease, "engine", "") or (job or {}).get("engine") or ""
        )
        if target_engine == "maestro":
            reaped = app.reap_orphan_maestro_runners()
            if reaped.get("status") not in ("clean", "reaped"):
                raise RuntimeError(
                    f"Maestro runner absence is unproven: {reaped.get('detail') or reaped}"
                )
        proof = app._gpu_reclaim_all(job)
        if proof.get("processes_gone") is not True:
            raise RuntimeError(f"managed GPU processes survived: {proof.get('survivors')}")
        if proof.get("memory_recovered") is not True:
            raise RuntimeError(f"memory did not recover: {proof.get('available_gib')} GiB")

        if lease is not None:
            app.gpu_protocol().reconcile(lease, proof=proof)
        app._gpu_active_lease = None
        if job is not None:
            for key in ("recovery_required", "recovery_reason"):
                job.pop(key, None)
            app.save_state()
        if marker is not None:
            app.GPU_RECOVERY_HOLD.unlink()
        if app.pool_cmd("acquire") != "OK":
            raise RuntimeError("legacy idle pool did not reacquire canonical GPU lock")

        print(json.dumps({
            "reconciled_job": args.job_id,
            "orphan_recovery_job": orphan_recovery_job,
            "internal_residency_recovery": internal_residency_recovery,
            "terminal_parked_recovery": terminal_parked_recovery,
            "proof": proof,
            "lease": app.gpu_protocol().snapshot().get("lease"),
            "hold_exists": app.GPU_RECOVERY_HOLD.exists(),
            "pool_restored": True,
        }, sort_keys=True))
        return 0
    finally:
        started = systemctl("start", SERVICE, check=False)
        if started.returncode != 0:
            print(started.stderr, file=sys.stderr)


if __name__ == "__main__":
    raise SystemExit(main())
