#!/usr/bin/env python3
"""Create a new desktop resource package for the independent controller.

Only reviewed source, lock files, and installer/launcher scripts are included.
This does not install, download, enable services, or qualify model engines.
"""
import argparse
import hashlib
import importlib.util
import json
from pathlib import Path
import tempfile

SCRIPTS = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('independent_stage', SCRIPTS / 'stage-independent-controller.py')
stager = importlib.util.module_from_spec(spec)
spec.loader.exec_module(stager)


def package(source, output):
    output = Path(output).absolute()
    if output.exists() or output.is_symlink():
        raise FileExistsError('Desktop packaging requires a new output directory')
    with tempfile.TemporaryDirectory(prefix='.desktop-controller-', dir=output.parent) as temporary:
        tree = Path(temporary) / 'package'
        tree.mkdir()
        stager.stage(source, tree / 'source')
        for name in ('install-independent-controller.py', 'run-independent-controller.py'):
            (tree / name).write_bytes((SCRIPTS / name).read_bytes())
        manifest_digest = hashlib.sha256((tree / 'source/manifest.json').read_bytes()).hexdigest()
        files = []
        for path in sorted(tree.rglob('*')):
            if path.is_file():
                data = path.read_bytes()
                files.append({'path': path.relative_to(tree).as_posix(), 'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest()})
        descriptor = {'schema': 1, 'runtime': 'independent-studio', 'source_manifest_sha256': manifest_digest,
                      'files': files, 'includes_models': False, 'activates_services': False}
        encoded = (json.dumps(descriptor, sort_keys=True, indent=2) + '\n').encode()
        (tree / 'package.json').write_bytes(encoded)
        # Refuse existing destinations again at publication time.
        output.mkdir()
        try:
            for child in tree.iterdir(): child.rename(output / child.name)
        except BaseException:
            # Preserve partial output for inspection; never replace user data.
            raise
    return {'package_sha256': hashlib.sha256(encoded).hexdigest(), 'source_manifest_sha256': manifest_digest,
            'file_count': len(files), 'output': str(output)}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', type=Path, default=SCRIPTS.parents[1] / 'media-lab')
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    print(json.dumps(package(args.source, args.output), sort_keys=True))
