# AI Suite - Additional Services

Besides ComfyUI, Studio and Hilbert Chat, this suite manages two supporting services through
`ai-switch` (`ai_manager.py`): an optional remote GPU dispatcher (`gpu-worker`) for routing
heavy ComfyUI jobs to a separate CUDA box, and the Workspace tab's video engine (`concat`).

LLM serving (llama.cpp, qwen-sidecar, Ollama), Genesis Runtime and the AI build pipeline
(planner, orchestrator, OpenHands, pipeline dashboard) live in the sibling agent suite - see
`../agent-suite/docs/SERVICES.md`. `ai-switch llama*` / `qwen-sidecar*` / `ollama*` still
work here; they are forwarded to `agent-switch`.

## Ports

| Port | Service |
|---|---|
| 39000 | Studio (web UI) |
| 39003 | ComfyUI |
| 39004 | Chat (Hilbert Chat) |
| 39005 | Playwright (browser API) |
| 39018 | **gpu-worker** remote ComfyUI dispatcher |
| 39100+ | per-GPU ComfyUI shards on the remote GPU box |
| (no port) | **concat** Workspace video engine - Unix socket `state/workspace/concat.sock`, see [Workspace video engine](#workspace-video-engine-concat) |

Ports 39001/39002, 39006-39017 and Ollama's 11434 belong to the agent suite.

## Commands

```bash
./ai-switch gpu-worker
./ai-switch gpu-worker-stop
./ai-switch concat               # Workspace video engine (Studio's Workspace tab)
./ai-switch concat-stop
./ai-switch status               # creative services, plus whether the agent suite's LLMs are up
./ai-switch stop                 # stops the creative services (LLMs keep running - `agent-switch stop`)
```

Every process logs to `logs/<name>.log`; PID files live in `.pids/`. See `docs/GPU_WORKER.md`
for the remote dispatcher.

## Workspace video engine (concat)

Studio's **Workspace** tab (a multitrack video editor) is backed by Concat 0.2.7, run as
`concat-cli serve`. Design, build recipe, and test results are in
[WORKSPACE_VIDEO_EDITOR_PLAN.md](WORKSPACE_VIDEO_EDITOR_PLAN.md).

**Install.** The Concat release packages ship only the desktop window, not `concat-cli`, so
it is built from the pinned source tag (`v0.2.7`, commit `14b5998`) under
`~/.local/opt/concat/`. The recipe, including the two apt packages it needs
(`libasound2-dev`, `libssl-dev`) and the FFmpeg 8.1 dev kit, is in the plan's
"Phase 0 results". Nothing Concat-derived lives in this repository: AI Suite is MIT, Concat
is AGPL-3.0-or-later, and Studio only speaks its documented JSON-RPC API.

**Config** (`config.env`, defaults shown):

| Key | Default | Meaning |
|---|---|---|
| `CONCAT_CLI` | `~/.local/opt/concat/bin/concat-cli` | The engine binary |
| `CONCAT_LIB_DIR` | `~/.local/opt/concat/ffmpeg-8.1/lib` | FFmpeg shared libraries it links against |
| `WORKSPACE_DATA_DIR` | `state/workspace` | Socket, token, projects, templates, job history |
| `WHISPER_CLI` | `~/.local/opt/whisper.cpp/src/build/bin/whisper-cli` | Speech recognition for automatic captions |
| `WHISPER_MODELS_DIR` | `~/.local/opt/whisper.cpp/models` | `ggml-<model>.bin` files; each one present is offered in the Captions dialog |

**What `./ai-switch concat` does.** Creates `WORKSPACE_DATA_DIR` (mode 0700), mints
`api.token` once (0600), and starts `concat-cli serve --socket concat.sock --root projects/`
with the token in `CONCAT_API_TOKEN`. The engine prints its token on startup; that line is
redacted before it reaches `logs/concat.log`. The token never leaves the server: Studio reads
it from the file, and browsers only see `/api/workspace/*`.

**Where things live.**

- Projects: `state/workspace/projects/<identity>/<project-id>/` (Concat's native folder:
  `concat.json`, plus `media/` for files uploaded into the project). Back up this folder to
  back up Workspace projects. Projects store absolute paths to their Library media, so moving
  ComfyUI's `output/` breaks the link until the media is moved back.
- Exports render into the project's `.exports/` and are moved, when finished, to
  `<ComfyUI output>/studio/<identity>/workspace/<name>-<timestamp>.mp4`, where Library lists
  them under Video.
- Templates: `state/workspace/templates/<identity>/<template-id>/` (Concat's bundle: `template.json`,
  `assets/`, plus Studio's `studio-template.json` and `poster.png`). Concat can only *save* templates
  into its machine-wide `~/.config/app.concat.editor/templates/`, so Studio uses that as a staging
  area and moves each bundle into the owner's folder immediately; it should stay empty.
- Export and caption job history: `state/workspace/jobs.json`.

**Operations notes.**

- Edits live in the engine's memory until saved. Restarting Studio keeps them (the engine
  still holds the open project), but stopping or restarting `concat` drops unsaved edits and
  undo history. Saved projects reopen intact.
- An export running when the engine stops is marked failed; one running when Studio
  restarts is shown as interrupted. In both cases the partial file is removed.
- Preview and export run on the CPU (this build reports no `gpu` capability). A 180 s
  1080p export takes about a minute and uses several cores; it does not compete with ComfyUI
  for the GPU.
- With the engine stopped, Workspace shows "engine offline" with a Start button (it calls
  `/api/services/concat`); every other tab is unaffected.

### Workspace captions (whisper.cpp)

Concat's transcription is only in its desktop window, so Workspace runs
[whisper.cpp](https://github.com/ggml-org/whisper.cpp) (MIT) itself. It is not a service:
Studio runs it once per Captions request.

Install (done on this machine, 2026-10-16):

```bash
git clone --depth 1 --branch v1.9.5 https://github.com/ggml-org/whisper.cpp ~/.local/opt/whisper.cpp/src
cd ~/.local/opt/whisper.cpp/src
cmake -B build -DCMAKE_BUILD_TYPE=Release -DBUILD_SHARED_LIBS=OFF -DWHISPER_BUILD_TESTS=OFF
cmake --build build -j 16 --target whisper-cli
mkdir -p ~/.local/opt/whisper.cpp/models
# Models are the ones Concat's own table pins (whisper.cpp HF revision 5359861c...), checked by SHA-256:
#   base   60ed5bc3dd14eea856493d334349b405782ddcaf0028d4b5df4088345fba2efe  (copied from genesis-runtime's vendor/models)
#   small  1be3a9b2063867b937e64e2ec7483364a79917e157fa98c5d94b5c1fffea987b
curl -L -o ~/.local/opt/whisper.cpp/models/ggml-small.bin \
  https://huggingface.co/ggerganov/whisper.cpp/resolve/5359861c739e955e79d9a303bcbc70fb988958b1/ggml-small.bin
```

A caption run extracts the clip's audio window with Concat's FFmpeg kit (`CONCAT_LIB_DIR`'s
`../bin/ffmpeg`, or `FFMPEG_BIN`) into the project's `.captions/` folder, which is cleared afterwards,
and runs whisper-cli on half the CPU cores. On this machine the base model handles 40 s of audio in
about 1.4 s, and the small model a 3-minute track in a few seconds. One captioning job runs at a time.
