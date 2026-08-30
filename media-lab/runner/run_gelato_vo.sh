#!/usr/bin/env bash
# Wait for the media-lab queue to go idle, then render the gelato voiceover
# in a hermetic chatterbox container. Coordinates with the warm pool by
# waiting for idle (the pool holds the canonical lock; compute is serialized
# through the app queue — we slot in only when nothing is rendering).
set -Eeuo pipefail
D=$HOME/.local/share/media-lab-tts/chatterbox
OUT=$HOME/mv-production/gelato-vo
WORK=$HOME/mv-production/gelato-vo-work
mkdir -p "$OUT" "$WORK/out"
cp "$HOME/mv-production/gelato-vo-copy.txt" "$WORK/copy.txt"
for i in $(seq 1 720); do
  N=$(curl -s -m 5 http://YOUR_TAILNET_IP:7863/api/queue | python3 -c 'import json,sys; print(len(json.load(sys.stdin).get("active",[])))' 2>/dev/null || echo 99)
  [ "$N" = 0 ] && break
  sleep 30
done
[ "$N" = 0 ] || { echo "QUEUE_NEVER_IDLE"; exit 61; }
echo "QUEUE_IDLE — rendering VO"
docker run --rm --name media-lab-tts-oneshot --gpus all --network none --ipc host \
  --user 1000:1000 --cap-drop ALL --security-opt no-new-privileges --pids-limit 4096 \
  --tmpfs /tmp:rw,exec,nosuid,nodev,size=8g \
  --env HOME=/tmp --env HF_HUB_OFFLINE=1 --env TRANSFORMERS_OFFLINE=1 \
  --mount "type=bind,src=$D,dst=/models/chatterbox,readonly" \
  --mount "type=bind,src=$D,dst=/opt/maestro/app/app/chatterbox,readonly" \
  --mount "type=bind,src=$HOME/media-lab-simple/runner/tts_chatterbox_oneshot.py,dst=/work/tts.py,readonly" \
  --mount "type=bind,src=$WORK/copy.txt,dst=/work/copy.txt,readonly" \
  --mount "type=bind,src=$WORK/out,dst=/work/out" \
  --entrypoint python3 maestro-v1.8.0-h3-r13:t_b05cae84 /work/tts.py
cp "$WORK"/out/vo-*.wav "$OUT/"
ls -la "$OUT"
