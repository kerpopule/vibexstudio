"""Configured-off Ming-Image engine option (t_e3595a34): selection-surface tests.

CPU-only execution of controller functions; never imports app startup/services.
"""
import ast
import os
from pathlib import Path
from unittest.mock import Mock

import pytest

APP = Path(__file__).parents[1] / "app.py"


def controller_functions(*names, **dependencies):
    tree = ast.parse(APP.read_text())
    nodes = [n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name in names]
    assert {n.name for n in nodes} == set(names)
    exec(compile(ast.Module(body=nodes, type_ignores=[]), str(APP), "exec"), dependencies)
    return dependencies


def selectors(monkeypatch, tmp_path=None, enabled="", root=""):
    monkeypatch.setenv("MING_IMAGE_ENABLED", enabled)
    monkeypatch.setenv("MING_IMAGE_MODEL_ROOT", str(root or ""))
    return controller_functions(
        "ming_image_ready", "char_engine",
        os=os, Path=Path,
        kontext_ready=Mock(return_value=False),
    )


def test_ming_is_off_by_default_and_request_follows_auto_rule(monkeypatch):
    ns = selectors(monkeypatch)
    assert ns["ming_image_ready"]() is False
    assert ns["char_engine"]("ming") == "qwen"
    assert ns["char_engine"]("ming", selfie=True) == "qwen"
    assert ns["char_engine"]("auto") == "qwen"
    assert ns["char_engine"]("qwen") == "qwen"


def test_ming_needs_enabled_flag(monkeypatch, tmp_path):
    ns = selectors(monkeypatch, tmp_path, enabled="", root=tmp_path)
    assert ns["ming_image_ready"]() is False
    assert ns["char_engine"]("ming") == "qwen"


def test_ming_needs_staged_model_root(monkeypatch, tmp_path):
    missing = tmp_path / "not-staged"
    ns = selectors(monkeypatch, enabled="1", root=missing)
    assert ns["ming_image_ready"]() is False
    assert ns["char_engine"]("ming") == "qwen"


def test_ming_resolves_only_when_explicitly_configured(monkeypatch, tmp_path):
    ns = selectors(monkeypatch, enabled="1", root=tmp_path)
    assert ns["ming_image_ready"]() is True
    assert ns["char_engine"]("ming") == "ming"
    # other selections unchanged
    assert ns["char_engine"]("qwen") == "qwen"
    assert ns["char_engine"]("auto") == "qwen"


def test_existing_kontext_qwen_selection_unchanged(monkeypatch, tmp_path):
    monkeypatch.setenv("MING_IMAGE_ENABLED", "")
    monkeypatch.setenv("MING_IMAGE_MODEL_ROOT", "")
    kontext = Mock(return_value=True)
    ns = controller_functions(
        "ming_image_ready", "char_engine", os=os, Path=Path, kontext_ready=kontext,
    )
    assert ns["char_engine"]("kontext") == "kontext"
    assert ns["char_engine"]("auto", selfie=True) == "kontext"
    assert ns["char_engine"]("auto") == "qwen"


def test_ming_render_refusal_contract():
    ns = controller_functions("ming_render_refusal")
    refusal = ns["ming_render_refusal"]
    msg = refusal("ming")
    assert msg and "not enabled for rendering" in msg
    assert refusal("qwen") is None
    assert refusal("kontext") is None
    assert refusal("auto") is None


def test_every_engine_pick_site_is_fail_closed_for_ming():
    tree = ast.parse(APP.read_text())
    calls = [n.func.id for n in ast.walk(tree)
             if isinstance(n, ast.Call) and isinstance(n.func, ast.Name)
             and n.func.id in ("char_engine", "ming_render_refusal")]
    # every engine resolution must carry a ming refusal guard, so a configured
    # Ming pick can never silently render on another engine
    assert calls.count("char_engine") == calls.count("ming_render_refusal") >= 1
