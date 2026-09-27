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
  Like an H3 job, that idle reload first stands every idle companion down
  (an idle image ComfyUI shell alone holds ~2.4 GiB, enough to fail the
  planner's H3 decode floor).
* Every H3 cold load first waits, at most `MEDIA_LAB_H3_LOAD_SETTLE_MAX_WAIT_S`
  seconds (default 120), until memory pressure (PSI `full avg10`, the signal the
  guard trips on) is at most `MEDIA_LAB_H3_LOAD_SETTLE_MAX_PSI` (default 2) and
  MemAvailable has stopped moving. The guard itself is unchanged.
* Each H3 cold load appends one line to `pool/h3-load-pressure.jsonl`: peak
  PSI, the longest run of one-second samples at the guard's PSI limit, lowest
  MemAvailable, swap growth, and load time. Use it before any guard retune.

Every H3 reload is still a full cold load with the same guard exposure, and a
guard trip still leaves a recovery hold for an operator.

## Real / Long (H3 Singularity), the load-on-demand H3

Sol stays the always-warm, fast H3 (about 70 s a clip, always 5.04 s at
1344x768). **Real / Long** is the community H3 Singularity checkpoint rendered
with the dual-sampling recipe (`runner/h3_singularity.py`): text plus up to 9
reference pictures, 3 reference videos and 3 reference sounds; portrait,
landscape or square; 5 to 15 s. It holds faces and skin texture and costs about
4x Sol's time (measured on the 128 GB host, lean weight set):

| Take | Time |
|---|---|
| 5 s, loaded | ~285 s |
| 5 s, two max-detail references | ~490 s |
| 15 s, one reference | ~1170 s |
| first take after Sol (load) | + ~7 min |

How it runs:

* It is the same unit, lease and guard as Sol: `media-lab-sol-h3.service`
  started with `H3_VARIANT=singularity` and the GPU task family `singularity`
  (capacity row `h3/singularity` in `config/gpu-capacity-receipts.json`: peak
  ~97 GiB, idle ~75 GiB). The engine server starts an isolated ComfyUI as its
  child, so the unit's cgroup and the guard's exact-cgroup stop cover it.
* It never sits beside Sol. A Real / Long take evicts Sol; the queue runs every
  queued take of the resident variant before switching. When no queued take
  needs it and it has idled `MEDIA_LAB_H3_SINGULARITY_LINGER_S` (default
  600 s), the reaper stops it and the idle reconciler restores warm Sol t2va.
* H3 reference jobs (pictures, motion videos) route to Real / Long on hosts that
  have it, because Sol's Ref2VA needs a 120 GiB row a 128 GB box cannot give.
* After each take the engine measures lip sync with SyncNet
  (`runner/av_sync_measure.py`, CPU) and removes that take's own audio lag at
  the mux (`media_lab_core/av_sync.py`). Raw H3 takes put the sound 16-34 ms
  (Singularity) and ~50 ms (Sol) after the lips; the job keeps the receipt in
  `av_sync`. A take without a clear face or with low confidence is left as is.
* The model picker shows each engine's estimated time for the chosen length
  and references, including the load when the engine is not resident
  (`GET /api/engines/eta`, numbers in `config/render-eta.json`, refreshed from
  completed takes in `pool/render-timings.json`).

Enable it on a host whose use fits the licences (`h3-singularity` in
`MEDIA_LAB_PERSONAL_ENGINES`, plus the `H3_SINGULARITY_*` and
`MEDIA_LAB_AV_SYNC_*` keys in `config/local.env.example`).

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
