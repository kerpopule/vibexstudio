import json
import re
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent
STATIC = ROOT / "static"
LIBRARY = STATIC / "template-library"
SHIPPED = 494
# Ids the reviewed upstream commit never had.
UPSTREAM_GAPS = {12, 169, 170}
# Taken out for rights reasons (franchise characters or branding, and one local
# record marked private research / no redistribution). See NOTICE.md; these
# must never come back.
REMOVED_FOR_RIGHTS = {24, 25, 43, 52, 84, 85, 86, 87, 91, 112, 125, 143, 145, 146,
                      147, 148, 161, 166, 174, 197, 207, 241, 250, 251, 282, 287,
                      299, 301, 309, 527}
# A rights note that forbids what a public repository does.
FORBIDDING_NOTE = re.compile(
    r"no (?:publication|redistribution|commercial)|not for (?:redistribution|commercial)"
    r"|non-?commercial|private (?:research|use)|research[- ]only|personal use only"
    r"|all rights reserved|do not (?:share|redistribute|repost)", re.I)
# Franchise titles and characters the removed cases named. They are public titles,
# not private identifiers, so plain text is fine here.
FRANCHISE_TERMS = re.compile(
    r"saint seiya|gold saints?|demon slayer|kimetsu|naruto|bleach\b(?! ?(?:wash|stain))|dragon ball"
    r"|minecraft|game of thrones|genshin|honkai|star rail|mai shiranui|king of fighters"
    r"|t-800|terminator|xenomorph|league of legends|black myth|garden of words"
    r"|little prince|jojo|tom and jerry|gumball|watterson|nazuna|call of the night"
    r"|grand theft auto|gta ?(?:vi|6)|leonida|vagabond|overlord|albedo", re.I)


class ImageTemplateStaticContractTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.manifest = json.loads((LIBRARY / "cases.json").read_text())
        cls.cases = cls.manifest["cases"]

    def test_manifest_contains_all_actual_cases_and_expected_ids(self):
        self.assertEqual(SHIPPED, self.manifest["totalCases"])
        self.assertEqual(SHIPPED, len(self.cases))
        ids = [case["id"] for case in self.cases]
        self.assertEqual(SHIPPED, len(set(ids)))
        self.assertEqual(UPSTREAM_GAPS | REMOVED_FOR_RIGHTS, set(range(1, 528)) - set(ids))
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
        self.assertEqual(SHIPPED, len(set(refs)))
        image_files = [p for p in (LIBRARY / "images").iterdir() if p.is_file()]
        self.assertEqual(SHIPPED, len(image_files))
        shipped = {p.name for p in image_files}
        for cid in REMOVED_FOR_RIGHTS:
            self.assertFalse({f"case{cid}.jpg", f"case{cid}.png", f"case{cid}.gif"} & shipped, cid)

    def test_no_shipped_case_is_marked_private_or_non_redistributable(self):
        for case in self.cases:
            with self.subTest(case=case["id"]):
                note = " ".join(str(case.get(k) or "") for k in ("rightsNote", "provenance", "license"))
                self.assertIsNone(FORBIDDING_NOTE.search(note), note)
                if case.get("provenance") == "media-lab-local":
                    # a local addition must say redistribution is allowed
                    self.assertRegex(case["rightsNote"], re.compile(r"redistribut", re.I))

    def test_no_shipped_case_names_a_removed_franchise(self):
        for case in self.cases:
            with self.subTest(case=case["id"]):
                text = " ".join(str(case.get(k) or "") for k in (
                    "title", "orig_title", "prompt", "orig_prompt", "promptPreview", "imageAlt"))
                self.assertIsNone(FRANCHISE_TERMS.search(text))

    def test_notice_states_the_provenance_rules_and_lists_every_removal(self):
        notice = (LIBRARY / "NOTICE.md").read_text()
        self.assertIn("## Provenance rules", notice)
        self.assertNotIn("private research/learning adaptation", notice)
        listed = {int(n) for n in re.findall(r"^\| (\d+) \|", notice, re.M)}
        self.assertEqual(REMOVED_FOR_RIGHTS, listed)

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
