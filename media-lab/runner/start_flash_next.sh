#!/usr/bin/env bash
# Qwen3.8-Flash-Next UD-IQ1_M on the pinned Qwen4-exp llama.cpp runtime.
# Flash is an idle Director/Hermes runtime; it must not overlap a video engine
# until a measured sampler canary proves the 24-GiB operational floor.
set -Eeuo pipefail
MODEL_DIR=/home/medialab/models/Qwen3.8-Flash-Next-UD-IQ1_M
MODEL_REL=UD-IQ1_M/Qwen3.8-Flash-Next-UD-IQ1_M-00001-of-00003.gguf
IMAGE=media-lab-qwen-flash-next:pr27742-035e2273
MAX_LEN=${FLASH_NEXT_MAX_LEN:-65536}

[[ -f "$MODEL_DIR/$MODEL_REL" && -f "$MODEL_DIR/MEDIA-LAB-RECEIPT.json" ]]
docker image inspect "$IMAGE" >/dev/null
if docker ps --format '{{.Names}}' | grep -Eq '^(qwen38-vllm|media-lab-ltx-engine|media-lab-h3-engine)$'; then
  echo "refusing Flash-Next start while PPLX or a video engine is running" >&2
  exit 72
fi

docker rm -f qwen38-flash-next >/dev/null 2>&1 || true
exec docker run -d --name qwen38-flash-next --restart unless-stopped --init \
  --device nvidia.com/gpu=all --ipc=host \
  -p 127.0.0.1:8004:8000 -p YOUR_TAILNET_IP:8004:8000 \
  -v "$MODEL_DIR":/models/active:ro \
  --entrypoint /opt/qwen-flash-next/llama-server \
  "$IMAGE" \
  -m "/models/active/$MODEL_REL" \
  --host 0.0.0.0 --port 8000 --alias qwen3.8-flash-next-ud-iq1-m,media-lab-text \
  -c "$MAX_LEN" -np 1 -ngl all --jinja --metrics --flash-attn on
