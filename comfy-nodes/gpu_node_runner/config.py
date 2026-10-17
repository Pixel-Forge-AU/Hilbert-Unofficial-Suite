from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import yaml


@dataclass(frozen=True)
class ServerConfig:
    host: str = "0.0.0.0"
    port: int = 39018
    request_timeout_seconds: int = 30
    poll_seconds: int = 2


@dataclass(frozen=True)
class StorageConfig:
    sqlite_path: Path = Path("./state/jobs.sqlite3")
    logs_dir: Path = Path("./logs")


@dataclass(frozen=True)
class ComfyConfig:
    root: Path = Path("/opt/ComfyUI")
    python: Path = Path("/opt/ComfyUI/.venv/bin/python")
    listen_host: str = "127.0.0.1"
    base_port: int = 39100
    extra_args: list[str] = field(default_factory=lambda: ["--disable-auto-launch"])


@dataclass(frozen=True)
class WorkerConfig:
    id: str
    label: str
    gpu_id: str
    port: int
    host: str = "127.0.0.1"
    weight: int = 50
    max_inflight: int = 1
    tags: frozenset[str] = frozenset()
    extra_args: tuple[str, ...] = ()

    @property
    def base_url(self) -> str:
        return f"http://{self.host}:{self.port}"


@dataclass(frozen=True)
class RunnerConfig:
    path: Path
    server: ServerConfig
    storage: StorageConfig
    comfy: ComfyConfig
    workers: tuple[WorkerConfig, ...]


def _path(value: str | Path) -> Path:
    return Path(value).expanduser()


def load_config(path: str | Path) -> RunnerConfig:
    config_path = _path(path)
    raw: dict[str, Any] = yaml.safe_load(config_path.read_text()) or {}
    server_raw = raw.get("server") or {}
    storage_raw = raw.get("storage") or {}
    comfy_raw = raw.get("comfy") or {}

    server = ServerConfig(
        host=str(server_raw.get("host", "0.0.0.0")),
        port=int(server_raw.get("port", 39018)),
        request_timeout_seconds=int(server_raw.get("request_timeout_seconds", 30)),
        poll_seconds=int(server_raw.get("poll_seconds", 2)),
    )
    storage = StorageConfig(
        sqlite_path=_path(storage_raw.get("sqlite_path", "./state/jobs.sqlite3")),
        logs_dir=_path(storage_raw.get("logs_dir", "./logs")),
    )
    comfy = ComfyConfig(
        root=_path(comfy_raw.get("root", "/opt/ComfyUI")),
        python=_path(comfy_raw.get("python", "/opt/ComfyUI/.venv/bin/python")),
        listen_host=str(comfy_raw.get("listen_host", "127.0.0.1")),
        base_port=int(comfy_raw.get("base_port", 39100)),
        extra_args=[str(item) for item in comfy_raw.get("extra_args", ["--disable-auto-launch"])],
    )
    workers = []
    for index, item in enumerate(raw.get("workers") or []):
        port = int(item.get("port", comfy.base_port + index))
        workers.append(
            WorkerConfig(
                id=str(item["id"]),
                label=str(item.get("label", item["id"])),
                gpu_id=str(item.get("gpu_id", index)),
                host=str(item.get("host", comfy.listen_host)),
                port=port,
                weight=int(item.get("weight", 50)),
                max_inflight=int(item.get("max_inflight", 1)),
                tags=frozenset(str(tag).lower() for tag in item.get("tags", [])),
                extra_args=tuple(str(arg) for arg in item.get("extra_args", [])),
            )
        )
    if not workers:
        raise ValueError("Config must define at least one worker")
    return RunnerConfig(config_path, server, storage, comfy, tuple(workers))
