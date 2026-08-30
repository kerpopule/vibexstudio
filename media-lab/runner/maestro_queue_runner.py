#!/usr/bin/env python3
"""Run one Maestro/WanGP settings JSON and write a structured receipt.

Executed inside the long-lived maestro-gui container by Media Lab's queue worker.
Paths in settings must be container-visible (normally /data/...).
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path("/opt/maestro/app/app")
sys.path.insert(0, str(ROOT))
from shared.api import init  # noqa: E402


def main() -> int:
    if len(sys.argv) != 3:
        print("usage: maestro_queue_runner.py SETTINGS_JSON RECEIPT_JSON", flush=True)
        return 2
    settings_path = Path(sys.argv[1])
    receipt_path = Path(sys.argv[2])
    settings = json.loads(settings_path.read_text(encoding="utf-8"))
    if not isinstance(settings, dict) or not settings.get("model_type"):
        raise ValueError("Maestro settings require model_type")

    receipt_path.parent.mkdir(parents=True, exist_ok=True)
    session = init(
        root=ROOT,
        config_path=Path("/data/config/wgp_config.json"),
        output_dir=Path("/data/outputs"),
        cli_args=["--attention", "sdpa", "--profile", "4"],
        console_output=True,
    )
    print("MAESTRO_JOB_SUBMITTED", json.dumps({
        "model_type": settings.get("model_type"),
        "resolution": settings.get("resolution"),
        "steps": settings.get("num_inference_steps"),
        "frames": settings.get("video_length"),
        "seed": settings.get("seed"),
    }), flush=True)
    job = session.submit_task(settings)
    result = job.result()
    receipt = {
        "success": bool(result.success),
        "generated_files": list(result.generated_files),
        "errors": [
            {"message": str(error.message), "stage": str(error.stage or "")}
            for error in result.errors
        ],
    }
    receipt_path.write_text(json.dumps(receipt, indent=2), encoding="utf-8")
    print("MAESTRO_RESULT", json.dumps(receipt), flush=True)
    return 0 if result.success else 2


if __name__ == "__main__":
    raise SystemExit(main())
