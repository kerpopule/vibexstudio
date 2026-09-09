"""Isolated Z-Image-Turbo renderer, invoked by the owned worker inside the pinned GPU runtime.

On unified-memory hosts the pipeline is loaded with device_map='cuda' (a CPU load followed by .to('cuda') doubles
the footprint and starves CUDA context creation); the owner sets THP_MEM_ALLOC_ENABLE=1 for the GB10 page-fault trap.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import sys

from .image_request import decode_request
from .image_artifact import inspect_png


def drop_page_cache(root):
    """Unified-memory hosts: page cache left by reading the weights competes with the model's own memory and
    starves CUDA context creation. Advise it away before loading (no privilege needed)."""
    dropped = 0
    for base, _, files in os.walk(str(root)):
        for file in files:
            try:
                fd = os.open(os.path.join(base, file), os.O_RDONLY)
                try:
                    os.posix_fadvise(fd, 0, 0, os.POSIX_FADV_DONTNEED); dropped += os.fstat(fd).st_size
                finally:
                    os.close(fd)
            except (OSError, AttributeError):
                pass
    return dropped


def load_pipeline(checkpoints):
    drop_page_cache(checkpoints)
    import torch
    from diffusers import ZImagePipeline
    return ZImagePipeline.from_pretrained(str(checkpoints), torch_dtype=torch.bfloat16, local_files_only=True, device_map='cuda')


def render(pipe, input_path, output_dir, revision):
    import torch
    with Path(input_path).open('rb') as stream:
        data = stream.read(65537)
    request = decode_request(data)
    width, height = (int(part) for part in request['size'].split('*'))
    image = pipe(prompt=request['prompt'], width=width, height=height, num_inference_steps=request['steps'], guidance_scale=0.0,
                 generator=torch.Generator('cuda').manual_seed(request['seed'])).images[0]
    output = Path(output_dir) / 'output.png'
    image.save(str(output), format='PNG')
    metadata = inspect_png(output.read_bytes())
    receipt = {'version': 1, 'revision': revision, 'inputSha256': hashlib.sha256(data).hexdigest(), 'image': metadata}
    with (Path(output_dir) / 'receipt.json').open('x') as stream:
        json.dump(receipt, stream, sort_keys=True)


def serve(checkpoints, revision):
    """Warm mode: keep the loaded pipeline and render one request per JSON line on stdin (see music_render.serve)."""
    channel = os.fdopen(os.dup(1), 'w', buffering=1)
    os.dup2(2, 1)
    sys.stdout = sys.stderr
    pipe = None
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        stage = 'request'
        try:
            job = json.loads(line)
            if type(job) is not dict or set(job) != {'input', 'output'}:
                raise ValueError('Invalid resident render request.')
            if pipe is None:
                stage = 'load'
                pipe = load_pipeline(checkpoints)
                stage = 'render'
            render(pipe, job['input'], job['output'], revision)
            reply = {'ok': True}
        except Exception as error:  # noqa: BLE001 - reported to the owner, which verifies outputs independently
            import traceback
            traceback.print_exc()  # stderr is the owner's per-process resident.log; the reply carries no paths
            reply = {'error': type(error).__name__, 'stage': stage}
        channel.write(json.dumps(reply) + '\n')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ('input', 'output'):
        parser.add_argument('--' + name, type=Path)
    parser.add_argument('--checkpoints', type=Path, required=True)
    parser.add_argument('--revision', required=True)
    parser.add_argument('--serve', action='store_true')
    args = parser.parse_args()
    if args.serve:
        serve(args.checkpoints, args.revision)
        return
    if args.input is None or args.output is None:
        parser.error('--input and --output are required without --serve')
    render(load_pipeline(args.checkpoints), args.input, args.output, args.revision)


if __name__ == '__main__':
    main()
