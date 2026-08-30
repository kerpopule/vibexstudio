#!/usr/bin/env python3
"""Regression checks for the attributed H3 floor-plan-to-building template."""

from __future__ import annotations

import hashlib
import json
import subprocess
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SPEC_PATH = ROOT / "prompt-templates" / "h3-floorplan-to-building-timelapse.json"
SOURCE_PATH = ROOT / "prompt-templates" / "source-media" / "h3-floorplan-to-building-timelapse-source.mp4"
PREVIEW_PATH = ROOT / "static" / "templates" / "h3-floorplan-to-building-timelapse.gif"
APP_PATH = ROOT / "app.py"
EXPECTED_SOURCE_PROMPT_SHA256 = "d963334a64e04bdeae663ce1e936568113b0140be3e8e7d164359cfa4d333f41"
EXPECTED_TEMPLATE_PROMPT_SHA256 = "b9e7ed9af0fe1dc6cb1f996c3542042b8af8eabc1b8319806f922a5b1bfe8a92"


class H3FloorplanToBuildingTemplateContract(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.spec = json.loads(SPEC_PATH.read_text(encoding="utf-8"))
        cls.app = APP_PATH.read_text(encoding="utf-8")

    def test_identity_scope_and_attribution(self) -> None:
        self.assertEqual(self.spec["template_id"], "h3-floorplan-to-building-timelapse")
        self.assertEqual(self.spec["engine"], "h3_fl2va")
        self.assertEqual(self.spec["status"], "source_captured_candidate")
        self.assertEqual(self.spec["scope"], "private_internal")
        provenance = self.spec["provenance"]
        self.assertEqual(
            provenance["source_prompt_url"],
            "https://x.com/PhotogenicWeekE/status/2093199674417316316?s=46",
        )
        self.assertEqual(
            provenance["source_example_url"],
            "https://x.com/PhotogenicWeekE/status/2093198730958897335",
        )
        self.assertIn("@PhotogenicWeekE", provenance["source_author"])

    def test_source_prompt_is_preserved_verbatim(self) -> None:
        source_prompt = self.spec["source_prompt_verbatim"]
        self.assertEqual(len(source_prompt), 2365)
        self.assertEqual(self.spec["source_prompt_character_count"], len(source_prompt))
        self.assertEqual(
            hashlib.sha256(source_prompt.encode("utf-8")).hexdigest(),
            EXPECTED_SOURCE_PROMPT_SHA256,
        )
        self.assertEqual(self.spec["source_prompt_sha256"], EXPECTED_SOURCE_PROMPT_SHA256)
        self.assertIn("[Shot 1] Photorealistic, cinematic", source_prompt)
        self.assertIn("[Shot 2] At 00:10.000", source_prompt)

    def test_reusable_prompt_is_pinned_and_construction_only(self) -> None:
        prompt = self.spec["prompt"]
        self.assertEqual(len(prompt), 2078)
        self.assertEqual(
            hashlib.sha256(prompt.encode("utf-8")).hexdigest(),
            EXPECTED_TEMPLATE_PROMPT_SHA256,
        )
        for marker in (
            "Picture 1 aligns with the 0.00-second mark",
            "uploaded architectural floor plan",
            "Preserve the plan’s footprint",
            "no unrelated second scene",
            "clean stable hold",
        ):
            self.assertIn(marker, prompt)
        self.assertNotIn("bedroom", prompt.lower())
        self.assertNotIn("woman", prompt.lower())
        self.assertNotIn("alarm clock", prompt.lower())

    def test_contract_requires_plan_fidelity_and_candidate_approval(self) -> None:
        contract = self.spec["render_contract"]
        for key in (
            "floorplan_reference_required",
            "uploaded_floorplan_is_geometry_source_of_truth",
            "preserve_footprint_orientation_rooms_openings_and_circulation",
            "single_coherent_construction_sequence",
            "construction_order_must_be_plausible",
            "matched_elevated_viewpoint",
            "restrained_camera_motion",
            "no_unrelated_second_scene",
            "do_not_call_final_before_steve_approval",
            "local_inference_only",
            "no_silent_engine_fallback",
            "fail_closed_without_decodable_floorplan_reference",
        ):
            self.assertIs(contract[key], True, key)
        self.assertEqual(contract["reference_alignment_seconds"], 0.0)
        self.assertGreaterEqual(contract["stable_final_hold_seconds_minimum"], 1.2)

    def test_source_video_and_construction_preview_decode(self) -> None:
        self.assertGreater(SOURCE_PATH.stat().st_size, 10_000_000)
        self.assertGreater(PREVIEW_PATH.stat().st_size, 100_000)

        def probe(path: Path) -> dict:
            raw = subprocess.check_output(
                [
                    "ffprobe",
                    "-v",
                    "error",
                    "-show_entries",
                    "format=duration,size:stream=codec_type,codec_name,width,height,r_frame_rate",
                    "-of",
                    "json",
                    str(path),
                ],
                text=True,
            )
            return json.loads(raw)

        source = probe(SOURCE_PATH)
        source_streams = {stream["codec_type"]: stream for stream in source["streams"]}
        self.assertEqual((source_streams["video"]["width"], source_streams["video"]["height"]), (1920, 1070))
        self.assertEqual(source_streams["video"]["codec_name"], "h264")
        self.assertEqual(source_streams["video"]["r_frame_rate"], "24/1")
        self.assertEqual(source_streams["audio"]["codec_name"], "aac")
        self.assertAlmostEqual(float(source["format"]["duration"]), 15.168, places=3)

        preview = probe(PREVIEW_PATH)
        self.assertEqual(preview["streams"][0]["codec_name"], "gif")
        self.assertEqual((preview["streams"][0]["width"], preview["streams"][0]["height"]), (480, 268))
        self.assertEqual(preview["streams"][0]["r_frame_rate"], "12/1")
        self.assertAlmostEqual(float(preview["format"]["duration"]), 10.0, places=2)

    def test_app_registry_references_template_artifacts(self) -> None:
        self.assertIn(
            '_H3_FLOORPLAN_BUILD_PROMPT = _load_prompt_template("h3-floorplan-to-building-timelapse")',
            self.app,
        )
        self.assertIn('"h3-floorplan-to-building-timelapse.gif"', self.app)
        self.assertIn('"Floor plan → finished building"', self.app)
        self.assertIn("_H3_FLOORPLAN_BUILD_PROMPT", self.app)


if __name__ == "__main__":
    unittest.main(verbosity=2)
