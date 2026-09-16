"""Contracts for the queue-owned H3 -> LTX 2.5 refinement path."""
from __future__ import annotations

import ast
import hashlib
import importlib
import json
import sys
import types
from pathlib import Path
from types import SimpleNamespace

import pytest

ROOT = Path(__file__).parents[1]
APP = ROOT / "app.py"
ENGINE = ROOT / "runner" / "engine_server.py"


def function(name, **namespace):
    tree = ast.parse(APP.read_text())
    node = next(n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == name)
    exec(compile(ast.Module(body=[node], type_ignores=[]), str(APP), "exec"), namespace)
    return namespace[name]


def make_composite_job(request):
    make = function(
        "make_video_job",
        normalize_video_source=lambda value: value,
        STYLES={"none": {"prefix": ""}},
        fal_ready=lambda: True,
        _h3ref=SimpleNamespace(
            required_turbo_preset=lambda value: None,
            normalize_references=lambda value: value,
            assert_ref_count_ok=lambda value: None,
            resolve_reference_detail=lambda value: value,
            normalize_video_references=lambda value: value,
        ),
        engine_frames=lambda engine, seconds: 124 if engine == "h3" else 121,
        SIZES={"landscape": (1280, 704)},
        H3_SIZES={"landscape": (1344, 768)},
        cast_lines=lambda value: [],
        engine_up=lambda value: False,
        submit_job=lambda kind, request, extra: {"kind": kind, "request": request, **extra},
    )
    return make(request)


def test_composite_job_uses_h3_geometry_and_one_queue_identity():
    job = make_composite_job({
        "model": "h3-ltx25", "prompt": "A paper bird takes flight.",
        "duration": "5", "orientation": "landscape", "seed": 424242,
    })
    assert job["engine"] == "h3-ltx25"
    assert job["frames"] >= 124
    assert (job["w"], job["h"]) == (1344, 768)
    assert job["request"]["model"] == "h3-ltx25"


def test_composite_job_is_scheduled_as_h3_first():
    job_engine = function("job_engine")
    assert job_engine({"kind": "video", "engine": "h3-ltx25",
                       "request": {"model": "h3-ltx25"}}) == "h3"


def test_two_stage_runner_preserves_stage_a_and_passes_same_seed(tmp_path):
    pool = tmp_path / "pool"
    jobs_dir = tmp_path / "jobs"
    h3_out = pool / "h3-out"
    ltx_out = pool / "ltx-out"
    h3_out.mkdir(parents=True)
    ltx_out.mkdir(parents=True)
    calls = []
    finished = []

    def generate(engine, body, job, timeout=0):
        calls.append((engine, dict(body), job["stage"]))
        out_dir = h3_out if engine == "h3" else ltx_out
        name = f"job-{job['id']}.mp4"
        (out_dir / name).write_bytes((engine + "-artifact").encode())
        return {"ok": True, "file": name, "seed": body["seed"]}

    run = function(
        "_run_h3_ltx_video",
        Path=Path,
        base64=__import__("base64"),
        json=json,
        shutil=__import__("shutil"),
        hashlib=hashlib,
        subprocess=__import__("subprocess"),
        POOL_DIR=pool,
        JOBS_DIR=jobs_dir,
        H3_LTX_RETAKE_STRENGTH=0.35,
        H3_LTX_REFINEMENT_PROMPT="Preserve continuity.",
        h3_prompt=lambda prompt, **kwargs: prompt,
        engine_generate=generate,
        touch_engine=lambda engine: None,
        fail=lambda job, message, detail="": job.update(status="error", message=message, detail=str(detail)),
        save_state=lambda: None,
        _finish_video=lambda job, out: finished.append(Path(out)),
        _sha256_file=lambda path: hashlib.sha256(Path(path).read_bytes()).hexdigest(),
        _write_h3_ltx_receipt=lambda job_dir, payload: (job_dir / "h3-ltx-receipt.json").write_text(
            json.dumps(payload, sort_keys=True)),
    )
    job = {
        "id": "abc123", "engine": "h3-ltx25", "frames": 124, "w": 1344, "h": 768,
        "full_prompt": "A paper bird takes flight.", "request": {"seed": 424242},
    }
    run(job, references=[], staged_video_refs=[], start_b64="")

    assert [call[0] for call in calls] == ["h3", "ltx"]
    assert calls[0][1]["seed"] == calls[1][1]["seed"] == 424242
    assert calls[1][1]["input_video_file"] == "abc123-stage-a.mp4"
    assert calls[1][1]["retake_strength"] == pytest.approx(0.35)
    assert calls[1][1]["regenerate_audio"] is False
    assert calls[1][1]["reference_pipeline"] is True
    assert (jobs_dir / "abc123" / "stage-a-h3.mp4").read_bytes() == b"h3-artifact"
    receipt = json.loads((jobs_dir / "abc123" / "h3-ltx-receipt.json").read_text())
    assert receipt["seed"] == 424242
    assert receipt["status"] == "complete"
    assert receipt["stages"][0]["engine"] == "h3"
    assert receipt["stages"][1]["engine"] == "ltx25"
    assert finished == [ltx_out / "job-abc123.mp4"]


def test_stage_a_failure_never_starts_ltx(tmp_path):
    calls = []
    run = function(
        "_run_h3_ltx_video",
        Path=Path,
        base64=__import__("base64"), json=json, shutil=__import__("shutil"),
        hashlib=hashlib, subprocess=__import__("subprocess"),
        POOL_DIR=tmp_path / "pool", JOBS_DIR=tmp_path / "jobs",
        H3_LTX_RETAKE_STRENGTH=0.35,
        H3_LTX_REFINEMENT_PROMPT="Preserve continuity.",
        h3_prompt=lambda prompt, **kwargs: prompt,
        engine_generate=lambda engine, body, job, timeout=0: calls.append(engine) or
            {"ok": False, "error": "stage-a exploded"},
        touch_engine=lambda engine: None,
        fail=lambda job, message, detail="": job.update(status="error", message=message, detail=str(detail)),
        save_state=lambda: None, _finish_video=lambda *args: None,
        _sha256_file=lambda path: "unused",
        _write_h3_ltx_receipt=lambda *args: None,
    )
    job = {"id": "failed", "engine": "h3-ltx25", "frames": 124,
           "w": 1344, "h": 768, "full_prompt": "fixture", "request": {"seed": 7}}
    run(job, references=[], staged_video_refs=[], start_b64="")
    assert calls == ["h3"]
    assert job["status"] == "error"
    assert "H3 draft failed" in job["message"]


def test_ltx_engine_accepts_only_staged_basename_video_inputs():
    source = ENGINE.read_text()
    assert "input_video_file" in source
    assert "Path(str(req.get('input_video_file') or '')).name" in source
    assert "LTX_INPUT_DIR" in source
    assert "extra['retake_video']" in source
    assert "extra['retake_strength']" in source
    assert "extra['regenerate_audio']" in source


def test_decord_compat_reader_uses_bounded_installed_pyav(monkeypatch):
    class Frame:
        def __init__(self, value):
            self.value = value

        def to_ndarray(self, format):
            assert format == "rgb24"
            return SimpleNamespace(shape=(16, 24, 3), value=self.value)

    class Container:
        streams = SimpleNamespace(video=[SimpleNamespace(average_rate=24)])

        def decode(self, video):
            assert video == 0
            return iter([Frame(1), Frame(2)])

        def close(self):
            return None

    fake_av = types.ModuleType("av")
    setattr(fake_av, "open", lambda path: Container())
    monkeypatch.setitem(sys.modules, "av", fake_av)
    monkeypatch.delitem(sys.modules, "decord", raising=False)
    tree = ast.parse(ENGINE.read_text())
    node = next(n for n in tree.body if isinstance(n, ast.FunctionDef)
                and n.name == "_install_decord_compat")
    namespace = {"importlib": importlib, "sys": sys, "types": types}
    exec(compile(ast.Module(body=[node], type_ignores=[]), str(ENGINE), "exec"), namespace)
    install = namespace["_install_decord_compat"]
    assert install() == "pyav-compat"
    decord = importlib.import_module("decord")
    reader = decord.VideoReader("stage-a.mp4")
    assert len(reader) == 2
    assert reader.get_avg_fps() == pytest.approx(24.0)
    assert reader[1].shape == (16, 24, 3)


def test_studio_ui_exposes_explicit_two_stage_choice():
    source = (ROOT / "static" / "index.html").read_text()
    assert 'data-v="h3-ltx25"' in source
    assert "H3 → LTX" in source
