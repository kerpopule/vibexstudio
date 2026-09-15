"""Fail-closed camera-grammar validation for AAS shot sequences."""
from __future__ import annotations

import json
from pathlib import Path

EXPECTED = [f"N{i:02d}" for i in range(19)]
CLOSE = {"close", "extreme_close"}
ANGLES = {"camera_left", "camera_right", "center"}
DISTANCES = {"extreme_close", "close", "medium", "medium_wide", "wide", "full_body"}


def require_camera_grammar(receipt_path: Path) -> dict:
    if not receipt_path.is_file():
        raise RuntimeError(f"missing camera-grammar receipt: {receipt_path}")
    data = json.loads(receipt_path.read_text())
    shots = data.get("shots") or []
    ids = [row.get("id") for row in shots]
    if ids != EXPECTED:
        raise RuntimeError(f"camera-grammar shot order mismatch: {ids}")
    for row in shots:
        if row.get("angle") not in ANGLES or row.get("distance") not in DISTANCES:
            raise RuntimeError(f"invalid camera classification: {row}")
        if row.get("visual_qa") != "pass":
            raise RuntimeError(f"camera visual QA missing: {row['id']}")
    for previous, current in zip(shots, shots[1:]):
        if previous["distance"] in CLOSE and current["distance"] in CLOSE:
            raise RuntimeError(f"adjacent close-up repetition: {previous['id']}->{current['id']}")
        if (previous["angle"], previous["distance"]) == (current["angle"], current["distance"]):
            raise RuntimeError(f"adjacent framing repetition: {previous['id']}->{current['id']}")
    for a, b, c in zip(shots, shots[1:], shots[2:]):
        if a["angle"] == b["angle"] == c["angle"] and a["angle"] != "center":
            raise RuntimeError(f"three-shot same-side run: {a['id']}->{b['id']}->{c['id']}")
    if data.get("approved_for_private_assembly") is not True:
        raise RuntimeError("camera grammar is not approved for private assembly")
    return data
