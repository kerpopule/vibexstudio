#!/usr/bin/env python3
import hashlib
import json
import subprocess
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SPEC_PATH = ROOT / "prompt-templates/h3-alcatraz-stickman-doodle-history.json"
PREVIEW_PATH = ROOT / "static/templates/h3-alcatraz-stickman-doodle-history.gif"
SOURCE_PATH = ROOT / "prompt-templates/source-media/h3-alcatraz-stickman-doodle-history-source.mp4"


class H3AlcatrazStickmanDoodleHistoryTemplateContract(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.spec = json.loads(SPEC_PATH.read_text(encoding="utf-8"))
        cls.app = (ROOT / "app.py").read_text(encoding="utf-8")

    def test_source_prompt_is_preserved_exactly(self):
        prompt = self.spec["prompt"]
        self.assertEqual(self.spec["template_id"], "h3-alcatraz-stickman-doodle-history")
        self.assertEqual(self.spec["engine"], "h3_t2v")
        self.assertEqual(self.spec["status"], "source_captured_candidate")
        self.assertEqual(len(prompt), 4971)
        self.assertEqual(
            hashlib.sha256(prompt.encode("utf-8")).hexdigest(),
            "4323d440a0b6d078e70dc51063055b29b1944613fe005a2388c59deca5baffaf",
        )
        for marker in (
            "0-2s:", "2-4s:", "4-6s:", "6-8s:", "8-10s:", "10-12s:",
            "12-15s (freeze-hold anchor, unresolved ending):",
        ):
            self.assertIn(marker, prompt)
        self.assertIn('Line 1 (early, quick tag): "ALCATRAZ"', prompt)
        self.assertIn('Line 2 (final tag): "JUNE 1962"', prompt)

    def test_template_is_registered_with_attributed_preview(self):
        self.assertIn('"h3-alcatraz-stickman-doodle-history"', self.app)
        self.assertIn("_H3_ALCATRAZ_STICKMAN_PROMPT", self.app)
        provenance = self.spec["provenance"]
        self.assertEqual(
            provenance["source_prompt_url"],
            "https://x.com/koldo2k/status/2092722673847574965?s=46",
        )
        self.assertIn("@koldo2k", provenance["source_author"])
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
        self.assertEqual((source["streams"][0]["width"], source["streams"][0]["height"]), (1344, 768))
        self.assertGreaterEqual(float(preview["format"]["duration"]), 15.0)
        self.assertGreaterEqual(float(source["format"]["duration"]), 15.0)

    def test_render_gates_preserve_candidate_status(self):
        contract = self.spec["render_contract"]
        self.assertTrue(contract["stickman_whiteboard_style"])
        self.assertTrue(contract["single_weight_black_linework"])
        self.assertEqual(contract["exact_text_only"], ["ALCATRAZ", "JUNE 1962"])
        self.assertTrue(contract["unresolved_ending"])
        self.assertTrue(contract["local_inference_only"])
        self.assertTrue(contract["no_silent_engine_fallback"])
        self.assertTrue(contract["do_not_call_final_before_steve_approval"])
        self.assertIn("source result as reference evidence", " ".join(self.spec["qa_gates"]))


if __name__ == "__main__":
    unittest.main(verbosity=2)