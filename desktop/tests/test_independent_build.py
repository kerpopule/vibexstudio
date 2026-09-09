import importlib.util
import json
from pathlib import Path

import pytest

SCRIPT = Path(__file__).parents[1] / 'scripts/build-independent-desktop.py'
spec = importlib.util.spec_from_file_location('independent_build', SCRIPT)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


def test_build_pairs_resource_with_pin_and_removes_legacy_resources(tmp_path, monkeypatch):
    frontend = tmp_path / 'web'
    frontend.mkdir()
    (frontend / 'index.html').write_text('<html></html>')
    def package(source, output):
        output.mkdir()
        return {'package_sha256': 'a' * 64, 'output': str(output)}
    monkeypatch.setattr(module.packager, 'package', package)
    output = tmp_path / 'build'
    receipt = module.prepare(tmp_path, output, frontend)
    assert receipt['environment']['VIBEX_CONTROLLER_PACKAGE_SHA256'] == 'a' * 64
    assert receipt['config']['build']['frontendDist'] == str(frontend)
    assert json.loads(Path(receipt['config_path']).read_text()) == receipt['config']
    resources = receipt['config']['bundle']['resources']
    base = json.loads((SCRIPT.parent.parent / 'src-tauri/tauri.conf.json').read_text())
    assert all(resources[key] is None for key in base['bundle']['resources'])
    assert 'media-lab' not in resources.values()
    for name in ('agent-enroll.mjs','agent-device-identity.mjs','agent-ssh-plan.mjs'):
        assert resources[str(SCRIPT.parent.parent / 'workbench' / name)] == 'workbench/' + name
    assert resources[str(SCRIPT.parent.parent / 'workbench/agent-transport.mjs')] == 'workbench/agent-transport.mjs'
    assert resources[str(output / 'independent-controller')] == 'independent-controller'
    assert json.loads((output / 'build-receipt.json').read_text()) == receipt
    with pytest.raises(FileExistsError):
        module.prepare(tmp_path, output, frontend)


def test_requires_export_before_creating_output(tmp_path):
    output = tmp_path / 'build'
    with pytest.raises(ValueError, match='Export'):
        module.prepare(tmp_path, output, tmp_path)
    assert not output.exists()


def test_default_resources_exclude_legacy_and_resolve_workbench_imports():
    # Check the real base config too: a direct Tauri build must not scoop up
    # stale legacy staging or ship workers whose relative imports are missing.
    import re
    desktop = SCRIPT.parent.parent
    resources = json.loads((desktop / 'src-tauri/tauri.conf.json').read_text())['bundle']['resources']
    assert all(destination.startswith('workbench/') for destination in resources.values())
    assert len(resources) == len(set(resources.values()))
    required = {'server.mjs', 'agent-transport.mjs', 'agent-enroll.mjs',
                'agent-remote-worker.mjs', 'project-sync-worker.mjs'}
    assert required <= {Path(destination).name for destination in resources.values()}
    for source, destination in resources.items():
        path = desktop / 'src-tauri' / source
        assert path.is_file(), source
        for relative in re.findall(r"(?:from\s*|import\s*\()(['\"])(\./[^'\"]+)\1", path.read_text()):
            dependency = (Path(destination).parent / relative[1]).as_posix()
            assert dependency in resources.values(), (destination, dependency)
