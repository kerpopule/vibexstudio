#!/usr/bin/env python3
"""Regression checks for the attributed four-color Sherlock H3 template."""

from __future__ import annotations

import hashlib
import json
import subprocess
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SPEC_PATH = ROOT / "prompt-templates" / "h3-four-color-sherlock-motion-design.json"
SOURCE_PATH = ROOT / "prompt-templates" / "source-media" / "h3-four-color-sherlock-motion-design-source.mp4"
PREVIEW_PATH = ROOT / "static" / "templates" / "h3-four-color-sherlock-motion-design.gif"
APP_PATH = ROOT / "app.py"
EXPECTED_PROMPT_SHA256 = "7ab250b97d604d6cca0684a90abcd732db25bce89c539b2c0b0c42180f706636"


class FourColorSherlockTemplateTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.spec = json.loads(SPEC_PATH.read_text(encoding="utf-8"))

    def test_identity_scope_and_provenance(self) -> None:
        self.assertEqual(self.spec["template_id"], "h3-four-color-sherlock-motion-design")
        self.assertEqual(self.spec["engine"], "h3_t2v")
        self.assertEqual(self.spec["status"], "source_captured_candidate")
        self.assertEqual(self.spec["scope"], "private_internal")
        provenance = self.spec["provenance"]
        self.assertEqual(
            provenance["source_prompt_url"],
            "https://x.com/Mayz1169/status/2092598128637772112",
        )
        self.assertEqual(
            provenance["source_example_url"],
            "https://x.com/Mayz1169/status/2092597548863402041",
        )
        self.assertEqual(provenance["source_author"], "Kiki (@Mayz1169)")
        self.assertEqual(
            provenance["inspiration_url"],
            "https://x.com/renataro9/status/2090573248752934994",
        )

    def test_exact_prompt_is_pinned(self) -> None:
        prompt = self.spec["prompt"]
        self.assertEqual(len(prompt), 3721)
        self.assertEqual(self.spec["source_prompt_character_count"], len(prompt))
        self.assertEqual(hashlib.sha256(prompt.encode("utf-8")).hexdigest(), EXPECTED_PROMPT_SHA256)
        self.assertTrue(prompt.startswith("Create a 15-second horizontal 16:9"))
        self.assertTrue(prompt.endswith("inconsistent character silhouettes."))

    def test_contract_and_nine_beats(self) -> None:
        self.assertEqual(len(self.spec["timed_beats"]), 9)
        self.assertEqual(self.spec["timed_beats"][0]["seconds"], "0–1.3")
        self.assertEqual(self.spec["timed_beats"][-1]["seconds"], "14.1–15.2")
        contract = self.spec["render_contract"]
        for key in (
            "text_to_video_only",
            "strict_four_color_palette",
            "exactly_nine_timed_beats",
            "consistent_character_silhouettes",
            "no_dialogue_or_subtitles",
            "no_modern_technology_guns_or_contemporary_vehicles",
            "no_photorealism_or_gradients",
            "do_not_call_final_before_steve_approval",
            "local_inference_only",
            "no_silent_engine_fallback",
        ):
            self.assertIs(contract[key], True, key)

    def test_source_video_and_preview_are_valid(self) -> None:
        self.assertGreater(SOURCE_PATH.stat().st_size, 1_000_000)
        self.assertGreater(PREVIEW_PATH.stat().st_size, 100_000)
        result = subprocess.run(
            [
                "ffprobe",
                "-v",
                "error",
                "-show_entries",
                "format=duration:stream=codec_type,codec_name,width,height,r_frame_rate",
                "-of",
                "json",
                str(SOURCE_PATH),
            ],
            check=True,
            capture_output=True,
            text=True,
        )
        probe = json.loads(result.stdout)
        self.assertAlmostEqual(float(probe["format"]["duration"]), 15.11619, places=3)
        streams = {stream["codec_type"]: stream for stream in probe["streams"]}
        self.assertEqual((streams["video"]["width"], streams["video"]["height"]), (1920, 1080))
        self.assertEqual(streams["video"]["codec_name"], "h264")
        self.assertEqual(streams["video"]["r_frame_rate"], "30/1")
        self.assertEqual(streams["audio"]["codec_name"], "aac")

    def test_app_registry_references_artifacts(self) -> None:
        app_source = APP_PATH.read_text(encoding="utf-8")
        self.assertIn(
            '_H3_FOUR_COLOR_SHERLOCK_PROMPT = _load_prompt_template("h3-four-color-sherlock-motion-design")',
            app_source,
        )
        self.assertIn('"h3-four-color-sherlock-motion-design.gif"', app_source)
        self.assertIn('"Four-color Sherlock mystery"', app_source)


if __name__ == "__main__":
    unittest.main(verbosity=2)
