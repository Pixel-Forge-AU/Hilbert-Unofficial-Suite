#!/usr/bin/env bash
# Agent Suite installer.
#
# This package ships Genesis Runtime, the planner -> implementation-orchestrator ->
# OpenHands build pipeline, its dashboard, and the local LLM service manager. The
# heavyweight pieces it drives - llama.cpp, the real OpenHands agent-server, and GGUF
# model weights (tens of GB each) - are NOT bundled. This script fetches and builds
# llama.cpp and OpenHands; model weights are your own download (see step 5 below).
set -euo pipefail
cd "$(dirname "$0")"
ROOT="$(pwd)"

echo "== Agent Suite installer =="
echo "Installing into: $ROOT"
echo

echo "-- Checking prerequisites --"
missing=()
command -v python3 >/dev/null 2>&1 || missing+=("python3")
command -v git >/dev/null 2>&1 || missing+=("git")
command -v cmake >/dev/null 2>&1 || missing+=("cmake")
command -v cc >/dev/null 2>&1 || command -v gcc >/dev/null 2>&1 || command -v g++ >/dev/null 2>&1 \
    || missing+=("a C/C++ compiler (build-essential)")
if [ "${#missing[@]}" -gt 0 ]; then
    echo "Missing required build tools:"
    printf '  - %s\n' "${missing[@]}"
    echo
    echo "On Debian/Ubuntu (and derivatives like Pop!_OS):"
    echo "  sudo apt install python3 git cmake build-essential"
    exit 1
fi
if ! command -v glslc >/dev/null 2>&1; then
    echo "NOTE: glslc (Vulkan shader compiler) not found - needed to build llama.cpp's Vulkan"
    echo "backend (step [1/5] below will fail with its own clear error if this is actually"
    echo "missing there). On Debian/Ubuntu:"
    echo "  sudo apt install glslang-tools spirv-tools spirv-headers libvulkan-dev"
fi
echo

# Resolved from config.env, so an existing build/model folder elsewhere (e.g. the
# creative suite's, from before the split) is reused instead of rebuilt.
config_value() { python3 -c "import agent_manager; print(agent_manager.load_config()['$1'])"; }
LLAMA_CPP_DIR="$(config_value LLAMA_CPP_DIR)"
MODELS_DIR="$(config_value MODELS_DIR)"

echo "-- Python virtualenv for the Runtime & Performance console --"
if [ ! -x .venv/bin/pip ]; then
    rm -rf .venv
    python3 -m venv .venv
fi
./.venv/bin/pip install --upgrade pip >/dev/null
./.venv/bin/pip install -r requirements.txt

echo
echo "-- [1/5] llama.cpp (Vulkan build) in $LLAMA_CPP_DIR --"
if [ ! -d "$LLAMA_CPP_DIR" ]; then
    mkdir -p "$(dirname "$LLAMA_CPP_DIR")"
    git clone https://github.com/ggml-org/llama.cpp.git "$LLAMA_CPP_DIR"
fi
if [ ! -x "$LLAMA_CPP_DIR/build-vulkan/bin/llama-server" ]; then
    cmake -S "$LLAMA_CPP_DIR" -B "$LLAMA_CPP_DIR/build-vulkan" -DGGML_VULKAN=ON -DCMAKE_BUILD_TYPE=Release
    cmake --build "$LLAMA_CPP_DIR/build-vulkan" --config Release -j"$(nproc)"
else
    echo "already built, skipping"
fi

echo
echo "-- [2/5] AI build pipeline (planner-pipeline + implementation-orchestrator) --"
if ! command -v node >/dev/null 2>&1; then
    echo "SKIPPED: Node.js 22+ not found. Install it, then re-run this script to set up"
    echo "the AI build pipeline (planner-pipeline/implementation-orchestrator/genesis-runtime)."
elif ! command -v docker >/dev/null 2>&1 || ! docker compose version >/dev/null 2>&1; then
    echo "SKIPPED: Docker + Docker Compose not found (needed for each service's own"
    echo "Postgres/Redis). Install Docker, then re-run this script."
else
    for svc in planner-pipeline implementation-orchestrator; do
        echo "  -- $svc --"
        ( cd "$svc" && npx --yes pnpm@9.15.9 install --frozen-lockfile )
    done
    ( cd implementation-orchestrator && npx --yes pnpm@9.15.9 build )

    [ -f planner-pipeline/.env ] || cp planner-pipeline/.env.example planner-pipeline/.env
    if [ ! -f implementation-orchestrator/.env ]; then
        sed "s|__INSTALL_DIR__|$ROOT|g" implementation-orchestrator/.env.example \
            > implementation-orchestrator/.env
    fi

    ./agent-switch planner-setup
    ./agent-switch orchestrator-setup
fi

echo
echo "-- [3/5] Genesis Runtime (plugin-host runtime, ships with zero plugins) --"
if command -v node >/dev/null 2>&1; then
    ( cd genesis-runtime && npm install )
else
    echo "SKIPPED: Node.js 22+ not found."
fi

echo
echo "-- [4/5] OpenHands agent-server --"
if ! command -v uv >/dev/null 2>&1; then
    echo "uv not found - installing (https://astral.sh/uv)..."
    curl -LsSf https://astral.sh/uv/install.sh | sh
    export PATH="$HOME/.local/bin:$PATH"
fi
if [ ! -d open-hands ]; then
    git clone https://github.com/All-Hands-AI/OpenHands.git open-hands
fi
( cd open-hands && rm -rf .venv && uv sync )
SESSION_KEY="$(python3 -c 'import secrets; print(secrets.token_hex(24))')"
if grep -q '^OPENHANDS_SESSION_API_KEY=' config.env; then
    sed -i "s|^OPENHANDS_SESSION_API_KEY=.*|OPENHANDS_SESSION_API_KEY=$SESSION_KEY|" config.env
else
    echo "OPENHANDS_SESSION_API_KEY=$SESSION_KEY" >> config.env
fi
if [ -f implementation-orchestrator/.env ]; then
    sed -i "s|^OPENHANDS_SESSION_API_KEY=.*|OPENHANDS_SESSION_API_KEY=$SESSION_KEY|" implementation-orchestrator/.env
fi
echo "Generated a fresh OPENHANDS_SESSION_API_KEY shared between config.env and"
echo "implementation-orchestrator/.env."

echo
echo "-- [5/5] LLM model weights in $MODELS_DIR --"
mkdir -p "$MODELS_DIR"
echo "Not downloaded automatically - these are large (tens to ~50GB each):"
echo "  qwen3-coder-next/...             (coding LLM, used by Hilbert Chat)"
echo "  qwythos-9b/...                   (sidecar LLM, used by the AI build"
echo "                                     pipeline and OpenHands)"
echo "  qwen3.6-35b-a3b-heretic/...      (optional; llama.cpp will auto-fetch"
echo "                                     this one from HF on first launch)"
echo "Place your own GGUF files there (see config.env for the exact filenames"
echo "expected, or set LLAMA_MODEL / QWEN_SIDECAR_MODEL to their paths)."

echo
echo "== Done =="
echo "Launch with: ./agent-switch status, or the AI Suite Switcher desktop app"
echo "(../ai-suite/launch-switcher), which controls both suites."
echo "Runtime & Performance console: ./agent-switch console  ->  http://127.0.0.1:39019"
echo "LLMs: ./agent-switch llama / llama-heretic / qwen-sidecar / ollama"
echo "AI build pipeline: ./agent-switch planner / orchestrator / openhands / genesis"
echo "(each has a matching '-stop' command; planner/orchestrator also have"
echo "'-setup', already run above). Dashboard: ./agent-switch pipeline-dashboard"
