import threading
import io
import json
import urllib.error
import urllib.request
from http.server import ThreadingHTTPServer
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import hilbert_chat
import launcher
from PIL import Image


def test_echo_uploads_appear_in_studio_library(tmp_path, monkeypatch):
    comfy_dir = tmp_path / "ComfyUI"
    input_dir = comfy_dir / "input"
    monkeypatch.setattr(hilbert_chat, "COMFY_INPUT", input_dir)
    monkeypatch.setenv("COMFYUI_DIR", str(comfy_dir))
    monkeypatch.setattr(launcher, "config_manager", object())

    server = ThreadingHTTPServer(("127.0.0.1", 0), hilbert_chat.HilbertHandler)
    server.store = hilbert_chat.ChatStore(tmp_path / "chat")
    session_id = server.store.create_session("guest", "Photos")["id"]
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        for expected in ("notes.txt", "notes-1.txt"):
            request = urllib.request.Request(
                f"http://127.0.0.1:{server.server_port}/api/upload?filename=notes.txt&session_id={session_id}",
                data=b"hello studio",
                headers={"Content-Type": "application/octet-stream"},
                method="POST",
            )
            with urllib.request.urlopen(request) as response:
                assert response.status == 200
                assert expected.encode() in response.read()
            assert (input_dir / "studio_uploads" / expected).read_bytes() == b"hello studio"
    finally:
        server.shutdown()
        server.server_close()
        thread.join()

    client = launcher.app.test_client()
    response = client.get("/api/inputs")
    assert response.status_code == 200
    files = [item for item in response.get_json()["inputs"] if item["media_type"] == "file"]
    assert {item["name"] for item in files} == {
        "studio_uploads/notes.txt", "studio_uploads/notes-1.txt"
    }
    download = client.get(files[0]["url"])
    assert download.status_code == 200
    assert download.data == b"hello studio"
    assert "attachment" in download.headers["Content-Disposition"]


def test_echo_upload_rejects_missing_filename(tmp_path, monkeypatch):
    monkeypatch.setattr(hilbert_chat, "COMFY_INPUT", tmp_path / "input")
    server = ThreadingHTTPServer(("127.0.0.1", 0), hilbert_chat.HilbertHandler)
    server.store = hilbert_chat.ChatStore(tmp_path / "chat")
    session_id = server.store.create_session("guest", "Photos")["id"]
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        request = urllib.request.Request(
            f"http://127.0.0.1:{server.server_port}/api/upload?session_id={session_id}",
            data=b"file",
            method="POST",
        )
        try:
            urllib.request.urlopen(request)
            assert False, "Expected upload to be rejected"
        except urllib.error.HTTPError as error:
            assert error.code == 400
    finally:
        server.shutdown()
        server.server_close()
        thread.join()


def test_photo_storyboard_is_seeded_with_story_and_ordered_images(tmp_path, monkeypatch):
    input_dir = tmp_path / "input"
    upload_dir = input_dir / "studio_uploads"
    upload_dir.mkdir(parents=True)
    for name, color in (("first.png", "red"), ("second.png", "blue")):
        Image.new("RGB", (20, 20), color).save(upload_dir / name)
    monkeypatch.setattr(hilbert_chat, "COMFY_INPUT", input_dir)
    monkeypatch.setattr(launcher, "STORYBOARDS_DIR", tmp_path / "storyboards")
    launcher.STORYBOARDS_DIR.mkdir()
    monkeypatch.setattr(hilbert_chat, "load_config", lambda: {"STUDIO_PORT": 39000})
    seen = {}

    def fake_vision(config, messages):
        images = [part for part in messages[1]["content"] if part["type"] == "image_url"]
        assert len(images) == 2
        assert all(part["image_url"]["url"].startswith("data:image/jpeg;base64,") for part in images)
        return json.dumps({"title": "A Small Journey", "story": "The journey unfolds.",
                           "shots": [{"description": "A red beginning", "steering": "Wide"},
                                     {"description": "A blue ending", "steering": "Close"}]})

    class Response(io.BytesIO):
        def __enter__(self):
            return self

        def __exit__(self, *_):
            self.close()

    def fake_urlopen(request, timeout):
        seen["request"] = json.loads(request.data)
        result = launcher.app.test_client().post("/api/storyboards", json=seen["request"])
        assert result.status_code == 200
        return Response(result.data)

    monkeypatch.setattr(hilbert_chat.llm_endpoints, "vision_chat_completion", fake_vision)
    monkeypatch.setattr(hilbert_chat.urllib.request, "urlopen", fake_urlopen)
    session = {"uploads": [{"name": f"studio_uploads/{name}"} for name in ("first.png", "second.png")]}
    reply = hilbert_chat.create_storyboard_from_photos(session, "Make a storyboard")

    assert seen["request"]["story"] == "The journey unfolds."
    assert [shot["image"]["filename"] for shot in seen["request"]["shots"]] == ["first.png", "second.png"]
    assert "storyboard:" in reply
    board_id = reply.split("storyboard:", 1)[1].split(")", 1)[0]
    board = launcher.app.test_client().get(f"/api/storyboards/{board_id}").get_json()
    assert board["title"] == "A Small Journey"
    assert board["story"] == "The journey unfolds."
    assert len(board["shots"]) == 2
    updated = launcher.app.test_client().put(
        f"/api/storyboards/{board_id}", json={"story": "An edited journey."}
    )
    assert updated.status_code == 200
    assert updated.get_json()["story"] == "An edited journey."
