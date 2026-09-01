import json
import shutil
import subprocess

import pytest

from media_lab_core.cut import (
    load_storyboard_project,
    render_single_source_export,
    validate_export_request,
)


def _project(tmp_path, duration=3):
    source = tmp_path / "storyboard.json"
    source.write_text(
        json.dumps(
            {
                "schema": "media_lab.storyboard.v1",
                "project": "ffmpeg-fixture",
                "title": "Generated fixture qualification",
                "private_internal_only": True,
                "candidate_not_final_until_steve_approves": True,
                "publication_authorized": False,
                "format": {
                    "resolution": "640x360",
                    "aspect_ratio": "16:9",
                    "fps": 24,
                    "shot_duration_seconds": duration,
                    "shot_count": 1,
                    "estimated_total_seconds": duration,
                },
                "shots": [
                    {
                        "id": "FIXTURE01",
                        "kind": "generated-fixture",
                        "narration": "Synthetic tone only.",
                        "visual": "Deterministic solid color fixture.",
                        "engine_plan": "ffmpeg lavfi",
                        "qa": ["synthetic-only"],
                    }
                ],
            },
            sort_keys=True,
        )
    )
    return load_storyboard_project(source)


def _generate_source(path):
    result = subprocess.run(
        [
            "ffmpeg",
            "-nostdin",
            "-v",
            "error",
            "-y",
            "-fflags",
            "+bitexact",
            "-f",
            "lavfi",
            "-i",
            "color=c=0x281810:s=640x360:r=24:d=3",
            "-f",
            "lavfi",
            "-i",
            "sine=frequency=440:sample_rate=48000:duration=3",
            "-c:v",
            "libx264",
            "-threads",
            "1",
            "-flags:v",
            "+bitexact",
            "-pix_fmt",
            "yuv420p",
            "-c:a",
            "aac",
            "-flags:a",
            "+bitexact",
            "-map_metadata",
            "-1",
            "-metadata",
            "creation_time=1970-01-01T00:00:00Z",
            "-shortest",
            str(path),
        ],
        capture_output=True,
        text=True,
        timeout=60,
        check=False,
    )
    assert result.returncode == 0, result.stderr


@pytest.mark.skipif(
    shutil.which("ffmpeg") is None or shutil.which("ffprobe") is None,
    reason="ffmpeg/ffprobe are required for the CPU finishing tracer",
)
def test_cpu_ffmpeg_range_export_decodes_with_audio(tmp_path):
    source = tmp_path / "source.mp4"
    output = tmp_path / "range.mp4"
    _generate_source(source)
    project = _project(tmp_path)
    export_request = validate_export_request(
        project,
        {
            "range_mode": "selection",
            "range_start_seconds": 0.5,
            "range_end_seconds": 2.25,
            "format": "mp4",
            "quality": "preview",
            "include_audio": True,
        },
    )
    receipt = render_single_source_export(
        source=source,
        output=output,
        export_request=export_request,
        timeout_seconds=60,
    )

    assert receipt["exit_code"] == 0
    assert receipt["candidate_not_final"] is True
    assert receipt["publication_authorized"] is False
    assert receipt["bytes"] == output.stat().st_size
    assert not (tmp_path / ".range.partial.mp4").exists()
    data = receipt["ffprobe"]
    assert {stream["codec_type"] for stream in data["streams"]} == {"video", "audio"}
    video = next(stream for stream in data["streams"] if stream["codec_type"] == "video")
    assert video["codec_name"] == "h264"
    assert (video["width"], video["height"]) == (640, 360)
    assert 1.7 <= float(data["format"]["duration"]) <= 1.85


@pytest.mark.skipif(
    shutil.which("ffmpeg") is None or shutil.which("ffprobe") is None,
    reason="ffmpeg/ffprobe are required for reproducibility qualification",
)
def test_two_cpu_preview_runs_are_byte_and_probe_reproducible(tmp_path):
    source = tmp_path / "generated-source.mp4"
    _generate_source(source)
    request = validate_export_request(
        _project(tmp_path),
        {
            "range_mode": "selection",
            "range_start_seconds": 0.25,
            "range_end_seconds": 1.75,
            "format": "mp4",
            "quality": "preview",
            "include_audio": True,
        },
    )
    first = render_single_source_export(
        source=source,
        output=tmp_path / "preview-a.mp4",
        export_request=request,
        timeout_seconds=60,
    )
    second = render_single_source_export(
        source=source,
        output=tmp_path / "preview-b.mp4",
        export_request=request,
        timeout_seconds=60,
    )

    assert first["sha256"] == second["sha256"]
    assert first["bytes"] == second["bytes"]
    assert first["ffprobe"] == second["ffprobe"]
    assert first["command"][:-1] == second["command"][:-1]
