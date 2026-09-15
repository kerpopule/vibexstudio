"""Coordinator tests — rescues plan->profile mapping + drain-not-kill guard.

Companion to proof 5: the transaction/recovery machine (residency.py) is
already exercised by test_residency.py; this file covers the coordinator's
plan_to_profile translation and BusyGuard drain-vs-kill contract, which the
capacity planner relies on to keep busy services alive.
"""
from pathlib import Path
import unittest

from media_lab_core.coordinator import plan_to_profile, BusyGuard


class PlanToProfile(unittest.TestCase):
    def test_qwen_ltx_maps_text_and_video(self):
        plan = {"selected": {"language": "qwen", "video": "ltx"}}
        slots = plan_to_profile(plan)
        self.assertEqual(slots, {"text_primary": "qwen", "video_primary": "ltx"})

    def test_video_secondary_when_two_video_engines(self):
        plan = {"selected": {"video": "h3", "video_secondary": "ltx",
                             "language": "qwen"}}
        slots = plan_to_profile(plan)
        self.assertEqual(slots["video_primary"], "h3")
        self.assertEqual(slots["video_secondary"], "ltx")

    def test_none_returns_empty(self):
        self.assertEqual(plan_to_profile({"selected": {}}), {})


class BusyGuard(unittest.TestCase):
    def test_busy_service_is_waited_not_killed(self):
        guard = BusyGuard(probes={"h3": lambda: True})
        out = guard.guard(draining=["h3", "qwen"])
        self.assertEqual(out["action"], "wait-for-busy")
        self.assertIn("h3", out["busy"])
        self.assertNotIn("h3", out["killable"])
        self.assertTrue(out["never_killed"])

    def test_idle_service_is_drainable(self):
        guard = BusyGuard(probes={"h3": lambda: False})
        out = guard.guard(draining=["h3"])
        self.assertEqual(out["action"], "drain")
        self.assertIn("h3", out["killable"])
        self.assertNotIn("h3", out["busy"])


if __name__ == "__main__":
    unittest.main(verbosity=2)