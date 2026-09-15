"""Fail-closed DGX Spark scale, wardrobe, and body-proportion gate for VibeX."""
from __future__ import annotations

import hashlib
import json
from pathlib import Path

EXPECTED = ["VX16", "VX17"]
PASS_OR_NA = {"pass", "not_applicable"}


def sha(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def require_vibex_prop_continuity(receipt_path: Path) -> dict:
    if not receipt_path.is_file():
        raise RuntimeError(f"missing VibeX prop continuity receipt: {receipt_path}")
    data = json.loads(receipt_path.read_text())
    rows = data.get("shots") or []
    if [row.get("id") for row in rows] != EXPECTED:
        raise RuntimeError("VibeX prop continuity receipt must contain VX16,VX17 in order")
    for row in rows:
        source = Path(row.get("source") or "")
        if not source.is_file() or sha(source) != row.get("source_sha256"):
            raise RuntimeError(f"VibeX prop source/hash mismatch: {row.get('id')}")
        if row.get("small_dgx_scale") != "pass":
            raise RuntimeError(f"DGX scale failed: {row['id']}")
        if row.get("wardrobe_continuity") not in PASS_OR_NA:
            raise RuntimeError(f"wardrobe continuity failed: {row['id']}")
        if row.get("body_proportions") not in PASS_OR_NA:
            raise RuntimeError(f"body proportions failed: {row['id']}")
        if row.get("framing_headroom") != "pass" or row.get("visual_qa") != "pass":
            raise RuntimeError(f"framing/visual QA failed: {row['id']}")
    if data.get("approved_for_private_assembly") is not True:
        raise RuntimeError("VibeX prop continuity is not approved for private assembly")
    return data
