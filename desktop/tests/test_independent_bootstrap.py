import json
from pathlib import Path
import subprocess
import sys

REPO = Path(__file__).resolve().parents[2]


def test_incomplete_installation_cannot_start(tmp_path):
    (tmp_path / 'installation.json').write_text(json.dumps({'schema':1,'complete':False,'stage':'dependencies'}))
    program = (REPO/'desktop/src-tauri/src/independent_bootstrap.py').read_text()
    helpers = (REPO/'desktop/scripts/install-independent-controller.py').read_text()
    result = subprocess.run([sys.executable,'-I','-c',program,helpers,str(tmp_path),'serve'],capture_output=True,text=True,timeout=5)
    assert result.returncode == 2
    assert 'ValueError' in result.stderr
    assert not (tmp_path/'host').exists()
