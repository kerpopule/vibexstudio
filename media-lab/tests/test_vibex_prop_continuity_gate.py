import hashlib
import json
import tempfile
import unittest
from pathlib import Path

from vibex_prop_continuity_gate import require_vibex_prop_continuity


class VibeXPropContinuityGateTests(unittest.TestCase):
    def receipt(self, root: Path, *, body="pass", scale="pass", approved=True) -> Path:
        rows = []
        for sid in ("VX16", "VX17"):
            source = root / f"{sid}.mp4"
            source.write_bytes((sid * 100).encode())
            rows.append({
                "id": sid,
                "source": str(source),
                "source_sha256": hashlib.sha256(source.read_bytes()).hexdigest(),
                "small_dgx_scale": scale,
                "wardrobe_continuity": "not_applicable" if sid == "VX16" else "pass",
                "body_proportions": "not_applicable" if sid == "VX16" else body,
                "framing_headroom": "pass",
                "visual_qa": "pass",
            })
        path = root / "receipt.json"
        path.write_text(json.dumps({"shots": rows, "approved_for_private_assembly": approved}))
        return path

    def test_valid_broll_plus_performance_passes(self):
        with tempfile.TemporaryDirectory() as td:
            self.assertEqual(len(require_vibex_prop_continuity(self.receipt(Path(td)))["shots"]), 2)

    def test_oversized_device_fails(self):
        with tempfile.TemporaryDirectory() as td:
            with self.assertRaisesRegex(RuntimeError, "DGX scale failed"):
                require_vibex_prop_continuity(self.receipt(Path(td), scale="fail"))

    def test_bad_body_proportions_fail(self):
        with tempfile.TemporaryDirectory() as td:
            with self.assertRaisesRegex(RuntimeError, "body proportions failed"):
                require_vibex_prop_continuity(self.receipt(Path(td), body="fail"))

    def test_unapproved_fails(self):
        with tempfile.TemporaryDirectory() as td:
            with self.assertRaisesRegex(RuntimeError, "not approved"):
                require_vibex_prop_continuity(self.receipt(Path(td), approved=False))


if __name__ == "__main__":
    unittest.main()
