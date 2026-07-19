# AI Suite V2

A local, offline-first AI workstation: a coding LLM, an uncensored "Heretic"
LLM, ComfyUI (image/video/3D/audio generation) and a browser automation
service, all driven from one switcher so only one GPU-heavy stack runs at a
time. Includes a workflow launcher/studio web UI at `:8000` with 48 curated
workflow packs (character, core-generation, image-editing, horror-gore,
three-d, video-animation, audio, and more) plus the original 24 migrated V1
Studio workflows, and two chained-generation pipelines built on top of them:

- **Music Video** - one concept in, a song + cover art + an animated film
  clip out, stitched and muxed into one file. Can also start from your own
  song/image, or reuse already-generated clips instead of generating new ones.
- **Storyboard** - generate a persisted, revisitable sequence of shot images,
  then turn it into one continuous video any time later by animating the
  motion between each consecutive pair of shots.

Runs entirely on your own machine - no API keys, no cloud calls.

## Before you install

This package is small (a few MB): it's the orchestration code, workflow
definitions, and presets. It does **not** include ComfyUI, llama.cpp, or any
model weights - those are hundreds of GB combined and you fetch/build them
yourself via `install.sh`.

**Hardware**: built and tested on an AMD Ryzen AI Max APU (Radeon 8060S /
gfx1151) using Vulkan (llama.cpp) and ROCm (ComfyUI/PyTorch). It should work
on other GPUs, but the install script's PyTorch step and `HSA_OVERRIDE_GFX_VERSION`
config knob are written with that hardware in mind - see `V1_SWITCHER_README.md`.
If your GPU/unified-memory split is configured in firmware (common on these
APUs), a fixed, large split can starve the OS side of RAM under big models
(e.g. 20B+ checkpoints) badly enough to crash the whole ComfyUI process rather
than failing gracefully - worth checking if you hit that.

**Disk space**: plan for 400GB+ free if you want ComfyUI, llama.cpp, and all
three LLMs installed (ComfyUI alone commonly grows past 300GB once you start
adding checkpoints/LoRAs for its workflow packs).

## Install

```bash
./install.sh
```

This creates a venv and installs suite dependencies, clones and builds
llama.cpp (Vulkan), clones ComfyUI plus ComfyUI-Manager, and installs a
desktop launcher entry. It prints what it can't do for you - mainly, getting
the actual LLM/checkpoint model files (see below).

### Model weights

Not fetched automatically. Two are required by default config:

- `models/qwen3-coder-next/...` - coding LLM used by `./ai-switch chat`
- `models/qwythos-9b/...` - sidecar LLM

The third (`models/qwen3.6-35b-a3b-heretic/...`) is optional: if you don't
place a file there, llama.cpp fetches it from Hugging Face automatically on
first launch of `./ai-switch llama-heretic`.

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
controlnet-aux, face/ID tools, etc.) - see `CUSTOM_NODES.md` for exactly
which nodes each workflow needs and how to install them via ComfyUI-Manager.
Not required for every workflow - only install what you plan to use.

## Using it

```bash
./ai-switch status   # what's running
./ai-switch llama    # start the coding LLM
./ai-switch comfy    # start ComfyUI (stops llama.cpp first - one GPU stack at a time)
./ai-switch studio   # start the workflow launcher/studio web UI on :8000
./ai-switch stop     # stop everything
```

Or use the desktop GUI (`./launch-switcher`, or the "AI Suite V2 Switcher"
entry `install.sh` adds to your applications menu) for the same controls with
buttons instead of commands.

Full command reference: `LAUNCHER_README.md` (the `launcher.py` CLI/web app)
and `V1_SWITCHER_README.md` (the `ai-switch` service commands, endpoints, and
AMD/ROCm notes).

## Configuration

`config.env` holds ports, context sizes, and hardware tuning knobs. Paths are
deliberately left out of it and resolved relative to wherever you installed
this folder - so it works unmodified regardless of install location. Only add
a path override there if you want models/repos stored somewhere other than
alongside the code (e.g. a separate drive).

## Changes since 2.0.0

See `CHANGELOG.md` for the full list - highlights are the Music Video and
Storyboard pipelines above, several `workflow_to_api()` conversion bugs fixed
(a handful of node types were silently getting wrong/missing inputs), and
retirement of the old standalone V1 "Studio" web server in favor of this
`launcher.py` app (filed away in `archive/comfy-studio-v1/` in the working
repo, not included in this release package).
