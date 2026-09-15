import json
import re
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent
STATIC = ROOT / "static"
LIBRARY = STATIC / "template-library"


class ImageTemplateStaticContractTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.manifest = json.loads((LIBRARY / "cases.json").read_text())
        cls.cases = cls.manifest["cases"]

    def test_manifest_contains_all_actual_cases_and_expected_ids(self):
        self.assertEqual(524, self.manifest["totalCases"])
        self.assertEqual(524, len(self.cases))
        ids = [case["id"] for case in self.cases]
        self.assertEqual(524, len(set(ids)))
        self.assertEqual({12, 169, 170}, set(range(1, 528)) - set(ids))
        self.assertEqual(
            "3a9c63baa03e6bbe2f28c89a2654cf9845466646",
            self.manifest["source"]["commit"],
        )
        self.assertEqual("MIT", self.manifest["source"]["license"])

    def test_every_case_has_local_unique_preview_and_preserved_attribution(self):
        refs = []
        for case in self.cases:
            with self.subTest(case=case["id"]):
                self.assertTrue(case["title"])
                self.assertTrue(case["prompt"])
                self.assertTrue(case["sourceLabel"])
                if case.get("provenance") == "media-lab-local":
                    self.assertTrue(case["sourceUrl"].startswith("https://"))
                    self.assertTrue(case.get("rightsNote"))
                else:
                    self.assertTrue(case["githubUrl"].startswith("https://github.com/"))
                ref = case["image"]
                self.assertTrue(ref.startswith("/static/template-library/images/"))
                path = STATIC / ref.removeprefix("/static/")
                self.assertTrue(path.is_file(), path)
                self.assertGreater(path.stat().st_size, 0)
                refs.append(ref)
        self.assertEqual(524, len(set(refs)))
        image_files = [p for p in (LIBRARY / "images").iterdir() if p.is_file()]
        self.assertEqual(524, len(image_files))

    def test_visible_notice_and_local_ui_assets_are_wired(self):
        notice = (LIBRARY / "NOTICE.md").read_text()
        self.assertIn("research/learning", notice.lower())
        self.assertIn("commercial rights", notice.lower())
        self.assertIn("rightsholder", notice.lower())
        self.assertTrue((LIBRARY / "LICENSE").is_file())

        html = (STATIC / "index.html").read_text()
        self.assertIn('id="imageTemplateLaunch"', html)
        self.assertRegex(html, r'/static/image-templates\.css\?v=\d+')
        self.assertRegex(html, r'/static/image-templates\.js\?v=\d+')
        self.assertIn('id="i_prompt"', html)
        self.assertIn('maxlength="8192"', html)

        javascript = (STATIC / "image-templates.js").read_text()
        for contract in (
            "itlSearch", "itlCategory", "itlStyle", "itlScene", "itlCount",
            'img.loading = "lazy"', "itlReset", "itlCopy", "itlUse", "itlAsk",
            "openWithTemplate", "selected_image_template",
        ):
            if contract == "selected_image_template":
                javascript = javascript + (STATIC / "medialab-chat.js").read_text()
            self.assertIn(contract, javascript)

    def test_service_worker_precaches_code_but_not_large_library_payloads(self):
        sw = (STATIC / "sw.js").read_text()
        match = re.search(r"const SHELL = \[(.*?)\];", sw, re.S)
        self.assertIsNotNone(match)
        shell = match.group(1)
        self.assertIn('/static/image-templates.css', shell)
        self.assertIn('/static/image-templates.js', shell)
        self.assertNotIn('template-library/cases.json', shell)
        self.assertNotIn('template-library/images', shell)
        self.assertRegex(sw, r'const CACHE = "medialab(?:-studio)?-v\d+"')
        self.assertIn('url.pathname.startsWith("/static/template-library/")', sw)


if __name__ == "__main__":
    unittest.main()
