# AI Suite

A local, offline-first AI workstation: a coding LLM, an uncensored "Heretic"
LLM, ComfyUI (image/video/3D/audio generation) and a browser automation
service, all driven from one switcher so only one GPU-heavy stack runs at a
time. Includes a workflow launcher/studio web UI (`:39000`) with 67 curated
workflow packs (character, core-generation, image-editing, horror-gore,
three-d, video-animation, audio, and more) plus the original 24 migrated V1
Studio workflows, two chained-generation pipelines built on top of them
(Music Video, Storyboard), and an AI software-build pipeline:

- **Music Video** - one concept in, a song + cover art + an animated film
  clip out, stitched and muxed into one file. Can also start from your own
  song/image, or reuse already-generated clips instead of generating new ones.
- **Storyboard** - generate a persisted, revisitable sequence of shot images,
  then turn it into one continuous video any time later by animating the
  motion between each consecutive pair of shots.
- **AI build pipeline** - `planner-pipeline` turns a rough project brief into
  a validated, quality-gated build manifest; `implementation-orchestrator`
  compiles an approved manifest into a task graph and dispatches it to a real
  OpenHands coding-agent (`open-hands/`, fetched by `install.sh`) that writes
  and verifies the code against an actual repository. `genesis-runtime` is a
  separate, standalone plugin-host runtime kept alongside these (ships with
  zero plugins by default).

Runs entirely on your own machine - no API keys, no cloud calls.

## Before you install

This package is small (a few MB): it's the orchestration code, workflow
definitions, presets, and the bespoke AI build-pipeline services' source. It
does **not** include ComfyUI, llama.cpp, OpenHands, or any model weights -
those are hundreds of GB combined and you fetch/build them yourself via
`install.sh`.

**Prerequisites**: Python 3.10+ with `python3-venv` (not always installed by
default - if it's missing, `python3 -m venv` can silently produce a `.venv`
with no `bin/pip`, which is the most common install failure), `git`, `cmake`,
a C/C++ compiler (`build-essential` on Debian/Ubuntu), and the Vulkan build
toolchain for llama.cpp's Vulkan backend (`glslc` - Debian/Ubuntu package
names are typically `glslang-tools`, `spirv-tools`, `spirv-headers`,
`libvulkan-dev`). `install.sh` checks for all of these up front and tells you
exactly what's missing before doing anything else. Node.js 22+ and Docker +
Docker Compose if you want the AI build pipeline (`install.sh` skips that
step and tells you if either is missing - everything else installs fine
without them); `uv` is fetched automatically if absent (used to build the
OpenHands agent-server's virtualenv).

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
adding checkpoints/LoRAs for its workflow packs). The AI build pipeline adds
relatively little: OpenHands' own checkout plus its venv is a few GB, and
each of planner-pipeline/implementation-orchestrator's Postgres+Redis pair is
a small docker volume.

## Install

```bash
./install.sh
```

This creates a venv and installs suite dependencies, sets up Playwright
(browser automation), clones and builds llama.cpp (Vulkan), clones ComfyUI
plus ComfyUI-Manager, installs and sets up the AI build pipeline (if
Node/Docker are present) including its two databases and a freshly generated
`OPENHANDS_SESSION_API_KEY`, clones and builds the OpenHands agent-server,
and installs a desktop launcher entry. It prints what it can't do for you -
mainly, getting the actual LLM/checkpoint model files (see below).

### Model weights

Not fetched automatically. Two are required by default config:

- `models/qwen3-coder-next/...` - coding LLM used by `./ai-switch chat`
- `models/qwythos-9b/...` - sidecar LLM, also what the AI build pipeline and
  OpenHands use by default (always-on, not stopped when ComfyUI runs)

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
controlnet-aux, face/ID tools, etc.) - each pack's own `manifest.yaml` lists
exactly which ones under `custom_nodes.required`/`custom_nodes.optional` (see
`docs/WORKFLOW_DEVELOPER_GUIDE.md` for the manifest format). Install what a
given workflow needs via ComfyUI-Manager (bundled). Not required for every
workflow - only install what you plan to use.

## Using it

```bash
./ai-switch status   # what's running
./ai-switch llama    # start the coding LLM
./ai-switch comfy    # start ComfyUI (stops llama.cpp first - one GPU stack at a time)
./ai-switch studio   # start the workflow launcher/studio web UI on :39000
./ai-switch stop     # stop everything
```

Or use the desktop GUI (`./launch-switcher`, or the "AI Suite Switcher"
entry `install.sh` adds to your applications menu) for the same controls with
buttons instead of commands.

### AI build pipeline

```bash
./ai-switch planner              # planner-pipeline API + worker (+ its postgres/redis)
./ai-switch orchestrator         # implementation-orchestrator API + worker (+ its postgres/redis)
./ai-switch openhands            # the real agent-server orchestrator dispatches to
./ai-switch genesis
./ai-switch pipeline-dashboard   # web control panel for all of the above, at :39016
./ai-switch pipeline-status      # terminal equivalent - polls plan/workflow status in-place
```

`planner-setup`/`orchestrator-setup` (already run by `install.sh`) install
each service's database schema - re-run either after pulling code changes
that touch its packages. All of the above are also on Studio's "Pipeline" tab
and the desktop Switcher's "AI Build Pipeline" row - including buttons for
`pipeline-dashboard`, whose UI lets you start/stop every pipeline service,
edit planner/orchestrator config, submit a build plan, and watch OpenHands'
live chat/IDE, all from one page. `pipeline-status` is terminal-only (no
Studio button) since it runs in the foreground until Ctrl+C. See
`docs/SERVICES.md` for the full port map, how planner and orchestrator
connect, and troubleshooting notes (including a real gotcha already found
and fixed: OpenHands' LLM routing needs a `provider/model`-prefixed model
name, e.g. `openai/qwen-sidecar`, not a bare model name).

Full command reference: `LAUNCHER_README.md` (the `launcher.py` CLI/web app)
and `V1_SWITCHER_README.md` (the `ai-switch` service commands, endpoints, and
AMD/ROCm notes).

## Configuration

`config.env` holds ports, context sizes, and hardware tuning knobs. Paths are
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
