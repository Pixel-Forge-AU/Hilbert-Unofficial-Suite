import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import comfy_studio


def test_queue_item_prompt_id_accepts_comfyui_tuple_items():
    assert comfy_studio.queue_item_prompt_id((0, "prompt-123", {}, {}, [])) == "prompt-123"


def test_queue_status_handles_tuple_queue_items(monkeypatch):
    payload = {
        "queue_running": [(0, "running-prompt", {}, {}, [])],
        "queue_pending": [(0, "pending-prompt", {}, {}, [])],
    }
    monkeypatch.setattr(comfy_studio, "queue", lambda config: payload)

    result = comfy_studio.queue_status({"COMFY_HOST": "127.0.0.1", "COMFY_PORT": 39003})

    assert result["running"][0]["prompt_id"] == "running-prompt"
    assert result["pending"][0]["prompt_id"] == "pending-prompt"


def test_progress_omits_outputs_while_job_is_running(monkeypatch):
    monkeypatch.setattr(comfy_studio, "history", lambda config, prompt_id: {
        prompt_id: {
            "status": {"status_str": "queued", "completed": False, "messages": []},
            "outputs": {},
        }
    })
    monkeypatch.setattr(comfy_studio, "queue", lambda config: {"queue_running": [], "queue_pending": []})

    result = comfy_studio.progress({"COMFY_HOST": "127.0.0.1", "COMFY_PORT": 39003}, "job-123")

    assert result["state"] == "history"
    assert result["completed"] is False
    assert result["outputs"] == []


def test_flatten_outputs_includes_audio_outputs():
    payload = {
        "job-123": {
            "outputs": {
                "1": {
                    "audios": [
                        {
                            "filename": "track.wav",
                            "subfolder": "Studio/audio",
                            "type": "output",
                        }
                    ]
                }
            }
        }
    }

    outputs = comfy_studio.flatten_outputs(payload)

    assert outputs == [
        {
            "type": "audio",
            "filename": "track.wav",
            "subfolder": "Studio/audio",
            "folder_type": "output",
            "url": "/media/Studio/audio/track.wav",
        }
    ]


def test_gallery_items_recognizes_audio_files(tmp_path, monkeypatch):
    audio_path = tmp_path / "song.wav"
    audio_path.write_bytes(b"RIFF")
    monkeypatch.setattr(comfy_studio, "COMFY_OUTPUT", tmp_path)

    items = comfy_studio.gallery_items()

    assert items[0]["type"] == "audio"
    assert items[0]["name"] == "song.wav"
    assert items[0]["url"].endswith("/song.wav")
