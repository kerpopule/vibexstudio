#!/usr/bin/env python3
"""Sol-H3-Spark wrapper speaking Media Lab's H3 engine contract on 127.0.0.1:8291.
GET /health -> {ok, engine:"h3", loaded, busy, variant, turbo_preset, fused_combined, attention, cache}
POST /generate -> {ok, file, seed, elapsed, cached}; writes <OUT_DIR>/job-<request_id>.mp4
Task mapping: references/video_references -> ref2va; start_image_b64 -> fl2va (first frame); else t2va.
Output is always 1344x768, 121 frames, 24 fps (Sol-H3-Spark frozen geometry); frames/width/height are ignored.
One resident Pipeline per task family; switching task reloads (minutes)."""
import os, sys, json, base64, time, threading, re, shutil, traceback
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
from media_lab_core import local_config   # config/local.env, stdlib only
PKG = os.environ["SOL_PKG"]; SOL_ROOT = os.environ["SOL_ROOT"]; RUNTIME = os.environ["SOL_H3_SPARK_RUNTIME_ROOT"]
OUT_DIR = os.environ.get("SOL_OUT_DIR", str(local_config.home() / "pool/h3-out"))
VARIANT = os.environ.get("H3_VARIANT", "fl2va")
TURBO = os.environ.get("H3_TURBO_PRESET") or None
PORT = int(os.environ.get("SOL_PORT", "8291"))
sys.path.insert(0, PKG)
from runtime.config import load_paths
from runtime.pipeline import Pipeline
for d in (OUT_DIR, f"{RUNTIME}/inputs", f"{RUNTIME}/outputs"): os.makedirs(d, exist_ok=True)
STATE = {"pipe": None, "task": None, "busy": False, "loaded": False, "started": time.time(), "renders": 0, "errors": 0, "last_error": None}
LOCK = threading.Lock()
def log(*a): print(time.strftime("%H:%M:%S"), *a, flush=True)
def _png(path, size, color):
    from PIL import Image
    Image.new("RGB", size, color).save(path); return path
def warm_case(task):
    if task == "fl2va":
        fp = _png(f"{RUNTIME}/inputs/warm-first.png", (1344, 768), (32, 32, 32))
        return {"case_id": "warm", "task": task, "seed": 1, "first_frame": fp, "prompt": "integrated_multimodal_description: A calm dark scene. overall_soundscape: silence."}
    if task == "ref2va":
        fp = _png(f"{RUNTIME}/inputs/warm-ref.png", (672, 384), (96, 96, 96))
        return {"case_id": "warm", "task": task, "seed": 1, "references": [{"type": "image", "path": fp}], "prompt": "subject_definitions: <Subject 1> is the shape in <Picture 1>. detailed_description: <Subject 1> stays still. overall_soundscape: silence."}
    return {"case_id": "warm", "task": "t2va", "seed": 1, "prompt": "A calm wide shot of a quiet meadow at dawn. overall_soundscape: soft wind."}
def ensure_pipeline(task):
    if STATE["pipe"] is not None and STATE["task"] == task: return STATE["pipe"]
    if STATE["pipe"] is not None:
        log("switching task", STATE["task"], "->", task, "(reload)")
        try: STATE["pipe"].finish(); STATE["pipe"].close()
        except Exception as e: log("close error", e)
        STATE["pipe"] = None; STATE["loaded"] = False
    paths = load_paths(f"{SOL_ROOT}/paths-{task}.json", task=task)
    outdir = f"{RUNTIME}/outputs/svc-{task}-{int(time.time())}"
    p = Pipeline(paths, outdir, task=task); t0 = time.time()
    p.start(warm_case(task)); log(f"pipeline {task} ready in {time.time()-t0:.0f}s")
    STATE.update(pipe=p, task=task, loaded=True, outdir=outdir); return p
def b64_to_file(b64, name):
    fp = f"{RUNTIME}/inputs/{name}"; open(fp, "wb").write(base64.b64decode(b64)); return fp
def find_mp4(rid):
    for root in ([STATE.get("outdir")] if STATE.get("outdir") else []) + [f"{RUNTIME}/outputs"]:
        for dp, dn, fn in os.walk(root):
            if dp.endswith(f"/{rid}/stage2"):
                for f in fn:
                    if f.endswith(".mp4"): return os.path.join(dp, f)
    return None
class H(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    def log_message(self, *a): pass
    def _send(self, code, obj):
        b = json.dumps(obj).encode(); self.send_response(code); self.send_header("Content-Type", "application/json"); self.send_header("Content-Length", str(len(b))); self.end_headers(); self.wfile.write(b)
    def do_GET(self):
        if self.path.startswith("/health"):
            return self._send(200, {"ok": True, "engine": "h3", "impl": "sol-h3-spark", "loaded": STATE["loaded"], "busy": STATE["busy"], "variant": VARIANT, "task": STATE["task"], "turbo_preset": TURBO, "fused_combined": False, "attention": "sol", "cache": {"renders": STATE["renders"], "errors": STATE["errors"], "last_error": STATE["last_error"]}, "uptime": int(time.time()-STATE["started"])})
        self._send(404, {"ok": False, "error": "not found"})
    def do_POST(self):
        if not self.path.startswith("/generate"): return self._send(404, {"ok": False, "error": "not found"})
        n = int(self.headers.get("Content-Length") or 0); req = json.loads(self.rfile.read(n) or b"{}")
        prompt = (req.get("prompt") or "").strip(); rid = str(req.get("request_id") or f"r{int(time.time())}")
        if not prompt: return self._send(400, {"ok": False, "error": "bad request: prompt required"})
        if not re.fullmatch(r"[A-Za-z0-9._-]{1,128}", rid): return self._send(400, {"ok": False, "error": "bad request: request_id"})
        out = f"{OUT_DIR}/job-{rid}.mp4"
        if os.path.exists(out): return self._send(200, {"ok": True, "file": os.path.basename(out), "seed": req.get("seed"), "elapsed": 0, "cached": True})
        if not LOCK.acquire(blocking=False): return self._send(409, {"ok": False, "error": "busy"})
        STATE["busy"] = True; t0 = time.time()
        try:
            refs = req.get("references") or []; vrefs = req.get("video_references") or []; seed = int(req.get("seed") or 0)
            if refs or vrefs:
                task = "ref2va"; rl = [{"type": "image", "path": b64_to_file(r["b64"], f"{rid}-ref{i}.png")} for i, r in enumerate(refs)]
                rl += [{"type": "video", "path": v["file"]} for v in vrefs[:3]]
                if req.get("audio_wav_b64"): rl.append({"type": "audio", "path": b64_to_file(req["audio_wav_b64"], f"{rid}-audio.wav")})
                subj = " ".join(f"<Subject {i+1}> is the person in <Picture {i+1}>." for i in range(len(refs)))
                case = {"case_id": rid, "task": task, "seed": seed, "references": rl, "prompt": f"subject_definitions: {subj} detailed_description: {prompt}"}
            elif req.get("start_image_b64"):
                task = "fl2va"; case = {"case_id": rid, "task": task, "seed": seed, "first_frame": b64_to_file(req["start_image_b64"], f"{rid}-first.png"), "prompt": f"integrated_multimodal_description: {prompt}"}
                if req.get("end_image_b64"): case["last_frame"] = b64_to_file(req["end_image_b64"], f"{rid}-last.png")
            else:
                task = "t2va"; case = {"case_id": rid, "task": task, "seed": seed, "prompt": prompt}
            log("generate", rid, task); p = ensure_pipeline(task); row = p.generate(case)
            src = None
            if isinstance(row, dict):
                for k in ("output", "file", "video", "mp4"):
                    if row.get(k) and os.path.exists(str(row[k])): src = str(row[k]); break
            src = src or find_mp4(rid)
            if not src: raise RuntimeError(f"no mp4 produced for {rid}: {str(row)[:300]}")
            shutil.copyfile(src, out); STATE["renders"] += 1
            self._send(200, {"ok": True, "file": os.path.basename(out), "seed": seed, "elapsed": round(time.time()-t0, 1), "cached": False, "task": task})
        except Exception as e:
            STATE["errors"] += 1; STATE["last_error"] = str(e)[:300]; log("ERROR", traceback.format_exc()); self._send(500, {"ok": False, "error": str(e)[:500]})
        finally:
            STATE["busy"] = False; LOCK.release()
if __name__ == "__main__":
    log(f"sol engine server :{PORT} variant={VARIANT} pkg={PKG}")
    pre = os.environ.get("SOL_PRELOAD") or ("ref2va" if VARIANT == "ref2va" else "fl2va")
    if pre: threading.Thread(target=lambda: ensure_pipeline(pre), daemon=True).start()
    ThreadingHTTPServer(("127.0.0.1", PORT), H).serve_forever()
