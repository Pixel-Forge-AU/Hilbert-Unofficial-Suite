# Agent Suite

The runtime & automation half of the Hilbert suite. It sits next to the creative suite
(`../ai-suite`: ComfyUI, Studio, Hilbert Chat) and provides:

- **Local LLM serving.** llama.cpp model profiles (coding, "Heretic" 35B/27B, small), an
  always-on CPU sidecar LLM, and Ollama.
- **Genesis Runtime** (`genesis-runtime/`). A plugin-host runtime that ships with zero
  plugins by default.
- **AI build pipeline.** `planner-pipeline` turns a project brief into a quality-gated
  build manifest. `implementation-orchestrator` compiles that manifest into a task graph
  and dispatches the tasks to a real OpenHands agent-server (`open-hands/`), which writes
  and verifies the code. `pipeline-dashboard-server.mjs` is a web control panel for all
  of it, at `:39016`.
- **Agent console** (`console/`, `:39019`). Studio's Runtime, Performance, Pipeline and
  Genesis tabs moved here. Runtime shows live CPU/RAM/GPU/NPU stats and service controls for
  both suites. Performance covers Strix Halo checks, task-based model picks, runtime slots,
  the installed-model inventory and the tuned-model catalogue. Pipeline has the
  planner/orchestrator setup buttons and starts, stops and embeds the pipeline dashboard.
  Genesis starts and stops Genesis Runtime and explains its plugin setup.

Everything runs on your own machine.

## Install

```bash
./install.sh
```

This builds llama.cpp (Vulkan), installs and sets up the planner and orchestrator
(they need Node.js 22+ and Docker, and get their own Postgres/Redis), installs Genesis
Runtime, builds the OpenHands agent-server venv (with `uv`) and generates a shared
`OPENHANDS_SESSION_API_KEY`. You supply the LLM weights; the installer lists the paths it expects.

## Using it

```bash
./agent-switch status
./agent-switch llama               # coding LLM on :39001 (stops ComfyUI first)
./agent-switch qwen-sidecar        # always-on CPU LLM on :39002, used by the pipeline
./agent-switch planner             # planner API + worker (+ postgres/redis)
./agent-switch orchestrator        # orchestrator API + worker (+ postgres/redis)
./agent-switch openhands           # agent-server the orchestrator dispatches to
./agent-switch genesis
./agent-switch pipeline-dashboard  # web control panel, :39016
./agent-switch console             # agent console (Runtime, Performance, Pipeline, Genesis), :39019
./agent-switch stop                # stop everything in this suite
```

Each service has a matching `-stop` command. The desktop control panel for both suites is
the creative suite's AI Suite Switcher (`../ai-suite/launch-switcher`); it calls
`agent-switch` for everything here. See `docs/SERVICES.md` for the port map, how the planner and
orchestrator connect, the config decisions behind them, and troubleshooting.

## Working with the creative suite

- Studio and Hilbert Chat reach the LLMs here over HTTP. `ai-switch llama*`,
  `qwen-sidecar*` and `ollama*` in the creative suite are forwarded to `agent-switch`.
- The main LLM and ComfyUI can't share the GPU. `agent-switch llama` runs
  `ai-switch comfy-stop` first, and `ai-switch comfy` runs `agent-switch llama-stop`.
  The sidecar runs on the CPU and stays up.
- The creative suite reads its LLM settings (`LLAMA_*`, `QWEN_SIDECAR_*`, `OLLAMA_*`,
  `MODELS_DIR`, `CONSOLE_*`) from this suite's `config.env`. The console writes the LLM
  ones when you save a runtime slot.
- Studio's Chat tab stays in the creative suite. It reads model/task data, and switches
  the task model, through Studio's `/api/performance/*`, which forwards to this console.
  Chat's task picker stays empty until the console is running. Studio links to the console
  from its nav bar ("Runtime & Performance").
- `CREATIVE_SUITE_DIR` (in `config.env` here) and `AGENT_SUITE_DIR` (in the creative suite's
  `config.env`) tell each suite where the other is. They default to sibling folders.

## Configuration

`config.env` holds ports, LLM profiles and the pipeline settings. Relative `*_DIR` values
resolve against this folder. On the machine where the split was done, `MODELS_DIR` and
`LLAMA_CPP_DIR` still point into `../ai-suite`, where the weights and the llama.cpp build
already lived.
