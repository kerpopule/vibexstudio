import hashlib
import importlib.util
import json
from pathlib import Path
import pytest

SPEC = importlib.util.spec_from_file_location('controller_install', Path(__file__).parents[1] / 'scripts/install-independent-controller.py')
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


def source(tmp_path):
    (tmp_path / 'example.py').write_bytes(b'print(1)')
    content = b'print(1)'
    data = json.dumps({'schema':1,'files':[{'path':'example.py','bytes':len(content),'sha256':hashlib.sha256(content).hexdigest()}]}).encode()
    (tmp_path / 'manifest.json').write_bytes(data)
    return hashlib.sha256(data).hexdigest()


def test_modified_source_is_refused_before_install(tmp_path):
    digest = source(tmp_path)
    assert MODULE.verified_source(tmp_path, digest)['example.py'] == b'print(1)'
    (tmp_path / 'example.py').write_bytes(b'print(2)')
    with pytest.raises(ValueError, match='identity mismatch'):
        MODULE.verified_source(tmp_path, digest)


def test_manifest_identity_and_symlinks_refused(tmp_path):
    digest = source(tmp_path)
    with pytest.raises(ValueError, match='manifest identity'):
        MODULE.verified_source(tmp_path, '0'*64)
    (tmp_path / 'example.py').unlink()
    (tmp_path / 'example.py').symlink_to(tmp_path / 'manifest.json')
    with pytest.raises(ValueError, match='symlink'):
        MODULE.verified_source(tmp_path, digest)


def test_only_exercised_platform_combinations():
    assert 'macos-arm64' in MODULE.select_lock(['Darwin','arm64',[3,14]])
    assert 'linux-arm64' in MODULE.select_lock(['Linux','aarch64',[3,12]])
    assert 'macos-x64' in MODULE.select_lock(['Darwin','x86_64',[3,14]])
    for facts in (['Windows','ARM64',[3,14]],['Darwin','x86_64',[3,13]],['Linux','x86_64',[3,12]],['Linux','aarch64',[3,13]]):
        with pytest.raises(ValueError):MODULE.select_lock(facts)


def test_existing_destination_is_preserved(tmp_path, monkeypatch):
    staged = tmp_path / 'source'; staged.mkdir()
    lock = MODULE.select_lock(['Darwin', 'arm64', [3,14]])
    contents = {'manifest.json': b'{}', lock: b''}
    monkeypatch.setattr(MODULE, 'verified_source', lambda *_: contents)
    monkeypatch.setattr(MODULE.subprocess, 'check_output', lambda *_, **__: b'["Darwin","arm64",[3,14]]')
    destination = tmp_path / 'existing'; destination.mkdir()
    marker = destination / 'keep'; marker.write_text('existing user data')
    with pytest.raises(FileExistsError):
        MODULE.install(staged, 'unused', destination, 'python', 'uv')
    assert marker.read_text() == 'existing user data'
    assert list(destination.iterdir()) == [marker]


def retry_source(tmp_path, monkeypatch):
    staged = tmp_path / 'input'; staged.mkdir()
    lock = MODULE.select_lock(['Darwin','arm64',[3,14]])
    (staged / lock).parent.mkdir(parents=True)
    (staged / lock).write_bytes(b'# fixture lock\n')
    data = json.dumps({'schema':1,'files':[{'path':lock,'bytes':15,'sha256':hashlib.sha256(b'# fixture lock\n').hexdigest()}]}).encode()
    (staged / 'manifest.json').write_bytes(data)
    def probe(args, **kwargs):
        if 'sys.prefix' in args[-1]:
            return json.dumps({'platform':['Darwin','arm64',[3,14]],'prefix':str(Path(args[0]).parents[1]),'base_prefix':'/fixture/base'}).encode()
        return b'["Darwin","arm64",[3,14]]'
    monkeypatch.setattr(MODULE.subprocess, 'check_output', probe)
    return staged, hashlib.sha256(data).hexdigest()


def test_dependency_failure_resumes_without_recreating_environment(tmp_path, monkeypatch):
    staged,digest=retry_source(tmp_path,monkeypatch)
    destination=tmp_path/'install'; calls=[]; fail=True
    def run(args, **kwargs):
        nonlocal fail
        calls.append(args)
        if args[1]=='venv':
            executable=destination/'venv/bin/python';executable.parent.mkdir(parents=True);executable.write_text('fixture')
        if args[1:3]==['pip','install'] and fail:
            fail=False;raise MODULE.subprocess.CalledProcessError(1,args)
    monkeypatch.setattr(MODULE.subprocess,'run',run)
    with pytest.raises(MODULE.subprocess.CalledProcessError):
        MODULE.install(staged,digest,destination,'python','uv')
    assert json.loads((destination/'installation.json').read_text())['stage']=='dependencies'
    receipt=MODULE.install(staged,digest,destination,'python','uv',resume=True)
    assert receipt['complete'] is True
    assert 'error_type' not in receipt
    assert sum(args[1]=='venv' for args in calls)==1
    assert sum(args[1:3]==['pip','install'] for args in calls)==2
    before=len(calls)
    with pytest.raises(ValueError,match='incomplete installation'):
        MODULE.install(staged,digest,destination,'python','uv',resume=True)
    assert len(calls)==before


def test_resume_rejects_changed_source_before_any_runtime_mutation(tmp_path,monkeypatch):
    staged,digest=retry_source(tmp_path,monkeypatch)
    destination=tmp_path/'install';destination.mkdir(mode=0o700)
    MODULE.shutil.copytree(staged,destination/'source')
    executable=destination/'venv/bin/python';executable.parent.mkdir(parents=True);executable.write_text('fixture')
    (destination/'installation.json').write_text(json.dumps({'schema':1,'complete':False,'stage':'dependencies','source_manifest_sha256':digest,'platform':['Darwin','arm64',[3,14]]}))
    (destination/'source'/MODULE.select_lock(['Darwin','arm64',[3,14]])).write_text('changed')
    calls=[];monkeypatch.setattr(MODULE.subprocess,'run',lambda *args,**kwargs:calls.append(args))
    with pytest.raises(ValueError,match='identity mismatch'):
        MODULE.install(staged,digest,destination,'python','uv',resume=True)
    assert calls==[]


def test_live_install_lock_refuses_competing_writer(tmp_path):
    with MODULE.installation_lock(tmp_path):
        with pytest.raises(ValueError,match='Another installer'):
            with MODULE.installation_lock(tmp_path):
                pytest.fail('A competing writer acquired the lock')
    with MODULE.installation_lock(tmp_path):
        pass


@pytest.mark.parametrize('changes', [
    {'platform':['Darwin','arm64',[3,13]]},
    {'prefix':'/some/other/environment'},
    {'base_prefix':'SAME'},
])
def test_reused_environment_must_match_platform_and_destination(tmp_path,monkeypatch,changes):
    prefix=str(tmp_path/'venv')
    result={'platform':['Darwin','arm64',[3,14]],'prefix':prefix,'base_prefix':'/base'}
    result.update({key:prefix if value=='SAME' else value for key,value in changes.items()})
    monkeypatch.setattr(MODULE.subprocess,'check_output',lambda *args,**kwargs:json.dumps(result).encode())
    with pytest.raises(ValueError,match='does not match'):
        MODULE.verify_environment(tmp_path,['Darwin','arm64',[3,14]])


def test_incomplete_environment_is_retained_and_retry_finishes(tmp_path, monkeypatch):
    staged, digest = retry_source(tmp_path, monkeypatch)
    destination = tmp_path / 'install'
    first = True
    def run(args, **kwargs):
        nonlocal first
        if args[1] == 'venv':
            venv = destination / 'venv'
            venv.mkdir(exist_ok=True)
            if first:
                first = False
                (venv / 'partial').write_text('keep for recovery')
                raise MODULE.subprocess.CalledProcessError(1, args)
            (venv / 'bin').mkdir()
            (venv / 'bin/python').write_text('fixture')
    monkeypatch.setattr(MODULE.subprocess, 'run', run)
    with pytest.raises(MODULE.subprocess.CalledProcessError):
        MODULE.install(staged, digest, destination, 'python', 'uv')
    assert json.loads((destination / 'installation.json').read_text())['stage'] == 'venv'
    assert MODULE.install(staged, digest, destination, 'python', 'uv', resume=True)['complete']
    retained = list(destination.glob('venv-incomplete-*/partial'))
    assert len(retained) == 1
    assert retained[0].read_text() == 'keep for recovery'
