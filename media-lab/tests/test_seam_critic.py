"""The critic pass: measured seam checks, the vision look (faked), verdicts."""
import json
import shutil
import subprocess

import pytest

from media_lab_core import seam_critic, stitch

pytestmark = pytest.mark.skipif(not (shutil.which("ffmpeg") and shutil.which("ffprobe")),
                                reason="needs ffmpeg")


def _clip(path, src, seconds=2.0, freq=440, volume=1.0):
    subprocess.run(["ffmpeg", "-nostdin", "-v", "error", "-y", "-f", "lavfi", "-i", f"{src}{':' if '=' in src else '='}s=320x180:r=24:d={seconds}",
                    "-f", "lavfi", "-i", f"sine=frequency={freq}:sample_rate=48000:duration={seconds}",
                    "-filter_complex", f"[1:a]volume={volume}[a]", "-map", "0:v", "-map", "[a]",
                    "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", str(path)], check=True,
                   capture_output=True)
    return path


@pytest.fixture
def cut(tmp_path):
    a = _clip(tmp_path / "a.mp4", "testsrc2")
    b = _clip(tmp_path / "b.mp4", "testsrc2", freq=660)          # same framing: a jump cut
    c = _clip(tmp_path / "c.mp4", "color=c=0x2255ff", freq=550)  # a colour jump inside the scene
    plan = {"shots": [{"path": str(a), "scene": "s"}, {"path": str(b), "scene": "s"},
                      {"path": str(c), "scene": "s"}],
            "width": 320, "height": 180, "color_match": False}
    receipt = stitch.render(plan, tmp_path / "cut.mp4")
    return tmp_path / "cut.mp4", receipt


def test_measured_half_flags_jump_cut_and_colour_jump(cut, tmp_path):
    path, receipt = cut
    report = seam_critic.review(path, receipt, frames_dir=tmp_path / "seams")
    s1, s2 = report["seams"]
    assert any("jump cut" in r for r in s1["reasons"])
    assert any(r.startswith("colour jump") for r in s2["reasons"])
    assert s1["verdict"] == "fix_edit" and s2["verdict"] == "fix_colour"
    assert (tmp_path / "seams" / "seam01-pair.jpg").is_file()
    assert report["vision_ran"] is False and report["pass"] is False
    assert "measured checks only" in report["summary"]
    json.dumps(report)


def test_vision_verdicts_become_a_rerender_list(cut, tmp_path):
    path, receipt = cut
    calls = []

    def chat(system, text, jpeg):
        calls.append(text)
        assert jpeg[:2] == b"\xff\xd8"
        if "seam 2" in text:
            return json.dumps({"people_consistent": False, "right_problems": ["looks into the camera"],
                               "verdict": "rerender_right", "reason": "the right frame stares at the lens"})
        return "```json\n" + json.dumps({"verdict": "ok", "reason": "fine"}) + "\n```"

    report = seam_critic.review(path, receipt, frames_dir=tmp_path / "seams", bible={"characters": []}, chat=chat)
    assert len(calls) == 2 and report["vision_ran"]
    assert report["rerender"] == [{"shot": 3, "reasons": ["looks into the camera"]}]
    assert "Nobody looks into the lens" in seam_critic.rerender_patch(["looks into the camera"])


def test_vision_failure_is_reported_not_passed(cut, tmp_path):
    path, receipt = cut

    def broken(system, text, jpeg):
        raise TimeoutError

    report = seam_critic.review(path, receipt, frames_dir=tmp_path / "seams", chat=broken)
    assert report["vision_ran"] is False and not report["pass"]


def test_vision_probe_rejects_a_text_only_engine():
    assert seam_critic.vision_probe(lambda s, t, j: "Red.")
    assert not seam_critic.vision_probe(lambda s, t, j: "I cannot describe the image as none was provided.")


def test_delta_e_is_zero_for_same_colour_and_large_for_opposites():
    assert seam_critic.delta_e([120, 80, 60], [120, 80, 60]) == 0
    assert seam_critic.delta_e([255, 0, 0], [0, 0, 255]) > 100
