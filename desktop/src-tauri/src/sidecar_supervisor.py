"""Run an owned Python server until it exits or its desktop control pipe closes."""
import os
import subprocess
import sys
import threading


def main():
    closed = threading.Event()

    def watch_owner():
        try:
            while os.read(sys.stdin.fileno(), 1):
                pass
        finally:
            closed.set()

    threading.Thread(target=watch_owner, daemon=True).start()
    child = subprocess.Popen([sys.executable, *sys.argv[1:]], stdin=subprocess.DEVNULL)
    try:
        while child.poll() is None:
            if closed.wait(0.1):
                break
        return child.returncode if child.returncode is not None else 0
    finally:
        if child.poll() is None:
            child.terminate()
            try:
                child.wait(timeout=5)
            except subprocess.TimeoutExpired:
                child.kill()
                child.wait()


if __name__ == '__main__':
    raise SystemExit(main())
