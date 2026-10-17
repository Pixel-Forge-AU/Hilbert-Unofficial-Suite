from __future__ import annotations

import os
import signal
import subprocess
import time
from pathlib import Path

from .config import RunnerConfig, WorkerConfig


class ShardManager:
    def __init__(self, config: RunnerConfig):
        self.config = config
        self.pid_dir = Path("./state/pids")
        self.pid_dir.mkdir(parents=True, exist_ok=True)
        self.config.storage.logs_dir.mkdir(parents=True, exist_ok=True)

    def start_all(self) -> None:
        for worker in self.config.workers:
            self.start(worker)

    def stop_all(self) -> None:
        for worker in self.config.workers:
            self.stop(worker)

    def start(self, worker: WorkerConfig) -> None:
        pid_path = self._pid_path(worker)
        if self._running(pid_path):
            print(f"{worker.id} already running pid={pid_path.read_text().strip()}")
            return
        cmd = [
            str(self.config.comfy.python),
            "main.py",
            "--listen",
            worker.host,
            "--port",
            str(worker.port),
            *self.config.comfy.extra_args,
            *worker.extra_args,
        ]
        env = dict(os.environ)
        env["CUDA_VISIBLE_DEVICES"] = worker.gpu_id
        log_path = self.config.storage.logs_dir / f"comfy-{worker.id}.log"
        with log_path.open("ab", buffering=0) as log:
            proc = subprocess.Popen(
                cmd,
                cwd=str(self.config.comfy.root),
                env=env,
                stdout=log,
                stderr=subprocess.STDOUT,
                start_new_session=True,
            )
        pid_path.write_text(str(proc.pid))
        print(f"started {worker.id} pid={proc.pid} gpu={worker.gpu_id} url={worker.base_url} log={log_path}")

    def stop(self, worker: WorkerConfig) -> None:
        pid_path = self._pid_path(worker)
        if not pid_path.exists():
            print(f"{worker.id} not running")
            return
        try:
            pid = int(pid_path.read_text().strip())
        except ValueError:
            pid_path.unlink(missing_ok=True)
            return
        try:
            os.killpg(pid, signal.SIGTERM)
            time.sleep(2)
        except ProcessLookupError:
            pass
        except PermissionError:
            os.kill(pid, signal.SIGTERM)
        if self._is_pid_running(pid):
            try:
                os.killpg(pid, signal.SIGKILL)
            except Exception:
                os.kill(pid, signal.SIGKILL)
        pid_path.unlink(missing_ok=True)
        print(f"stopped {worker.id}")

    def _pid_path(self, worker: WorkerConfig) -> Path:
        return self.pid_dir / f"{worker.id}.pid"

    def _running(self, pid_path: Path) -> bool:
        if not pid_path.exists():
            return False
        try:
            return self._is_pid_running(int(pid_path.read_text().strip()))
        except ValueError:
            return False

    def _is_pid_running(self, pid: int) -> bool:
        try:
            os.kill(pid, 0)
            return True
        except ProcessLookupError:
            return False
