from __future__ import annotations

import os
import time
from pathlib import Path
from typing import Any

from fastapi import FastAPI, HTTPException, Query

from .comfy import ComfyClient
from .config import load_config
from .models import JobRecord, JobRequest, WorkerStatus
from .poller import Poller
from .scheduler import Scheduler
from .store import JobStore


def create_app(config_path: str | Path | None = None) -> FastAPI:
    config = load_config(config_path or os.environ.get("GPU_NODE_RUNNER_CONFIG", "config.yaml"))
    store = JobStore(config.storage.sqlite_path)
    client = ComfyClient(config.server.request_timeout_seconds)
    scheduler = Scheduler(config, store, client)
    poller = Poller(config, store, client)

    app = FastAPI(title="Comfy Nodes GPU Runner", version="0.1.0")

    @app.on_event("startup")
    def startup() -> None:
        poller.start()

    @app.on_event("shutdown")
    def shutdown() -> None:
        poller.stop()

    @app.get("/health")
    def health() -> dict[str, Any]:
        return {
            "ok": True,
            "config": str(config.path),
            "workers": len(config.workers),
            "active_jobs": len(store.active()),
        }

    @app.get("/v1/workers")
    def workers() -> list[WorkerStatus]:
        return scheduler.statuses()

    @app.post("/v1/jobs")
    def submit_job(body: dict[str, Any]) -> JobRecord:
        try:
            request = JobRequest.from_body(body)
            worker = scheduler.choose(request.workflow_type, request.worker_id)
            prompt_id = client.submit(worker, request.prompt_payload())
            return store.upsert(
                JobRecord(
                    worker_id=worker.id,
                    prompt_id=prompt_id,
                    workflow_type=request.workflow_type,
                    priority=request.priority,
                    state="queued",
                    updated_at=time.time(),
                )
            )
        except LookupError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        except RuntimeError as exc:
            raise HTTPException(status_code=503, detail=str(exc)) from exc
        except Exception as exc:
            raise HTTPException(status_code=502, detail=str(exc)) from exc

    @app.get("/v1/jobs")
    def jobs(limit: int = Query(default=100, ge=1, le=500)) -> list[JobRecord]:
        return store.list(limit)

    @app.get("/v1/jobs/{job_id}")
    def job(job_id: str) -> JobRecord:
        record = store.get(job_id)
        if not record:
            raise HTTPException(status_code=404, detail="Unknown job")
        return record

    return app
