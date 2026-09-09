"""Exercise the desktop's actual embedded supervisor with disposable servers."""
from pathlib import Path
import socket
import subprocess
import sys
import time

SUPERVISOR = Path(__file__).parents[1] / 'src-tauri/src/sidecar_supervisor.py'


def test_owner_pipe_close_reaps_server_and_releases_port(tmp_path):
    ready = tmp_path / 'ready'
    program = '''
import socket,sys,time
from pathlib import Path
s=socket.socket();s.bind(('127.0.0.1',0));s.listen()
Path(sys.argv[1]).write_text(str(s.getsockname()[1]))
while True:time.sleep(.1)
'''
    process = subprocess.Popen([sys.executable, str(SUPERVISOR), '-c', program, str(ready)], stdin=subprocess.PIPE)
    try:
        deadline = time.monotonic() + 10
        while not ready.exists():
            assert process.poll() is None
            assert time.monotonic() < deadline
            time.sleep(.05)
        port = int(ready.read_text())
        with socket.create_connection(('127.0.0.1', port), timeout=2):
            pass
        process.stdin.close()
        assert process.wait(timeout=8) == 0
        with socket.socket() as probe:
            probe.settimeout(1)
            assert probe.connect_ex(('127.0.0.1', port)) != 0
    finally:
        if process.poll() is None:
            process.stdin.close()
            process.wait(timeout=8)


def test_child_exit_code_is_preserved():
    process = subprocess.Popen([sys.executable, str(SUPERVISOR), '-c', 'raise SystemExit(23)'], stdin=subprocess.PIPE)
    try:
        assert process.wait(timeout=5) == 23
    finally:
        process.stdin.close()
