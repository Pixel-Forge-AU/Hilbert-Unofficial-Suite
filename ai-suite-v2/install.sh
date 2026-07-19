#!/usr/bin/env bash
# AI Suite V2 installer.
#
# This package ships only the orchestration code, workflows, and presets
# (a few MB). The two heavyweight runtimes it drives - ComfyUI and
# llama.cpp, plus the GGUF/checkpoint model weights (hundreds of GB
# combined) - are NOT bundled. This script fetches and builds the former;
# model weights are your own download (see step 3 below and tools/).
set -euo pipefail
cd "$(dirname "$0")"
ROOT="$(pwd)"

echo "== AI Suite V2 installer =="
echo "Installing into: $ROOT"
echo

echo "-- [1/5] Python virtualenv + suite dependencies --"
if [ ! -d .venv ]; then
    python3 -m venv .venv
fi
./.venv/bin/pip install --upgrade pip >/dev/null
./.venv/bin/pip install -r requirements.txt

echo
echo "-- [2/5] llama.cpp (Vulkan build) --"
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
echo "-- [3/5] ComfyUI --"
if [ ! -d repos/ComfyUI ]; then
    git clone https://github.com/Comfy-Org/ComfyUI.git repos/ComfyUI
fi
if [ ! -d repos/ComfyUI/.venv ]; then
    python3 -m venv repos/ComfyUI/.venv
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
echo "-- [4/5] Model weights --"
mkdir -p models
echo "Not downloaded automatically - these are large (tens to ~50GB each):"
echo "  models/qwen3-coder-next/...             (coding LLM, used by 'chat')"
echo "  models/qwythos-9b/...                   (sidecar LLM)"
echo "  models/qwen3.6-35b-a3b-heretic/...       (optional; llama.cpp will"
echo "                                            auto-fetch this one from"
echo "                                            HF on first launch if absent)"
echo "Place your own GGUF files at those paths (see config.env for exact"
echo "filenames expected), then run: ./.venv/bin/python tools/download_models.py"
echo "for the smaller ComfyUI checkpoint/LoRA/controlnet set."

echo
echo "-- [5/5] Desktop launcher --"
mkdir -p ~/.local/share/applications
sed "s|__INSTALL_DIR__|$ROOT|g" "AI Suite V2 Switcher.desktop.template" \
    > ~/.local/share/applications/ai-suite-v2-switcher.desktop
chmod +x ~/.local/share/applications/ai-suite-v2-switcher.desktop

echo
echo "== Done =="
echo "Launch with: ./ai-switch status   or   ./launch-switcher   (GUI)"
echo "Studio web UI once services are up: http://127.0.0.1:8000"
