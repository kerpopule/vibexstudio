"""Tests for tools/identity_guard.py.

The guard runs on `git ls-files`, so every case builds a throwaway repository in
`tmp_path` and invokes the guard there as a subprocess (`repo_root()` resolves
from cwd). Private identifiers are assembled at runtime so this test file never
itself contains a string the guard would reject.
"""
from __future__ import annotations

import pathlib
import subprocess
import sys

REPO_ROOT = pathlib.Path(__file__).resolve().parents[2]
GUARD = REPO_ROOT / "media-lab" / "tools" / "identity_guard.py"

# Built by concatenation: the guard scans this file too.
PRIVATE_ABS_PATH = b"/Users/" + b"vibex/proj/mod.py"
PRIVATE_HOSTNAME = "spark-" + "d16e"


def _git(repo: pathlib.Path, *args: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        ["git", *args], cwd=repo, check=True, capture_output=True, text=True
    )


def _init_repo(repo: pathlib.Path) -> None:
    repo.mkdir(parents=True, exist_ok=True)
    _git(repo, "init", "-q")
    _commit(repo, "init")


def _commit(repo: pathlib.Path, message: str) -> None:
    _git(
        repo,
        "-c",
        "user.email=guard-test@example.com",
        "-c",
        "user.name=Guard Test",
        "commit",
        "-q",
        "--allow-empty",
        "-m",
        message,
    )


def _run_guard(repo: pathlib.Path) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [sys.executable, str(GUARD)], cwd=repo, capture_output=True, text=True
    )


def test_force_added_pyc_in_pycache_is_rejected(tmp_path: pathlib.Path) -> None:
    _init_repo(tmp_path)
    cache = tmp_path / "pkg" / "__pycache__"
    cache.mkdir(parents=True)
    # A CPython header embeds the absolute source path it was compiled from.
    (cache / "mod.cpython-312.pyc").write_bytes(b"\x55\x0d\x0d\x0a\x00\x00\x00\x00" + PRIVATE_ABS_PATH)
    _git(tmp_path, "add", "-f", "pkg/__pycache__/mod.cpython-312.pyc")

    result = _run_guard(tmp_path)

    assert result.returncode == 1
    assert "pkg/__pycache__/mod.cpython-312.pyc" in result.stderr


def test_force_added_bytecode_without_private_string_is_rejected(tmp_path: pathlib.Path) -> None:
    _init_repo(tmp_path)
    pkg = tmp_path / "pkg"
    pkg.mkdir()
    (pkg / "mod.pyo").write_bytes(b"no private data at all\n")
    _git(tmp_path, "add", "-f", "pkg/mod.pyo")

    result = _run_guard(tmp_path)

    assert result.returncode == 1
    assert "pkg/mod.pyo" in result.stderr
    assert "bytecode" in result.stderr


def test_clean_tree_passes(tmp_path: pathlib.Path) -> None:
    _init_repo(tmp_path)
    pkg = tmp_path / "pkg"
    pkg.mkdir()
    (pkg / "mod.py").write_text("print('hello')\n")
    _git(tmp_path, "add", "pkg/mod.py")
    _commit(tmp_path, "add module")

    result = _run_guard(tmp_path)

    assert result.returncode == 0
    assert "identity_guard: 1 files clean" in result.stdout


def test_private_pattern_still_reported(tmp_path: pathlib.Path) -> None:
    _init_repo(tmp_path)
    (tmp_path / "notes.md").write_text(f"host: {PRIVATE_HOSTNAME}\n")
    _git(tmp_path, "add", "notes.md")

    result = _run_guard(tmp_path)

    assert result.returncode == 1
    assert "notes.md:1:" in result.stderr
    assert PRIVATE_HOSTNAME in result.stderr


def test_other_binary_extensions_still_skipped(tmp_path: pathlib.Path) -> None:
    _init_repo(tmp_path)
    # Text content with no NUL byte, so only BINARY_EXT can skip it.
    (tmp_path / "logo.png").write_text(f"host: {PRIVATE_HOSTNAME}\n")
    _git(tmp_path, "add", "logo.png")

    result = _run_guard(tmp_path)

    assert result.returncode == 0
    assert "identity_guard: 1 files clean" in result.stdout


def test_untracked_bytecode_is_rejected(tmp_path: pathlib.Path) -> None:
    _init_repo(tmp_path)
    pkg = tmp_path / "pkg"
    pkg.mkdir()
    (pkg / "mod.pyc").write_bytes(b"\x55\x0d\x0d\x0a\x00\x00\x00\x00")

    result = _run_guard(tmp_path)

    assert result.returncode == 1
    assert "pkg/mod.pyc" in result.stderr