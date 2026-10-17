#!/usr/bin/env bash
# AI Suite (creative) installer.
#
# This package ships Studio, Hilbert Chat, the workflow packs, presets and tooling.
# The heavyweight runtime it drives - ComfyUI plus its checkpoint weights - is NOT
# bundled; this script fetches and builds it. Local LLM serving (llama.cpp, Ollama)
# and the AI build pipeline live in the sibling agent suite: run
# ../agent-suite/install.sh for those.
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
if command -v python3 >/dev/null 2>&1 && ! python3 -c "import ensurepip" >/dev/null 2>&1; then
    missing+=("python3-venv (python3's ensurepip module is missing - this is what silently")
    missing+=("  leaves a .venv with no bin/pip after 'python3 -m venv', with no error)")
fi
if [ "${#missing[@]}" -gt 0 ]; then
    echo "Missing required build tools:"
    printf '  - %s\n' "${missing[@]}"
    echo
    echo "On Debian/Ubuntu (and derivatives like Pop!_OS):"
    echo "  sudo apt install python3 python3-venv python3-pip git"
    exit 1
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

echo "-- [1/4] Python virtualenv + suite dependencies --"
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
echo "-- [2/4] ComfyUI --"
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
echo "-- [3/4] Model weights --"
echo "Run: ./.venv/bin/python tools/download_models.py for the ComfyUI"
echo "checkpoint/LoRA/controlnet set. LLM (GGUF) weights belong to the agent"
echo "suite - see ../agent-suite/install.sh."

echo
echo "-- [4/4] Desktop launcher --"
mkdir -p ~/.local/share/applications
sed "s|__INSTALL_DIR__|$ROOT|g" "AI Suite Switcher.desktop.template" \
    > ~/.local/share/applications/ai-suite-switcher.desktop
chmod +x ~/.local/share/applications/ai-suite-switcher.desktop

echo
echo "== Done =="
echo "Launch with: ./ai-switch status   or   ./launch-switcher   (GUI)"
echo "Studio web UI once services are up: http://127.0.0.1:39000"
echo "Hilbert Chat needs an LLM: install ../agent-suite (./install.sh there), then"
echo "./ai-switch hilbert starts the LLM via agent-switch plus the chat UI."
