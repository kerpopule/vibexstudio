import hashlib
import json
import tempfile
import unittest
from pathlib import Path

from true_lipsync_gate import AAS_VISIBLE_IDS, require_true_lipsync_gate


class TrueLipSyncGateTests(unittest.TestCase):
    def test_aas_has_no_still_or_voiceover_exception(self):
        self.assertEqual(AAS_VISIBLE_IDS, [f"N{i:02d}" for i in range(19)])
        self.assertIn("N10", AAS_VISIBLE_IDS)

    def test_batch_includes_moving_n10_and_no_still_exception(self):
        source = (Path(__file__).parents[1] / "productions/aas-founder-performance-nightmare-2026-08-30/submit_aas_source_lipsync_batch.py").read_text()
        self.assertIn('VISIBLE_BATCH = [f"N{i:02d}" for i in range(1, 19) if i != 4]', source)
        self.assertIn('"included_n10": "moving Steve source', source)
        self.assertIn('"still_or_separate_voiceover_exceptions": False', source)
        self.assertNotIn("intentional closed-mouth voiceover plate", source)
        self.assertIn('"N04": "old repeated camera-left extreme close-up rejected', source)

    def make_receipt(self, root: Path) -> Path:
        rows = []
        for sid in AAS_VISIBLE_IDS:
            source = root / f"{sid}.mp4"
            source.write_bytes((sid + "-source").encode())
            rows.append({
                "id": sid,
                "source": str(source),
                "source_sha256": hashlib.sha256(source.read_bytes()).hexdigest(),
                "objective_model": "SyncNet",
                "av_offset_frames": 0,
                "confidence": 6.0,
                "manual_visual_sync_qa": "pass",
                "opening_rest_qa": "pass",
                "gate": "pass",
            })
        receipt = root / "qa.json"
        receipt.write_text(json.dumps({"shots": rows, "gate": "pass"}))
        return receipt

    def test_complete_true_sync_receipt_passes(self):
        with tempfile.TemporaryDirectory() as td:
            rows = require_true_lipsync_gate(self.make_receipt(Path(td)))
            self.assertEqual(sorted(rows), AAS_VISIBLE_IDS)

    def test_waveform_only_or_missing_manual_evidence_fails(self):
        with tempfile.TemporaryDirectory() as td:
            receipt = self.make_receipt(Path(td))
            data = json.loads(receipt.read_text())
            data["shots"][0]["manual_visual_sync_qa"] = "pending"
            receipt.write_text(json.dumps(data))
            with self.assertRaisesRegex(RuntimeError, "N00"):
                require_true_lipsync_gate(receipt)

    def test_bad_offset_fails(self):
        with tempfile.TemporaryDirectory() as td:
            receipt = self.make_receipt(Path(td))
            data = json.loads(receipt.read_text())
            data["shots"][4]["av_offset_frames"] = 3
            receipt.write_text(json.dumps(data))
            with self.assertRaises(RuntimeError):
                require_true_lipsync_gate(receipt)

    def test_hash_substitution_fails(self):
        with tempfile.TemporaryDirectory() as td:
            receipt = self.make_receipt(Path(td))
            data = json.loads(receipt.read_text())
            Path(data["shots"][2]["source"]).write_bytes(b"changed")
            with self.assertRaisesRegex(RuntimeError, "hash mismatch"):
                require_true_lipsync_gate(receipt)


if __name__ == "__main__":
    unittest.main(verbosity=2)
