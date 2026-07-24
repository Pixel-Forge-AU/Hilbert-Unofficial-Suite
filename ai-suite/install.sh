#!/usr/bin/env bash
# AI Suite installer.
#
# This package ships the orchestration code, workflows, presets, and the bespoke
# AI build-pipeline services (a few MB of source). The heavyweight runtimes it
# drives - ComfyUI, llama.cpp, the real OpenHands agent-server, plus GGUF/checkpoint
# model weights (hundreds of GB combined) - are NOT bundled. This script fetches and
# builds all of those; model weights are your own download (see step 7 below and
# tools/).
set -euo pipefail
cd "$(dirname "$0")"
ROOT="$(pwd)"

echo "== AI Suite installer =="
echo "Installing into: $ROOT"
echo

echo "-- Checking prerequisites --"
missing=()
command -v python3 >/dev/null 2>&1 || missing+=("python3")
command -v git >/dev/null 2>&1 || missing+=("git")
command -v cmake >/dev/null 2>&1 || missing+=("cmake")
command -v cc >/dev/null 2>&1 || command -v gcc >/dev/null 2>&1 || command -v g++ >/dev/null 2>&1 \
    || missing+=("a C/C++ compiler (build-essential)")
if command -v python3 >/dev/null 2>&1 && ! python3 -c "import ensurepip" >/dev/null 2>&1; then
    missing+=("python3-venv (python3's ensurepip module is missing - this is what silently")
    missing+=("  leaves a .venv with no bin/pip after 'python3 -m venv', with no error)")
fi
if [ "${#missing[@]}" -gt 0 ]; then
    echo "Missing required build tools:"
    printf '  - %s\n' "${missing[@]}"
    echo
    echo "On Debian/Ubuntu (and derivatives like Pop!_OS):"
    echo "  sudo apt install python3 python3-venv python3-pip git cmake build-essential"
    exit 1
fi
if ! command -v glslc >/dev/null 2>&1; then
    echo "NOTE: glslc (Vulkan shader compiler) not found - needed to build llama.cpp's Vulkan"
    echo "backend (step [2/8] below will fail with its own clear error if this is actually"
    echo "missing there). On Debian/Ubuntu:"
    echo "  sudo apt install glslang-tools spirv-tools spirv-headers libvulkan-dev"
fi
echo

# python3 -m venv can exit 0 but leave bin/pip missing (broken ensurepip on some distros), and a
# .venv left over from a prior run that hit that can mask the same problem on every re-run since
# only the directory's existence gets checked - so check for the pip binary itself, every time.
create_venv() {
    local venv_dir="$1"
    if [ -x "$venv_dir/bin/pip" ]; then
        return 0
    fi
    if [ -d "$venv_dir" ]; then
        echo "  $venv_dir exists but has no pip (partial/broken venv from a prior run) - recreating"
        rm -rf "$venv_dir"
    fi
    python3 -m venv "$venv_dir"
    if [ ! -x "$venv_dir/bin/pip" ]; then
        echo "ERROR: $venv_dir/bin/pip still missing after 'python3 -m venv $venv_dir'."
        echo "This usually means python3-venv/python3-pip isn't installed - see the"
        echo "prerequisites check above, install it, then re-run this script."
        exit 1
    fi
}

echo "-- [1/8] Python virtualenv + suite dependencies --"
create_venv .venv
./.venv/bin/pip install --upgrade pip >/dev/null
./.venv/bin/pip install -r requirements.txt

echo
echo "-- Browser automation (Playwright) --"
create_venv .venv-playwright
./.venv-playwright/bin/pip install --upgrade pip >/dev/null
./.venv-playwright/bin/pip install playwright
./.venv-playwright/bin/playwright install chromium

echo
echo "-- [2/8] llama.cpp (Vulkan build) --"
mkdir -p repos
if [ ! -d repos/llama.cpp ]; then
    git clone https://github.com/ggml-org/llama.cpp.git repos/llama.cpp
fi
if [ ! -x repos/llama.cpp/build-vulkan/bin/llama-server ]; then
    cmake -S repos/llama.cpp -B repos/llama.cpp/build-vulkan -DGGML_VULKAN=ON -DCMAKE_BUILD_TYPE=Release
    cmake --build repos/llama.cpp/build-vulkan --config Release -j"$(nproc)"
else
    echo "already built, skipping"
fi

echo
echo "-- [3/8] ComfyUI --"
if [ ! -d repos/ComfyUI ]; then
    git clone https://github.com/Comfy-Org/ComfyUI.git repos/ComfyUI
fi
comfyui_venv_fresh=0
[ -x repos/ComfyUI/.venv/bin/pip ] || comfyui_venv_fresh=1
create_venv repos/ComfyUI/.venv
if [ "$comfyui_venv_fresh" = "1" ]; then
    ./repos/ComfyUI/.venv/bin/pip install --upgrade pip >/dev/null
    ./repos/ComfyUI/.venv/bin/pip install -r repos/ComfyUI/requirements.txt
    echo "NOTE: this installed the CPU/CUDA build of torch. On an AMD ROCm"
    echo "GPU/APU (e.g. Ryzen AI Max / Radeon 8060S), replace it with AMD's"
    echo "ROCm-matched PyTorch wheels inside repos/ComfyUI/.venv, matching"
    echo "your installed ROCm runtime version."
fi
mkdir -p repos/ComfyUI/custom_nodes
if [ ! -d repos/ComfyUI/custom_nodes/ComfyUI-Manager ]; then
    git clone https://github.com/Comfy-Org/ComfyUI-Manager.git repos/ComfyUI/custom_nodes/ComfyUI-Manager
fi
if [ ! -d repos/ComfyUI/custom_nodes/diffrhythm_mw ] && [ -d extra/custom_nodes/diffrhythm_mw ]; then
    cp -r extra/custom_nodes/diffrhythm_mw repos/ComfyUI/custom_nodes/diffrhythm_mw
fi
echo "Other custom nodes referenced by individual workflow packs are NOT"
echo "installed automatically - see CUSTOM_NODES.md for the full list of"
echo "which packages each workflow needs, and install what you plan to use"
echo "from within ComfyUI via the bundled ComfyUI-Manager."

echo
echo "-- [4/8] AI build pipeline (planner-pipeline + implementation-orchestrator) --"
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

    ./ai-switch planner-setup
    ./ai-switch orchestrator-setup
fi

echo
echo "-- [5/8] Genesis Runtime (plugin-host runtime, ships with zero plugins) --"
if command -v node >/dev/null 2>&1; then
    ( cd genesis-runtime && npm install )
else
    echo "SKIPPED: Node.js 22+ not found."
fi

echo
echo "-- [6/8] OpenHands agent-server --"
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
echo "-- [7/8] Model weights --"
mkdir -p models
echo "Not downloaded automatically - these are large (tens to ~50GB each):"
echo "  models/qwen3-coder-next/...             (coding LLM, used by 'chat')"
echo "  models/qwythos-9b/...                   (sidecar LLM, also used by the AI"
echo "                                            build pipeline and OpenHands)"
echo "  models/qwen3.6-35b-a3b-heretic/...       (optional; llama.cpp will"
echo "                                            auto-fetch this one from"
echo "                                            HF on first launch if absent)"
echo "Place your own GGUF files at those paths (see config.env for exact"
echo "filenames expected), then run: ./.venv/bin/python tools/download_models.py"
echo "for the smaller ComfyUI checkpoint/LoRA/controlnet set."

echo
echo "-- [8/8] Desktop launcher --"
mkdir -p ~/.local/share/applications
sed "s|__INSTALL_DIR__|$ROOT|g" "AI Suite Switcher.desktop.template" \
    > ~/.local/share/applications/ai-suite-switcher.desktop
chmod +x ~/.local/share/applications/ai-suite-switcher.desktop

echo
echo "== Done =="
echo "Launch with: ./ai-switch status   or   ./launch-switcher   (GUI)"
echo "Studio web UI once services are up: http://127.0.0.1:39000"
echo "AI build pipeline: ./ai-switch planner / orchestrator / openhands / genesis"
echo "(each has a matching '-stop' command; planner/orchestrator also have"
echo "'-setup', already run above)."
