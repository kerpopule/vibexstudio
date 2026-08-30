#!/usr/bin/env bash
# Media Lab pool lock manager. Usage: pool_lock.sh acquire|release
# One transient unit (media-lab-pool.service) holds the canonical GPU flock
# while ANY warm engine is resident, replacing the old reservation pattern.
# Uses the proven override-toggle recipe (reservation service is RefuseManualStart;
# the ONLY working restore is: move override aside, daemon-reload, reset-failed,
# systemd-run flock holder, move override back, daemon-reload).
set -Eeuo pipefail
LOCK=/run/user/1000/spark-gpu.lock
OVERRIDE=$HOME/.config/systemd/user/media-lab-gpu-reservation.service.d/override.conf
CMD=${1:?acquire|release}

case "$CMD" in
  acquire)
    if systemctl --user is-active --quiet media-lab-pool.service; then echo OK; exit 0; fi
    if systemctl --user is-active --quiet media-lab-gpu-reservation.service; then
      # Reservation holds the lock (GPU idle-reserved): take over via override toggle.
      mv "$OVERRIDE" "$OVERRIDE.pool"; systemctl --user daemon-reload
      systemctl --user stop media-lab-gpu-reservation.service
      mv "$OVERRIDE.pool" "$OVERRIDE"; systemctl --user daemon-reload
    elif ! flock -n "$LOCK" -c true; then
      # The lock is held while NEITHER of our units is active. That is either an
      # outside production batch (leave it alone) or — the case that stalled
      # every H3 take on 2026-08-17 — a stale holder left behind by a transient
      # unit that died, which nothing will ever clean up. Reclaim only holders
      # that match our own "flock <lock> sleep infinity" pattern.
      for p in $(fuser "$LOCK" 2>/dev/null); do
        cmd=$(ps -o cmd= -p "$p" 2>/dev/null || true)
        case "$cmd" in
          *flock*"$LOCK"*sleep*)
            echo "reclaiming stale lock holder pid $p" >&2
            kill "$p" 2>/dev/null || true ;;
        esac
      done
      sleep 1
      if ! flock -n "$LOCK" -c true; then
        # still held -> genuinely someone else's GPU
        echo BUSY; exit 62
      fi
    fi
    systemctl --user reset-failed media-lab-pool.service >/dev/null 2>&1 || true
    systemd-run --user --unit=media-lab-pool.service --property=Restart=always \
      --property=RestartSec=2s /usr/bin/flock "$LOCK" /usr/bin/sleep infinity >/dev/null
    for i in $(seq 1 20); do
      flock -n "$LOCK" -c true || { echo OK; exit 0; }
      sleep 0.5
    done
    echo FAIL; exit 63
    ;;
  release)
    systemctl --user stop media-lab-pool.service >/dev/null 2>&1 || true
    systemctl --user reset-failed media-lab-pool.service >/dev/null 2>&1 || true
    if ! systemctl --user is-active --quiet media-lab-gpu-reservation.service; then
      mv "$OVERRIDE" "$OVERRIDE.pool"; systemctl --user daemon-reload
      systemctl --user reset-failed media-lab-gpu-reservation.service >/dev/null 2>&1 || true
      systemd-run --user --unit=media-lab-gpu-reservation.service --property=Restart=always \
        --property=RestartSec=2s /usr/bin/flock "$LOCK" /usr/bin/sleep infinity >/dev/null 2>&1 || true
      mv "$OVERRIDE.pool" "$OVERRIDE"; systemctl --user daemon-reload
    fi
    echo OK
    ;;
  *) echo "unknown command $CMD"; exit 2;;
esac
