# Sol-H3-Spark — the whole-box H3 engine

Since 2026-09-14 the `h3` engine on the Spark is **Sol-H3-Spark**: a
`runner/sol_engine_server.py` wrapper that speaks Media Lab's H3 engine
contract (`GET /health`, `POST /generate`) on `127.0.0.1:8291`, run by
the dormant-loaded user unit `media-lab-sol-h3.service`. Media Lab writes an
exact lease-bound environment under `$XDG_RUNTIME_DIR` and starts that static
unit only after the independent control-plane guard grants fresh same-boot
admission. It replaces the `media-lab-h3-engine` Docker container.

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

`app.py` writes expanded host paths plus the exact lease delegation into the
mode-0600 runtime environment consumed by `config/media-lab-sol-h3.service`;
an empty `SOL_PKG` means the engine is not installed on this host and admission
fails without starting the unit. `H3_VARIANT`, `H3_TURBO_PRESET`, and
`SOL_PRELOAD` are written for the exact requested load. See
[Sol-H3 cold-load control-plane liveness](solh3-control-plane-liveness.md).

## Memory guard

`runner/memavail-watchdog.sh` remains a legacy last-resort sample, but the
liveness boundary is now `solh3-control-plane-guard.service`: a one-second
independent observer for MemAvailable, H3-session swap growth, and memory PSI
with exact-cgroup bounded termination. The legacy latch remains durable evidence
and never authorizes a restart. The static H3 unit also refuses admission unless
the guard heartbeat is fresh and bound to the current boot. See
`solh3-control-plane-liveness.md` for installation, receipt, rollback, and the
separately approved canary gate.

```sh
cp config/solh3-memwatch.service config/solh3-memwatch.timer ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable --now solh3-memwatch.timer
tail -f ~/logs/memwatch.log
```
