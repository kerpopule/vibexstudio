#!/usr/bin/env python3
import hashlib
import json
import subprocess
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SPEC_PATH = ROOT / "prompt-templates/h3-explosive-flat-motion-graphics.json"
PREVIEW_PATH = ROOT / "static/templates/h3-explosive-flat-motion-graphics.gif"
SOURCE_PATH = ROOT / "prompt-templates/source-media/h3-explosive-flat-motion-graphics-source.mp4"


class H3ExplosiveFlatMotionGraphicsTemplateContract(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.spec = json.loads(SPEC_PATH.read_text(encoding="utf-8"))
        cls.app = (ROOT / "app.py").read_text(encoding="utf-8")

    def test_source_prompt_is_preserved_exactly(self):
        prompt = self.spec["prompt"]
        self.assertEqual(self.spec["template_id"], "h3-explosive-flat-motion-graphics")
        self.assertEqual(self.spec["engine"], "h3_t2v")
        self.assertEqual(self.spec["status"], "source_captured_candidate")
        self.assertEqual(len(prompt), 2918)
        self.assertEqual(
            hashlib.sha256(prompt.encode("utf-8")).hexdigest(),
            "a1c9ca8328b8232bd7c43b3b9ae9a8c1958518f8ee7e36ba566a18c9fb0f8e43",
        )
        for shot in range(1, 10):
            self.assertIn(f"[Shot {shot}]", prompt)

    def test_template_is_registered_with_attributed_preview(self):
        self.assertIn('"h3-explosive-flat-motion-graphics"', self.app)
        self.assertIn("_H3_EXPLOSIVE_MOTION_PROMPT", self.app)
        provenance = self.spec["provenance"]
        self.assertEqual(
            provenance["source_url"],
            "https://x.com/studio_oneroom/status/2092220604309205341?s=46",
        )
        self.assertIn("@studio_oneroom", provenance["source_author"])
        self.assertTrue(PREVIEW_PATH.is_file())
        self.assertGreater(PREVIEW_PATH.stat().st_size, 100_000)
        self.assertTrue(SOURCE_PATH.is_file())
        self.assertGreater(SOURCE_PATH.stat().st_size, PREVIEW_PATH.stat().st_size)

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
        self.assertEqual((preview["streams"][0]["width"], preview["streams"][0]["height"]), (560, 315))
        self.assertEqual((source["streams"][0]["width"], source["streams"][0]["height"]), (2560, 1440))
        self.assertGreaterEqual(float(preview["format"]["duration"]), 15.0)
        self.assertGreaterEqual(float(source["format"]["duration"]), 15.0)

    def test_render_gates_preserve_candidate_status(self):
        contract = self.spec["render_contract"]
        self.assertTrue(contract["exactly_nine_shots"])
        self.assertTrue(contract["exact_text_only"])
        self.assertTrue(contract["local_inference_only"])
        self.assertTrue(contract["no_silent_engine_fallback"])
        self.assertTrue(contract["do_not_call_final_before_steve_approval"])
        self.assertIn("source result as reference evidence", " ".join(self.spec["qa_gates"]))


if __name__ == "__main__":
    unittest.main(verbosity=2)
