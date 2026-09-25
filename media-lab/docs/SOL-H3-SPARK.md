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

## Keeping H3 warm

Set the idle residency profile to `qwen-h3` (`pool/residency/desired.json`,
or `POST /api/residency/apply`) to keep H3 loaded between jobs. Set it back
to `qwen-ltx-default` to make LTX the idle engine again; that is the on/off
switch.

* The idle reaper never unloads an engine the idle profile keeps resident.
  Before 2026-09-25 it stopped H3 after an idle hour and the idle reconciler
  reloaded it a minute later, a cold load about every 67 minutes; one of those
  loads tripped the memory guard and left a studio-wide recovery hold.
* The idle preload boots `MEDIA_LAB_H3_IDLE_TASK` (default `t2va`). A text-only
  H3 job then reuses the warm engine (about 70 s per clip) instead of paying a
  5-7 minute task switch. First/last-frame and reference jobs still switch.
* Image, voice, music and LTX jobs still push H3 out: nothing heavy fits beside
  it. While H3 is warm, every queued H3 take runs first. Once H3 is out, the
  rest of the non-H3 work runs before H3 is reloaded (an H3 take waits at most
  `MEDIA_LAB_H3_BATCH_MAX_WAIT_S`, default 900 s), and the idle reload starts
  only after no local GPU job has finished for `MEDIA_LAB_H3_RESTORE_QUIET_S`
  seconds (default 300). A queued H3 job never waits for that: it loads H3.
* Every H3 cold load first waits, at most `MEDIA_LAB_H3_LOAD_SETTLE_MAX_WAIT_S`
  seconds (default 120), until memory pressure (PSI `full avg10`, the signal the
  guard trips on) is at most `MEDIA_LAB_H3_LOAD_SETTLE_MAX_PSI` (default 2) and
  MemAvailable has stopped moving. The guard itself is unchanged.
* Each H3 cold load appends one line to `pool/h3-load-pressure.jsonl`: peak
  PSI, the longest run of one-second samples at the guard's PSI limit, lowest
  MemAvailable, swap growth, and load time. Use it before any guard retune.

Every H3 reload is still a full cold load with the same guard exposure, and a
guard trip still leaves a recovery hold for an operator.

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
