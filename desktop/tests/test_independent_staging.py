import hashlib
import json
from pathlib import Path
import subprocess
import sys

REPO = Path(__file__).resolve().parents[2]
SCRIPT = REPO / 'desktop/scripts/stage-independent-controller.py'


def test_staging_has_verified_source_and_locks_without_legacy(tmp_path):
    output = tmp_path / 'stage'
    command = [sys.executable, str(SCRIPT), '--output', str(output)]
    run = subprocess.run(command, capture_output=True, text=True, timeout=20)
    assert run.returncode == 0, run.stderr
    assert json.loads(run.stdout)['files'] == 37
    manifest = json.loads((output / 'manifest.json').read_text())
    expected = {row['path'] for row in manifest['files']}
    actual = {p.relative_to(output).as_posix() for p in output.rglob('*') if p.is_file()}
    assert actual == expected | {'manifest.json'}
    assert not any(name.startswith(('app.py', 'runner/', 'static/', 'config/')) for name in actual)
    for row in manifest['files']:
        content = (output / row['path']).read_bytes()
        assert len(content) == row['bytes']
        assert hashlib.sha256(content).hexdigest() == row['sha256']
    for platform in ('macos-arm64', 'linux-arm64', 'macos-x64'):
        assert f'media_lab_core/data/controller-{platform}.requirements.lock' in actual
    before = (output / 'manifest.json').read_bytes()
    repeated = subprocess.run(command, capture_output=True, text=True, timeout=20)
    assert repeated.returncode != 0
    assert (output / 'manifest.json').read_bytes() == before
