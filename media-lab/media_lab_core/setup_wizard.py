from __future__ import annotations

import argparse
import json
import sys
from dataclasses import asdict
from pathlib import Path

from .model_catalog import ModelOption, load_model_catalog, resolve_selection

CATEGORY_TITLES = {
    "video": "Video generation",
    "image": "Images and likeness preparation",
    "audio": "Speech and audio",
    "llm": "Local setup/chat model",
    "enhancement": "Optional enhancement",
}

DEFAULT_CATALOG = Path(__file__).with_name("data") / "models.example.toml"


def _label(model: ModelOption) -> str:
    recommended = " · recommended" if model.recommended else ""
    unavailable = " · not yet qualified" if not model.selectable else ""
    return (
        f"{model.name}{recommended}{unavailable}\n"
        f"    Speed: {model.speed} · Quality: {model.quality} · "
        f"Disk: {model.disk_gb:g} GB · Memory floor: {model.memory_floor_gb:g} GB\n"
        f"    {model.summary}"
    )


def choose_interactively(catalog: dict[str, ModelOption]) -> list[str]:
    chosen: list[str] = []
    print("\nMedia Lab capability setup")
    print("Choose any combination. Unqualified entries are shown for transparency but cannot install.\n")
    for category, title in CATEGORY_TITLES.items():
        models = [model for model in catalog.values() if model.category == category]
        if not models:
            continue
        print(f"== {title} ==")
        for model in models:
            print(f"[{model.id}] {_label(model)}")
            if not model.selectable:
                print(f"    Blocked: {model.refusal_reason()}")
                continue
            answer = input("    Include this capability? [y/N] ").strip().lower()
            if answer in {"y", "yes"}:
                chosen.append(model.id)
        print()
    return chosen


def make_plan(catalog_path: Path, models: list[ModelOption], hardware_profile: str) -> dict:
    licenses = [model for model in models if model.terms_acceptance_required]
    exclusive_groups: dict[str, list[str]] = {}
    for model in models:
        if model.exclusive_group:
            exclusive_groups.setdefault(model.exclusive_group, []).append(model.id)
    return {
        "schema_version": 1,
        "catalog": str(catalog_path.resolve()),
        "hardware_profile": hardware_profile,
        "selected": [model.id for model in models],
        "download_disk_gb": round(sum(model.disk_gb for model in models), 3),
        "terms_acceptance_required": [model.id for model in licenses],
        "runtime_swap_groups": exclusive_groups,
        "models": [asdict(model) for model in models],
        "next_stage": "license-review" if licenses else "download-and-verify",
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Plan a modular Media Lab installation")
    parser.add_argument("--catalog", type=Path, default=DEFAULT_CATALOG)
    parser.add_argument("--select", action="append", default=[], metavar="MODEL_ID")
    parser.add_argument("--hardware-profile", default="auto-detect")
    parser.add_argument("--output-plan", type=Path)
    parser.add_argument("--list", action="store_true", help="show the catalog and exit")
    args = parser.parse_args(argv)
    try:
        catalog = load_model_catalog(args.catalog)
        if args.list:
            for category, title in CATEGORY_TITLES.items():
                models = [model for model in catalog.values() if model.category == category]
                if models:
                    print(f"\n== {title} ==")
                    for model in models:
                        print(f"[{model.id}] {_label(model)}")
                        if not model.selectable:
                            print(f"    Blocked: {model.refusal_reason()}")
            return 0
        selected = args.select or choose_interactively(catalog)
        models = resolve_selection(catalog, selected)
        plan = make_plan(args.catalog, models, args.hardware_profile)
        payload = json.dumps(plan, indent=2, sort_keys=True)
        if args.output_plan:
            args.output_plan.parent.mkdir(parents=True, exist_ok=True)
            args.output_plan.write_text(payload + "\n")
            print(f"Install plan written to {args.output_plan}")
        else:
            print(payload)
        print("\nNo models were downloaded. Review and accept required terms before the download stage.")
        return 0
    except (OSError, ValueError) as exc:
        print(f"Setup blocked: {exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
