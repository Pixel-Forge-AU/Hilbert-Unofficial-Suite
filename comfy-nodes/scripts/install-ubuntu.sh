#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

python3 -m venv .venv
. .venv/bin/activate
pip install --upgrade pip
pip install -r requirements.txt

mkdir -p logs state
if [[ ! -f config.yaml ]]; then
  cp configs/example.yaml config.yaml
fi

chmod +x scripts/*.sh

echo "Installed GPU node runner in $ROOT"
echo "Edit config.yaml, then run:"
echo "  ./scripts/start-shards.sh config.yaml"
echo "  ./scripts/serve.sh config.yaml"
