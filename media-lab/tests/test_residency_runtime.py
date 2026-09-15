"""Integration seam tests for app.py's activity-aware residency runtime.

These tests exercise the actual _ResidencyRuntime.snapshot() wiring without
starting a service or contacting a live Qwen endpoint.  The pure parser tests
cover metric semantics; this module proves the application snapshot consumes
one injected activity result, fails closed for resident UNKNOWN, and treats
:8003 as a shim rather than a second health authority.
"""

import os
import shutil
import subprocess
import tempfile
import threading
import unittest
from pathlib import Path
from unittest import mock

# app.py intentionally binds runtime state to $HOME/media-lab-simple. Use a
# disposable complete fixture on developer machines rather than depending on
# or mutating any real Media Lab directory.
SRC = Path(__file__).resolve().parent.parent
TEST_HOME = Path(tempfile.mkdtemp(prefix="media-lab-residency-tests-"))
ROOT = TEST_HOME / "media-lab-simple"
ROOT.mkdir(parents=True)
os.environ["HOME"] = str(TEST_HOME)
for name in ("config", "static", "prompt-templates"):
    shutil.copytree(SRC / name, ROOT / name, dirs_exist_ok=True)
shutil.copy(SRC / "chat-system-prompt.md", ROOT / "chat-system-prompt.md")

import app as studio


def tearDownModule():
    shutil.rmtree(TEST_HOME, ignore_errors=True)


class ResidencyRuntimeSnapshotTests(unittest.TestCase):
    def _runtime(self, activity):
        probe = mock.Mock(return_value=activity)
        runtime = studio._ResidencyRuntime(activity_probe=probe)
        return runtime, probe

    def _patch_runtime(self, runtime, healthy):
        return mock.patch.multiple(
            studio,
            _chat_containers_running=mock.Mock(return_value=[]),
            engine_up=mock.Mock(return_value=False),
            engine_busy=mock.Mock(return_value=False),
            _mem_available_gb=mock.Mock(return_value=58.0),
        ), mock.patch.object(
            runtime, "_healthy",
            side_effect=lambda url: url == "http://127.0.0.1:8004/v1/models"
            if healthy else False,
        ), mock.patch.object(
            studio.subprocess, "run",
            return_value=subprocess.CompletedProcess([], 1, stdout="", stderr=""),
        )

    def test_resident_unknown_activity_is_consumed_once_and_blocks_eviction(self):
        detail = {
            "state": "unknown", "source": None, "probes": [],
            "skipped_shims": {"8003": "8004"},
            "probe_status": {"8004": {"status": "unreachable"}},
            "detail": "no canonical text endpoint answered /metrics",
            "running": 0.0, "waiting": 0.0,
        }
        runtime, probe = self._runtime(("unknown", detail))
        patches = self._patch_runtime(runtime, healthy=True)
        with patches[0], patches[1], patches[2]:
            state = runtime.snapshot()

        qwen = state["models"]["qwen"]
        self.assertTrue(qwen["resident"])
        self.assertTrue(qwen["healthy"])
        self.assertTrue(qwen["busy"])
        self.assertEqual(qwen["activity"]["state"], "unknown")
        self.assertIsNone(qwen["activity"]["source"])
        probe.assert_called_once_with()

    def test_cold_qwen_does_not_probe_and_exposes_unknown_diagnostic(self):
        runtime, probe = self._runtime(("busy", {"state": "busy", "source": "8004"}))
        patches = self._patch_runtime(runtime, healthy=False)
        with patches[0], patches[1], patches[2]:
            state = runtime.snapshot()

        qwen = state["models"]["qwen"]
        self.assertFalse(qwen["resident"])
        self.assertFalse(qwen["busy"])
        self.assertEqual(qwen["activity"]["state"], "unknown")
        self.assertIn("not resident", qwen["activity"]["detail"])
        probe.assert_not_called()

    def test_qwen_health_uses_authoritative_8004_only(self):
        runtime, _probe = self._runtime(("idle", {"state": "idle"}))
        healthy = mock.Mock(side_effect=lambda url: url == "http://127.0.0.1:8004/v1/models")
        with mock.patch.object(runtime, "_healthy", healthy):
            self.assertTrue(runtime.model_healthy("qwen"))
        healthy.assert_called_once_with("http://127.0.0.1:8004/v1/models")


class ResidencyDiagnosticsAuthTests(unittest.TestCase):
    @staticmethod
    def _request(role=None):
        request = studio.Request({
            "type": "http", "method": "GET", "path": "/api/residency",
            "headers": [], "query_string": b"", "scheme": "http",
            "server": ("test", 80), "client": ("test", 1),
        })
        if role:
            request.state.role = role
        return request

    def test_residency_diagnostics_are_not_public(self):
        response = studio.residency_state(self._request(), None)
        self.assertEqual(response.status_code, 403)

    def test_signed_user_session_can_read_non_secret_diagnostics(self):
        expected = {"status": "healthy", "actual": {"models": {}}}
        with mock.patch.object(studio.RESIDENCY, "state", return_value=expected):
            result = studio.residency_state(self._request("user"), None)
        self.assertEqual(result, expected)


class VideoResidencyAdmissionTests(unittest.TestCase):
    def test_cold_video_releases_image_weights_before_memory_planning(self):
        calls = []
        job = {}

        def release(why):
            calls.append(("release", why))
            return 27.5

        def apply(profile, slots, commit_desired):
            calls.append(("apply", profile, slots, commit_desired))
            return {"status": "committed"}

        with mock.patch.object(studio.RESIDENCY, "desired", return_value={
                "name": "qwen-ltx-default", "models": ["qwen", "ltx"], "slots": {}}), \
             mock.patch.object(studio.RESIDENCY, "snapshot", return_value={
                "models": {"h3": {"resident": False, "healthy": False}}}), \
             mock.patch.object(studio.RESIDENCY.hooks, "release_image_weights",
                               side_effect=release), \
             mock.patch.object(studio.RESIDENCY, "apply", side_effect=apply), \
             mock.patch.object(studio, "save_state"):
            result = studio.ensure_video_residency("h3", job)

        self.assertEqual("up", result)
        self.assertEqual("release", calls[0][0])
        self.assertEqual(("apply", "qwen-h3", None, False), calls[1])
        self.assertIn("preflight for h3", calls[0][1])

    def test_healthy_resident_video_does_not_release_image_weights(self):
        with mock.patch.object(studio.RESIDENCY, "desired", return_value={
                "name": "qwen-ltx-default", "models": ["qwen", "ltx"], "slots": {}}), \
             mock.patch.object(studio.RESIDENCY, "snapshot", return_value={
                "models": {"ltx": {"resident": True, "healthy": True}}}), \
             mock.patch.object(studio.RESIDENCY.hooks, "release_image_weights") as release, \
             mock.patch.object(studio.RESIDENCY, "apply", return_value={"status": "committed"}), \
             mock.patch.object(studio, "save_state"):
            result = studio.ensure_video_residency("ltx", {})

        self.assertEqual("up", result)
        release.assert_not_called()

    def test_release_failure_refuses_video_admission_loudly(self):
        job = {}
        with mock.patch.object(studio.RESIDENCY, "desired", return_value={
                "name": "qwen-ltx-default", "models": ["qwen", "ltx"], "slots": {}}), \
             mock.patch.object(studio.RESIDENCY, "snapshot", return_value={
                "models": {"h3": {"resident": False, "healthy": False}}}), \
             mock.patch.object(studio.RESIDENCY.hooks, "release_image_weights",
                               return_value=None), \
             mock.patch.object(studio.RESIDENCY, "apply") as apply, \
             mock.patch.object(studio, "save_state"):
            result = studio.ensure_video_residency("h3", job)

        self.assertEqual("busy", result)
        self.assertIn("would not release", job["detail"])
        apply.assert_not_called()


class OneCompanionContractTests(unittest.TestCase):
    def test_music_stands_down_every_other_idle_companion_but_never_pplx(self):
        up = {"ltx", "h3", "music", "image"}
        stopped = []
        with mock.patch.object(studio, "pplx_primary_healthy", return_value=True), \
             mock.patch.object(studio, "release_voice_weights", return_value=True) as voice, \
             mock.patch.object(studio, "engine_up", side_effect=lambda name: name in up), \
             mock.patch.object(studio, "engine_busy", return_value=False), \
             mock.patch.object(studio, "stop_engine", side_effect=stopped.append):
            result = studio.stand_down_other_companions("music", {})

        self.assertEqual("up", result)
        self.assertEqual(["ltx", "h3", "image"], stopped)
        voice.assert_called_once_with()
        self.assertNotIn("qwen", stopped)

    def test_unhealthy_pplx_refuses_companion_mutation(self):
        job = {}
        with mock.patch.object(studio, "pplx_primary_healthy", return_value=False), \
             mock.patch.object(studio, "stop_engine") as stop:
            result = studio.stand_down_other_companions("image", job)

        self.assertEqual("busy", result)
        self.assertIn("PPLX-27B", job["detail"])
        stop.assert_not_called()

    def test_busy_non_target_companion_is_never_interrupted(self):
        job = {}
        with mock.patch.object(studio, "pplx_primary_healthy", return_value=True), \
             mock.patch.object(studio, "release_voice_weights", return_value=True), \
             mock.patch.object(studio, "engine_up", return_value=True), \
             mock.patch.object(studio, "engine_busy", side_effect=lambda name: name == "h3"), \
             mock.patch.object(studio, "stop_engine") as stop:
            result = studio.stand_down_other_companions("ltx", job)

        self.assertEqual("busy", result)
        self.assertIn("h3", job["detail"])
        stop.assert_not_called()

    def test_music_and_speech_block_idle_ltx_restore(self):
        previous = studio.jobs
        try:
            for kind in ("music", "speak"):
                studio.jobs = {kind: {"kind": kind, "status": "running", "request": {}}}
                self.assertTrue(studio.video_work_pending(), kind)
        finally:
            studio.jobs = previous

    def test_pplx_is_the_only_idle_text_runtime(self):
        self.assertEqual("pplx", studio.preferred_text_runtime())

    def test_failed_post_load_pplx_probe_unwinds_idle_target(self):
        job = {}
        with mock.patch.object(studio, "pplx_primary_healthy", return_value=False), \
             mock.patch.object(studio, "engine_up", return_value=True), \
             mock.patch.object(studio, "engine_busy", return_value=False), \
             mock.patch.object(studio, "stop_engine") as stop:
            result = studio.verify_pplx_after_companion_load("music", job)

        self.assertEqual("fail", result)
        stop.assert_called_once_with("music")
        self.assertIn("became unhealthy", job["detail"])


class IdleReaperSafetyTests(unittest.TestCase):
    def test_stale_busy_h3_is_never_stopped(self):
        with mock.patch.object(studio, "engine_idle_s", return_value=studio.IDLE_REAP_S + 1), \
             mock.patch.object(studio, "engine_up", return_value=True), \
             mock.patch.object(studio, "engine_busy", side_effect=lambda name: name == "h3"), \
             mock.patch.object(studio, "stop_engine") as stop:
            studio.reap_idle_engines()

        self.assertNotIn(mock.call("h3"), stop.call_args_list)

    def test_stale_idle_h3_is_stopped(self):
        with mock.patch.object(studio, "engine_idle_s",
                               side_effect=lambda name: studio.IDLE_REAP_S + 1
                               if name == "h3" else None), \
             mock.patch.object(studio, "engine_up", return_value=True), \
             mock.patch.object(studio, "engine_busy", return_value=False), \
             mock.patch.object(studio, "stop_engine") as stop:
            studio.reap_idle_engines()

        stop.assert_called_once_with("h3")


class RestoreRenderSerializationTests(unittest.TestCase):
    def test_queued_job_cannot_start_inside_active_idle_restore_transaction(self):
        previous_jobs = studio.jobs
        previous_runner = studio.RUNNERS.get("race-test")
        started = threading.Event()
        finished = threading.Event()
        restore_has_lock = threading.Event()
        release_restore = threading.Event()
        job = {"id": "race", "kind": "race-test", "status": "queued", "request": {}}

        def runner(j):
            started.set()
            j["status"] = "done"
            j["stage"] = "done"

        def hold_restore_transaction():
            with studio._idle_restore_mutex:
                restore_has_lock.set()
                release_restore.wait(2)

        def run_job():
            studio.run_queued_job("race")
            finished.set()

        try:
            studio.jobs = {"race": job}
            studio.RUNNERS["race-test"] = runner
            with mock.patch.object(studio, "save_state"), \
                 mock.patch.object(studio, "eta_record"), \
                 mock.patch.object(studio, "notify_done"), \
                 mock.patch.object(studio, "settle_video_transaction"):
                restore = threading.Thread(target=hold_restore_transaction)
                restore.start()
                self.assertTrue(restore_has_lock.wait(1))
                render = threading.Thread(target=run_job)
                render.start()
                self.assertFalse(started.wait(0.1), "render entered while restore held the transaction")
                release_restore.set()
                self.assertTrue(started.wait(1))
                self.assertTrue(finished.wait(1))
                restore.join(1)
                render.join(1)
        finally:
            studio.jobs = previous_jobs
            if previous_runner is None:
                studio.RUNNERS.pop("race-test", None)
            else:
                studio.RUNNERS["race-test"] = previous_runner


class MaestroExclusiveResidencyTests(unittest.TestCase):
    def tearDown(self):
        studio.CHAT_PAUSE_RECEIPT.unlink(missing_ok=True)
        studio.CHAT_MAINTENANCE.unlink(missing_ok=True)

    def test_stale_pause_receipt_rechecks_and_stops_live_qwen(self):
        studio.CHAT_PAUSE_RECEIPT.parent.mkdir(parents=True, exist_ok=True)
        studio.CHAT_PAUSE_RECEIPT.write_text(
            '{"containers":["qwen38-vllm"],"ts":1}')
        live = [["qwen38-vllm"], ["qwen38-vllm"], []]
        with mock.patch.object(studio, "_chat_containers_running",
                               side_effect=lambda: live.pop(0) if live else []), \
             mock.patch.object(studio, "save_state"), \
             mock.patch.object(studio.subprocess, "run") as run:
            self.assertTrue(studio.pause_chat_for_video({}))
        self.assertTrue(studio.CHAT_MAINTENANCE.exists())
        run.assert_called_once_with(
            ["docker", "stop", "--time", "45", "qwen38-vllm"],
            stdout=studio.subprocess.DEVNULL, stderr=studio.subprocess.DEVNULL)

    def test_maestro_preflight_source_colds_video_before_pausing_chat(self):
        source = (SRC / "app.py").read_text()
        block = source[source.index("def run_maestro"):source.index("RUNNERS =")]
        release_at = block.index('release_video_engines("Maestro render")')
        verify_at = block.index('remaining = [name for name in VIDEO_ENGINE_NAMES')
        pause_at = block.index("pause_chat_for_video(j)")
        launch_at = block.index("subprocess.Popen")
        self.assertLess(release_at, verify_at)
        self.assertLess(verify_at, pause_at)
        self.assertLess(pause_at, launch_at)
        self.assertIn('if remaining:', block)


if __name__ == "__main__":
    unittest.main(verbosity=2)
