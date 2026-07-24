# AI Suite - Additional Services

This suite also hosts four services developed separately and integrated into this install:
an AI software-build pipeline (`planner-pipeline` + `implementation-orchestrator`), the real
OpenHands agent-server (`open-hands/`) that orchestrator dispatches builder tasks to, and a
standalone plugin-host runtime (`genesis-runtime`). All four are managed the same way as
every other suite service - through `ai-switch` (`ai_manager.py`), the Studio web UI's new
"Pipeline" tab, and the tkinter Switcher's "AI Build Pipeline" row. A fifth, optional piece -
`pipeline-dashboard-server.mjs` (plus its terminal-only sibling `pipeline-status.mjs`) - gives
the first three of these their own dedicated control panel; see the service table below.

## Suite-wide port map

All suite-managed services live in the uncommonly-used **39000-39015** block (not an
IANA-registered range, not a default for any other software on this box), so nothing here
collides with other local dev tools. See `config.env` for the authoritative list.

| Port | Service |
|---|---|
| 39000 | Studio (web UI) |
| 39001 | llama.cpp (coding LLM) |
| 39002 | qwen-sidecar (always-on LLM) |
| 39003 | ComfyUI |
| 39004 | Chat (Hilbert Chat) |
| 39005 | Playwright (browser API) |
| 39006 | **planner-pipeline** API |
| 39007 | **implementation-orchestrator** API |
| 39008 | **genesis-runtime** |
| 39009 | **openhands** agent-server |
| 39010 | planner-pipeline Postgres (docker) |
| 39011 | planner-pipeline Redis (docker) |
| 39012 | implementation-orchestrator Postgres (docker) |
| 39013 | implementation-orchestrator Redis (docker) |
| 39014 / 39015 | implementation-orchestrator MinIO API/console (docker, unused - artifact storage uses the filesystem provider) |
| 39016 | pipeline dashboard (`pipeline-dashboard-server.mjs` web control panel) |
| 39017 | openhands vscode (bundled web IDE - only used by the Docker path, see below) |
| 11434 | Ollama - **exception**, see below |

**Ollama is not movable via `config.env`.** `ai_manager.py`'s `start_ollama()` just runs
`systemctl start ollama` with no `--port` flag - Ollama's real bind port comes from its
systemd unit, and 11434 is a convention many external Ollama clients hardcode. Changing it
means editing `/etc/systemd/system/ollama.service(.d/)` outside this repo, not `config.env`.

## What each service is

| Service | Purpose | Directory |
|---|---|---|
| `planner-pipeline` | Turns a project brief into a validated, auditable build manifest via a multi-stage LLM pipeline (Fastify API + BullMQ worker). | `planner-pipeline/` |
| `implementation-orchestrator` | Compiles an approved manifest into a task graph, dispatches it to builder agents, and independently verifies the result. | `implementation-orchestrator/` |
| `openhands` | The real OpenHands agent-server (standalone `openhands-agent-server` PyPI package, not the whole Agent Canvas app) - runs actual coding-agent conversations for orchestrator's `openhands-local` builder profile. | `open-hands/` |
| `genesis-runtime` | A minimal plugin-host runtime (infrastructure only - ships with zero plugins in this install). Unrelated to the other services. | `genesis-runtime/` |
| `pipeline-dashboard` | Web control panel for the three services above: start/stop, `.env` editing, plan submission, and a live OpenHands chat/IDE view. Optional - a convenience layer over the same `ai-switch` commands. | `pipeline-dashboard-server.mjs` |
| `pipeline-status` | Terminal equivalent of the dashboard's status view (no service management) - polls plan/workflow state until Ctrl+C. Not managed as a background service; run it directly. | `pipeline-status.mjs` |

`ai-switch` starts/stops each service's Postgres/Redis docker containers alongside its Node
processes automatically.

### About `open-hands/`

The `open-hands/` directory is a full clone of the OpenHands "Agent Canvas" repo, but the
relevant piece is just one of its pip dependencies: `openhands-agent-server`, a standalone
REST API (`agent-server` console script) with no relation to the rest of that repo's
frontend/Agent Canvas app. Its own venv must be built natively on this box - a venv copied
from another machine's checkout will have the wrong layout (Windows `Scripts/` vs Linux
`bin/`) and won't run. Rebuild with:

```bash
cd open-hands
rm -rf .venv
uv sync
```

`ai-switch openhands` runs `.venv/bin/agent-server --host ... --port ...` directly - no
Makefile/poetry/docker-compose involved. `OPENHANDS_SESSION_API_KEY` in `config.env` is
passed to the agent-server as `SESSION_API_KEY` at startup and to
`implementation-orchestrator/.env`'s `OPENHANDS_SESSION_API_KEY` as the matching client
credential, so requests between them are authenticated (`X-Session-API-Key` header).

**This native path is the one this suite is set up for** (`OPENHANDS_CONTAINER_WORKSPACE_ROOT`
is deliberately blank above, since there's no container). The pipeline dashboard's OpenHands
controls also offer a second, Docker-based way to run the same `openhands-agent-server` image
instead - only use it if you'd rather not build the venv above, and don't run both at once
(same repo/workspace, two agent-server instances). It maps its container onto the same
`OPENHANDS_PORT` by default so either path is a drop-in for the other from the rest of the
suite's point of view.

## First-time setup

Each of the two database-backed services needs a one-time setup before its first start
(installs its Prisma schema against its own database):

```bash
./ai-switch planner-setup
./ai-switch orchestrator-setup
```

`genesis-runtime` needs no setup - it's file/JSON based (see `genesis-runtime/README.md`
to point it at a real plugin catalog; this install ships zero plugins).

## Day-to-day commands

```bash
./ai-switch planner              # start planner-api + planner-worker (+ its postgres/redis)
./ai-switch planner-stop
./ai-switch orchestrator         # start orchestrator-api + orchestrator-worker (+ its postgres/redis)
./ai-switch orchestrator-stop
./ai-switch openhands            # start the OpenHands agent-server orchestrator dispatches to
./ai-switch openhands-stop
./ai-switch genesis
./ai-switch genesis-stop
./ai-switch pipeline-dashboard    # web control panel for all of the above, at :39016
./ai-switch pipeline-dashboard-stop
./ai-switch pipeline-status       # terminal status view - foreground, Ctrl+C to exit
./ai-switch status               # includes all of the above except pipeline-status
./ai-switch stop                 # stops everything, including the dashboard
```

Same commands are available from Studio's "Pipeline" tab (buttons call the same `ai-switch`
verbs through `/api/services/<command>`) and from the tkinter Switcher's "AI Build Pipeline"
row.

## Config decisions made during integration

These services were developed on another machine and needed a few local adjustments
(see `config.env`, `planner-pipeline/.env`, `implementation-orchestrator/.env`):

- **Planner's LLM target**: points at this suite's always-on `qwen-sidecar` (port 39002,
  `QWEN_SIDECAR_ALIAS=qwen-sidecar` in `config.env`) rather than a LAN box that doesn't
  exist on this install. The sidecar stays up even when ComfyUI/the main llama.cpp
  instance are stopped, so the planner keeps working regardless of what else is running.
- **Per-stage model routing disabled**: `LLM_MANAGEMENT_BASE_URL` is blank because this
  suite has no per-stage model-switching endpoint; every planning stage uses the single
  configured model instead.
- **Orchestrator's builder profile is `openhands-local`**, pointed at the real agent-server
  above. `OPENHANDS_LLM_MODEL` is `openai/qwen-sidecar` (not bare `qwen-sidecar`) - the
  agent-server routes LLM calls through LiteLLM, which needs a `provider/model` prefix to
  know how to talk to an OpenAI-compatible custom endpoint; without it every task fails
  immediately with `litellm.BadRequestError: LLM Provider NOT provided` (found by actually
  running a real task through it, not by inspection). A `Cost calculation failed: This
  model isn't mapped yet` warning in `logs/openhands.log` is cosmetic - LiteLLM just has no
  pricing data for a local model - and does not indicate a problem.
  `OPENHANDS_CONTAINER_WORKSPACE_ROOT` is left blank since the agent-server runs as a bare
  host process sharing this filesystem directly (not a container), so no path translation
  is needed (see `OpenHandsAdapterConfig`'s doc comment in
  `packages/builder-gateway/src/openhands/openhands-adapter.ts`).
- **Workspace/artifact paths**: rewritten from the original Windows paths (`E:/AI/...`) to
  `implementation-orchestrator/orchestrator-workspaces` / `orchestrator-artifacts` under
  this suite's root.

## How planner and orchestrator connect

This link already existed in the code, not something added for this integration: once a
plan reaches quality-gated completion, `POST /v1/plans/:planId/publish` on the planner API
calls `POST /v1/workflows` on `implementation-orchestrator`
(`IMPLEMENTATION_ORCHESTRATOR_URL=http://localhost:39007` in `planner-pipeline/.env`),
handing off the approved manifest as a new orchestrator workflow. Both services just needed
matching local ports, which they already had.

`genesis-runtime` has no relationship to any of the other three - it's a separate
plugin-host runtime kept in this suite for its own sake.

## Logs and troubleshooting

Every process logs to `logs/<name>.log` (`planner-api`, `planner-worker`,
`orchestrator-api`, `orchestrator-worker`, `genesis-runtime`, `openhands`), same as every
other suite service. PID files live in `.pids/`. `planner-pipeline` runs via `tsx` directly
(it has no build step - its `tsconfig` is `noEmit: true` by design, see its own README);
`implementation-orchestrator` runs its built `dist/` output and needs
`./ai-switch orchestrator-setup` re-run after pulling code changes that touch its packages.
`logs/openhands.log` holds each conversation's real agent activity (tool calls, LLM
responses) - check it first when a dispatched task behaves unexpectedly.
