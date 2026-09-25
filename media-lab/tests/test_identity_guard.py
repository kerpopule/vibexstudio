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


def test_bytecode_hit_stderr_omits_local_env_remedy(tmp_path: pathlib.Path) -> None:
    """A committed .pyc is a file-type violation: the local.env remedy is wrong.

    "Move the value into config/local.env" is the fix for a leaked secret, not
    for a committed artifact, so a developer following it would mishandle the
    leak. The bytecode branch must print its own removal remedy instead.
    """
    _init_repo(tmp_path)
    cache = tmp_path / "pkg" / "__pycache__"
    cache.mkdir(parents=True)
    (cache / "mod.cpython-312.pyc").write_bytes(b"\x55\x0d\x0d\x0a\x00\x00\x00\x00")
    _git(tmp_path, "add", "-f", "pkg/__pycache__/mod.cpython-312.pyc")

    result = _run_guard(tmp_path)

    assert result.returncode == 1
    assert "pkg/__pycache__/mod.cpython-312.pyc" in result.stderr
    assert "config/local.env" not in result.stderr
    assert "Remove the bytecode artifact from the repository" in result.stderr


def test_private_pattern_hit_stderr_keeps_local_env_remedy(tmp_path: pathlib.Path) -> None:
    """The real secret remedy survives the split epilogue."""
    _init_repo(tmp_path)
    (tmp_path / "notes.md").write_text(f"host: {PRIVATE_HOSTNAME}\n")
    _git(tmp_path, "add", "notes.md")

    result = _run_guard(tmp_path)

    assert result.returncode == 1
    assert "config/local.env" in result.stderr
    assert "Remove the bytecode artifact from the repository" not in result.stderr


def test_clean_tree_reports_clean_and_no_remedy(tmp_path: pathlib.Path) -> None:
    """Negative control: a clean tree stays exit 0 with no remedy text at all."""
    _init_repo(tmp_path)
    (tmp_path / "mod.py").write_text("print('hello')\n")
    _git(tmp_path, "add", "mod.py")
    _commit(tmp_path, "add module")

    result = _run_guard(tmp_path)

    assert result.returncode == 0
    assert "identity_guard: 1 files clean" in result.stdout
    assert "config/local.env" not in result.stderr
    assert "Remove the bytecode artifact from the repository" not in result.stderr

# ------------------------------------------------ names, brands, e-mail, CSS
# Every private word below is assembled at runtime ("a" + "b"): the guard scans
# this file too, and a quote-plus-quote join is never read as one word.
PERSON = "Hea" + "ther"
BRAND = "auto" + "edu"
CLIENT = "gs" + "gel" + "ato"
MAIL_DOMAIN = "gm" + "ail.com"


def _scan_text(tmp_path: pathlib.Path, name: str, text: str) -> subprocess.CompletedProcess[str]:
    _init_repo(tmp_path)
    (tmp_path / name).write_text(text)
    _git(tmp_path, "add", name)
    return _run_guard(tmp_path)


def test_personal_name_is_rejected(tmp_path: pathlib.Path) -> None:
    result = _scan_text(tmp_path, "notes.md", f"# {PERSON}'s rule for the studio\n")
    assert result.returncode == 1
    assert "notes.md:1:" in result.stderr and "personal name" in result.stderr


def test_lower_case_knit_colour_is_not_a_name(tmp_path: pathlib.Path) -> None:
    result = _scan_text(tmp_path, "prompt.txt", f"a fitted {PERSON.lower()}-gray tee\n")
    assert result.returncode == 0, result.stderr
    result = _scan_text(tmp_path / "b", "prompt.txt", f"the {PERSON} grey-canvas lesson\n")
    assert result.returncode == 1


def test_private_brand_in_a_hostname_is_rejected(tmp_path: pathlib.Path) -> None:
    result = _scan_text(tmp_path, "cfg.env", f"URL=https://media.{BRAND}.ai/x\n")
    assert result.returncode == 1 and "private brand" in result.stderr


def test_client_brand_and_copied_css_are_rejected(tmp_path: pathlib.Path) -> None:
    result = _scan_text(tmp_path, "a.css", f"/* from {CLIENT} */\n")
    assert result.returncode == 1 and "client brand" in result.stderr
    rim = ("rgba(255,255,255," + ".50) 0%,\n  rgba(255,255,255," + ".16) 22%")
    result = _scan_text(tmp_path / "b", "b.css", f".x{{background:linear-gradient(180deg,\n  {rim})}}\n")
    assert result.returncode == 1 and "copied CSS" in result.stderr


def test_personal_email_is_rejected_and_reserved_domains_pass(tmp_path: pathlib.Path) -> None:
    result = _scan_text(tmp_path, "push.py", f'SUB = "mailto:someone@{MAIL_DOMAIN}"\n')
    assert result.returncode == 1 and "e-mail address" in result.stderr
    ok = ('a = "mailto:ops@example.com"\n'
          'b = "icon@2x.png"\n'
          'c = "user@1000.service"\n'
          'd = "https://token@queue.example.org/job"\n'
          'e = "Co-Authored-By: bot <noreply@anthropic.com>"\n')
    result = _scan_text(tmp_path / "b", "ok.py", ok)
    assert result.returncode == 0, result.stderr


def test_guard_source_never_spells_the_words_it_blocks() -> None:
    source = GUARD.read_text(encoding="utf-8").lower()
    for word in (PERSON, BRAND, CLIENT, MAIL_DOMAIN, PRIVATE_HOSTNAME):
        assert word.lower() not in source, word


def test_hash_helper_prints_an_entry_to_paste() -> None:
    out = subprocess.run([sys.executable, str(GUARD), "--hash", "Some Phrase"],
                         capture_output=True, text=True, check=True).stdout
    assert out.strip().startswith('"') and '": "<what it is>",' in out
