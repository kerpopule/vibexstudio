# H3 → LTX 2.5 two-stage video

The `h3-ltx25` model is one visible Media Lab queue job with two fenced GPU stages.
It is private/local only and does not change public endpoints, customer routes, or
the idle residency target.

## Pipeline contract

1. Stage A boots Sol-H3-Spark through the durable GPU controller and renders one
   five-second 1344×768 draft. The controller preserves any approved H3 image or
   motion references.
2. Before H3 can be evicted, Media Lab copies the non-empty MP4 to
   `jobs/<job-id>/stage-a-h3.mp4` and records its SHA-256.
3. Media Lab stages a basename-only copy under `pool/ltx-out/inputs/`. The LTX
   container cannot accept an arbitrary path.
4. The normal fenced engine transition parks H3, verifies cleanup/capacity, then
   starts LTX 2.5. LTX uses its installed native `retake_video` pipeline over the
   complete H3 clip. `regenerate_audio=false` prevents LTX soundtrack generation.
5. Media Lab then stream-copies the refined LTX video with the Stage A H3 audio
   track into `jobs/<job-id>/stage-b-ltx-with-h3-audio.mp4`. A missing source
   audio track or failed remux fails closed; raw LTX audio is never published as
   the preserved H3 soundtrack.
6. The muxed MP4 passes through the existing `_finish_video` publication path.
   Media Lab returns the durable controller to its configured idle residency
   using the existing queue finalizer.

Both stages use one seed. The operator-facing refinement prompt is defined by
`H3_LTX_REFINEMENT_PROMPT` in `app.py`. The native-retake strength defaults to
`0.35` and can be set per host in untracked `config/local.env`:

    MEDIA_LAB_H3_LTX_RETAKE_STRENGTH=0.35

The value is clamped to `0.01..1.0`; invalid text falls back to `0.35`.

## Receipt and failure semantics

`jobs/<job-id>/h3-ltx-receipt.json` is written atomically. It records:

- pipeline and queue job ID;
- exact prompt and seed;
- requested dimensions/frame counts;
- stage engine names and refinement settings;
- Stage A, raw LTX, and remuxed Stage B artifact names and SHA-256 values;
- the Stage A audio source artifact/hash used by the remux;
- status, failed stage, and bounded error detail.

Stage A failure never starts LTX. Stage B failure preserves
`stage-a-h3.mp4` for diagnosis and retry; it never silently publishes the H3
artifact as the requested refined result. A missing/empty artifact fails its
stage. Cancellation follows `active_engine`, so an in-flight Stage B stop targets
LTX rather than the no-longer-resident H3 engine.

## Verification

Focused local contract:

    uv run --with pytest pytest -q tests/test_h3_ltx_two_stage.py \
      tests/test_h3_timeout_recovery.py \
      tests/test_retry_evidence_boundaries.py \
      tests/test_engine_transition_boundaries.py \
      tests/test_durable_gpu_protocol.py

A Spark canary is valid only when the deployed tagged source includes this
route, the normal queue accepts `model=h3-ltx25`, both receipt stages are
complete, both media artifacts are non-empty, the final MP4 has video and audio,
and the configured idle residency is restored after the job. Do not bypass the
queue or either GPU lock to obtain a canary.
