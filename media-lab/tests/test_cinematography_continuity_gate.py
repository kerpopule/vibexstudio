import json
import tempfile
import unittest
from pathlib import Path

from cinematography_continuity_gate import EXPECTED, require_camera_grammar


class CinematographyContinuityGateTests(unittest.TestCase):
    def rows(self):
        distances = [
            "medium", "medium_wide", "medium", "close", "medium_wide",
            "medium", "wide", "full_body", "close", "medium",
            "extreme_close", "medium", "medium", "close", "medium",
            "medium_wide", "close", "medium", "medium_wide",
        ]
        angles = [
            "center", "camera_right", "center", "camera_left", "camera_right",
            "camera_left", "center", "center", "camera_left", "camera_right",
            "center", "camera_left", "center", "camera_right", "camera_left",
            "center", "camera_left", "camera_right", "center",
        ]
        return [
            {"id": sid, "distance": distance, "angle": angle, "visual_qa": "pass"}
            for sid, distance, angle in zip(EXPECTED, distances, angles)
        ]

    def write(self, root: Path, rows, approved=True):
        path = root / "receipt.json"
        path.write_text(json.dumps({"shots": rows, "approved_for_private_assembly": approved}))
        return path

    def test_varied_sequence_passes(self):
        with tempfile.TemporaryDirectory() as td:
            self.assertEqual(len(require_camera_grammar(self.write(Path(td), self.rows()))["shots"]), 19)

    def test_adjacent_closeups_fail(self):
        with tempfile.TemporaryDirectory() as td:
            rows = self.rows()
            rows[4]["distance"] = "extreme_close"
            with self.assertRaisesRegex(RuntimeError, "adjacent close-up repetition"):
                require_camera_grammar(self.write(Path(td), rows))

    def test_same_framing_fails(self):
        with tempfile.TemporaryDirectory() as td:
            rows = self.rows()
            rows[1]["angle"] = rows[0]["angle"]
            rows[1]["distance"] = rows[0]["distance"]
            with self.assertRaisesRegex(RuntimeError, "adjacent framing repetition"):
                require_camera_grammar(self.write(Path(td), rows))

    def test_unapproved_receipt_fails(self):
        with tempfile.TemporaryDirectory() as td:
            with self.assertRaisesRegex(RuntimeError, "not approved"):
                require_camera_grammar(self.write(Path(td), self.rows(), False))


if __name__ == "__main__":
    unittest.main()
