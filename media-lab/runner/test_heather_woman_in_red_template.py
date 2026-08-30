#!/usr/bin/env python3
import json
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


class HeatherWomanInRedTemplateContract(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.spec = json.loads(
            (ROOT / "prompt-templates/heather-woman-in-red-cinematic-mv.json").read_text()
        )
        cls.app = (ROOT / "app.py").read_text()

    def test_promoted_template_is_registered_with_preview(self):
        self.assertEqual(
            self.spec["template_id"], "heather-woman-in-red-cinematic-mv"
        )
        self.assertEqual(self.spec["status"], "promoted_creative_direction")
        self.assertIn('"heather-woman-in-red-cinematic-mv"', self.app)
        preview = ROOT / "static/templates/woman-in-red-cinematic-mv.gif"
        self.assertTrue(preview.is_file())
        self.assertGreater(preview.stat().st_size, 1000)

    def test_not_talking_head_and_dynamic_shot_balance_are_binding(self):
        creative = self.spec["creative_contract"]
        self.assertTrue(creative["not_a_talking_head_video"])
        self.assertLessEqual(creative["performance_shot_max_fraction"], 0.4)
        self.assertGreaterEqual(creative["narrative_environment_min_fraction"], 0.6)
        camera = " ".join(creative["camera_language"]).lower()
        for required in ("silhouette", "rain-streaked", "reflection", "aerial", "orbital"):
            self.assertIn(required, camera)

    def test_recovered_story_grammar_covers_steves_required_beats(self):
        prompts = " ".join(x["prompt"] for x in self.spec["shot_sequence"]).lower()
        for required in (
            "smoky nightclub",
            "rain-streaked",
            "reflection",
            "mirror",
            "silhouette",
            "small car",
            "rain-slick empty highway",
            "passenger-side",
            "taillights",
        ):
            self.assertIn(required, prompts)

    def test_identity_audio_and_failure_gates_remain_strict(self):
        contract = self.spec["render_contract"]
        self.assertTrue(contract["separate_identity_references"])
        self.assertTrue(contract["preserve_approved_audio_master"])
        self.assertTrue(contract["pin_seed_within_each_ab_pair"])
        self.assertTrue(contract["one_variable_per_test"])
        self.assertTrue(contract["audio_scale_ltx_only"])
        self.assertTrue(contract["existing_or_running_jobs_unchanged"])
        forbidden = " ".join(self.spec["forbidden"]).lower()
        self.assertIn("contact sheets", forbidden)
        self.assertIn("grey-canvas", forbidden)
        self.assertIn("silent engine fallback", forbidden)
        self.assertIn("religious imagery", forbidden)

    def test_provenance_is_honest_about_unverified_x_source(self):
        provenance = self.spec["provenance"]
        self.assertIn("STORYBOARD.json", provenance["recovered_from"])
        self.assertIn("unverified", provenance["source_credit_status"].lower())
        self.assertIn("credit-limit", provenance["source_credit_status"].lower())


if __name__ == "__main__":
    unittest.main(verbosity=2)
