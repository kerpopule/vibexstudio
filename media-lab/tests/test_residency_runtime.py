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
from types import SimpleNamespace
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


class ExactWarmVideoAdmissionTests(unittest.TestCase):
    def setUp(self):
        self.previous_lease = studio._gpu_active_lease
        self.previous_thread_lease = getattr(studio._gpu_thread, "lease", None)
        studio._gpu_thread.lease = None

    def tearDown(self):
        studio._gpu_active_lease = self.previous_lease
        studio._gpu_thread.lease = self.previous_thread_lease

    @staticmethod
    def _lease(**changes):
        values = dict(state="active", phase="parked", job_id="prior",
                      engine="h3", task="t2va", fence=41, owner="controller",
                      pid=123, boot_id="boot-a", _fd=object())
        values.update(changes)
        return SimpleNamespace(**values)

    def test_parked_exact_warm_h3_releases_idle_image_before_retarget(self):
        lease = self._lease()
        studio._gpu_active_lease = lease
        events = []
        gate = object()

        class Protocol:
            def capacity_deficit_gib(self, engine, task, *, warm=False):
                events.append(("capacity", engine, task, warm))
                return 11.2

            def retarget(self, current, **kwargs):
                events.append("retarget")
                self_outer.assertIn("release-image", events)
                current.job_id = kwargs["job_id"]
                current.phase = "render"

            def park(self, current, proof):
                events.append("park")
                current.phase = "parked"

        self_outer = self
        with mock.patch.object(studio, "gpu_protocol", return_value=Protocol()), \
             mock.patch.object(studio, "_gpu_warm_proof", return_value={
                 "engine": "h3", "task": "t2va", "healthy": True, "busy": False}), \
             mock.patch.object(studio, "engine_up", side_effect=lambda name: name == "image"), \
             mock.patch.object(studio, "_gpu_exact_idle", side_effect=lambda name: name == "image"), \
             mock.patch.object(studio.RESIDENCY.hooks, "begin_residency_transaction",
                               side_effect=lambda: events.append("inference-lock") or gate), \
             mock.patch.object(studio.RESIDENCY.hooks, "end_residency_transaction",
                               side_effect=lambda actual: events.append(("unlock", actual))), \
             mock.patch.object(studio.RESIDENCY.hooks, "release_image_weights",
                               side_effect=lambda _why: events.append("release-image") or 11.5), \
             mock.patch.object(studio, "save_state"):
            with studio.gpu_operation("h3", "t2va", {"id": "next"}):
                events.append("body")

        self.assertLess(events.index("inference-lock"), events.index("release-image"))
        self.assertLess(events.index("release-image"), events.index("retarget"))
        self.assertLess(events.index("retarget"), events.index(("unlock", gate)))
        self.assertIn("body", events)

    def test_busy_image_fails_closed_before_release_or_retarget(self):
        lease = self._lease()
        studio._gpu_active_lease = lease

        class Protocol:
            def capacity_deficit_gib(self, *_args, **_kwargs):
                return 11.2

            def retarget(self, *_args, **_kwargs):
                raise AssertionError("must not retarget")

        with mock.patch.object(studio, "gpu_protocol", return_value=Protocol()), \
             mock.patch.object(studio, "_gpu_warm_proof", return_value={
                 "engine": "h3", "task": "t2va", "healthy": True, "busy": False}), \
             mock.patch.object(studio, "engine_up", return_value=True), \
             mock.patch.object(studio, "_gpu_exact_idle", return_value=False), \
             mock.patch.object(studio.RESIDENCY.hooks, "begin_residency_transaction",
                               return_value=object()), \
             mock.patch.object(studio.RESIDENCY.hooks, "end_residency_transaction"), \
             mock.patch.object(studio.RESIDENCY.hooks, "release_image_weights") as release:
            with self.assertRaisesRegex(studio.LeaseBusy, "not proven idle"):
                with studio.gpu_operation("h3", "t2va", {"id": "next"}):
                    self.fail("busy image must block warm admission")
        release.assert_not_called()
        self.assertEqual("parked", lease.phase)

    def test_idle_image_release_failure_stays_parked_and_never_retargets(self):
        lease = self._lease()
        studio._gpu_active_lease = lease

        protocol = mock.Mock()
        protocol.capacity_deficit_gib.return_value = 11.2
        warm = {"engine": "h3", "task": "t2va", "healthy": True, "busy": False}
        with mock.patch.object(studio, "gpu_protocol", return_value=protocol), \
             mock.patch.object(studio, "_gpu_warm_proof", return_value=warm), \
             mock.patch.object(studio, "engine_up", return_value=True), \
             mock.patch.object(studio, "_gpu_exact_idle", return_value=True), \
             mock.patch.object(studio.RESIDENCY.hooks, "begin_residency_transaction",
                               return_value=object()), \
             mock.patch.object(studio.RESIDENCY.hooks, "end_residency_transaction"), \
             mock.patch.object(studio.RESIDENCY.hooks, "release_image_weights",
                               return_value=None), \
             mock.patch.object(studio, "save_state"):
            with self.assertRaisesRegex(studio.LeaseBusy, "would not release"):
                with studio.gpu_operation("h3", "t2va", {"id": "next"}):
                    self.fail("failed release must block warm admission")
        protocol.retarget.assert_not_called()
        self.assertEqual("parked", lease.phase)

    def test_cold_unrelated_and_recovery_paths_do_not_release_image(self):
        exact = {"engine": "h3", "task": "t2va", "healthy": True, "busy": False}
        cases = (
            (None, exact, "h3", "t2va"),
            (self._lease(), {**exact, "healthy": False}, "h3", "fl2va"),
            (self._lease(state="recovery"), exact, "h3", "t2va"),
        )
        for lease, proof, engine, task in cases:
            with self.subTest(lease=lease, engine=engine, task=task):
                protocol = mock.Mock()
                with mock.patch.object(studio.RESIDENCY.hooks,
                                       "release_image_weights") as release:
                    with studio._exact_warm_video_admission(
                            protocol, lease, engine, task, proof, {}):
                        pass
                release.assert_not_called()
                protocol.capacity_deficit_gib.assert_not_called()


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

    def test_chat_container_inspection_failure_is_not_treated_as_absent(self):
        failed = subprocess.CompletedProcess(
            ["docker", "ps"], 2, stdout="", stderr="daemon unavailable"
        )
        with mock.patch.object(studio.subprocess, "run", return_value=failed):
            with self.assertRaisesRegex(RuntimeError, "inspection failed"):
                studio._chat_containers_running()

    def test_maestro_pause_is_inside_fenced_unload_before_reclaim_and_load(self):
        source = (SRC / "app.py").read_text()
        block = source[source.index("def gpu_operation"):source.index("def gpu_render_ready")]
        unload_at = block.index('protocol.advance(lease, "unload")')
        pause_at = block.index("pause_chat_for_video(j)")
        reclaim_at = block.index("reclaim_proof = reclaim_operation()")
        load_at = block.index('protocol.advance(lease, "load")')
        self.assertLess(unload_at, pause_at)
        self.assertLess(pause_at, reclaim_at)
        self.assertLess(reclaim_at, load_at)

        maestro = source[source.index("def run_maestro"):source.index("def run_maestro_fenced")]
        self.assertNotIn("pause_chat_for_video(j)", maestro)

    def test_maestro_capacity_failure_restores_managed_qwen(self):
        lease = SimpleNamespace(
            state="active", phase="drain", job_id="maestro-job",
            engine="maestro", task="generate", _fd=None,
        )
        events = []

        class Protocol:
            def acquire(self, **_kwargs):
                return lease

            def advance(self, current, phase):
                events.append(phase)
                if phase == "load":
                    raise studio.CapacityUnqualified("fixture capacity")
                current.phase = phase
                return current

            def release(self, current, proof):
                events.append("release")
                current.state = "released"

        previous = studio._gpu_active_lease
        studio._gpu_active_lease = None
        try:
            with mock.patch.object(studio, "gpu_protocol", return_value=Protocol()), \
                 mock.patch.object(studio, "pool_cmd", return_value="OK"), \
                 mock.patch.object(studio, "_gpu_warm_proof", return_value={
                     "healthy": False, "busy": False}), \
                 mock.patch.object(studio, "pause_chat_for_video", return_value=True) as pause, \
                 mock.patch.object(studio, "reap_orphan_maestro_runners", return_value={
                     "status": "clean", "returncode": 1, "detail": ""}), \
                 mock.patch.object(studio, "_gpu_reclaim_all", return_value={
                     "processes_gone": True, "memory_recovered": True,
                     "available_gib": 120.0, "survivors": []}), \
                 mock.patch.object(studio, "restore_chat_after_video", return_value=True) as restore:
                with self.assertRaises(studio.CapacityUnqualified):
                    with studio.gpu_operation("maestro", "generate", {"id": "maestro-job"},
                                              ephemeral=True):
                        self.fail("capacity failure must happen before render admission")
        finally:
            studio._gpu_active_lease = previous

        pause.assert_called_once()
        restore.assert_called_once_with()
        self.assertEqual(["unload", "reclaim", "load", "release"], events)

    def test_maestro_pause_failure_restores_receipt_and_never_reclaims_or_loads(self):
        lease = SimpleNamespace(
            state="active", phase="drain", job_id="maestro-job",
            engine="maestro", task="generate", _fd=None,
        )
        events = []

        class Protocol:
            def acquire(self, **_kwargs):
                return lease

            def advance(self, current, phase):
                events.append(phase)
                current.phase = phase
                return current

            def mark_recovery(self, current, _reason):
                current.state = "recovery"

            def release(self, current, proof):
                events.append("release")
                current.state = "released"

        previous = studio._gpu_active_lease
        studio._gpu_active_lease = None
        try:
            with mock.patch.object(studio, "gpu_protocol", return_value=Protocol()), \
                 mock.patch.object(studio, "pool_cmd", return_value="OK"), \
                 mock.patch.object(studio, "_gpu_warm_proof", return_value={
                     "healthy": False, "busy": False}), \
                 mock.patch.object(studio, "pause_chat_for_video", return_value=False), \
                 mock.patch.object(studio, "reap_orphan_maestro_runners", return_value={
                     "status": "clean", "returncode": 1, "detail": ""}), \
                 mock.patch.object(studio, "_gpu_reclaim_all", return_value={
                     "processes_gone": True, "memory_recovered": True,
                     "available_gib": 120.0, "survivors": []}) as reclaim, \
                 mock.patch.object(studio, "restore_chat_after_video", return_value=True) as restore, \
                 mock.patch.object(studio, "hold_gpu_recovery"):
                with self.assertRaisesRegex(studio.LeaseBusy, "pause"):
                    with studio.gpu_operation("maestro", "generate", {"id": "maestro-job"},
                                              ephemeral=True):
                        self.fail("pause failure must happen before render admission")
        finally:
            studio._gpu_active_lease = previous

        restore.assert_called_once_with()
        reclaim.assert_called_once_with({"id": "maestro-job"})
        self.assertEqual(["unload", "reclaim", "release"], events)

    def test_maestro_render_exception_reaps_runner_before_qwen_restore_and_release(self):
        lease = SimpleNamespace(
            state="active", phase="drain", job_id="maestro-job",
            engine="maestro", task="generate", _fd=None,
        )
        events = []

        class Protocol:
            def acquire(self, **_kwargs):
                return lease

            def advance(self, current, phase):
                events.append(phase)
                current.phase = phase
                return current

            def bind_process(self, *_args, **_kwargs):
                return None

            def mark_recovery(self, current, _reason):
                events.append("recovery")
                current.state = "recovery"

            def release(self, current, proof):
                events.append("release")
                current.state = "released"

        previous = studio._gpu_active_lease
        studio._gpu_active_lease = None
        try:
            with mock.patch.object(studio, "gpu_protocol", return_value=Protocol()), \
                 mock.patch.object(studio, "pool_cmd", return_value="OK"), \
                 mock.patch.object(studio, "_gpu_warm_proof", return_value={
                     "healthy": False, "busy": False}), \
                 mock.patch.object(studio, "pause_chat_for_video", return_value=True), \
                 mock.patch.object(studio, "_gpu_reclaim_all", side_effect=lambda _job=None: (
                     events.append("reclaim-proof") or {
                         "processes_gone": True, "memory_recovered": True,
                         "available_gib": 120.0, "survivors": []})), \
                 mock.patch.object(studio, "_gpu_process_identity", return_value=None), \
                 mock.patch.object(studio, "reap_orphan_maestro_runners",
                                   side_effect=lambda: (events.append("maestro-reap") or {
                                       "status": "clean", "returncode": 1, "detail": ""})), \
                 mock.patch.object(studio, "restore_chat_after_video",
                                   side_effect=lambda: (events.append("restore") or True)) as restore, \
                 mock.patch.object(studio, "hold_gpu_recovery"):
                with self.assertRaisesRegex(RuntimeError, "fixture render failure"):
                    with studio.gpu_operation("maestro", "generate", {"id": "maestro-job"},
                                              ephemeral=True):
                        studio.gpu_render_ready("maestro", "generate")
                        raise RuntimeError("fixture render failure")
        finally:
            studio._gpu_active_lease = previous

        restore.assert_called_once_with()
        self.assertEqual("released", lease.state)
        self.assertLess(len(events) - 1 - events[::-1].index("maestro-reap"), events.index("restore"))
        self.assertNotIn("recovery", events)

    def test_maestro_invalid_final_reclaim_never_restores_qwen(self):
        lease = SimpleNamespace(
            state="active", phase="drain", job_id="maestro-job",
            engine="maestro", task="generate", _fd=None,
        )

        class Protocol:
            def acquire(self, **_kwargs):
                return lease

            def advance(self, current, phase):
                current.phase = phase
                return current

            def bind_process(self, *_args, **_kwargs):
                return None

            def mark_recovery(self, current, _reason):
                current.state = "recovery"

        good = {
            "processes_gone": True, "memory_recovered": True,
            "available_gib": 120.0, "survivors": [],
        }
        bad = {
            "processes_gone": False, "memory_recovered": False,
            "available_gib": 12.0, "survivors": ["h3"],
        }
        previous = studio._gpu_active_lease
        studio._gpu_active_lease = None
        try:
            with mock.patch.object(studio, "gpu_protocol", return_value=Protocol()), \
                 mock.patch.object(studio, "pool_cmd", return_value="OK"), \
                 mock.patch.object(studio, "_gpu_warm_proof", return_value={
                     "healthy": False, "busy": False}), \
                 mock.patch.object(studio, "pause_chat_for_video", return_value=True), \
                 mock.patch.object(studio, "reap_orphan_maestro_runners", return_value={
                     "status": "clean", "returncode": 1, "detail": ""}), \
                 mock.patch.object(studio, "_gpu_reclaim_all", side_effect=[good, bad]), \
                 mock.patch.object(studio, "_gpu_process_identity", return_value=None), \
                 mock.patch.object(studio, "restore_chat_after_video") as restore, \
                 mock.patch.object(studio, "hold_gpu_recovery"):
                with self.assertRaisesRegex(RuntimeError, "survived final reclaim"):
                    with studio.gpu_operation("maestro", "generate", {"id": "maestro-job"},
                                              ephemeral=True):
                        studio.gpu_render_ready("maestro", "generate")
        finally:
            studio._gpu_active_lease = previous

        restore.assert_not_called()
        self.assertEqual("recovery", lease.state)


if __name__ == "__main__":
    unittest.main(verbosity=2)
