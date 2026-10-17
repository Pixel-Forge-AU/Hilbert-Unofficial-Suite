from __future__ import annotations

import json
import sqlite3
import time
from pathlib import Path

from .models import JobRecord


class JobStore:
    def __init__(self, path: Path):
        self.path = path
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self._init()

    def _connect(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self.path)
        conn.row_factory = sqlite3.Row
        return conn

    def _init(self) -> None:
        with self._connect() as conn:
            conn.execute(
                """
                create table if not exists jobs (
                  id text primary key,
                  worker_id text not null,
                  prompt_id text not null,
                  workflow_type text not null,
                  state text not null,
                  priority integer not null,
                  created_at real not null,
                  updated_at real not null,
                  error text,
                  comfy_status text
                )
                """
            )

    def upsert(self, job: JobRecord) -> JobRecord:
        with self._connect() as conn:
            conn.execute(
                """
                insert into jobs (
                  id, worker_id, prompt_id, workflow_type, state, priority,
                  created_at, updated_at, error, comfy_status
                ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                on conflict(id) do update set
                  worker_id=excluded.worker_id,
                  prompt_id=excluded.prompt_id,
                  workflow_type=excluded.workflow_type,
                  state=excluded.state,
                  priority=excluded.priority,
                  updated_at=excluded.updated_at,
                  error=excluded.error,
                  comfy_status=excluded.comfy_status
                """,
                (
                    job.id,
                    job.worker_id,
                    job.prompt_id,
                    job.workflow_type,
                    job.state,
                    job.priority,
                    job.created_at,
                    job.updated_at,
                    job.error,
                    json.dumps(job.comfy_status) if job.comfy_status is not None else None,
                ),
            )
        return job

    def get(self, job_id: str) -> JobRecord | None:
        with self._connect() as conn:
            row = conn.execute("select * from jobs where id = ?", (job_id,)).fetchone()
        return self._row(row) if row else None

    def list(self, limit: int = 100) -> list[JobRecord]:
        with self._connect() as conn:
            rows = conn.execute(
                "select * from jobs order by created_at desc limit ?",
                (max(1, min(limit, 500)),),
            ).fetchall()
        return [self._row(row) for row in rows]

    def active(self) -> list[JobRecord]:
        with self._connect() as conn:
            rows = conn.execute(
                "select * from jobs where state in ('queued', 'running', 'unknown')"
            ).fetchall()
        return [self._row(row) for row in rows]

    def update_state(
        self,
        job_id: str,
        state: str,
        error: str | None = None,
        comfy_status: dict | None = None,
    ) -> JobRecord | None:
        job = self.get(job_id)
        if not job:
            return None
        updated = job.model_copy(
            update={
                "state": state,
                "error": error,
                "comfy_status": comfy_status if comfy_status is not None else job.comfy_status,
                "updated_at": time.time(),
            }
        )
        return self.upsert(updated)

    def inflight_counts(self) -> dict[str, int]:
        counts: dict[str, int] = {}
        for job in self.active():
            counts[job.worker_id] = counts.get(job.worker_id, 0) + 1
        return counts

    def _row(self, row: sqlite3.Row) -> JobRecord:
        data = dict(row)
        if data.get("comfy_status"):
            data["comfy_status"] = json.loads(data["comfy_status"])
        return JobRecord(**data)
