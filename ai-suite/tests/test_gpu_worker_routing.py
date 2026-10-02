import importlib.util
import sys
from pathlib import Path

import pytest


@pytest.fixture()
def worker_api(tmp_path, monkeypatch):
    config = tmp_path / "workers.yaml"
    config.write_text(
        """
workers:
  - id: p100-0
    base_url: http://p100-0:8188
    vram_gb: 16
    weight: 100
    tags: [video, image-to-3d]
  - id: p100-1
    base_url: http://p100-1:8188
    vram_gb: 16
    weight: 100
    tags: [video, image-to-3d]
  - id: p40-0
    base_url: http://p40-0:8188
    vram_gb: 24
    weight: 60
    tags: [video, image-to-3d]
""",
        encoding="utf-8",
    )
    monkeypatch.setenv("GPU_WORKER_CONFIG", str(config))
    monkeypatch.setenv("GPU_WORKER_INPUT_ROOT", str(tmp_path / "input"))
    monkeypatch.setenv("GPU_WORKER_OUTPUT_ROOT", str(tmp_path / "output"))
    path = Path(__file__).parents[1] / "gpu-worker" / "worker_api.py"
    spec = importlib.util.spec_from_file_location("worker_api_under_test", path)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    monkeypatch.setattr(module, "refresh_worker_health", lambda worker: setattr(worker, "healthy", True))
    return module


def test_16gb_job_prefers_p100_pool(worker_api):
    request = worker_api.JobRequest(prompt={"1": {}}, workflow_type="video", required_vram_gb=16)
    selected = worker_api.choose_worker(request)
    assert selected.id.startswith("p100-")
    assert selected.vram_gb == 16


def test_24gb_job_is_forced_to_p40(worker_api):
    request = worker_api.JobRequest(prompt={"1": {}}, workflow_type="image-to-3d", required_vram_gb=24)
    selected = worker_api.choose_worker(request)
    assert selected.id == "p40-0"


def test_job_over_fleet_capacity_is_rejected(worker_api):
    request = worker_api.JobRequest(prompt={"1": {}}, workflow_type="video", required_vram_gb=25)
    with pytest.raises(worker_api.HTTPException) as exc:
        worker_api.choose_worker(request)
    assert exc.value.status_code == 503
    assert "25GB" in str(exc.value.detail)


def test_unreported_3d_export_is_added_to_history(worker_api):
    output = worker_api.OUTPUT_ROOT / "studio/user/mesh_00001_.glb"
    output.parent.mkdir(parents=True)
    output.write_bytes(b"glb")
    job = worker_api.JobRecord(
        id="job",
        worker_id="p40-0",
        prompt_id="prompt",
        workflow_type="image-to-3d",
        state="completed",
        created_at=0,
        updated_at=0,
        expected_output_prefixes=["studio/user/mesh"],
    )
    history = worker_api.discover_unreported_outputs(job, {"outputs": {}})
    assert history["outputs"]["gpu_worker_discovered"]["3d"] == [{
        "filename": "mesh_00001_.glb",
        "subfolder": "studio/user",
        "type": "output",
    }]
