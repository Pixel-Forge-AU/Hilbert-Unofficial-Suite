from __future__ import annotations

import threading
import time

from .comfy import ComfyClient
from .config import RunnerConfig
from .store import JobStore


class Poller:
    def __init__(self, config: RunnerConfig, store: JobStore, client: ComfyClient):
        self.config = config
        self.store = store
        self.client = client
        self._thread: threading.Thread | None = None
        self._stop = threading.Event()

    def start(self) -> None:
        if self._thread and self._thread.is_alive():
            return
        self._thread = threading.Thread(target=self._run, daemon=True)
        self._thread.start()

    def stop(self) -> None:
        self._stop.set()
        if self._thread:
            self._thread.join(timeout=5)

    def _run(self) -> None:
        workers = {worker.id: worker for worker in self.config.workers}
        while not self._stop.is_set():
            for job in self.store.active():
                worker = workers.get(job.worker_id)
                if not worker:
                    self.store.update_state(job.id, "failed", error=f"Unknown worker {job.worker_id}")
                    continue
                try:
                    payload = self.client.history(worker, job.prompt_id)
                    history = payload.get(job.prompt_id)
                    if not history:
                        self.store.update_state(job.id, "running")
                        continue
                    status = history.get("status") or {}
                    messages = status.get("messages") or []
                    if any("execution_error" in str(message) for message in messages):
                        self.store.update_state(job.id, "failed", error="ComfyUI reported execution_error", comfy_status=history)
                    elif status.get("completed") or status.get("status_str") in {"success", "completed"}:
                        self.store.update_state(job.id, "completed", comfy_status=history)
                    else:
                        self.store.update_state(job.id, "running", comfy_status=history)
                except Exception as exc:
                    self.store.update_state(job.id, "unknown", error=str(exc))
            self._stop.wait(self.config.server.poll_seconds)
