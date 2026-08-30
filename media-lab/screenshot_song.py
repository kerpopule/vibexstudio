"""Deterministic overlap removal, lyric timing, and screenshot-video assembly.

The vision model extracts literal blocks; this module deliberately owns the parts
that must not be left to a generative model: adjacent-screenshot deduplication,
cue calculation, and pixel-preserving FFmpeg assembly.
"""
from __future__ import annotations

import json
import math
import re
import subprocess
from difflib import SequenceMatcher
from pathlib import Path
from typing import Iterable, Sequence


def clean_blocks(blocks: Iterable[object]) -> list[str]:
    """Normalize OCR container noise without changing visible wording."""
    out: list[str] = []
    for value in blocks:
        if isinstance(value, dict):
            value = value.get("text", "")
        text = str(value or "").replace("\r\n", "\n").replace("\r", "\n").strip()
        text = re.sub(r"[ \t]+", " ", text)
        text = re.sub(r"\n{3,}", "\n\n", text)
        if text:
            out.append(text)
    return out


def normalized_block(text: str) -> str:
    text = str(text or "").casefold()
    text = text.replace("’", "'").replace("‘", "'").replace("“", '"').replace("”", '"')
    return " ".join(re.findall(r"[\w']+", text, flags=re.UNICODE))


def _same_boundary_block(left: str, right: str) -> bool:
    a, b = normalized_block(left), normalized_block(right)
    if not a or not b:
        return False
    if a == b:
        return True
    # OCR can vary one character between overlapping screenshots. Only allow a
    # fuzzy single-block match when it is long and nearly identical; short
    # messages such as "yes" may legitimately occur again and are exact-only.
    if min(len(a), len(b)) < 12:
        return False
    return SequenceMatcher(None, a, b, autojunk=False).ratio() >= 0.96


def boundary_overlap(previous: Sequence[str], current: Sequence[str], max_blocks: int = 20) -> int:
    """Largest suffix/prefix overlap between adjacent screenshots.

    This is intentionally not global deduplication. A later repeated message is
    preserved unless it occurs exactly at the boundary created by overlapping
    screenshots.
    """
    limit = min(len(previous), len(current), max_blocks)
    for size in range(limit, 0, -1):
        left, right = previous[-size:], current[:size]
        if all(_same_boundary_block(a, b) for a, b in zip(left, right)):
            return size
    return 0


def merge_screenshot_blocks(screenshots: Sequence[Sequence[object]]) -> dict:
    merged: list[str] = []
    rows: list[dict] = []
    for index, raw in enumerate(screenshots):
        blocks = clean_blocks(raw)
        overlap = boundary_overlap(merged, blocks) if merged else 0
        unique = blocks[overlap:]
        merged.extend(unique)
        rows.append({
            "index": index,
            "blocks": blocks,
            "unique_blocks": unique,
            "unique_text": "\n".join(unique).strip(),
            "overlap_removed": overlap,
            "included": bool(unique),
        })
    return {"screenshots": rows, "blocks": merged, "lyrics": "\n".join(merged).strip()}


def lyric_tokens(text: str) -> list[str]:
    return re.findall(r"[\w']+", str(text or "").casefold(), flags=re.UNICODE)


def auto_music_seconds(text: str, block_count: int | None = None) -> int:
    """Readable default runtime for literal text, rounded to a musical five seconds.

    1.65 words/second is deliberately slower than ordinary speech so Music 3 can
    articulate prose instead of racing it. Per-block and intro/outro allowances
    become instrumental breathing room; they never duplicate or invent lyrics.
    Empty/freeform song ideas retain a useful 90-second default.
    """
    words = len(lyric_tokens(text))
    if not words:
        return 90
    if block_count is None:
        block_count = len([part for part in re.split(r"\n\s*\n", str(text).strip())
                           if part.strip()])
    blocks = max(1, int(block_count or 1))
    raw = words / 1.65 + blocks * 1.5 + 12.0
    return max(30, min(180, int(math.ceil(raw / 5.0) * 5)))


def literal_vocal_qa(target_text: str, transcript_words: Sequence[dict],
                     requested_duration: float | None = None,
                     actual_duration: float | None = None) -> dict:
    """Fail-closed ASR evidence for one ordered, verbatim vocal pass.

    The comparison is deterministic. The Director may rerender from this receipt,
    but no language model is allowed to rewrite the approved words or waive the
    gate. Small ASR uncertainty is tolerated; long additions, repeated lyric runs,
    missing passages, and materially short renders are not.
    """
    target = lyric_tokens(target_text)
    heard: list[str] = []
    for row in transcript_words or []:
        heard.extend(lyric_tokens(str(row.get("word", ""))))
    if not target or not heard:
        return {
            "passed": False,
            "reason": "no target words" if not target else "no usable vocal transcript",
            "target_words": len(target), "heard_words": len(heard),
            "matched_words": 0, "matched_fraction": 0.0,
            "omitted_words": len(target), "extra_words": len(heard),
            "max_extra_run": len(heard), "extra_samples": heard[:16],
            "duration_ok": False if requested_duration else True,
        }

    matcher = SequenceMatcher(None, target, heard, autojunk=False)
    matched_target: set[int] = set()
    matched_heard: set[int] = set()
    matched = 0
    for block in matcher.get_matching_blocks():
        for offset in range(block.size):
            matched_target.add(block.a + offset)
            matched_heard.add(block.b + offset)
            matched += 1

    extra_runs: list[list[str]] = []
    run: list[str] = []
    for index, token in enumerate(heard):
        if index not in matched_heard:
            run.append(token)
        elif run:
            extra_runs.append(run); run = []
    if run:
        extra_runs.append(run)
    extras = [token for run in extra_runs for token in run]
    omitted = len(target) - len(matched_target)
    coverage = matched / max(1, len(target))
    max_extra_run = max((len(run) for run in extra_runs), default=0)
    allowed_omissions = max(1, int(math.floor(len(target) * 0.08)))
    allowed_extras = max(2, int(math.floor(len(target) * 0.04)))

    duration_ok = True
    duration_reason = ""
    actual = 0.0
    if requested_duration:
        requested = float(requested_duration)
        try:
            actual = float(actual_duration) if actual_duration is not None else 0.0
        except (TypeError, ValueError):
            actual = 0.0
        if actual <= 0 or not math.isfinite(actual):
            duration_ok = False
            duration_reason = "rendered duration could not be measured"
        else:
            minimum = max(1.0, requested * 0.88, requested - 12.0)
            maximum = requested + 8.0
            duration_ok = minimum <= actual <= maximum
            if not duration_ok:
                duration_reason = f"rendered {actual:.1f}s for a {requested:.1f}s request"

    passed = (coverage >= 0.90 and omitted <= allowed_omissions and
              len(extras) <= allowed_extras and max_extra_run <= 2 and duration_ok)
    reasons: list[str] = []
    if coverage < 0.90 or omitted > allowed_omissions:
        reasons.append(f"only {coverage:.0%} of reviewed words matched")
    if len(extras) > allowed_extras or max_extra_run > 2:
        reasons.append(f"{len(extras)} unapproved words detected")
    if duration_reason:
        reasons.append(duration_reason)
    return {
        "passed": passed,
        "reason": "; ".join(reasons) if reasons else "verbatim vocal contract passed",
        "target_words": len(target), "heard_words": len(heard),
        "matched_words": matched, "matched_fraction": round(coverage, 4),
        "omitted_words": omitted, "extra_words": len(extras),
        "max_extra_run": max_extra_run,
        "extra_samples": [" ".join(run[:12]) for run in extra_runs[:4]],
        "allowed_omissions": allowed_omissions, "allowed_extras": allowed_extras,
        "duration_ok": duration_ok,
        "requested_duration": round(float(requested_duration), 3) if requested_duration else None,
        "actual_duration": (round(actual, 3) if requested_duration and actual > 0 and
                            math.isfinite(actual) else None),
    }


def lyric_weighted_starts(texts: Sequence[str], duration: float) -> list[float]:
    if not texts:
        return []
    duration = max(float(duration), 0.1)
    weights = [max(1, len(lyric_tokens(text))) for text in texts]
    total = sum(weights)
    starts = [0.0]
    elapsed = 0
    for weight in weights[:-1]:
        elapsed += weight
        starts.append(round(duration * elapsed / total, 3))
    return starts


def aligned_starts(texts: Sequence[str], transcript_words: Sequence[dict], duration: float) -> dict:
    """Map each screenshot's first lyric to Whisper word time.

    SequenceMatcher aligns the complete intended lyric stream to the ASR stream,
    so occasional missing/misheard sung words do not shift every later cue. Any
    unresolved boundary falls back to its lyric-weighted position and is reported.
    """
    fallback = lyric_weighted_starts(texts, duration)
    if len(texts) < 2:
        return {"starts": fallback, "method": "single-frame", "matched_fraction": 1.0,
                "fallback_boundaries": []}

    target: list[str] = []
    ranges: list[tuple[int, int]] = []
    for text in texts:
        begin = len(target)
        target.extend(lyric_tokens(text))
        ranges.append((begin, len(target)))
    heard = [lyric_tokens(str(row.get("word", ""))) for row in transcript_words]
    heard_flat = [parts[0] if parts else "" for parts in heard]
    usable_heard = [(i, token) for i, token in enumerate(heard_flat) if token]
    heard_tokens = [token for _i, token in usable_heard]

    if not target or not heard_tokens:
        return {"starts": fallback, "method": "lyric-weighted", "matched_fraction": 0.0,
                "fallback_boundaries": list(range(1, len(texts)))}

    matcher = SequenceMatcher(None, target, heard_tokens, autojunk=False)
    target_to_heard: dict[int, int] = {}
    matched = 0
    for block in matcher.get_matching_blocks():
        for offset in range(block.size):
            target_to_heard[block.a + offset] = usable_heard[block.b + offset][0]
            matched += 1

    starts = [0.0]
    unresolved: list[int] = []
    for shot_index, (begin, end) in enumerate(ranges[1:], start=1):
        candidates = [target_to_heard[i] for i in range(begin, end) if i in target_to_heard]
        if candidates:
            value = float(transcript_words[min(candidates)].get("start", fallback[shot_index]))
        else:
            value = fallback[shot_index]
            unresolved.append(shot_index)
        # Keep cues strictly monotonic and leave enough time for a visible frame.
        value = max(starts[-1] + 0.35, min(float(duration) - 0.35, value))
        starts.append(round(value, 3))

    fraction = matched / max(1, len(target))
    method = "whisper-word-aligned" if fraction >= 0.35 else "lyric-weighted"
    if method == "lyric-weighted":
        starts = fallback
        unresolved = list(range(1, len(texts)))
    return {"starts": starts, "method": method,
            "matched_fraction": round(fraction, 4), "fallback_boundaries": unresolved}


def _run(command: Sequence[str], timeout: int = 1800) -> None:
    result = subprocess.run(list(command), capture_output=True, text=True, timeout=timeout)
    if result.returncode:
        detail = (result.stderr or result.stdout or "ffmpeg failed").strip()[-2000:]
        raise RuntimeError(detail)


def render_screenshot_video(images: Sequence[Path], starts: Sequence[float], duration: float,
                            audio: Path, output: Path, poster: Path,
                            orientation: str = "portrait", motion: bool = True,
                            workdir: Path | None = None) -> dict:
    """Build a readable screenshot sequence with optional restrained motion.

    The screenshots themselves are never regenerated. Motion is a six-pixel
    deterministic drift over a blurred copy, preserving every source glyph.
    """
    if not images or len(images) != len(starts):
        raise ValueError("images and starts must be non-empty and the same length")
    if orientation == "landscape":
        width, height = 1920, 1080
    elif orientation == "square":
        width, height = 1080, 1080
    else:
        width, height = 1080, 1920
    duration = max(float(duration), 0.5)
    root = Path(workdir or output.parent / f".{output.stem}-work")
    root.mkdir(parents=True, exist_ok=True)
    clips: list[Path] = []
    cue_rows: list[dict] = []
    completed = False

    try:
        for index, (image, start) in enumerate(zip(images, starts)):
            end = float(starts[index + 1]) if index + 1 < len(starts) else duration
            seconds = max(0.35, end - float(start))
            clip = root / f"shot-{index + 1:02d}.mp4"
            inner_w, inner_h = width - 54, height - 54
            if motion:
                cycle = max(seconds, 1.0)
                vf = (
                    f"split=2[bgsrc][fgsrc];"
                    f"[bgsrc]scale={width}:{height}:force_original_aspect_ratio=increase:flags=lanczos,"
                    f"crop={width}:{height},gblur=sigma=36,eq=brightness=-0.38[bg];"
                    f"[fgsrc]scale={inner_w}:{inner_h}:force_original_aspect_ratio=decrease:flags=lanczos[fg];"
                    f"[bg][fg]overlay=x=(W-w)/2:y=(H-h)/2+6*sin(2*PI*t/{cycle:.3f}),format=yuv420p"
                )
            else:
                vf = (f"scale={inner_w}:{inner_h}:force_original_aspect_ratio=decrease:flags=lanczos,"
                      f"pad={width}:{height}:(ow-iw)/2:(oh-ih)/2:color=0x0B0806,format=yuv420p")
            _run(["ffmpeg", "-nostdin", "-v", "error", "-y", "-loop", "1", "-i", str(image),
                  "-t", f"{seconds:.3f}", "-vf", vf, "-r", "30", "-an", "-c:v", "libx264",
                  "-preset", "fast", "-crf", "20", "-pix_fmt", "yuv420p", str(clip)])
            clips.append(clip)
            cue_rows.append({"image": str(image), "start": round(float(start), 3),
                              "end": round(min(duration, end), 3)})

        concat_file = root / "clips.txt"
        concat_file.write_text("".join(f"file '{clip.as_posix()}'\n" for clip in clips), encoding="utf-8")
        silent = root / "silent.mp4"
        _run(["ffmpeg", "-nostdin", "-v", "error", "-y", "-f", "concat", "-safe", "0",
              "-i", str(concat_file), "-c", "copy", str(silent)])
        _run(["ffmpeg", "-nostdin", "-v", "error", "-y", "-i", str(silent), "-i", str(audio),
              "-map", "0:v:0", "-map", "1:a:0", "-c:v", "copy", "-c:a", "aac", "-b:a", "192k",
              "-shortest", "-movflags", "+faststart", str(output)])
        _run(["ffmpeg", "-nostdin", "-v", "error", "-y", "-ss", "0.2", "-i", str(output),
              "-frames:v", "1", str(poster)], timeout=300)
        receipt = {"width": width, "height": height, "duration": round(duration, 3),
                   "motion": bool(motion), "cues": cue_rows, "output": str(output),
                   "poster": str(poster)}
        (root / "receipt.json").write_text(json.dumps(receipt, indent=2), encoding="utf-8")
        completed = True
        return receipt
    finally:
        # The receipt is durable evidence; per-shot clips and concat files are not.
        for pattern in ("shot-*.mp4", "clips.txt", "silent.mp4"):
            for intermediate in root.glob(pattern):
                intermediate.unlink(missing_ok=True)
        if not completed:
            output.unlink(missing_ok=True)
            poster.unlink(missing_ok=True)
