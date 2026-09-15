import json
import subprocess
import tempfile
import pytest
import unittest
from pathlib import Path

import coupled_av_trim as c


class CoupledAvTrimTests(unittest.TestCase):
    def test_visible_dialogue_command_has_one_timeline_input(self):
        cmd = c.build_command(Path("source.mp4"), Path("out.mp4"), 0.1, 1.5)
        self.assertEqual(cmd.count("-i"), 1)
        self.assertIn(["-map", "0:v:0", "-map", "0:a:0"], [cmd[i:i+4] for i in range(len(cmd)-3)])
        self.assertNotIn("-itsoffset", cmd)

    def test_real_coupled_trim_keeps_audio_and_duration(self):
        with tempfile.TemporaryDirectory() as td:
            td = Path(td); src = td / "src.mp4"; out = td / "out.mp4"
            subprocess.run(["ffmpeg", "-nostdin", "-v", "error", "-y", "-f", "lavfi", "-i", "testsrc2=size=320x176:rate=24:duration=2", "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000:duration=2", "-shortest", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", str(src)], check=True)
            receipt = c.coupled_av_trim(src, out, 0.4, 0.8, width=320, height=176)
            self.assertTrue(out.is_file())
            self.assertTrue(receipt["coupled_av_trim"])
            self.assertLess(abs(receipt["duration_seconds"] - 0.8), 0.08)
            self.assertTrue(receipt["has_audio"])

    @pytest.mark.spark  # needs the Spark's private productions/ or image-svc/ tree
    def test_unsafe_vibex_legacy_recut_is_disabled(self):
        source = (Path(__file__).parents[1] / "productions/vibexstudio-founder-explainer-2026-08-30/smart_trim_recut.py").read_text()
        self.assertIn("UNSAFE_INDEPENDENT_DIALOGUE_REMUX_DISABLED = True", source)
        self.assertIn("rebuild_vibex_synced.py", source)
        prod = Path(__file__).parents[1] / "productions/vibexstudio-founder-explainer-2026-08-30"
        for legacy in ("stitch_candidate.py", "repair_vx02_audio_exact.py"):
            legacy_source = (prod / legacy).read_text()
            self.assertIn("UNSAFE_INDEPENDENT_DIALOGUE_REMUX_DISABLED = True", legacy_source, legacy)

    @pytest.mark.spark  # needs the Spark's private productions/ or image-svc/ tree
    def test_aas_visible_dialogue_uses_shared_coupled_trim(self):
        source = (Path(__file__).parents[1] / "productions/aas-founder-performance-nightmare-2026-08-30/smart_trim_recut_aas.py").read_text()
        self.assertIn("from coupled_av_trim import coupled_av_trim", source)
        self.assertIn("all_dialogue_coupled", source)
        self.assertIn("no_still_or_separate_audio_exception", source)
        self.assertNotIn("N10-deterministic-voiceover-plate", source)
        self.assertNotIn("separate narration allowed", source)
        self.assertEqual(source.count('"1:a:0"'), 0, "no AAS shot may map separate narration")
        self.assertIn("deliverables/coupled-trim", source)


if __name__ == "__main__":
    unittest.main(verbosity=2)
