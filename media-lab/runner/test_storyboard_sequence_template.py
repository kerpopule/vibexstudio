import json
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


class StoryboardSequenceTemplateContract(unittest.TestCase):
    def test_registry_and_reference_transport_fail_closed(self):
        spec = json.loads(
            (ROOT / "prompt-templates/h3-storyboard-sequential-beats.json").read_text()
        )
        self.assertEqual(spec["template_id"], "h3-storyboard-sequential-beats")
        self.assertEqual(spec["engine"], "h3_ref2va")
        transport = spec["reference_transport"]
        self.assertEqual(transport["required_variant"], "minimax_h3_ref2va")
        self.assertEqual(transport["storyboard"]["mode"], "reference")
        self.assertIn("image_start", transport["storyboard"]["forbidden_modes"])
        self.assertIn("first_frame", transport["storyboard"]["forbidden_modes"])
        self.assertIn("do not fall back", transport["fail_closed"].lower())

    def test_live_registry_entry_and_owned_preview_exist(self):
        app = (ROOT / "app.py").read_text()
        self.assertIn('"h3-storyboard-sequential-beats"', app)
        self.assertIn('"Field-tested H3 workflows"', app)
        self.assertIn("not as a static image", app)
        preview = ROOT / "static/templates/h3-storyboard-sequence.gif"
        self.assertTrue(preview.is_file())
        self.assertGreater(preview.stat().st_size, 1000)


if __name__ == "__main__":
    unittest.main()
