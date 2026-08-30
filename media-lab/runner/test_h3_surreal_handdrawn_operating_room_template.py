#!/usr/bin/env python3
import hashlib
import json
import subprocess
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SPEC_PATH = ROOT / "prompt-templates/h3-surreal-hand-drawn-operating-room.json"
PREVIEW_PATH = ROOT / "static/templates/h3-surreal-hand-drawn-operating-room.gif"
SOURCE_PATH = ROOT / "prompt-templates/source-media/h3-surreal-hand-drawn-operating-room-source.mp4"


class H3SurrealHandDrawnOperatingRoomTemplateContract(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.spec = json.loads(SPEC_PATH.read_text(encoding="utf-8"))
        cls.app = (ROOT / "app.py").read_text(encoding="utf-8")

    def test_source_prompt_is_preserved_exactly(self):
        prompt = self.spec["prompt"]
        self.assertEqual(self.spec["template_id"], "h3-surreal-hand-drawn-operating-room")
        self.assertEqual(self.spec["engine"], "h3_t2v")
        self.assertEqual(self.spec["status"], "source_captured_candidate")
        self.assertEqual(len(prompt), 6169)
        self.assertEqual(
            hashlib.sha256(prompt.encode("utf-8")).hexdigest(),
            "ae305ddb32307c19d69e504c844229f96588c24a7ec7d9f814378751f0c493f6",
        )
        for timed_range in ("0–3 seconds", "3–6 seconds", "6–10 seconds", "10–13 seconds", "13–15 seconds"):
            self.assertIn(timed_range, prompt)

    def test_template_is_registered_with_attributed_preview(self):
        self.assertIn('"h3-surreal-hand-drawn-operating-room"', self.app)
        self.assertIn("_H3_SURREAL_HANDDRAWN_OR_PROMPT", self.app)
        provenance = self.spec["provenance"]
        self.assertEqual(
            provenance["source_prompt_url"],
            "https://x.com/azed_ai/status/2092313996242337988?s=46",
        )
        self.assertEqual(
            provenance["source_example_url"],
            "https://x.com/azed_ai/status/2092313983131042093",
        )
        self.assertIn("@azed_ai", provenance["source_author"])
        self.assertTrue(PREVIEW_PATH.is_file())
        self.assertGreater(PREVIEW_PATH.stat().st_size, 100_000)
        self.assertTrue(SOURCE_PATH.is_file())
        self.assertGreater(SOURCE_PATH.stat().st_size, 1_000_000)

    def test_preview_and_source_decode_with_expected_geometry(self):
        def probe(path):
            raw = subprocess.check_output(
                [
                    "ffprobe", "-v", "error", "-select_streams", "v:0",
                    "-show_entries", "stream=codec_name,width,height",
                    "-show_entries", "format=duration", "-of", "json", str(path),
                ],
                text=True,
            )
            return json.loads(raw)

        preview = probe(PREVIEW_PATH)
        source = probe(SOURCE_PATH)
        self.assertEqual(preview["streams"][0]["codec_name"], "gif")
        self.assertEqual((preview["streams"][0]["width"], preview["streams"][0]["height"]), (480, 270))
        self.assertEqual((source["streams"][0]["width"], source["streams"][0]["height"]), (1280, 720))
        self.assertGreaterEqual(float(preview["format"]["duration"]), 15.0)
        self.assertGreaterEqual(float(source["format"]["duration"]), 15.0)

    def test_render_gates_preserve_candidate_status(self):
        contract = self.spec["render_contract"]
        self.assertTrue(contract["one_uninterrupted_take"])
        self.assertTrue(contract["animation_leads_camera"])
        self.assertTrue(contract["continuous_physical_transformations"])
        self.assertTrue(contract["environmental_audio_only"])
        self.assertTrue(contract["local_inference_only"])
        self.assertTrue(contract["no_silent_engine_fallback"])
        self.assertTrue(contract["do_not_call_final_before_steve_approval"])
        self.assertIn("source result as reference evidence", " ".join(self.spec["qa_gates"]))


if __name__ == "__main__":
    unittest.main(verbosity=2)
