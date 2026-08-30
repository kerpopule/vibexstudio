# Installation and onboarding product specification

## Experience target

### Human terminal path

```text
$ media-lab setup

✓ DGX Spark detected: GB10 / 128 GB unified memory / CUDA 13
✓ 1.4 TB free in model storage

Choose video engines:
  [x] LTX-2.5 — Balanced speed; strong motion and cinematic continuity
  [x] H3 FL2VA — Slower; strong native audio and multimodal control
  [ ] H3 Ref2VA — Adds reference identity/style/video/audio weights

Choose image engines:
  [x] FLUX Dev — Recommended for source-frame and likeness preparation
  [ ] Qwen Image Edit — Strong instruction editing and useful text rendering

Choose speech/audio:
  [x] Local speech

Choose setup/chat models:
  [x] Qwen 27B NVFP4 — Recommended fastest promoted 27B Spark profile
  [ ] Qwen 27B alternate variant — Similar class; separate behavior/safety evaluation

Download: … GB  |  Maximum measured residency: … GB  |  Runtime swaps: video, image, LLM
```

Every displayed number comes from the signed catalog and qualification receipts. Unknown values block selection rather than rendering as estimates.

### Agent-driven path

The user gives the repository URL to an agent. The agent reads `docs/external-agent-setup.md`, runs machine inspection and the same deterministic planner, shows the proposed plan, gathers direct user acceptance for gated terms, executes resumable stages, and reports the setup receipt. Agent-driven installation and terminal installation invoke the same APIs and state machine.

## Capability catalog

Each option contains:

- stable capability ID and display name;
- category and supported generation modes;
- concise speed, quality, and best-use summary;
- exact platform/hardware compatibility;
- measured disk bytes and phase-specific memory floor;
- dependencies and mutually resident/swap group;
- exact source, immutable revision, artifact SHA-256;
- code and weight license identifiers and terms URL;
- gated-access/acceptance state;
- qualification status and receipt revision;
- installer adapter and uninstall behavior.

Only `qualified` entries with complete immutable metadata become selectable. Experimental/planned/blocked entries can appear under an advanced transparency view but cannot install.

## Packs without hiding individual choices

Offer one-click presets as selections over the same catalog:

- **Starter Studio:** one video engine, recommended image engine, local speech, setup LLM.
- **Video Studio:** LTX plus H3 FL2VA; optional Ref2VA.
- **Full Studio:** every qualified media capability that fits the machine.
- **Custom:** individual selections.

Presets never override license gates, hardware fit, or swap constraints.

## Deterministic installer stages

1. **Bootstrap:** verify supported Python/OS and run a signed or checksummed installer entrypoint.
2. **Inspect:** record hardware, driver/CUDA, memory, disk, container runtime, ports, and permissions.
3. **Plan:** resolve dependencies, download bytes, runtime swap groups, and measured phase floors.
4. **Terms:** present every distinct code/model license and gated source; record consent locally without committing protected receipts.
5. **Fetch:** resumable downloads into staging with bounded retries.
6. **Verify:** expected bytes, SHA-256, SafeTensor metadata, archive path containment, and source revision.
7. **Install:** atomic move into a content-addressed model store; isolated adapter/runtime installation.
8. **Preflight:** architecture, package/ABI, kernel backend, writable persistent caches, ports, and memory admission.
9. **Qualify:** deterministic minimal tracer for each selected backend under the shared GPU scheduler.
10. **Register:** enable only exact manifest matches; otherwise leave disabled with a repair receipt.
11. **Launch:** app liveness/readiness plus capability health.
12. **Onboard:** deterministic questions first; optional local Qwen conversation for preferences and explanations.
13. **Receipt:** installed/skipped/blocked capabilities and rollback/uninstall instructions.

Every stage is idempotent and resumable. Interrupting a download or qualification run does not corrupt the prior working setup.

## Local Qwen onboarding

The local model is an enhancement, not a bootstrap dependency. The app can open with a setup chat after deterministic installation:

> Your core studio is working. I have a few preferences to finish setup: Which video engine should be the default? Do you prefer faster previews or maximum quality? What output orientation do you use most? How long should Media Lab retain source files and failed candidates?

The model receives a typed setup schema and produces a proposed patch. The deterministic controller validates it and shows the user the resulting actions before application. Free-form model output never directly executes shell commands or mutates services.

If Qwen cannot load, the same questions render as a standard form. Setup remains fully usable.

## Model swapping

Installing both models does not imply simultaneous residency. The catalog declares swap groups such as `video-engine`, `image-engine`, and `llm-residency`. The lifecycle manager:

1. inspects the active owner;
2. acquires the canonical GPU lease;
3. drains the exact service;
4. stops only that owner;
5. starts the requested immutable manifest;
6. verifies actual identity/readiness;
7. runs or queues work;
8. restores the prior desired state when policy requires it.

The UI says **Installed** separately from **Loaded now**.

## Release acceptance criteria

- Clean supported machine reaches the app from one documented command.
- Human and agent paths produce the same deterministic install plan.
- All downloads are revision- and hash-pinned.
- Interrupted setup resumes safely.
- No agent or LLM can accept terms for the user.
- Unqualified/unsupported options fail before download or GPU work.
- Both-engine installs can swap repeatedly without stale residency or lock leakage.
- The app works without the optional setup LLM.
- Every selected engine completes its tracer and reports its actual manifest.
- Uninstall removes application/runtime state selected by the user without deleting shared models or user media unexpectedly.
