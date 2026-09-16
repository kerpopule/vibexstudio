#!/usr/bin/env python3
"""Reconcile one exact Media Lab durable GPU recovery hold.

Run only after operator approval. The tool stops admission, adopts the existing
recovery fence, reclaims every managed GPU companion, requires exact process and
memory proof, reconciles the protocol, removes only the matching hold, restores
the legacy idle pool, and restarts Media Lab in a finally block.
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

        lease = app._gpu_active_lease or app.gpu_protocol().recover_startup()
        app._gpu_active_lease = lease
        if lease is None or lease.state != "recovery" or lease.job_id != args.job_id:
            raise RuntimeError(
                f"exact recovery lease not found for {args.job_id}: "
                f"{None if lease is None else (lease.job_id, lease.state)}"
            )
        job = app.jobs.get(args.job_id)
        if not job or job.get("recovery_required") is not True:
            raise RuntimeError("matching job is not marked recovery_required")

        marker = json.loads(app.GPU_RECOVERY_HOLD.read_text())
        if marker.get("job_id") != args.job_id:
            raise RuntimeError(f"recovery marker belongs to {marker.get('job_id')!r}")

        proof = app._gpu_reclaim_all(job)
        if proof.get("processes_gone") is not True:
            raise RuntimeError(f"managed GPU processes survived: {proof.get('survivors')}")
        if proof.get("memory_recovered") is not True:
            raise RuntimeError(f"memory did not recover: {proof.get('available_gib')} GiB")

        app.gpu_protocol().reconcile(lease, proof=proof)
        app._gpu_active_lease = None
        for key in ("recovery_required", "recovery_reason"):
            job.pop(key, None)
        app.save_state()
        app.GPU_RECOVERY_HOLD.unlink()
        if app.pool_cmd("acquire") != "OK":
            raise RuntimeError("legacy idle pool did not reacquire canonical GPU lock")

        print(json.dumps({
            "reconciled_job": args.job_id,
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
