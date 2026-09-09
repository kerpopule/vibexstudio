import hashlib
import importlib.util
import json
from pathlib import Path
import pytest

SPEC = importlib.util.spec_from_file_location('controller_launch', Path(__file__).parents[1] / 'scripts/run-independent-controller.py')
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


def fixture_install(tmp_path):
    source = tmp_path / 'source'; source.mkdir()
    content = b'example source'
    (source / 'example.py').write_bytes(content)
    data = json.dumps({'schema':1,'files':[{'path':'example.py','bytes':len(content),'sha256':hashlib.sha256(content).hexdigest()}]}).encode()
    (source / 'manifest.json').write_bytes(data)
    receipt = {'schema':1,'stage':'installed','complete':True,'source_manifest_sha256':hashlib.sha256(data).hexdigest()}
    (tmp_path / 'installation.json').write_text(json.dumps(receipt))
    python = tmp_path / 'venv/bin/python'; python.parent.mkdir(parents=True); python.write_text('fixture')
    return receipt


def test_launch_uses_isolated_installed_interpreter_and_host(tmp_path):
    fixture_install(tmp_path)
    command = MODULE.launch_command(tmp_path, 'serve', ['--port','62929'])
    assert command[0] == str(tmp_path / 'venv/bin/python')
    assert command[1:3] == ['-I','-c']
    assert command[4:] == [str(tmp_path/'source'),'serve',str(tmp_path/'host'),'--port','62929']


def test_changed_source_and_incomplete_installation_refused(tmp_path):
    receipt = fixture_install(tmp_path)
    (tmp_path/'source/example.py').write_bytes(b'changed source')
    with pytest.raises(ValueError, match='identity mismatch'):
        MODULE.launch_command(tmp_path, 'inspect', [])
    receipt['complete'] = False
    (tmp_path/'installation.json').write_text(json.dumps(receipt))
    with pytest.raises(ValueError, match='not completed'):
        MODULE.launch_command(tmp_path, 'inspect', [])
