import json
import os
import subprocess
from pathlib import Path

import pytest

import comfy_studio


def test_stitch_videos_with_external_output_symlink(tmp_path, monkeypatch):
    actual_output = tmp_path / "external-disk"
    actual_output.mkdir()
    configured_output = tmp_path / "ComfyUI" / "output"
    configured_output.parent.mkdir()
    try:
        configured_output.symlink_to(actual_output, target_is_directory=True)
    except OSError as exc:
        if os.name != "nt":
            pytest.skip(f"Directory symlinks are unavailable: {exc}")
        junction = subprocess.run(
            ["cmd", "/c", "mklink", "/J", str(configured_output), str(actual_output)],
            capture_output=True, text=True,
        )
        if junction.returncode != 0:
            pytest.skip(f"Directory junctions are unavailable: {junction.stderr}")

    clips = []
    for number in (1, 2):
        clip = actual_output / "studio" / f"clip-{number}.mp4"
        clip.parent.mkdir(exist_ok=True)
        clip.write_bytes(b"clip")
        clips.append({"type": "video", "subfolder": "studio", "filename": clip.name})

    monkeypatch.setattr(comfy_studio, "COMFY_OUTPUT", configured_output)
    monkeypatch.setattr(comfy_studio, "COMFY_INPUT", tmp_path / "input")
    monkeypatch.setattr(comfy_studio, "ffmpeg_binary", lambda: "ffmpeg")

    def fake_ffmpeg(command, **kwargs):
        Path(command[-1]).write_bytes(b"stitched")
        return subprocess.CompletedProcess(command, 0, "")

    monkeypatch.setattr(comfy_studio.subprocess, "run", fake_ffmpeg)
    result = comfy_studio.stitch_videos(clips, "storyboard")

    manifest = next(actual_output.glob("Studio/video-sequences/*/sequence.json"))
    assert json.loads(manifest.read_text())["segments"] == [
        "studio/clip-1.mp4", "studio/clip-2.mp4"
    ]
    assert result["type"] == "video"
    assert (actual_output / result["subfolder"] / result["filename"]).read_bytes() == b"stitched"


def test_stitch_videos_reports_missing_segment(tmp_path, monkeypatch):
    monkeypatch.setattr(comfy_studio, "COMFY_OUTPUT", tmp_path / "output")
    monkeypatch.setattr(comfy_studio, "COMFY_INPUT", tmp_path / "input")
    (tmp_path / "output").mkdir()
    (tmp_path / "output" / "first.mp4").write_bytes(b"first")
    with pytest.raises(ValueError, match="Video segment 2 is missing"):
        comfy_studio.stitch_videos([
            {"type": "video", "filename": "first.mp4"},
            {"type": "video", "filename": "second.mp4"},
        ])
