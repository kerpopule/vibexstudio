import hashlib
import importlib.util
import json
from pathlib import Path
import pytest

SCRIPT = Path(__file__).parents[1] / 'scripts/package-independent-desktop.py'
spec = importlib.util.spec_from_file_location('desktop_package', SCRIPT)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


def test_package_hashes_every_resource_and_keeps_existing_output(tmp_path, monkeypatch):
    def stage(source, output):
        output.mkdir()
        (output / 'manifest.json').write_text('{"schema":1}')
        (output / 'controller.py').write_text('print("fixture")')
    monkeypatch.setattr(module.stager, 'stage', stage)
    output = tmp_path / 'resource'
    result = module.package(tmp_path, output)
    raw = (output / 'package.json').read_bytes()
    assert hashlib.sha256(raw).hexdigest() == result['package_sha256']
    descriptor = json.loads(raw)
    assert descriptor['includes_models'] is False
    assert descriptor['activates_services'] is False
    assert {row['path'] for row in descriptor['files']} == {
        'source/manifest.json', 'source/controller.py',
        'install-independent-controller.py', 'run-independent-controller.py'}
    for row in descriptor['files']:
        data = (output / row['path']).read_bytes()
        assert len(data) == row['bytes']
        assert hashlib.sha256(data).hexdigest() == row['sha256']
    with pytest.raises(FileExistsError): module.package(tmp_path, output)
    assert (output / 'package.json').read_bytes() == raw


def test_installer_rejects_modified_package_before_execution(tmp_path, monkeypatch):
    verify_spec = importlib.util.spec_from_file_location('package_installer', SCRIPT.parent / 'install-desktop-package.py')
    installer = importlib.util.module_from_spec(verify_spec)
    verify_spec.loader.exec_module(installer)
    def stage(source, output):
        output.mkdir()
        (output / 'manifest.json').write_text('{"schema":1}')
    monkeypatch.setattr(module.stager, 'stage', stage)
    output = tmp_path / 'resource'
    result = module.package(tmp_path, output)
    assert installer.verified_package(output, result['package_sha256'])[0] == output
    calls = []
    monkeypatch.setattr(installer.subprocess, 'run', lambda *a, **k: calls.append(a))
    installer.install_package(output, result['package_sha256'], tmp_path / 'install', '/python', '/uv', True)
    assert calls[0][0][-1] == '--resume'
    calls.clear()
    (output / 'install-independent-controller.py').write_text('modified')
    with pytest.raises(ValueError, match='identity mismatch'):
        installer.install_package(output, result['package_sha256'], tmp_path / 'install', '/python', '/uv')
    assert calls == []
