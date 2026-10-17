from __future__ import annotations

import time
import uuid
from typing import Any, Literal

from pydantic import BaseModel, Field


JobState = Literal["queued", "running", "completed", "failed", "unknown"]


class JobRequest(BaseModel):
    prompt: dict[str, Any] | None = None
    workflow: dict[str, Any] | None = None
    workflow_type: str = "image"
    priority: int = 0
    client_id: str | None = None
    worker_id: str | None = None

    @classmethod
    def from_body(cls, body: dict[str, Any]) -> "JobRequest":
        if "prompt" in body or "workflow" in body:
            return cls(**body)
        return cls(prompt=body)

    def prompt_payload(self) -> dict[str, Any]:
        prompt = self.prompt or self.workflow
        if not prompt:
            raise ValueError("Expected a ComfyUI prompt in `prompt` or `workflow`")
        return {
            "prompt": prompt,
            "client_id": self.client_id or f"gpu-node-runner-{uuid.uuid4().hex}",
        }


class JobRecord(BaseModel):
    id: str = Field(default_factory=lambda: uuid.uuid4().hex)
    worker_id: str
    prompt_id: str
    workflow_type: str
    state: JobState = "queued"
    priority: int = 0
    created_at: float = Field(default_factory=time.time)
    updated_at: float = Field(default_factory=time.time)
    error: str | None = None
    comfy_status: dict[str, Any] | None = None


class WorkerStatus(BaseModel):
    id: str
    label: str
    gpu_id: str
    url: str
    tags: list[str]
    weight: int
    healthy: bool
    inflight: int
    max_inflight: int
    last_error: str = ""
