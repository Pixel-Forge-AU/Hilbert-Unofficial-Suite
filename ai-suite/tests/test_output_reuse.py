import sys
from pathlib import Path


sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import launcher


def test_generated_output_can_be_staged_as_workflow_input(tmp_path, monkeypatch):
    comfy_dir = tmp_path / "ComfyUI"
    output = comfy_dir / "output" / "studio" / "guest" / "video" / "clip.mp4"
    output.parent.mkdir(parents=True)
    output.write_bytes(b"generated-video")
    (comfy_dir / "input").mkdir(parents=True)

    monkeypatch.setenv("COMFYUI_DIR", str(comfy_dir))
    monkeypatch.setattr(launcher, "config_manager", object())
    response = launcher.app.test_client().post(
        "/api/outputs/reuse",
        json={"path": "studio/guest/video/clip.mp4"},
    )

    assert response.status_code == 200
    item = response.get_json()["input"]
    assert item["name"] == "studio_outputs/studio/guest/video/clip.mp4"
    assert item["media_type"] == "video"
    assert (comfy_dir / "input" / item["name"]).read_bytes() == b"generated-video"


def test_output_reuse_rejects_parent_traversal(tmp_path, monkeypatch):
    monkeypatch.setenv("COMFYUI_DIR", str(tmp_path / "ComfyUI"))
    monkeypatch.setattr(launcher, "config_manager", object())

    response = launcher.app.test_client().post(
        "/api/outputs/reuse",
        json={"path": "../outside.mp4"},
    )

    assert response.status_code == 400
