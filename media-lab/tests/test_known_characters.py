import json
from pathlib import Path

import app as media_app


CATALOG = Path(__file__).parents[1] / "config/h3-known-characters.json"
UI = Path(__file__).parents[1] / "static/index.html"


def test_pinned_catalog_is_complete_and_ids_are_unique():
    data = json.loads(CATALOG.read_text())
    rows = data["characters"]

    assert data["source"]["revision"] == "d5c81a97a0607ae0634805dcc33e3b0622ca0c29"
    assert data["source"]["license"] == "WTFPL"
    assert data["counts"] == {"good": 499, "onthefence": 81, "bad": 895}
    assert len(rows) == 1475
    assert len({row["id"] for row in rows}) == len(rows)
    assert all(row["id"].startswith("known:") for row in rows)
    assert all(row["name"] and row["actor"] and row["franchise"] for row in rows)


def test_known_character_api_is_metadata_only_and_preserves_status():
    rows = media_app.known_characters_list()

    assert len(rows) == 1475
    assert {row["known_status"] for row in rows} == {"good", "onthefence", "bad"}
    assert all(row["known"] is True and row["prompt_only"] is True for row in rows)
    assert all("appearance" not in row and "sheet_url" not in row for row in rows)


def test_known_character_resolves_into_prompt_without_claiming_an_identity_sheet():
    abby = next(row for row in media_app.known_characters() if row["name"] == "Abby Sciuto")
    lines = media_app.cast_lines([abby["id"]])

    assert len(lines) == 1
    assert "Abby Sciuto" in lines[0]
    assert "Pauley Perrette" in lines[0]
    assert "NCIS" in lines[0]
    assert "prompt-only preset" in lines[0]
    assert abby.get("sheet_url") is None


def test_resolve_cast_records_preserves_custom_first_request_order():
    custom = {"id": "custom-heather", "name": "Heather", "appearance": "Custom Heather"}
    known = {"id": "known:test", "name": "Known Test", "appearance": "Known test prompt"}

    rows = media_app.resolve_cast_records(
        ["known:test", "custom-heather"], chars=[custom, known]
    )

    assert [row["id"] for row in rows] == ["known:test", "custom-heather"]


def test_all_five_creation_flows_use_the_searchable_known_character_picker():
    html = UI.read_text()

    assert "fetch('/api/known-characters')" in html
    assert 'placeholder="Search name, actor, or show…"' in html
    assert "Custom characters appear first" in html
    assert "H3 known entries are prompt-only" in html
    for target in ("#v_cast", "#mv_cast", "#i_cast", "#sb_cast", "#s_cast"):
        assert f"castPicker('{target}'" in html
