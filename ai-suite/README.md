# AI Suite

The creative half of a local, offline-first AI workstation: ComfyUI
(image/video/3D/audio generation), Hilbert Chat and a browser automation
service, driven from one switcher. Includes a workflow launcher/studio web UI
(`:39000`) with 67 curated workflow packs (character, core-generation,
image-editing, horror-gore, three-d, video-animation, audio, and more) plus
the original 24 migrated V1 Studio workflows, and two chained-generation
pipelines built on top of them:

- **Music Video** - one concept in, a song + cover art + an animated film
  clip out, stitched and muxed into one file. Can also start from your own
  song/image, or reuse already-generated clips instead of generating new ones.
- **Storyboard** - generate a persisted, revisitable sequence of shot images,
  then turn it into one continuous video any time later by animating the
  motion between each consecutive pair of shots.
Runs entirely on your own machine - no API keys, no cloud calls.

**LLMs and automation live in the sibling agent suite** (`../agent-suite`):
local LLM serving (llama.cpp coding/"Heretic" models, the qwen-sidecar,
Ollama), Genesis Runtime, and the AI software-build pipeline (planner,
orchestrator, OpenHands, pipeline dashboard). Hilbert Chat and Studio's LLM
workflows talk to those LLMs over HTTP; `./ai-switch llama` and friends are
forwarded to `agent-switch`. ComfyUI and the main LLM still take turns on the
GPU - starting either stops the other, across the two suites.

Studio's Runtime (system stats, service buttons), Performance (LLM tuning, model
slots), Pipeline and Genesis tabs moved there too, into the agent suite's console
(`:39019`, linked from Studio's nav). Studio keeps the queue and latest output. Its Chat tab
still works as before; its task picker reads model data from the console.

## Before you install

This package is small (a few MB): it's the orchestration code, workflow
definitions and presets. It does **not** include ComfyUI or any model
weights - those are hundreds of GB combined and you fetch/build them yourself
via `install.sh`. For LLMs, also run `../agent-suite/install.sh`.

**Prerequisites**: Python 3.10+ with `python3-venv` (not always installed by
default - if it's missing, `python3 -m venv` can silently produce a `.venv`
with no `bin/pip`, which is the most common install failure), and `git`.
`install.sh` checks for these up front and tells you exactly what's missing
before doing anything else. (The agent suite's installer has its own list:
cmake, a C/C++ compiler and the Vulkan toolchain for llama.cpp, plus Node.js
22+ and Docker for the build pipeline.)

**Hardware**: built and tested on an AMD Ryzen AI Max APU (Radeon 8060S /
gfx1151) using ROCm (ComfyUI/PyTorch). It should work
on other GPUs, but the install script's PyTorch step and `HSA_OVERRIDE_GFX_VERSION`
config knob are written with that hardware in mind - see `V1_SWITCHER_README.md`.
If your GPU/unified-memory split is configured in firmware (common on these
APUs), a fixed, large split can starve the OS side of RAM under big models
(e.g. 20B+ checkpoints) badly enough to crash the whole ComfyUI process rather
than failing gracefully - worth checking if you hit that.

**Disk space**: ComfyUI commonly grows past 300GB once you start adding
checkpoints/LoRAs for its workflow packs. The agent suite's LLM weights are
another ~100GB for the default three models.

## Install

```bash
./install.sh
```

This creates a venv and installs suite dependencies, sets up Playwright
(browser automation), clones ComfyUI plus ComfyUI-Manager, and installs a
desktop launcher entry. It prints what it can't do for you - mainly, getting
the checkpoint model files (see below).

### Model weights

LLM (GGUF) weights belong to the agent suite - see its `install.sh`.

Once ComfyUI is set up, run `./.venv/bin/python tools/download_models.py` to
pull the smaller checkpoint/LoRA/controlnet set the bundled workflow packs
expect. `download_models.py` covers a known subset; each workflow's own
`packs/*/*/manifest.yaml` under `models.required[].url` is the authoritative
list if a specific pack needs something it doesn't fetch. The Music Video and
Storyboard pipelines additionally expect ACE-Step 1.5 (audio), Z-Image Turbo
and/or Qwen-Image (cover art), and LTXV plus WAN 2.2 (film clips/transitions)
- see `packs/audio/ace-step-1-5`, `packs/core-generation/text-to-image*`, and
`packs/video-animation/*` manifests for exact filenames/URLs.

### Custom ComfyUI nodes

Several workflow packs use custom nodes beyond stock ComfyUI (impact-pack,
controlnet-aux, face/ID tools, etc.) - each pack's own `manifest.yaml` lists
exactly which ones under `custom_nodes.required`/`custom_nodes.optional` (see
`docs/WORKFLOW_DEVELOPER_GUIDE.md` for the manifest format). Install what a
given workflow needs via ComfyUI-Manager (bundled). Not required for every
workflow - only install what you plan to use.

## Using it

```bash
./ai-switch status   # what's running (and whether the agent suite's LLMs are up)
./ai-switch llama    # start the coding LLM (forwarded to agent-switch)
./ai-switch comfy    # start ComfyUI (stops the main LLM first - one GPU stack at a time)
./ai-switch studio   # start the workflow launcher/studio web UI on :39000
./ai-switch hilbert  # start the coding LLM + Hilbert Chat
./ai-switch stop     # stop the creative services (LLMs: `agent-switch stop`)
```

Or use the desktop GUI (`./launch-switcher`, or the "AI Suite Switcher"
entry `install.sh` adds to your applications menu). It is the control panel for
both suites: ComfyUI, Studio and Chat here, plus the agent suite's LLMs, build
pipeline, Genesis and Runtime & Performance console (it calls `agent-switch`
for those). Its Status and Stop All cover both suites.

The AI build pipeline, Genesis Runtime and its dashboard moved to
`../agent-suite` - start them with `agent-switch` there (see its README).

Full command reference: `LAUNCHER_README.md` (the `launcher.py` CLI/web app)
and `V1_SWITCHER_README.md` (the `ai-switch` service commands, endpoints, and
AMD/ROCm notes).

## Configuration

`config.env` holds ports and hardware tuning knobs. LLM settings (model
paths, context sizes, `LLAMA_*`/`QWEN_SIDECAR_*`/`OLLAMA_*`) are read from
`../agent-suite/config.env` - the agent suite's console writes them there too. Paths are
deliberately left out of it and resolved relative to wherever you installed
this folder - so it works unmodified regardless of install location. Only add
a path override there if you want models/repos stored somewhere other than
alongside the code (e.g. a separate drive).

## Changes since 2.1.0

See `CHANGELOG.md` for the full list - the headline is the new AI build
pipeline (`planner-pipeline` + `implementation-orchestrator` + a real
OpenHands agent-server) and `genesis-runtime`, all managed the same way as
every other suite service. Also: every suite-managed port moved to the
39000-39015 block to avoid collisions with other local dev tools (Ollama's
port is unchanged - it isn't controlled by this suite).
