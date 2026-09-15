"""Fail-closed source-level lip-sync gate for visible dialogue."""
from __future__ import annotations

import hashlib
import json
from pathlib import Path

AAS_VISIBLE_IDS = [f"N{i:02d}" for i in range(19)]


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def require_true_lipsync_gate(receipt_path: Path) -> dict[str, dict]:
    """Validate objective and human source-level sync evidence.

    A waveform-copy/coupled-trim receipt is intentionally insufficient here:
    this gate validates visible mouth motion against the source's audio before
    the source is allowed into assembly.
    """
    if not receipt_path.is_file():
        raise RuntimeError(f"missing source-level lip-sync QA: {receipt_path}")
    data = json.loads(receipt_path.read_text())
    rows = data.get("shots") or []
    by_id = {row.get("id"): row for row in rows}
    if sorted(by_id) != AAS_VISIBLE_IDS or len(rows) != len(AAS_VISIBLE_IDS):
        raise RuntimeError("source-level lip-sync QA must contain exactly all 19 moving AAS dialogue shots")
    for shot_id in AAS_VISIBLE_IDS:
        row = by_id[shot_id]
        source = Path(row.get("source") or "")
        if not source.is_file() or sha256(source) != row.get("source_sha256"):
            raise RuntimeError(f"source-level lip-sync source/hash mismatch: {shot_id}")
        checks = {
            "objective_model_syncnet": row.get("objective_model") == "SyncNet",
            "offset_within_one_frame": abs(int(row.get("av_offset_frames", 999))) <= 1,
            "confidence_at_least_five": float(row.get("confidence", -1)) >= 5.0,
            "manual_visible_sync_pass": row.get("manual_visual_sync_qa") == "pass",
            "opening_rest_pass": row.get("opening_rest_qa") == "pass",
            "shot_gate_pass": row.get("gate") == "pass",
        }
        if not all(checks.values()):
            raise RuntimeError(f"source-level lip-sync gate failed for {shot_id}: {checks}")
    if data.get("gate") != "pass":
        raise RuntimeError("source-level lip-sync aggregate gate is not pass")
    return by_id
