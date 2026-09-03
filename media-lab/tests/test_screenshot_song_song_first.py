import importlib.util
import os
import sys
from pathlib import Path

import pytest

from screenshot_song import (
    literal_vocal_qa,
    song_first_auto_seconds,
    song_first_lyrics_qa,
    song_first_word_budget,
)


ROOT = Path(__file__).resolve().parent.parent


def _words(text: str, probability: float = 0.99) -> list[dict]:
    return [
        {"word": token, "start": index * 0.4, "probability": probability}
        for index, token in enumerate(text.split())
    ]


def test_song_first_auto_duration_tracks_selected_text_and_scenes():
    short = "word " * 80
    long = "word " * 305
    assert song_first_auto_seconds(short, block_count=3) < song_first_auto_seconds(
        long, block_count=7
    )
    assert song_first_auto_seconds(long, block_count=7) == 155
    assert song_first_auto_seconds("word " * 1000, block_count=16) == 180


def test_song_first_budget_compresses_prose_to_singable_size():
    assert song_first_word_budget("word " * 305) == 146
    assert song_first_word_budget("word " * 40) == 60
    assert song_first_word_budget("word " * 1000) == 180


def test_song_first_lyrics_require_short_lines_and_written_out_hook():
    chorus = "Today today what could go wrong\nI made it to noon so I wrote this song"
    lyrics = f"""[Verse 1]
Wrong name wrong text before the day began
Coffee in my hand and a mystery man

[Chorus]
{chorus}

[Verse 2]
I saved a stranger while my bicycle disappeared
The light turned green and the punchline reappeared

[Chorus]
{chorus}

[Bridge]
Every little disaster finds a rhythm before long

[Outro]
Today today so I wrote this song"""
    report = song_first_lyrics_qa(lyrics)
    assert report["passed"] is True
    assert report["chorus_count"] == 2
    assert report["verse_count"] == 2

    prose = "[Verse 1]\n" + "word " * 70
    rejected = song_first_lyrics_qa(prose)
    assert rejected["passed"] is False
    assert "two written-out choruses" in rejected["reason"]


def test_screenshot_song_duration_is_a_maximum_and_numbers_are_spoken_equivalents():
    target = "I waited 10 minutes across a 6 lane street for 30 minutes"
    heard = "I waited ten minutes across a six lane street for thirty minutes"
    report = literal_vocal_qa(
        target,
        _words(heard),
        requested_duration=180,
        actual_duration=88.5,
        duration_policy="maximum",
    )
    assert report["passed"] is True
    assert report["duration_policy"] == "maximum"


def test_song_delivery_tolerates_scattered_melodic_asr_errors_but_not_leaks():
    words = (
        "alpha bravo charlie delta echo foxtrot golf hotel india juliet kilo lima "
        "mike november oscar papa quebec romeo sierra tango uniform victor whiskey "
        "xray yankee zulu amber birch cedar dune ember frost grove harbor ivory jasper "
        "kindle lantern meadow nectar orbit pebble quartz river spruce timber valley "
        "willow xenon"
    ).split()
    heard = [word for index, word in enumerate(words) if index not in {5, 17, 29, 41}]
    for index, noise in ((10, "glimmer"), (20, "shimmer"), (30, "singer")):
        heard.insert(index, noise)
    transcript = [{"word": word, "probability": 0.96} for word in heard]
    literal = literal_vocal_qa(" ".join(words), transcript, delivery_policy="literal")
    sung = literal_vocal_qa(" ".join(words), transcript, delivery_policy="song")
    assert literal["passed"] is False
    assert sung["passed"] is True
    assert sung["reason"] == "song-first vocal contract passed"

    leaked = transcript + [
        {"word": word, "probability": 0.99}
        for word in ("system prompt preserve every supplied word")
    ]
    rejected = literal_vocal_qa(" ".join(words), leaked, delivery_policy="song")
    assert rejected["passed"] is False
    assert rejected["max_extra_run"] > rejected["allowed_extra_run"]


def test_low_confidence_whisper_tail_is_ignored_but_confident_leak_is_not():
    target = "today the bicycle disappeared"
    low_tail = _words(target) + _words("phantom ending words", probability=0.2)
    accepted = literal_vocal_qa(
        target, low_tail, requested_duration=90, actual_duration=60,
        duration_policy="maximum",
    )
    assert accepted["passed"] is True
    assert accepted["ignored_low_confidence_tail"] == ["phantom", "ending", "words"]

    confident = _words(target + " system prompt words leaked loudly")
    rejected = literal_vocal_qa(
        target, confident, requested_duration=90, actual_duration=60,
        duration_policy="maximum",
    )
    assert rejected["passed"] is False


def test_app_and_ui_wire_song_first_as_the_default_with_verbatim_fallback():
    app = (ROOT / "app.py").read_text(encoding="utf-8")
    ui = (ROOT / "static/index.html").read_text(encoding="utf-8")
    for contract in (
        'screenshot_song_mode: str = "song"',
        '"source_material": lyrics',
        'duration_policy="maximum"',
        "song_first_lyrics_qa(",
    ):
        assert contract in app
    for contract in (
        'id="ss_mode"',
        'data-v="song"',
        'data-v="verbatim"',
        'class="ss_include"',
        "songFirstAutoSeconds",
    ):
        assert contract in ui


@pytest.fixture(scope="module")
def media_app(tmp_path_factory):
    home = tmp_path_factory.mktemp("song-first-api-home")
    root = home / "media-lab-simple"
    root.mkdir()
    for name in ("static", "config", "prompt-templates"):
        (root / name).symlink_to(ROOT / name)
    old = {key: os.environ.get(key) for key in
           ("HOME", "MEDIA_LAB_DISABLE_BACKGROUND_WORKERS")}
    os.environ["HOME"] = str(home)
    os.environ["MEDIA_LAB_DISABLE_BACKGROUND_WORKERS"] = "1"
    spec = importlib.util.spec_from_file_location("song_first_test_app", ROOT / "app.py")
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    sys.modules["song_first_test_app"] = module
    try:
        spec.loader.exec_module(module)
    finally:
        for key, value in old.items():
            if value is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = value
    return module


def _prepare_endpoint(media_app, tmp_path, monkeypatch, captured):
    manifest = "abcdef123456"
    source = tmp_path / f"ss_{manifest}_01.png"
    source.write_bytes(b"image")
    review_root = tmp_path / "reviews"
    (review_root / manifest).mkdir(parents=True)
    monkeypatch.setattr(media_app, "SCREENSHOT_SONGS_DIR", review_root)
    monkeypatch.setattr(
        media_app, "media_path",
        lambda value: source if Path(str(value)).name == source.name else None,
    )
    monkeypatch.setattr(media_app, "engine_up", lambda _name: False)
    monkeypatch.setattr(media_app, "eta_estimate", lambda _job: 7)

    def submit(kind, request, extra=None):
        captured.update(kind=kind, request=request, extra=extra)
        return {"id": "songfirst123", "kind": kind, "request": request}

    monkeypatch.setattr(media_app, "submit_job", submit)
    return manifest, source


def test_endpoint_defaults_to_song_first_and_keeps_auto_unresolved(
        media_app, tmp_path, monkeypatch):
    captured = {}
    manifest, source = _prepare_endpoint(media_app, tmp_path, monkeypatch, captured)
    result = media_app.screenshot_song_make(media_app.ScreenshotSongReq(
        manifest_id=manifest,
        screenshots=[media_app.ScreenshotSongFrame(
            source=f"/media/{source.name}",
            text="A long strange day became a bright funny story " * 20,
        )],
    ))
    assert result["id"] == "songfirst123"
    assert result["automatic"] is True
    assert captured["request"]["screenshot_song_mode"] == "song"
    assert captured["request"]["source_material"]
    assert captured["request"]["lyrics"] == ""
    assert captured["request"]["literal_lyrics"] is False
    assert captured["request"]["duration_seconds"] is None
    assert captured["request"]["auto_duration_estimate"] == result["duration_seconds"]


def test_endpoint_preserves_every_word_mode_and_manual_override(
        media_app, tmp_path, monkeypatch):
    captured = {}
    manifest, source = _prepare_endpoint(media_app, tmp_path, monkeypatch, captured)
    text = "Sing every reviewed word once and in order."
    result = media_app.screenshot_song_make(media_app.ScreenshotSongReq(
        manifest_id=manifest,
        screenshot_song_mode="verbatim",
        length="custom",
        duration_seconds=75,
        screenshots=[media_app.ScreenshotSongFrame(
            source=f"/media/{source.name}", text=text,
        )],
    ))
    assert result["duration_seconds"] == 75
    assert result["automatic"] is False
    assert captured["request"]["lyrics"] == text
    assert captured["request"]["literal_lyrics"] is True
    assert captured["request"]["duration_seconds"] == 75


def test_song_first_worker_resolves_auto_after_writing_and_runs_director_qa(
        media_app, tmp_path, monkeypatch):
    import builtins
    from types import SimpleNamespace

    jobs_dir = tmp_path / "jobs"
    media_dir = tmp_path / "media"
    comfy_dir = tmp_path / "comfy"
    (comfy_dir / "output/music3-lab").mkdir(parents=True)
    jobs_dir.mkdir()
    media_dir.mkdir()
    monkeypatch.setattr(media_app, "JOBS_DIR", jobs_dir)
    monkeypatch.setattr(media_app, "MEDIA", media_dir)
    monkeypatch.setattr(media_app, "COMFY_MUSIC_DIR", comfy_dir)
    monkeypatch.setattr(media_app, "ensure_engine", lambda *_args: "up")
    monkeypatch.setattr(media_app, "touch_engine", lambda *_args: None)
    monkeypatch.setattr(media_app.fcntl, "flock", lambda *_args: None)

    lyrics = """[Verse 1]
Morning sent a message meant for someone else
Wrong name glowing brightly on the screen
[Chorus]
Today today what could go wrong
Made it to noon and wrote this song
[Verse 2]
Stopped to help while my bicycle disappeared
Kindness met a getaway routine
[Chorus]
Today today what could go wrong
Made it to noon and wrote this song"""
    caption = (
        "Global Metadata: Bright melodic synth pop.\n\n"
        "Vocal Details: Clearly sung male lead.\n\n"
        "Arrangement: Instrumental opening, repeated chorus, musical outro."
    )
    monkeypatch.setattr(media_app, "qwen_json", lambda *_args: {
        "caption": caption, "lyrics": lyrics,
    })

    payloads = []

    def fake_comfy(_port, payload, **_kwargs):
        payloads.append(payload)
        prefix = payload["35"]["inputs"]["filename_prefix"].split("/", 1)[1]
        (comfy_dir / "output/music3-lab" / f"{prefix}_00001.flac").write_bytes(b"flac")

    monkeypatch.setattr(media_app, "comfy_run", fake_comfy)
    target = media_app._literal_words(lyrics)
    monkeypatch.setattr(media_app, "_screenshot_song_transcript", lambda _path: {
        "duration": 80.0,
        "words": [{"word": word, "probability": 0.99}
                  for word in target.split()],
    })
    monkeypatch.setattr(media_app, "media_duration", lambda _path: 80.0)

    def fake_run(command, **_kwargs):
        output = command[-1]
        if isinstance(output, str):
            path = Path(output)
            if path.suffix in (".mp3", ".png"):
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_bytes(b"encoded" if path.suffix == ".mp3" else b"wave")
        return SimpleNamespace(returncode=0, stderr="", stdout="")

    monkeypatch.setattr(media_app.subprocess, "run", fake_run)
    lock_path = tmp_path / "inference.lock"
    real_open = builtins.open

    def fake_open(path, *args, **kwargs):
        if str(path) == "/run/user/1000/media-lab-inference.lock":
            return real_open(lock_path, *args, **kwargs)
        return real_open(path, *args, **kwargs)

    monkeypatch.setattr(builtins, "open", fake_open)
    job = {
        "id": "songfirstworker1",
        "kind": "screenshotsong",
        "status": "running",
        "request": {
            "vibe": "catchy synth pop",
            "length": "auto",
            "duration_seconds": None,
            "screenshot_song_mode": "song",
            "source_material": "A strange day became a funny story. " * 40,
            "lyrics": "",
            "literal_lyrics": False,
            "screenshots": [{"source": "/media/one.png", "text": "story"}],
        },
    }
    media_app.run_music(job, finalize=False)

    expected = media_app.song_first_auto_seconds(lyrics, adapted=True)
    assert payloads[0]["13"]["inputs"]["max_duration"] == expected
    assert job["request"]["duration_seconds"] == expected
    assert job["request"]["auto_duration_resolved"] is True
    assert job["director_qa"]["passed"] is True
    assert job["director_qa"]["policy"] == "song-first-asr-v1"
    assert job["stage"] == "aligning lyrics"

