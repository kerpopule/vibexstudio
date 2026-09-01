"""Shared fixtures for the Cut test-suite: tiny synthetic media made by ffmpeg."""

import shutil
import subprocess

import pytest

FFMPEG = shutil.which("ffmpeg") and shutil.which("ffprobe")


def _ff(*args):
    result = subprocess.run(["ffmpeg", "-nostdin", "-v", "error", "-y", "-fflags", "+bitexact", *args],
                            capture_output=True, text=True, timeout=120, check=False)
    assert result.returncode == 0, result.stderr


@pytest.fixture(scope="session")
def cut_media(tmp_path_factory):
    """A 3 s video with a tone, a 2 s video, a square PNG and a 5 s mp3 — no real media."""
    if not FFMPEG:
        pytest.skip("ffmpeg/ffprobe are required for Cut media tests")
    base = tmp_path_factory.mktemp("cut-media")
    _ff("-f", "lavfi", "-i", "testsrc2=s=640x360:r=24:d=3",
        "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000:d=3",
        "-c:v", "libx264", "-threads", "1", "-flags:v", "+bitexact", "-pix_fmt", "yuv420p",
        "-c:a", "aac", "-flags:a", "+bitexact", "-map_metadata", "-1", "-shortest", str(base / "a.mp4"))
    _ff("-f", "lavfi", "-i", "color=c=0x3355aa:s=640x360:r=24:d=2",
        "-f", "lavfi", "-i", "sine=frequency=660:sample_rate=48000:d=2",
        "-c:v", "libx264", "-threads", "1", "-flags:v", "+bitexact", "-pix_fmt", "yuv420p",
        "-c:a", "aac", "-flags:a", "+bitexact", "-map_metadata", "-1", "-shortest", str(base / "b.mp4"))
    _ff("-f", "lavfi", "-i", "color=c=0xaa5533:s=480x480:d=1", "-frames:v", "1", str(base / "c.png"))
    _ff("-f", "lavfi", "-i", "sine=frequency=220:sample_rate=44100:d=5", "-c:a", "libmp3lame", "-q:a", "4",
        "-map_metadata", "-1", str(base / "m.mp3"))
    return {"dir": base, "a": base / "a.mp4", "b": base / "b.mp4", "c": base / "c.png", "m": base / "m.mp3"}
