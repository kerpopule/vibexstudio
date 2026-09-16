# Sol H3 loader safety

The wrapper serializes preload, family switching, and generation with one reentrant lock. A cold preload must not race a generate request into a second heavyweight pipeline. Health marks startup as `loading=true,busy=true` rather than implying inference readiness.

`Pipeline.finish()` is report finalization, not teardown. It can reject a warm-only or failed batch. Teardown must still call `close()` and verify the known worker processes and their process groups are gone before loading another family. Unknown or surviving workers fail closed; no broad process killing is used by the wrapper's verification.

## Sticky failure boundary

A transition or generation exception sets an in-process block and atomically writes `safety-stop.json` beneath the configured `SOL_ROOT`. A subsequent process also honors this marker. The wrapper additionally honors the existing `flashnext-memwatch.latch` under `XDG_RUNTIME_DIR` (legacy watchdog compatibility). Health returns 503 with `blocked=true` while latched. New allocation is refused, but existing cached successful output can still be returned.

The marker records only reason, exception type, PID, task family, and timestamp. It does not contain a prompt or credentials. Failure to persist is logged and still blocks the running process; a filesystem failure or abrupt kill before a marker is written is not durable recovery proof.

The memory watchdog retains its marker but can stop a newly active service under pressure again. A stale marker no longer makes it ignore a controller relaunch. This is a last-resort stop, not an admission allocator.

## Recovery requires an operator gate

Do not clear a marker merely because a TCP socket opens, systemd reports active, or MemAvailable momentarily rises. Preserve journal, worker diagnostics, memory/pressure samples and queue checkpoints first. Quiesce approved work through the controller. Verify worker groups are gone, driver allocation/hung-task errors are not continuing, and the exact task-family phase budget fits with the approved operating margin. Preserve markers before approved clearing; never delete jobs or media to recover memory.

The app owns the cross-process inference transaction and pool lease. The reentrant lock here is only intra-process protection, not a replacement for those locks or protection against unmanaged GPU consumers. Do not acquire the app-held inference lock a second time inside this wrapper.

No automatic canary or job resubmission is part of this change. Memory estimates and the OS reserve are intentionally unchanged: only an approved, instrumented single-load qualification can establish whether a larger reserve and revised phase estimates fit the hardware. Controller retry policy and reliable terminal-state notification remain separate responsibilities.

## Fixture verification (no GPU/runtime import)

Run from `media-lab` with the project's test dependencies installed:

    python -m pytest -q tests/test_sol_engine_safety.py tests/test_memavail_watchdog.py tests/test_residency.py tests/test_residency_runtime.py tests/test_h3_timeout_recovery.py

Fake pipelines reproduce concurrent construction, finish-before-close leakage, partial-start cleanup, surviving worker/group rejection, sticky retry blocking across fresh process state, loading/blocked health, and generation failure. Watchdog tests execute the real shell script against stub commands; no real systemctl call or GPU load occurs.
