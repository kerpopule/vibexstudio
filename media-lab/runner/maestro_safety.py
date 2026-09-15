"""Spark-specific safety policy for Media Lab's in-container Maestro runner."""
from __future__ import annotations

import math
import subprocess
from typing import Any, Mapping

H3_QUALIFIED_MAX_FRAMES = 124
H3_DEFAULT_FPS = 24.0
_H3_MODEL_PREFIX = "minimax_h3"
_ORPHAN_PATTERN = r"^python3 /tmp/media-lab-maestro-runner\.py /tmp/media-lab-maestro-"


def _positive_float(value: Any) -> float | None:
    try:
        parsed = float(value)
    except (TypeError, ValueError):
        return None
    return parsed if math.isfinite(parsed) and parsed > 0 else None


def requested_video_frames(settings: Mapping[str, Any]) -> int | None:
    """Return explicit frames, else conservatively derive them from duration and FPS."""
    frames = _positive_float(settings.get("video_length"))
    if frames is not None:
        return int(math.ceil(frames))
    duration = _positive_float(settings.get("duration_seconds"))
    if duration is None:
        return None
    fps = _positive_float(settings.get("force_fps")) or H3_DEFAULT_FPS
    return int(math.ceil(duration * fps))


def admission_error(settings: Mapping[str, Any]) -> str | None:
    """Fail closed for H3 requests outside the one-Spark qualified memory envelope."""
    model = str(settings.get("model_type") or "").strip().lower()
    if not model.startswith(_H3_MODEL_PREFIX):
        return None
    frames = requested_video_frames(settings)
    if frames is None:
        return None
    if frames > H3_QUALIFIED_MAX_FRAMES:
        return (
            f"MiniMax H3 requested {frames} frames, but this 128 GiB DGX Spark is "
            f"qualified only through {H3_QUALIFIED_MAX_FRAMES} frames per take. "
            "Split the performance into qualified takes; the studio refused this "
            "request before model load to protect Tailscale, SSH, and the render queue."
        )
    return None


def reap_orphan_runners(container: str = "maestro-gui") -> dict[str, Any]:
    """Kill only queue-owned Maestro runners left inside the container after API death."""
    try:
        completed = subprocess.run(
            ["docker", "exec", container, "pkill", "-f", _ORPHAN_PATTERN],
            capture_output=True,
            text=True,
            timeout=30,
            check=False,
        )
    except (OSError, subprocess.TimeoutExpired) as exc:
        return {"status": "error", "returncode": None, "detail": str(exc)[:300]}
    if completed.returncode == 0:
        status = "reaped"
    elif completed.returncode == 1:
        status = "clean"
    else:
        status = "error"
    return {
        "status": status,
        "returncode": completed.returncode,
        "detail": (completed.stderr or completed.stdout or "").strip()[:300],
    }
