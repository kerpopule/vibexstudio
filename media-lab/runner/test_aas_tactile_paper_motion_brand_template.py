#!/usr/bin/env python3
"""Contract tests for the repeatable 32-beat paper-motion brand template."""
from __future__ import annotations

import hashlib
import json
import subprocess
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SPEC_PATH = ROOT / "prompt-templates/aas-tactile-paper-motion-brand-explainer.json"
SOURCE_PATH = ROOT / "prompt-templates/source-media/aas-tactile-paper-motion-brand-explainer-source.mp4"
PREVIEW_PATH = ROOT / "static/templates/aas-tactile-paper-motion-brand-explainer.gif"
APP_PATH = ROOT / "app.py"
EXPECTED_PROMPT_SHA256 = "a6047b63d7ccc0752a4e294f27cdaba0ce11e4edece548c1bd377c84eeb08908"
EXPECTED_SOURCE_SHA256 = "b2177e63dee3ea2d598f0ea2f3f022678d5ae606974b9b6115c557b3568aa7f6"


def probe(path: Path) -> dict:
    raw = subprocess.check_output(
        [
            "ffprobe", "-v", "error",
            "-show_entries", "format=duration,size:stream=codec_type,codec_name,width,height,r_frame_rate,sample_rate,channels",
            "-of", "json", str(path),
        ],
        text=True,
    )
    return json.loads(raw)


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


class AasPaperMotionBrandTemplateContract(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.spec = json.loads(SPEC_PATH.read_text(encoding="utf-8"))
        cls.app = APP_PATH.read_text(encoding="utf-8")

    def test_template_identity_and_repeatable_slots(self) -> None:
        self.assertEqual(self.spec["schema_version"], "media_lab.prompt_template.v1")
        self.assertEqual(self.spec["template_id"], "aas-tactile-paper-motion-brand-explainer")
        self.assertEqual(self.spec["engine"], "ltx_h3_hybrid_storyboard")
        self.assertEqual(self.spec["status"], "proven_internal_candidate")
        self.assertEqual(self.spec["scope"], "private_internal")
        self.assertEqual(len(self.spec["storyboard_blueprint"]), 32)
        self.assertEqual([beat["beat"] for beat in self.spec["storyboard_blueprint"]], list(range(1, 33)))
        self.assertAlmostEqual(sum(beat["duration_seconds"] for beat in self.spec["storyboard_blueprint"]), 112.0, places=1)
        variables = self.spec["editable_variables"]
        for key in ("brand_name", "offer_a", "offer_b", "offer_c", "offer_d", "leader_1", "leader_2", "leader_3", "leader_4", "closing_line", "narration_script"):
            self.assertIn(key, variables)

    def test_prompt_is_pinned_and_one_beat_at_a_time(self) -> None:
        prompt = self.spec["prompt"]
        self.assertEqual(len(prompt), 1445)
        self.assertEqual(hashlib.sha256(prompt.encode("utf-8")).hexdigest(), EXPECTED_PROMPT_SHA256)
        for marker in (
            "exactly one current storyboard beat",
            "Do not attempt the entire long-form program in one generation",
            "deterministic post-production overlays",
            "Use LTX for fast production-quality",
            "Upgrade only identity-critical, hero, or difficult high-detail beats to H3",
        ):
            self.assertIn(marker, prompt)

    def test_engine_and_assembly_contract(self) -> None:
        routing = self.spec["engine_routing"]
        contract = self.spec["render_contract"]
        self.assertTrue(routing["single_flight_gpu"])
        self.assertTrue(routing["same_seed_ab_required_before_swap"])
        for key in (
            "one_generation_per_beat", "full_program_assembled_in_edit",
            "exactly_32_beats_by_default", "shared_visual_world_across_beats",
            "deterministic_text_only", "supplied_plate_is_composition_source_of_truth",
            "ltx_is_default_fast_lane", "h3_is_selective_premium_lane",
            "native_24fps_delivery", "audio_assembled_without_regeneration",
            "local_inference_only", "no_silent_engine_fallback",
            "do_not_call_final_before_steve_approval",
        ):
            self.assertTrue(contract[key], key)

    def test_source_master_and_gif_preview_decode(self) -> None:
        self.assertEqual(sha256(SOURCE_PATH), EXPECTED_SOURCE_SHA256)
        source = probe(SOURCE_PATH)
        source_streams = {stream["codec_type"]: stream for stream in source["streams"]}
        self.assertEqual((source_streams["video"]["width"], source_streams["video"]["height"]), (1920, 1080))
        self.assertEqual(source_streams["video"]["codec_name"], "h264")
        self.assertEqual(source_streams["video"]["r_frame_rate"], "24/1")
        self.assertEqual(source_streams["audio"]["codec_name"], "aac")
        self.assertEqual(source_streams["audio"]["sample_rate"], "48000")
        self.assertEqual(source_streams["audio"]["channels"], 2)
        self.assertAlmostEqual(float(source["format"]["duration"]), 112.0, places=3)

        preview = probe(PREVIEW_PATH)
        self.assertEqual(preview["streams"][0]["codec_name"], "gif")
        self.assertEqual((preview["streams"][0]["width"], preview["streams"][0]["height"]), (560, 315))
        self.assertEqual(preview["streams"][0]["r_frame_rate"], "10/1")
        self.assertAlmostEqual(float(preview["format"]["duration"]), 10.0, places=2)
        self.assertGreater(PREVIEW_PATH.stat().st_size, 500_000)
        self.assertLess(PREVIEW_PATH.stat().st_size, 5_000_000)

    def test_app_registry_exposes_template_and_preview(self) -> None:
        self.assertIn('_AAS_PAPER_MOTION_PROMPT = _load_prompt_template("aas-tactile-paper-motion-brand-explainer")', self.app)
        self.assertIn('"aas-tactile-paper-motion-brand-explainer.gif"', self.app)
        self.assertIn('"Full paper-motion brand explainer"', self.app)
        self.assertIn('("Proven Media Lab templates", [', self.app)


if __name__ == "__main__":
    unittest.main(verbosity=2)
