#!/usr/bin/env python3
"""Install an independent development controller into a new private directory."""
import argparse
from contextlib import contextmanager
import os
import stat
import tempfile
import hashlib
import json
from pathlib import Path, PurePosixPath
import shutil
import subprocess
import sys


def verified_source(source, expected):
    source = Path(source).resolve(strict=True)
    manifest = source / 'manifest.json'
    if manifest.is_symlink():
        raise ValueError('Manifest cannot be a symlink')
    with manifest.open('rb') as stream:
        data = stream.read(1024 * 1024 + 1)
    if len(data) > 1024 * 1024 or hashlib.sha256(data).hexdigest() != expected:
        raise ValueError('Staged manifest identity mismatch')
    document = json.loads(data)
    rows = document['files']
    if document['schema'] != 1 or not isinstance(rows, list) or not 1 <= len(rows) <= 128:
        raise ValueError('Invalid source manifest')
    contents = {'manifest.json': data}
    total = 0
    for row in rows:
        name = row['path']
        if not isinstance(name, str) or '\\' in name or any(p in ('', '.', '..') for p in name.split('/')) or PurePosixPath(name).is_absolute() or name in contents:
            raise ValueError('Invalid source path')
        size = row['bytes']
        if type(size) is not int or not 0 <= size <= 8 * 1024**2:
            raise ValueError('Invalid source size')
        total += size
        if total > 32 * 1024**2:
            raise ValueError('Source exceeds size limit')
        path = source
        for part in name.split('/'):
            path = path / part
            if path.is_symlink():
                raise ValueError('Source cannot contain symlinks')
        with path.open('rb') as stream:
            content = stream.read(size + 1)
        if len(content) != size or hashlib.sha256(content).hexdigest() != row['sha256']:
            raise ValueError('Source identity mismatch')
        contents[name] = content
    return contents


def select_lock(facts):
    system, machine, version = facts
    if system == 'Darwin' and machine.lower() == 'x86_64' and tuple(version) == (3, 14):
        return 'media_lab_core/data/controller-macos-x64.requirements.lock'
    if machine.lower() not in ('arm64', 'aarch64'):
        raise ValueError('This controller runtime has not been tested on this architecture')
    target = {('Darwin', (3, 14)): 'macos-arm64', ('Linux', (3, 12)): 'linux-arm64'}.get((system, tuple(version)))
    if target is None:
        raise ValueError('This controller runtime has not been tested on this OS/Python combination')
    return f'media_lab_core/data/controller-{target}.requirements.lock'


@contextmanager
def installation_lock(destination):
    import fcntl  # Only the qualified POSIX targets reach installation.
    fd = os.open(destination / '.install.lock', os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW, 0o600)
    try:
        info = os.fstat(fd)
        if not stat.S_ISREG(info.st_mode) or info.st_uid != os.getuid():
            raise ValueError('Installation lock must be a regular file owned by this user')
        try:
            fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise ValueError('Another installer is working in this directory') from None
        yield
    finally:
        os.close(fd)


def verify_environment(destination, facts):
    venv = destination / 'venv'
    executable = venv / 'bin/python'
    result = json.loads(subprocess.check_output([str(executable), '-I', '-c',
        'import json,platform,sys; print(json.dumps({"platform":[platform.system(),platform.machine(),list(sys.version_info[:2])],"prefix":sys.prefix,"base_prefix":sys.base_prefix}))'], timeout=15))
    if (result.get('platform') != facts
            or Path(result.get('prefix', '')).resolve() != venv.resolve()
            or result.get('prefix') == result.get('base_prefix')):
        raise ValueError('The existing Python environment does not match this installation and platform')


def resume_receipt(destination, digest, facts):
    fd = os.open(destination / 'installation.json', os.O_RDONLY | os.O_NOFOLLOW)
    with os.fdopen(fd, 'rb') as stream:
        info = os.fstat(stream.fileno())
        if not stat.S_ISREG(info.st_mode) or info.st_uid != os.getuid() or info.st_size > 16384:
            raise ValueError('Invalid installation receipt')
        receipt = json.load(stream)
    if (receipt.get('schema') != 1 or receipt.get('complete') is not False
            or receipt.get('source_manifest_sha256') != digest or receipt.get('platform') != facts):
        raise ValueError('Resume requires an incomplete installation with the same source and platform')
    if receipt.get('stage') not in ('venv', 'dependencies', 'initialize'):
        raise ValueError('This failed stage cannot be resumed yet; preserve it and choose a new installation directory')
    if (destination / 'source').is_symlink() or (destination / 'venv').is_symlink():
        raise ValueError('Installation source and environment cannot be symbolic links')
    verified_source(destination / 'source', digest)
    if receipt['stage'] == 'venv':
        return receipt
    if not (destination / 'venv/bin/python').is_file():
        raise ValueError('The existing installation environment is missing')
    verify_environment(destination, facts)
    return receipt


def install(source, digest, destination, python, uv, resume=False):
    contents = verified_source(source, digest)
    facts = json.loads(subprocess.check_output([str(python), '-I', '-c',
        'import json,platform,sys; print(json.dumps([platform.system(),platform.machine(),list(sys.version_info[:2])]))'], timeout=15))
    lock = select_lock(facts)
    if lock not in contents:
        raise ValueError('The staged package lacks this platform dependency lock')
    destination = Path(destination).absolute()
    if resume:
        info = destination.lstat()
        if not stat.S_ISDIR(info.st_mode) or info.st_uid != os.getuid() or info.st_mode & 0o077:
            raise ValueError('Resume requires a private installation directory owned by this user')
    else:
        destination.mkdir(mode=0o700)  # Refuse existing installations, including symlinks.
    with installation_lock(destination):
        previous = resume_receipt(destination, digest, facts) if resume else None
        return install_locked(contents, digest, destination, python, uv, facts, lock, previous)


def install_locked(contents, digest, destination, python, uv, facts, lock, previous):
    receipt = {'schema': 1, 'source_manifest_sha256': digest, 'platform': facts,
               'stage': 'source', 'complete': False, 'engines_qualified': [],
               'scope': 'Development controller installation only; no service activation or model qualification.'}
    if previous is not None:
        receipt = dict(previous)
        receipt.pop('error_type', None)
    def record():
        fd, temporary = tempfile.mkstemp(prefix='.installation-', dir=destination)
        try:
            with os.fdopen(fd, 'w') as stream:
                stream.write(json.dumps(receipt, indent=2) + '\n')
                stream.flush()
                os.fsync(stream.fileno())
            os.replace(temporary, destination / 'installation.json')
        finally:
            if os.path.exists(temporary): os.unlink(temporary)
    def run(args):
        subprocess.run([str(a) for a in args], check=True, timeout=300)
    try:
        record()
        staged = destination / 'source'
        venv = destination / 'venv'
        if previous is None:
            staged.mkdir()
            for name, data in contents.items():
                target = staged / name
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_bytes(data)
            receipt['stage'] = 'venv'; record()
            run([uv, 'venv', venv, '--python', python, '--no-python-downloads'])
            verify_environment(destination, facts)
        if previous is not None and previous['stage'] == 'venv':
            # Preserve an incomplete environment rather than clearing a directory
            # that the user may want to inspect or recover.
            reusable = False
            if (venv / 'bin/python').is_file():
                try:
                    verify_environment(destination, facts)
                    reusable = True
                except (ValueError, OSError, subprocess.SubprocessError):
                    pass
            if not reusable:
                if venv.exists():
                    retained = Path(tempfile.mkdtemp(prefix='venv-incomplete-', dir=destination))
                    venv.rename(retained)
                run([uv, 'venv', venv, '--python', python, '--no-python-downloads'])
                verify_environment(destination, facts)
        executable = venv / 'bin/python'
        if previous is None or previous['stage'] in ('venv', 'dependencies'):
            receipt['stage'] = 'dependencies'; record()
            run([uv, 'pip', 'install', '--python', executable, '--require-hashes', '--only-binary=:all:', '-r', staged / lock])
        run([uv, 'pip', 'check', '--python', executable])
        receipt['stage'] = 'initialize'; record()
        run([executable, '-I', '-c', '''import sys
from pathlib import Path
sys.path.insert(0,sys.argv[1])
from media_lab_core.studio_cli import initialize,inspect_host,application,parser
root=Path(sys.argv[2])
if root.is_symlink():raise ValueError('Host directory cannot be symbolic')
if root.exists():inspect_host(root)
else:initialize(root)
application(parser().parse_args(['serve',str(root)]))
assert inspect_host(root)['configuration_valid']
assert not {'app','runner','torch','transformers'} & set(sys.modules)
''', staged, destination / 'host'])
        receipt.update(stage='installed', complete=True, serving=False)
        record()
        return receipt
    except BaseException as error:
        receipt['error_type'] = type(error).__name__
        record()  # Keep the exact failed stage; never overwrite or delete user data.
        raise


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', type=Path, required=True)
    parser.add_argument('--manifest-sha256', required=True)
    parser.add_argument('--destination', type=Path, required=True)
    parser.add_argument('--resume', action='store_true', help='Retry a failed dependency or initialization stage in the same private installation')
    parser.add_argument('--python', type=Path, default=Path(sys.executable))
    parser.add_argument('--uv', type=Path, default=shutil.which('uv'))
    args = parser.parse_args()
    if not args.uv:
        parser.error('An existing uv executable is required')
    print(json.dumps(install(args.source, args.manifest_sha256, args.destination, args.python, args.uv, resume=args.resume), sort_keys=True))


if __name__ == '__main__':
    main()
