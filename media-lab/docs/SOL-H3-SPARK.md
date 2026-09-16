# Sol-H3-Spark — the whole-box H3 engine

Since 2026-09-14 the `h3` engine on the Spark is **Sol-H3-Spark**: a
`runner/sol_engine_server.py` wrapper that speaks Media Lab's H3 engine
contract (`GET /health`, `POST /generate`) on `127.0.0.1:8291`, run by
`app.py` as the transient user unit `media-lab-sol-h3.service`. It replaces
the `media-lab-h3-engine` Docker container.

What that means for the box:

* The engine takes ~110 GB of the 121 GiB unified pool
  (`config/model-residency-policy.json`: cold_load 112, warm_idle 110,
  sampler 113, decode 115, mux 1). Nothing else heavy co-resides with it.
* The chat model is served **remotely through the bridge**, so
  `MEDIA_LAB_QWEN_GB=0` and the pool ceiling is `MEDIA_LAB_MEM_CAP_GB=120`
  (both in `config/local.env`; the policy's `operational_floor_gb` is 3).
* A first boot can take most of `boot_wait` (30 min): the pipeline loads one
  task family (`t2va`, `fl2va`, `ref2va`) at a time and switching reloads.
* Output is always 1344x768, 121 frames, 24 fps; `frames/width/height` in a
  request are ignored.

## Configuration (`config/local.env`)

```
SOL_PKG=/path/to/Sol-H3-Spark            # the model package (cd here to run)
SOL_ROOT=~/.local/share/sol-h3-spark     # install root; envs/stage2/bin/python runs the server
SOL_H3_SPARK_RUNTIME_ROOT=~/.local/share/sol-h3-spark/runtime
SOL_H3_SPARK_QWEN_IMAGE=sol-h3-spark-qwen
SOL_H3_SPARK_QWEN_WEIGHTS_ROOT=~/.local/share
MEDIA_LAB_QWEN_GB=0
MEDIA_LAB_MEM_CAP_GB=120
```

`app.py` builds the unit's command line from these (`_sol_h3_command()`);
an empty `SOL_PKG` means the engine is not installed on this host and a boot
fails with that message instead of a stack trace. `H3_VARIANT` and
`H3_TURBO_PRESET` are passed with `systemd-run --setenv` when a job asks for
a specific variant. `SOL_PRELOAD` (task family to warm at start) and
`PYTORCH_CUDA_ALLOC_CONF` can be added to the unit's environment by hand
when experimenting; the app does not set them.

## Memory guard

`runner/memavail-watchdog.sh` samples `/proc/meminfo` and stops the unit
when `MemAvailable` stays below 8 GiB for 3 consecutive samples — the
memory-pressure mitigation, not a guarantee against GPU/IO wedges. The latch
remains evidence across unit starts; `systemctl --user start media-lab-sol-h3.service`
does NOT clear it. The wrapper refuses allocation while either the memory latch
or `SOL_ROOT/safety-stop.json` exists. Preserve and review both before a separately
approved clearance procedure; unit start is never clearance. A new boot also
requires separately approved boot-bound clearance. See `sol-h3-safety.md` and
`boot-safe-recovery.md`. Do not enable/restart services as an incident diagnostic.

```sh
cp config/solh3-memwatch.service config/solh3-memwatch.timer ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable --now solh3-memwatch.timer
tail -f ~/logs/memwatch.log
```
