"""Bounded image executor: canonical GPU lease + owned (warm) renderer + verified atomic publication."""
import contextlib
import hashlib
import json
import os
from pathlib import Path
import re
import tempfile
from .cpu_worker import cpu_slot, WorkerStopped
from .music_worker import gpu_lease, ResidentRenderer
from .image_request import decode_request
from .image_artifact import inspect_png, MAX_BYTES

RENDER_MODULE = 'media_lab_core.image_render'
ENV = {'THP_MEM_ALLOC_ENABLE': '1'}


def verify_result(directory, digest, revision):
    directory = Path(directory)
    if directory.is_symlink() or not directory.is_dir():
        raise ValueError('Invalid image result directory.')
    receipt = directory / 'receipt.json'; picture = directory / 'output.png'
    for path, limit in ((receipt, 16384), (picture, MAX_BYTES)):
        if path.is_symlink() or not path.is_file() or path.stat().st_size > limit:
            raise ValueError('Invalid image result file.')
    with receipt.open('rb') as stream:
        info = json.loads(stream.read(16385))
    with picture.open('rb') as stream:
        metadata = inspect_png(stream.read(MAX_BYTES + 1))
    if info != {'version': 1, 'revision': revision, 'inputSha256': digest, 'image': metadata}:
        raise ValueError('Image receipt does not match the request and decoded output.')
    return metadata


def make_resident(*, runtime, checkpoints, revision, home, idle_seconds, memory_bytes=32 * 1024**3, shutting_down=lambda: False):
    return ResidentRenderer(runtime=runtime, checkpoints=checkpoints, revision=revision, home=home, memory_bytes=memory_bytes,
                            idle_seconds=idle_seconds, module=RENDER_MODULE, env=ENV, shutting_down=shutting_down)


def run_image_job(*, job_id, data, root, resident, inference_lock, revision, cancelled=lambda: False, lock_fd=None, timeout=600):
    decode_request(data)
    if not re.fullmatch(r'[a-f0-9]{32}', job_id or '') or not revision or len(revision) > 128:
        raise ValueError('Invalid image job identity.')
    root, inference_lock = Path(root), Path(inference_lock)
    if not root.is_absolute() or not inference_lock.is_absolute():
        raise ValueError('Image worker paths must be absolute.')
    digest = hashlib.sha256(data).hexdigest()
    destination = root / job_id
    with (cpu_slot(root) if lock_fd is None else contextlib.nullcontext(lock_fd)):
        if cancelled():
            raise WorkerStopped('Image generation was cancelled.')
        recovered = destination.exists() or destination.is_symlink()
        if recovered:
            metadata = verify_result(destination, digest, revision)
        else:
            with gpu_lease(inference_lock), tempfile.TemporaryDirectory(prefix=f'.{job_id}-', dir=root) as temporary:
                stage = Path(temporary); accepted = stage / 'accepted'; accepted.mkdir()
                (stage / 'input.json').write_bytes(data)
                resident.render(input_path=stage / 'input.json', output_dir=accepted, timeout=timeout, cancelled=cancelled, job_label='image')
                metadata = verify_result(accepted, digest, revision)
                if cancelled():
                    raise WorkerStopped('Image generation was cancelled.')
                os.rename(accepted, destination)
        if cancelled():
            raise WorkerStopped('Image generation was cancelled.')
        return {**metadata, 'path': f'{job_id}/output.png', 'recovered': recovered}
