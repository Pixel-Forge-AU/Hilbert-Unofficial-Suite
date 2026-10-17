from __future__ import annotations

from typing import Any

import requests

from .config import WorkerConfig


class ComfyClient:
    def __init__(self, timeout: int = 30):
        self.timeout = timeout

    def system_stats(self, worker: WorkerConfig) -> dict[str, Any]:
        response = requests.get(f"{worker.base_url}/system_stats", timeout=5)
        response.raise_for_status()
        return response.json()

    def submit(self, worker: WorkerConfig, payload: dict[str, Any]) -> str:
        response = requests.post(f"{worker.base_url}/prompt", json=payload, timeout=self.timeout)
        response.raise_for_status()
        prompt_id = response.json().get("prompt_id")
        if not prompt_id:
            raise RuntimeError("ComfyUI returned no prompt_id")
        return str(prompt_id)

    def history(self, worker: WorkerConfig, prompt_id: str) -> dict[str, Any]:
        response = requests.get(f"{worker.base_url}/history/{prompt_id}", timeout=self.timeout)
        response.raise_for_status()
        return response.json()

    def interrupt(self, worker: WorkerConfig) -> None:
        response = requests.post(f"{worker.base_url}/interrupt", json={}, timeout=self.timeout)
        response.raise_for_status()
