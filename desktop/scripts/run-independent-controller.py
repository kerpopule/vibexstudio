#!/usr/bin/env python3
"""Inspect, pair or serve an installed independent development controller."""
import argparse
import json
import os
from pathlib import Path
import runpy


def launch_command(installation, command, options):
    installation = Path(installation).resolve(strict=True)
    receipt_path = installation / 'installation.json'
    if receipt_path.is_symlink():
        raise ValueError('Installation receipt cannot be symbolic')
    with receipt_path.open('rb') as stream:
        data = stream.read(16385)
    if len(data) > 16384:
        raise ValueError('Installation receipt exceeds size limit')
    receipt = json.loads(data)
    if receipt.get('schema') != 1 or receipt.get('complete') is not True or receipt.get('stage') != 'installed':
        raise ValueError('Controller installation has not completed')
    helpers = runpy.run_path(str(Path(__file__).with_name('install-independent-controller.py')))
    source = installation / 'source'
    helpers['verified_source'](source, receipt['source_manifest_sha256'])
    python = installation / 'venv/bin/python'
    if not python.is_file():
        raise ValueError('Installed Python environment is missing')
    program = '''import sys
sys.path.insert(0,sys.argv[1])
from media_lab_core.studio_cli import main
raise SystemExit(main(sys.argv[2:]))
'''
    return [str(python), '-I', '-c', program, str(source), command,
            str(installation / 'host'), *options]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--installation', type=Path, required=True)
    parser.add_argument('command', choices=('inspect', 'pair', 'serve'))
    args, options = parser.parse_known_args()
    if args.command != 'serve' and options:
        parser.error('Only serve accepts additional options')
    try:
        command = launch_command(args.installation, args.command, options)
    except (OSError, ValueError, KeyError) as error:
        parser.exit(2, f'Cannot launch independent controller: {type(error).__name__}. Verify the installation.\n')
    os.execv(command[0], command)  # The service manager owns the actual server PID.


if __name__ == '__main__':
    main()
