import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest import mock
from media_lab_core import local_config
from runner import queue_watchdog, service_supervisor

ROOT = Path(__file__).resolve().parents[1]
QUEUE_URL = local_config.studio_url() + "/api/queue"   # config/local.env, never a literal


class WatchdogMaestroSafetyTests(unittest.TestCase):
    def test_queue_probe_uses_configured_studio_url_and_no_proxy(self):
        self.assertEqual(QUEUE_URL, queue_watchdog.QUEUE_URL)
        self.assertEqual("localhost", queue_watchdog.queue_request().get_header("Host"))
        source = (ROOT / "runner/queue_watchdog.py").read_text(encoding="utf-8")
        self.assertIn("build_opener(urllib.request.ProxyHandler({}))", source)

    def test_supervisor_media_lab_probe_uses_configured_studio_url_and_no_proxy(self):
        self.assertIn(
            ("media-lab-simple.service", QUEUE_URL, None),
            service_supervisor.UNITS,
        )
        fake_response = mock.MagicMock()
        fake_response.__enter__.return_value.getcode.return_value = 200
        with mock.patch.object(service_supervisor.LOCAL_OPENER, "open", return_value=fake_response) as opened, \
             mock.patch.object(service_supervisor.urllib.request, "urlopen") as global_open:
            self.assertTrue(service_supervisor.probe(QUEUE_URL))
        opened.assert_called_once()
        global_open.assert_not_called()

    def test_active_runner_detection_uses_queue_owned_docker_exec(self):
        for module in (queue_watchdog, service_supervisor):
            with self.subTest(module=module.__name__), mock.patch.object(
                module.subprocess,
                "run",
                return_value=SimpleNamespace(returncode=0, stdout="1905346\n", stderr=""),
            ) as run:
                self.assertTrue(module.maestro_queue_runner_active())
                command = run.call_args.args[0]
                self.assertEqual("pgrep", command[0])
                self.assertIn("media-lab-maestro-runner", command[-1])

    def test_both_watchdogs_stand_clear_during_queue_owned_render(self):
        queue_source = (ROOT / "runner/queue_watchdog.py").read_text(encoding="utf-8")
        supervisor_source = (ROOT / "runner/service_supervisor.py").read_text(encoding="utf-8")
        self.assertIn("API probe failed while a queue-owned Maestro runner is active — standing clear", queue_source)
        self.assertIn("probe failed during a queue-owned Maestro render — standing clear", supervisor_source)


if __name__ == "__main__":
    unittest.main()
