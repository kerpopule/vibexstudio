from pathlib import Path
import unittest

ROOT = Path(__file__).parents[1]
PROD = ROOT / "productions/aas-founder-performance-nightmare-2026-08-30"


class AASNativeH3FaceSafetyTests(unittest.TestCase):
    def test_assembly_requires_native_h3_opening_and_body_n14(self):
        assembly = (PROD / "assemble_aas_20shot.py").read_text()
        recut = (PROD / "smart_trim_recut_aas.py").read_text()
        restore = (PROD / "restore_aas_storyboard_20shot.py").read_text()
        self.assertIn("review/native-h3-repair/opening-hello-final/OPENING-native-H3-authoritative.mp4", assembly)
        self.assertIn("review/native-h3-repair/opening-hello-final/opening-native-h3-qa.json", assembly)
        self.assertIn("review/native-h3-repair/source-lipsync-qa-native-N14.json", recut)
        self.assertIn("review/native-h3-repair/opening-hello-final/opening-native-h3-qa.json", restore)
        self.assertNotIn("review/source-lipsync/opening-final/OPENING-authoritative.mp4", assembly)

    def test_rejected_opening_face_sync_aborts(self):
        source = (PROD / "submit_aas_opening_exact_audio_resync.py").read_text()
        self.assertIn("raise RuntimeError('REJECTED PIPELINE: post-H3 LatentSync damaged Steve identity/mouth", source)

    def test_rejected_n14_face_sync_aborts(self):
        source = (PROD / "submit_aas_n14_exact_audio_resync.py").read_text()
        self.assertIn("raise RuntimeError('REJECTED PIPELINE: post-H3 LatentSync damaged Steve identity/mouth", source)

    def test_storyboard_uses_hello_not_hey(self):
        source = (PROD / "restore_aas_storyboard_20shot.py").read_text()
        self.assertIn("Hello, welcome to Automated AI Solutions. I am Steve", source)
        self.assertNotIn("Hey, welcome to Automated AI Solutions", source)

    def test_native_opening_uses_proven_seed_and_prompt_builder(self):
        source = (PROD / "submit_aas_opening_hello_native_h3.py").read_text()
        self.assertIn("from submit_principal_h3 import build_prompt", source)
        self.assertIn("SEED=2026083001", source)
        self.assertIn("'post_h3_face_transform_permitted':False", source)

    def test_no_legacy_n10_voiceover_exception(self):
        source = (PROD / "verify_aas_coupled_sync.py").read_text()
        self.assertNotIn("closed_mouth_voiceover", source)
        self.assertNotIn('if sid=="N10"', source)

    def test_native_opening_syncnet_is_measurement_only(self):
        source = (PROD / "run_aas_opening_hello_native_syncnet.py").read_text()
        self.assertIn("'measurement_only':True", source)
        self.assertNotIn("/api/enhance", source)


if __name__ == "__main__":
    unittest.main()
