#!/usr/bin/env bash
set -euo pipefail

CONFIG_PATH="${1:-config.yaml}"

python3 - "$CONFIG_PATH" <<'PY'
import subprocess
import sys
from pathlib import Path

import yaml

config = yaml.safe_load(Path(sys.argv[1]).read_text())
for worker in config.get("workers", []):
    port = str(worker["port"])
    subprocess.run(["pkill", "-f", f"main.py --listen .* --port {port}"], check=False)
    subprocess.run(["pkill", "-f", f"main.py.*--port {port}"], check=False)
    print(f"stop requested for {worker['id']} port={port}")
PY
