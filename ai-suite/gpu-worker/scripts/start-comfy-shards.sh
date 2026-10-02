#!/usr/bin/env bash
set -euo pipefail

CONFIG_PATH="${1:-config.yaml}"

python3 - "$CONFIG_PATH" <<'PY'
import shlex
import subprocess
import sys
from pathlib import Path

import yaml

config_path = Path(sys.argv[1])
config = yaml.safe_load(config_path.read_text())
comfy_root = Path(config["comfy_root"])
python = config.get("python") or str(comfy_root / ".venv/bin/python")
logs = Path(config.get("logs", "./logs"))
logs.mkdir(parents=True, exist_ok=True)

for worker in config.get("workers", []):
    env = {
        "CUDA_VISIBLE_DEVICES": str(worker["gpu_id"]),
    }
    cmd = [
        python,
        "main.py",
        "--listen",
        str(worker.get("host", "127.0.0.1")),
        "--port",
        str(worker["port"]),
        *worker.get("extra_args", []),
    ]
    log_path = logs / f"comfy-{worker['id']}.log"
    print(f"starting {worker['id']} on CUDA_VISIBLE_DEVICES={worker['gpu_id']} port={worker['port']}")
    with log_path.open("ab", buffering=0) as log:
        subprocess.Popen(
            cmd,
            cwd=str(comfy_root),
            env={**dict(__import__("os").environ), **env},
            stdout=log,
            stderr=subprocess.STDOUT,
            start_new_session=True,
        )
PY
