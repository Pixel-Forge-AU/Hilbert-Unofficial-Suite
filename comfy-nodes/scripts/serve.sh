#!/usr/bin/env bash
set -euo pipefail

CONFIG="${1:-config.yaml}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

cd "$ROOT"
exec ./.venv/bin/python -m gpu_node_runner --config "$CONFIG" serve
