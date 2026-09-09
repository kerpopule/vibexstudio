#!/usr/bin/env python3
"""Stage a pinned independent controller and build the desktop with that resource.

Requires an existing exported frontend. --prepare-only writes a reviewable build
receipt without compiling. Does not install or launch the resulting application.
"""
import argparse
import importlib.util
import json
import os
from pathlib import Path
import subprocess

SCRIPTS = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('desktop_package', SCRIPTS / 'package-independent-desktop.py')
packager = importlib.util.module_from_spec(spec)
spec.loader.exec_module(packager)


def prepare(source, output, frontend):
    frontend = Path(frontend).resolve(strict=True)
    if not (frontend / 'index.html').is_file():
        raise ValueError('Export the Studio frontend before building the desktop')
    output = Path(output).absolute()
    output.mkdir(exist_ok=False)
    package = packager.package(source, output / 'independent-controller')
    base = json.loads((SCRIPTS.parent / 'src-tauri/tauri.conf.json').read_text())
    # Tauri applies JSON Merge Patch: null removes inherited resource entries.
    resources = {key: None for key in base['bundle'].get('resources', {})}
    resources.update({str(SCRIPTS.parent / 'workbench/server.mjs'): 'workbench/server.mjs',
                      str(SCRIPTS.parent / 'workbench/agent-transport.mjs'): 'workbench/agent-transport.mjs',
                      str(SCRIPTS.parent / 'workbench/agent-enroll.mjs'): 'workbench/agent-enroll.mjs',
                      str(SCRIPTS.parent / 'workbench/agent-device-identity.mjs'): 'workbench/agent-device-identity.mjs',
                      str(SCRIPTS.parent / 'workbench/agent-ssh-plan.mjs'): 'workbench/agent-ssh-plan.mjs',
                      str(output / 'independent-controller'): 'independent-controller'})
    for name in ('agent-remote-worker.mjs','agent-remote-connection.mjs','agent-tunnel.mjs','project-sync-folder.mjs','project-sync-worker.mjs','device-pairing.mjs'):
        resources[str(SCRIPTS.parent / 'workbench' / name)] = 'workbench/' + name
    # Tauri parses `frontendDist` as a URL before treating it as a path. An
    # absolute Windows path such as `D:\a\dist` parses as a URL with scheme
    # `d:`, so the window navigates to it instead of embedding the export and
    # WebView2 shows ERR_FILE_NOT_FOUND (seen on the 20fg Windows candidate).
    # Emit a POSIX path relative to src-tauri, which Tauri resolves as a directory.
    src_tauri = SCRIPTS.parent / 'src-tauri'
    frontend_dist = Path(os.path.relpath(frontend, src_tauri)).as_posix()
    if ':' in frontend_dist.split('/')[0]:
        raise ValueError('frontendDist must not look like a URL scheme: ' + frontend_dist)
    config = {'build': {'frontendDist': frontend_dist}, 'bundle': {'resources': resources}}
    config_path = output / 'tauri.independent.json'
    config_path.write_text(json.dumps(config, indent=2) + '\n')
    receipt = {'package': package, 'config': config, 'config_path': str(config_path),
               'environment': {'VIBEX_CONTROLLER_PACKAGE_SHA256': package['package_sha256']}}
    (output / 'build-receipt.json').write_text(json.dumps(receipt, indent=2) + '\n')
    return receipt


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', type=Path, default=SCRIPTS.parents[1] / 'media-lab')
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--frontend', type=Path, required=True)
    parser.add_argument('--prepare-only', action='store_true')
    parser.add_argument('--no-bundle', action='store_true')
    args = parser.parse_args()
    cli = SCRIPTS.parent / 'node_modules/@tauri-apps/cli/tauri.js'
    if not args.prepare_only and not cli.is_file():
        parser.error('Install desktop build dependencies with npm ci in desktop first')
    receipt = prepare(args.source, args.output, args.frontend)
    print(json.dumps(receipt, sort_keys=True), flush=True)
    if args.prepare_only:
        return
    command = ['node', str(cli), 'build', '--config', receipt['config_path']]
    if args.no_bundle:
        command.append('--no-bundle')
    subprocess.run(command, cwd=SCRIPTS.parent, env=dict(os.environ, **receipt['environment']), check=True)


if __name__ == '__main__':
    main()
