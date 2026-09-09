"""Embedded desktop entry point for an explicitly selected independent install."""
import json
from pathlib import Path
import sys


def main():
    helpers = {'__name__': 'controller_install_helpers'}
    exec(sys.argv[1], helpers)
    installation = Path(sys.argv[2]).resolve(strict=True)
    receipt_path = installation / 'installation.json'
    if receipt_path.is_symlink():
        raise ValueError('Invalid installation receipt')
    with receipt_path.open('rb') as stream:
        data = stream.read(16385)
    if len(data) > 16384:
        raise ValueError('Invalid installation receipt')
    receipt = json.loads(data)
    if receipt.get('schema') != 1 or receipt.get('stage') != 'installed' or receipt.get('complete') is not True:
        raise ValueError('Installation is incomplete')
    source = installation / 'source'
    helpers['verified_source'](source, receipt['source_manifest_sha256'])
    sys.path.insert(0, str(source))
    from media_lab_core.studio_cli import main as studio_main
    if sys.argv[3] == 'inspect-desktop':
        from media_lab_core.studio_cli import application, parser
        application(parser().parse_args(['serve', str(installation / 'host'), '--origin', sys.argv[4]]))
        return studio_main(['inspect', str(installation / 'host')])
    return studio_main([sys.argv[3], str(installation / 'host'), *sys.argv[4:]])


if __name__ == '__main__':
    try:
        raise SystemExit(main())
    except (OSError, ValueError, KeyError) as error:
        print(f'Independent controller could not start: {type(error).__name__}. Verify the installation.', file=sys.stderr)
        raise SystemExit(2)
