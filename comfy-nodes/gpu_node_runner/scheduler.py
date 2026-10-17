from __future__ import annotations

from dataclasses import dataclass

from .comfy import ComfyClient
from .config import RunnerConfig, WorkerConfig
from .models import WorkerStatus
from .store import JobStore


@dataclass
class Health:
    healthy: bool = False
    last_error: str = ""


class Scheduler:
    def __init__(self, config: RunnerConfig, store: JobStore, client: ComfyClient):
        self.config = config
        self.store = store
        self.client = client
        self.health: dict[str, Health] = {worker.id: Health() for worker in config.workers}

    def classify_tags(self, workflow_type: str) -> set[str]:
        value = workflow_type.strip().lower().replace("_", "-")
        if value in {"3d", "image-to-3d", "image2three", "image-to-three"}:
            return {"image-to-3d", "high-vram"}
        if value in {"video", "txt2video", "text-to-video", "img2video", "i2v"}:
            return {"video", "high-vram"}
        if value in {"preview", "upscale"}:
            return {value}
        return {"image"}

    def refresh_health(self, worker: WorkerConfig) -> Health:
        health = self.health[worker.id]
        try:
            self.client.system_stats(worker)
            health.healthy = True
            health.last_error = ""
        except Exception as exc:
            health.healthy = False
            health.last_error = str(exc)
        return health

    def statuses(self) -> list[WorkerStatus]:
        counts = self.store.inflight_counts()
        statuses = []
        for worker in self.config.workers:
            health = self.refresh_health(worker)
            statuses.append(
                WorkerStatus(
                    id=worker.id,
                    label=worker.label,
                    gpu_id=worker.gpu_id,
                    url=worker.base_url,
                    tags=sorted(worker.tags),
                    weight=worker.weight,
                    healthy=health.healthy,
                    inflight=counts.get(worker.id, 0),
                    max_inflight=worker.max_inflight,
                    last_error=health.last_error,
                )
            )
        return statuses

    def choose(self, workflow_type: str, requested_worker_id: str | None = None) -> WorkerConfig:
        counts = self.store.inflight_counts()
        workers = {worker.id: worker for worker in self.config.workers}
        if requested_worker_id:
            worker = workers.get(requested_worker_id)
            if not worker:
                raise LookupError(f"Unknown worker {requested_worker_id}")
            health = self.refresh_health(worker)
            if not health.healthy:
                raise RuntimeError(f"Worker {worker.id} is not healthy: {health.last_error}")
            if counts.get(worker.id, 0) >= worker.max_inflight:
                raise RuntimeError(f"Worker {worker.id} is at capacity")
            return worker

        required = self.classify_tags(workflow_type)
        candidates: list[WorkerConfig] = []
        for worker in self.config.workers:
            health = self.refresh_health(worker)
            if not health.healthy:
                continue
            if counts.get(worker.id, 0) >= worker.max_inflight:
                continue
            if required & worker.tags or (required == {"image"} and "image" in worker.tags):
                candidates.append(worker)
        if not candidates:
            raise RuntimeError(f"No healthy worker has capacity for {workflow_type}")
        candidates.sort(
            key=lambda worker: (
                len(required & worker.tags),
                worker.weight,
                -counts.get(worker.id, 0),
            ),
            reverse=True,
        )
        return candidates[0]
