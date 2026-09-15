from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
UI = (ROOT / "static/index.html").read_text(encoding="utf-8")
APP = (ROOT / "app.py").read_text(encoding="utf-8")


def test_music_and_screenshot_song_use_auto_exact_second_controls():
    for control in (
        "ssDurAuto", "ssDurSlider", "ssDurVal",
        "mDurAuto", "mDurSlider", "mDurVal",
        "mvDurAuto", "mvDurSlider", "mvDurVal",
    ):
        assert f'id="{control}"' in UI
    assert UI.count('min="20" max="180" step="1"') >= 2
    assert 'id="mvDurSlider" min="1" max="180" step="1"' in UI
    assert "musicDurationControl" in UI
    assert "duration_seconds:automatic?null:Number(slider.value)" in UI
    assert "duration_seconds:(MV.automatic||MV.legacyFull)?null:Number($('#mvDurSlider').value)" in UI
    assert "m_len" not in UI
    assert "ss_len" not in UI
    assert "mv_len" not in UI
    assert 'length: str = "auto"' in APP
    assert "_musicvideo_seconds(" in APP


def test_verbatim_director_gate_is_wired_end_to_end():
    for contract in (
        "literal_vocal_qa(",
        'max_attempts = 3 if literal else 1',
        'j["stage"] = "director qa"',
        '"policy": "verbatim-asr-v1"',
        "The Director rejected every take instead of publishing a subpar song.",
    ):
        assert contract in APP
    assert "Director checking every sung word" in UI
    assert "repairing take 2" in UI
    assert "repairing take 3" in UI


def test_regression_contracts_keep_results_private_complete_and_remixable():
    assert 'run_music(j, finalize=False)' in APP
    assert '"song_url", "video_url", "video_poster", "timing", "screenshot_cues"' in APP
    assert '"vibe", "lyrics", "length", "duration_seconds"' in APP
    assert 'text[:4000]' not in APP
    assert 'text.maxLength=4000' not in UI
    assert 'Nothing was truncated.' in APP
    assert "MV.legacyFull?'full'" in UI
    assert 'Nothing was truncated.' in UI
    assert 'const AUDIO_KINDS={music:1,speak:1,screenshotsong:1}' in UI
    assert "else if(kind==='screenshotsong'" in UI
    assert "fetch('/api/jobs/'+id+'?full=1')" in UI


def test_literal_runtime_copy_promises_instrumentals_not_repeated_words():
    assert "extra time stays instrumental" in UI
    assert "Instrumental intro, transitions, solos, and ending fill the remaining runtime" in APP
    assert 'f"[Verse {index}]' in APP
