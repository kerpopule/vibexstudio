# Credits

Media Lab stands on a lot of great work. Some of this attribution is
required by licenses; most of it is here because we believe in crediting
what we build on, whether required or not.

## Engines & models (referenced, not bundled)

No model weights ship in this repository. The app orchestrates engines the
owner installs and licenses themselves:

- **Maestro / WanGP** by deepbeepmeep — the video-engine runtime our H3
  engine container is a pinned fork of.
- **MiniMax H3** — video generation model. Separately licensed; private
  single-machine use only. This repo contains integration code, never the
  model.
- **LTX-Video** by Lightricks — fast video generation engine.
- **ComfyUI** and its node ecosystem — image and music pipelines.
- **Qwen** (Alibaba) — image editing and on-box chat.
- **FLUX / FLUX Kontext** by Black Forest Labs — image generation/editing.
- **fal.ai** — optional cloud rendering provider (bring your own key).

## Ideas & prior art

- **minimax-h3-prompt-composer** by BMB12d3 — camera-path planning and H3
  prompt-composition ideas informed our tooling. That repo has no license,
  so we adapted ideas only, never code.
- The **malcolmrey** community character index informed the known-characters
  feature (the index itself is not distributed here).
- Countless prompt techniques came from the open AI-video community on X —
  individual templates carry their source in their own `usage_note` /
  attribution fields where known.

## Design & type

- **Space Grotesk** by Florian Karsten and **Barlow** by Jeremy Tribby —
  both under the SIL Open Font License, served via Google Fonts.
- The Co-Agent NOIR design language grew out of our own gsgelato and
  co-agent.us design systems.

## Foundation

- **FastAPI**, **Uvicorn**, **Pydantic** — the server.
- The original `media-lab-simple` was built for a single NVIDIA DGX Spark,
  and this studio fork keeps that heritage.

If you see your work here uncredited, open an issue — we'll fix it.
