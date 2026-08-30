#!/usr/bin/env python3
"""Media Lab Studio — local dev host.

Serves THIS repo's frontend (static/index.html, static/*, sw.js) from disk and
proxies every other route (/api/*, /media/*, /gate, /manifest.json, …) to the
live Media Lab on the Spark, cookies and all. That means the new UI runs
locally while jobs, galleries, characters and Sparky chat are the real thing.

    python3 local_studio.py            # http://127.0.0.1:7899
    UPSTREAM=https://media.source4ai.com python3 local_studio.py
"""
import http.server
import os
import ssl
import sys
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent
# Default: straight to the Spark over the tailnet — no Cloudflare 100s timeout,
# no edge bot checks, and the tailnet Host is trusted so there is no gate.
UPSTREAM = os.environ.get("UPSTREAM", "http://127.0.0.1:7863").rstrip("/")
PORT = int(os.environ.get("PORT", "7899"))
# 0.0.0.0 so tailnet devices (phone, Air) can open the Studio at this Mac's
# tailscale IP. The tailnet is the trust boundary, same as the Spark itself.
HOST = os.environ.get("HOST", "0.0.0.0")

HOP = {"connection", "keep-alive", "proxy-authenticate", "proxy-authorization",
       "te", "trailers", "transfer-encoding", "upgrade", "content-encoding",
       "content-length", "host", "accept-encoding"}

CTX = ssl.create_default_context()

# ---- transparent session ----------------------------------------------------
# Browsing is gate-free on the tailnet, but /api/chat requires the signed
# session cookie — which a phone that never visited /gate doesn't have. This is
# Steve's own private proxy, so it signs in once with the studio code (read
# over SSH from the Spark, never stored here) and quietly attaches the session
# to any request that lacks one.
SESSION_COOKIE = "mlab_access"
_session = {"value": None}


def _studio_session():
    if _session["value"]:
        return _session["value"]
    import json as _json
    import subprocess
    try:
        code = subprocess.run(
            ["ssh", "-o", "BatchMode=yes", "-o", "ConnectTimeout=5",
             "medialab@YOUR_TAILNET_IP", "cat media-lab-simple/access-code.txt"],
            capture_output=True, text=True, timeout=15).stdout.strip()
        if not code:
            return None
        req = urllib.request.Request(UPSTREAM + "/api/gate",
                                     data=_json.dumps({"code": code}).encode(),
                                     headers={"Content-Type": "application/json"})
        resp = urllib.request.urlopen(req, context=CTX, timeout=20)
        for k, v in resp.headers.items():
            if k.lower() == "set-cookie" and v.startswith(SESSION_COOKIE + "="):
                _session["value"] = v.split(";", 1)[0].split("=", 1)[1]
                break
    except Exception as e:
        sys.stderr.write(f"studio session sign-in failed: {e}\n")
    return _session["value"]


class Handler(http.server.BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    # ---- local files -----------------------------------------------------
    def _serve_file(self, rel: str, ctype: str):
        f = (ROOT / rel).resolve()
        if not str(f).startswith(str(ROOT)) or not f.is_file():
            self.send_error(404)
            return
        data = f.read_bytes()
        self.send_response(200)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-cache")
        self.end_headers()
        self.wfile.write(data)

    def _local(self, path: str) -> bool:
        if path in ("/", "/index.html"):
            self._serve_file("static/index.html", "text/html; charset=utf-8")
            return True
        if path == "/sw.js":
            self._serve_file("static/sw.js", "application/javascript")
            return True
        if path.startswith("/static/"):
            ext = path.rsplit(".", 1)[-1].lower()
            ctype = {"js": "application/javascript", "css": "text/css",
                     "png": "image/png", "gif": "image/gif", "jpg": "image/jpeg",
                     "jpeg": "image/jpeg", "webp": "image/webp", "svg": "image/svg+xml",
                     "json": "application/json", "woff2": "font/woff2",
                     "html": "text/html; charset=utf-8"}.get(ext, "application/octet-stream")
            self._serve_file(path.lstrip("/").split("?")[0], ctype)
            return True
        return False

    # ---- proxy -----------------------------------------------------------
    def _proxy(self):
        url = UPSTREAM + self.path
        length = int(self.headers.get("Content-Length") or 0)
        body = self.rfile.read(length) if length else None
        req = urllib.request.Request(url, data=body, method=self.command)
        for k, v in self.headers.items():
            if k.lower() not in HOP:
                req.add_header(k, v)
        req.add_header("Accept-Encoding", "identity")
        # attach the proxy's own signed session when the device has none
        if SESSION_COOKIE not in (self.headers.get("Cookie") or ""):
            tok = _studio_session()
            if tok:
                prior = self.headers.get("Cookie") or ""
                joined = (prior + "; " if prior else "") + f"{SESSION_COOKIE}={tok}"
                req.remove_header("Cookie")
                req.add_header("Cookie", joined)
        try:
            resp = urllib.request.urlopen(req, context=CTX, timeout=180)
        except urllib.error.HTTPError as e:
            resp = e
        except Exception as e:
            self.send_error(502, f"upstream unreachable: {e}")
            return
        # STREAM the body through — never buffer. Chat is an SSE stream and a
        # buffered read() waits on a keep-alive connection that never closes.
        self.send_response(resp.status)
        for k, v in resp.headers.items():
            if k.lower() in HOP:
                continue
            if k.lower() == "set-cookie":
                # Upstream marks cookies Secure (it lives behind TLS in prod);
                # localhost is plain HTTP, so the browser would drop them.
                v = "; ".join(p for p in v.split("; ")
                              if p.lower() != "secure"
                              and not p.lower().startswith("domain="))
            self.send_header(k, v)
        self.send_header("Connection", "close")
        self.close_connection = True
        self.end_headers()
        try:
            while True:
                # read1 = "whatever is available now". read(n) would sit and
                # fill the buffer across chunks, which held SSE status frames
                # hostage until the next model token arrived.
                chunk = resp.read1(65536) if hasattr(resp, "read1") else resp.read(65536)
                if not chunk:
                    break
                self.wfile.write(chunk)
                self.wfile.flush()
        finally:
            resp.close()

    def _route(self):
        try:
            if self.command == "GET" and self._local(self.path.split("?")[0]):
                return
            self._proxy()
        except (BrokenPipeError, ConnectionResetError):
            pass

    do_GET = do_POST = do_PUT = do_PATCH = do_DELETE = _route

    def log_message(self, fmt, *args):
        sys.stderr.write("%s %s\n" % (self.address_string(), fmt % args))


if __name__ == "__main__":
    srv = http.server.ThreadingHTTPServer((HOST, PORT), Handler)
    print(f"Media Lab Studio → http://{HOST}:{PORT}  (upstream {UPSTREAM})")
    srv.serve_forever()
