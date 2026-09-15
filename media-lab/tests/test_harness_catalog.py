"""Harness catalog tests — acceptance proof 7.

Proof 7: harness selection is optional, source-verified, isolated, and
separately approved.  The catalog only lists entries with an exact immutable
upstream source and a review receipt; names from speech transcription are never
treated as verified products.  Installation is a separate explicit apply gate,
never auto-executed.
"""
from pathlib import Path
import json
import tempfile
import unittest

from media_lab_core.harness_catalog import HarnessCatalog, HarnessOption, HarnessAdapter

SHA64 = "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2c3d4"


def catalog_json() -> Path:
    tmp = Path(tempfile.mkdtemp()) / "harnesses.json"
    data = {
        "harnesses": [
            {
                "id": "hermes-agent", "name": "Hermes Agent",
                "source_url": "https://github.com/NousResearch/hermes-agent",
                "docs_url": "https://hermes-agent.nousresearch.com/docs",
                "immutable_release": "v1.0.0", "sha256": SHA64,
                "license_name": "Apache-2.0",
                "permissions": ["filesystem", "network"],
                "isolation": "container",
                "tool_access": ["terminal", "web"],
                "network_policy": "default-deny",
                "maintenance_model": "official",
                "compatibility": "spark-aarch64",
                "resource_footprint_gb": 4.0,
                "review_receipt": "review-2026-08-19-hermes",
                "terms_acceptance_required": False,
            },
            {
                "id": "openclaw", "name": "OpenClaw",
                "source_url": "https://github.com/example/openclaw",
                "docs_url": "https://openclaw.example/docs",
                "immutable_release": "v0.9.0", "sha256": SHA64,
                "license_name": "MIT",
                "permissions": ["terminal"],
                "isolation": "container",
                "tool_access": ["terminal"],
                "network_policy": "default-deny",
                "maintenance_model": "community",
                "compatibility": "spark-aarch64",
                "resource_footprint_gb": 2.5,
                "review_receipt": "review-2026-08-19-openclaw",
                "terms_acceptance_required": True,
            },
        ]
    }
    tmp.write_text(json.dumps(data))
    return tmp


class HarnessCatalogProof(unittest.TestCase):
    def test_lists_only_selectable_verified(self):
        cat = HarnessCatalog(catalog_json())
        opts = cat.list()
        self.assertGreaterEqual(len(opts), 1)
        for o in opts:
            self.assertTrue(o.selectable())
            self.assertTrue(o.source_url)
            self.assertTrue(o.review_receipt)

    def test_selection_requires_apply_gate(self):
        cat = HarnessCatalog(catalog_json())
        sel = cat.resolve_selection("hermes-agent")
        self.assertEqual(sel["installed"], False)
        self.assertEqual(sel["apply_required"], True)

    def test_refuses_unverified_name_from_speech(self):
        cat = HarnessCatalog(catalog_json())
        with self.assertRaises(ValueError):
            cat.resolve_selection("the-deepseek-harness-someone-mentioned")  # never a verified id

    def test_refuses_missing_sha(self):
        cat = HarnessCatalog(catalog_json())
        ok = cat.get("hermes-agent")
        # A forged entry with no immutable release / review receipt is not selectable.
        fake = HarnessOption(
            id="fake", name="Fake", source_url="https://xf",
            docs_url="https://xd", immutable_release="", sha256="short",
            license_name="?", permissions=(), isolation="none",
            tool_access=(), network_policy="allow", maintenance_model="?",
            compatibility="?", resource_footprint_gb=0.0, review_receipt="",
        )
        self.assertFalse(fake.selectable())


class HarnessAdapterContract(unittest.TestCase):
    def test_adapter_interface_has_install_verify_uninstall(self):
        # The adapter is an abstract contract: install/verify/uninstall are
        # separate, and the catalog never auto-executes them during onboarding.
        import inspect
        import media_lab_core.harness_catalog as hc
        methods = {m for m in dir(hc.HarnessAdapter) if not m.startswith("_")}
        for required in ("manifest", "install", "verify", "uninstall"):
            self.assertIn(required, methods)
        self.assertTrue(inspect.isabstract(hc.HarnessAdapter))


if __name__ == "__main__":
    unittest.main(verbosity=2)