#!/usr/bin/env python3
"""Verify a pinned desktop resource package before invoking its installer."""
import argparse
import hashlib
import json
from pathlib import Path, PurePosixPath
import subprocess
import sys


def verified_package(root, expected):
    root = Path(root)
    if root.is_symlink():
        raise ValueError('Package directory cannot be symbolic')
    root = root.resolve(strict=True)
    descriptor = root / 'package.json'
    if descriptor.is_symlink():
        raise ValueError('Package descriptor cannot be symbolic')
    with descriptor.open('rb') as stream:
        raw = stream.read(1024 * 1024 + 1)
    if len(raw) > 1024 * 1024 or hashlib.sha256(raw).hexdigest() != expected:
        raise ValueError('Desktop package identity mismatch')
    data = json.loads(raw)
    if data.get('schema') != 1 or data.get('runtime') != 'independent-studio':
        raise ValueError('Unsupported desktop package')
    rows = data.get('files')
    if not isinstance(rows, list) or not 1 <= len(rows) <= 128:
        raise ValueError('Invalid package file list')
    seen = set()
    total = 0
    for row in rows:
        name = row['path']
        if not isinstance(name, str) or '\\' in name or PurePosixPath(name).is_absolute() or any(part in ('', '.', '..') for part in name.split('/')) or name in seen:
            raise ValueError('Invalid package path')
        seen.add(name)
        size = row['bytes']
        if type(size) is not int or not 0 <= size <= 8 * 1024**2:
            raise ValueError('Invalid package file size')
        total += size
        if total > 32 * 1024**2:
            raise ValueError('Package exceeds size limit')
        path = root
        for part in name.split('/'):
            path = path / part
            if path.is_symlink():
                raise ValueError('Package files cannot be symbolic')
        with path.open('rb') as stream:
            content = stream.read(size + 1)
        if len(content) != size or hashlib.sha256(content).hexdigest() != row['sha256']:
            raise ValueError('Package file identity mismatch')
    if not {'source/manifest.json', 'install-independent-controller.py', 'run-independent-controller.py'} <= seen:
        raise ValueError('Package is missing installer resources')
    source_digest = hashlib.sha256((root / 'source/manifest.json').read_bytes()).hexdigest()
    if source_digest != data.get('source_manifest_sha256'):
        raise ValueError('Package source identity mismatch')
    return root, source_digest


def install_package(root, expected, destination, python, uv, resume=False):
    root, digest = verified_package(root, expected)
    args = [str(python), '-I', str(root / 'install-independent-controller.py'),
            '--source', str(root / 'source'), '--manifest-sha256', digest,
            '--destination', str(destination), '--python', str(python), '--uv', str(uv)]
    if resume:
        args.append('--resume')
    subprocess.run(args, check=True, timeout=1800)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--package', type=Path, required=True)
    parser.add_argument('--package-sha256', required=True)
    parser.add_argument('--destination', type=Path)
    parser.add_argument('--python', type=Path, default=Path(sys.executable))
    parser.add_argument('--uv', type=Path)
    parser.add_argument('--resume', action='store_true')
    args = parser.parse_args()
    if args.destination:
        if not args.uv: parser.error('--uv is required when installing')
        install_package(args.package, args.package_sha256, args.destination, args.python, args.uv, args.resume)
    else:
        root, digest = verified_package(args.package, args.package_sha256)
        print(json.dumps({'verified': True, 'source_manifest_sha256': digest}))
