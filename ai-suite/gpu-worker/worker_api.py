#!/usr/bin/env python3
from __future__ import annotations

import argparse
import os
import threading
import time
import uuid
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import requests
import yaml
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field


ROOT = Path(__file__).resolve().parent
CONFIG_PATH = Path(os.environ.get("GPU_WORKER_CONFIG", ROOT / "config.yaml"))
INPUT_ROOT = Path(os.environ.get("GPU_WORKER_INPUT_ROOT", "/input"))
OUTPUT_ROOT = Path(os.environ.get("GPU_WORKER_OUTPUT_ROOT", "/output"))


@dataclass
class Worker:
    id: str
    label: str
    host: str
    port: int
    gpu_id: str
    vram_gb: float
    tags: set[str]
    weight: int = 50
    max_inflight: int = 1
    configured_base_url: str = ""
    inflight: set[str] = field(default_factory=set)
    healthy: bool = False
    last_error: str = ""

    @property
    def base_url(self) -> str:
        return self.configured_base_url.rstrip("/") or f"http://{self.host}:{self.port}"


class JobRequest(BaseModel):
    prompt: dict[str, Any] | None = None
    workflow: dict[str, Any] | None = None
    workflow_type: str = Field(default="image")
    priority: int = Field(default=0)
    client_id: str | None = None
    worker_id: str | None = None
    required_vram_gb: float = Field(default=0, ge=0)


class JobRecord(BaseModel):
    id: str
    worker_id: str
    prompt_id: str
    workflow_type: str
    required_vram_gb: float = 0
    expected_output_prefixes: list[str] = Field(default_factory=list)
    state: str
    created_at: float
    updated_at: float
    error: str | None = None
    comfy_status: dict[str, Any] | None = None


def load_config() -> dict[str, Any]:
    path = CONFIG_PATH
    if not path.exists():
        example = ROOT / "config.example.yaml"
        raise RuntimeError(f"{path} not found; copy {example} to config.yaml and edit it")
    return yaml.safe_load(path.read_text()) or {}


CONFIG = load_config()
REQUEST_TIMEOUT = int(CONFIG.get("request_timeout_seconds", 30))
POLL_SECONDS = int(CONFIG.get("poll_seconds", 2))
WORKERS: dict[str, Worker] = {
    item["id"]: Worker(
        id=item["id"],
        label=item.get("label", item["id"]),
        host=item.get("host", "127.0.0.1"),
        port=int(item.get("port", 8188)),
        gpu_id=str(item.get("gpu_id", item.get("device", ""))),
        vram_gb=float(item.get("vram_gb", 0)),
        tags=set(item.get("tags", [])),
        weight=int(item.get("weight", 50)),
        max_inflight=int(item.get("max_inflight", 1)),
        configured_base_url=str(item.get("base_url", "")),
    )
    for item in CONFIG.get("workers", [])
}
JOBS: dict[str, JobRecord] = {}
LOCK = threading.Lock()
SUBMIT_LOCK = threading.Lock()

app = FastAPI(title="AI Suite GPU Worker", version="0.1.0")


def classify_tags(workflow_type: str) -> set[str]:
    value = workflow_type.strip().lower().replace("_", "-")
    if value in {"3d", "image-to-3d", "image2three", "image-to-three"}:
        return {"image-to-3d", "high-vram"}
    if value in {"video", "txt2video", "img2video", "i2v"}:
        return {"video", "high-vram"}
    if value in {"preview", "upscale"}:
        return {value}
    return {"image"}


def refresh_worker_health(worker: Worker) -> None:
    try:
        response = requests.get(f"{worker.base_url}/system_stats", timeout=5)
        response.raise_for_status()
        worker.healthy = True
        worker.last_error = ""
    except Exception as exc:
        worker.healthy = False
        worker.last_error = str(exc)


def choose_worker(request: JobRequest) -> Worker:
    for worker in WORKERS.values():
        refresh_worker_health(worker)
    if request.worker_id:
        worker = WORKERS.get(request.worker_id)
        if not worker:
            raise HTTPException(status_code=404, detail=f"Unknown worker {request.worker_id}")
        if not worker.healthy:
            raise HTTPException(status_code=503, detail=f"Worker {worker.id} is not healthy: {worker.last_error}")
        if request.required_vram_gb and worker.vram_gb < request.required_vram_gb:
            raise HTTPException(
                status_code=409,
                detail=f"Worker {worker.id} has {worker.vram_gb:g}GB VRAM; job requires {request.required_vram_gb:g}GB",
            )
        return worker

    required = classify_tags(request.workflow_type)
    candidates = [
        worker for worker in WORKERS.values()
        if worker.healthy
        and len(worker.inflight) < worker.max_inflight
        and (not request.required_vram_gb or worker.vram_gb >= request.required_vram_gb)
        and (required & worker.tags or (required == {"image"} and "image" in worker.tags))
    ]
    if not candidates:
        requirement = f" requiring {request.required_vram_gb:g}GB VRAM" if request.required_vram_gb else ""
        raise HTTPException(status_code=503, detail=f"No healthy worker has capacity for this job{requirement}")
    # Prefer the smallest card that safely fits the job. This preserves any
    # larger cards in mixed deployments for work that actually needs them.
    # Weight breaks ties between equal-sized cards.
    candidates.sort(key=lambda item: (item.vram_gb or 10_000, -len(required & item.tags), -item.weight, len(item.inflight)))
    return candidates[0]


def comfy_payload(request: JobRequest) -> dict[str, Any]:
    prompt = request.prompt or request.workflow
    if not prompt:
        raise HTTPException(status_code=400, detail="Expected a ComfyUI prompt in `prompt` or `workflow`")
    return {
        "prompt": prompt,
        "client_id": request.client_id or f"gpu-worker-{uuid.uuid4().hex}",
    }


def output_prefixes(request: JobRequest) -> list[str]:
    prompt = request.prompt or request.workflow or {}
    return sorted({
        str(inputs.get("filename_prefix"))
        for node in prompt.values()
        if isinstance(node, dict)
        for inputs in [node.get("inputs") or {}]
        if isinstance(inputs, dict) and inputs.get("filename_prefix")
    })


def discover_unreported_outputs(job: JobRecord, history: dict[str, Any]) -> dict[str, Any]:
    """Add files saved by nodes that omit ComfyUI's normal UI history output."""
    discovered: dict[str, list[dict[str, str]]] = {"images": [], "videos": [], "audios": [], "3d": []}
    kind_by_suffix = {
        ".png": "images", ".jpg": "images", ".jpeg": "images", ".webp": "images",
        ".mp4": "videos", ".webm": "videos", ".mov": "videos", ".mkv": "videos", ".gif": "videos",
        ".wav": "audios", ".mp3": "audios", ".flac": "audios", ".ogg": "audios",
        ".glb": "3d", ".gltf": "3d", ".obj": "3d", ".stl": "3d", ".ply": "3d", ".spz": "3d",
    }
    existing = {
        (str(item.get("subfolder") or ""), str(item.get("filename") or ""))
        for output in (history.get("outputs") or {}).values()
        if isinstance(output, dict)
        for key in kind_by_suffix.values()
        for item in (output.get(key) or [])
        if isinstance(item, dict)
    }
    for prefix_value in job.expected_output_prefixes:
        prefix = Path(prefix_value.replace("\\", "/"))
        if prefix.is_absolute() or ".." in prefix.parts or not prefix.name:
            continue
        parent = (
            OUTPUT_ROOT.resolve()
            if prefix.parent == Path(".")
            else safe_asset_path(OUTPUT_ROOT, prefix.parent.as_posix())
        )
        if not parent.is_dir():
            continue
        for path in parent.glob(f"{prefix.name}*"):
            kind = kind_by_suffix.get(path.suffix.lower())
            if not kind or not path.is_file() or path.stat().st_mtime < job.created_at - 2:
                continue
            rel = path.relative_to(OUTPUT_ROOT.resolve())
            key = (rel.parent.as_posix() if rel.parent != Path(".") else "", rel.name)
            if key in existing:
                continue
            discovered[kind].append({"filename": rel.name, "subfolder": key[0], "type": "output"})
            existing.add(key)
    discovered = {key: value for key, value in discovered.items() if value}
    if discovered:
        history = dict(history)
        outputs = dict(history.get("outputs") or {})
        outputs["gpu_worker_discovered"] = discovered
        history["outputs"] = outputs
    return history


def validate_prompt_nodes(worker: Worker, request: JobRequest) -> None:
    """Reject a job early when the selected shard lacks required node classes."""
    prompt = request.prompt or request.workflow or {}
    required = {
        str(node.get("class_type"))
        for node in prompt.values()
        if isinstance(node, dict) and node.get("class_type")
    }
    if not required:
        return
    try:
        response = requests.get(f"{worker.base_url}/object_info", timeout=REQUEST_TIMEOUT)
        response.raise_for_status()
        available = set(response.json())
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Could not inspect nodes on {worker.id}: {exc}") from exc
    missing = sorted(required - available)
    if missing:
        raise HTTPException(
            status_code=409,
            detail={"message": f"Worker {worker.id} is missing required ComfyUI nodes", "missing_nodes": missing},
        )


def poll_loop() -> None:
    while True:
        with LOCK:
            records = list(JOBS.values())
            workers = dict(WORKERS)
        for job in records:
            if job.state in {"completed", "failed"}:
                continue
            worker = workers.get(job.worker_id)
            if not worker:
                continue
            try:
                response = requests.get(f"{worker.base_url}/history/{job.prompt_id}", timeout=REQUEST_TIMEOUT)
                response.raise_for_status()
                payload = response.json()
                history = payload.get(job.prompt_id)
                if history:
                    status = history.get("status", {})
                    completed = bool(status.get("completed"))
                    messages = status.get("messages") or []
                    state = "completed" if completed else "running"
                    error = None
                    if any("execution_error" in str(message) for message in messages):
                        state = "failed"
                        error = "ComfyUI reported execution_error"
                    if state == "completed":
                        history = discover_unreported_outputs(job, history)
                    with LOCK:
                        current = JOBS[job.id]
                        JOBS[job.id] = current.model_copy(update={
                            "state": state,
                            "updated_at": time.time(),
                            "error": error,
                            "comfy_status": history,
                        })
                        if state in {"completed", "failed"}:
                            worker.inflight.discard(job.id)
            except Exception as exc:
                with LOCK:
                    current = JOBS.get(job.id)
                    if current:
                        JOBS[job.id] = current.model_copy(update={
                            "state": "unknown",
                            "updated_at": time.time(),
                            "error": str(exc),
                        })
        time.sleep(POLL_SECONDS)


@app.on_event("startup")
def startup() -> None:
    thread = threading.Thread(target=poll_loop, daemon=True)
    thread.start()


@app.get("/health")
def health() -> dict[str, Any]:
    return {"ok": True, "workers": len(WORKERS), "jobs": len(JOBS)}


@app.get("/v1/workers")
def workers() -> list[dict[str, Any]]:
    with LOCK:
        snapshot = list(WORKERS.values())
    for worker in snapshot:
        refresh_worker_health(worker)
    return [
        {
            "id": worker.id,
            "label": worker.label,
            "gpu_id": worker.gpu_id,
            "vram_gb": worker.vram_gb,
            "url": worker.base_url,
            "tags": sorted(worker.tags),
            "weight": worker.weight,
            "healthy": worker.healthy,
            "inflight": len(worker.inflight),
            "max_inflight": worker.max_inflight,
            "last_error": worker.last_error,
        }
        for worker in snapshot
    ]


@app.post("/v1/route")
def preview_route(body: dict[str, Any]) -> dict[str, Any]:
    """Preview placement without submitting anything to ComfyUI."""
    request = JobRequest(**body)
    worker = choose_worker(request)
    return {
        "worker_id": worker.id,
        "label": worker.label,
        "vram_gb": worker.vram_gb,
        "workflow_type": request.workflow_type,
        "required_vram_gb": request.required_vram_gb,
    }


def safe_asset_path(root: Path, asset_path: str) -> Path:
    relative = Path(asset_path.replace("\\", "/"))
    if not asset_path or relative.is_absolute() or ".." in relative.parts:
        raise HTTPException(status_code=400, detail="Invalid asset path")
    root_resolved = root.resolve()
    target = (root / relative).resolve()
    if root_resolved not in target.parents or target == root_resolved:
        raise HTTPException(status_code=400, detail="Invalid asset path")
    return target


@app.put("/v1/assets/input/{asset_path:path}")
async def upload_input(asset_path: str, request: Request) -> dict[str, Any]:
    target = safe_asset_path(INPUT_ROOT, asset_path)
    target.parent.mkdir(parents=True, exist_ok=True)
    written = 0
    with target.open("wb") as handle:
        async for chunk in request.stream():
            handle.write(chunk)
            written += len(chunk)
    return {"path": asset_path, "bytes": written}


@app.get("/v1/assets/output/{asset_path:path}")
def download_output(asset_path: str) -> FileResponse:
    target = safe_asset_path(OUTPUT_ROOT, asset_path)
    if not target.is_file():
        raise HTTPException(status_code=404, detail="Output file not found")
    return FileResponse(target)


@app.post("/v1/jobs")
def submit_job(body: dict[str, Any]) -> JobRecord:
    if "prompt" in body or "workflow" in body:
        request = JobRequest(**body)
    else:
        request = JobRequest(prompt=body)
    # Selection and reservation are one critical section. Without this, two
    # concurrent Studio/browser requests could both observe the same final
    # free slot before either had added its job to worker.inflight.
    with SUBMIT_LOCK:
        worker = choose_worker(request)
        validate_prompt_nodes(worker, request)
        response = requests.post(f"{worker.base_url}/prompt", json=comfy_payload(request), timeout=REQUEST_TIMEOUT)
        if response.status_code >= 400:
            raise HTTPException(status_code=response.status_code, detail=response.text)
        prompt_id = response.json().get("prompt_id")
        if not prompt_id:
            raise HTTPException(status_code=502, detail="ComfyUI accepted the request but returned no prompt_id")

        now = time.time()
        record = JobRecord(
            id=uuid.uuid4().hex,
            worker_id=worker.id,
            prompt_id=prompt_id,
            workflow_type=request.workflow_type,
            required_vram_gb=request.required_vram_gb,
            expected_output_prefixes=output_prefixes(request),
            state="queued",
            created_at=now,
            updated_at=now,
        )
        with LOCK:
            JOBS[record.id] = record
            worker.inflight.add(record.id)
    return record


@app.get("/v1/jobs")
def list_jobs() -> list[JobRecord]:
    with LOCK:
        return sorted(JOBS.values(), key=lambda item: item.created_at, reverse=True)


@app.get("/v1/jobs/{job_id}")
def get_job(job_id: str) -> JobRecord:
    with LOCK:
        record = JOBS.get(job_id)
    if not record:
        raise HTTPException(status_code=404, detail="Unknown job")
    return record


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--host", default=CONFIG.get("host", "0.0.0.0"))
    parser.add_argument("--port", type=int, default=int(CONFIG.get("port", 39018)))
    args = parser.parse_args()
    import uvicorn
    uvicorn.run("worker_api:app", host=args.host, port=args.port)


if __name__ == "__main__":
    main()
