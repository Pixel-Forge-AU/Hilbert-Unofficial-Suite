AI Suite — Feature List
AI Suite is an offline-first AI workstation combining a ComfyUI workflow platform ("Hilbert Studio"), a plugin-based personal-assistant runtime ("genesis-runtime"), and an AI code-build pipeline, switched between via ai-switch (only one GPU-heavy stack runs at a time).

Workflow pack platform
Manifest-driven workflow packs (inputs/outputs/models/hardware/tags/presets), model-agnostic (Flux, SDXL, SD1.5/3, Qwen), hardware-aware VRAM tiers, registry-driven discovery, JSON-schema validation, batch processing, quality-control scoring
12 registry categories / 89 workflows: audio, character, core-generation, horror-gore, image-analysis, image-editing, llm-orchestration, three-d, video-edit, video-gen, video-stitch, weird-experimental
Plus two categories kept out of the public registry: adult, community-models (user-supplied checkpoints/LoRAs)
Studio / launcher
Web dashboard: workflow grid, category/tag/status/hardware search, detail view, run modal, job queue (queue/move/cancel/retry), input/output file browser with uploads, live ComfyUI progress via WebSocket, model listing
Music Video pipeline — mux music + video, burn in lyrics, stitch clips, song library CRUD
Storyboard pipeline — persisted shot sequences, animate motion between shots, storyboard CRUD
Hilbert Chat tab — chat sessions/messages/models, web-search citations, inline image generation
Pipeline/Services panel — start/stop/monitor every suite service (llama, comfy, studio, planner, orchestrator, openhands, dashboard)
Performance panel — Strix Halo APU model-slot management, active-model optimization, task-to-model switching
CLI equivalents: list, show, run, jobs, config, categories, service <cmd>
comfy_studio.py — legacy standalone Studio server (now reused as a library)
ai-switch / switcher_app.py — CLI and Tkinter GUI service switcher, with idle/display-safety status
install.sh — full installer (venv, Playwright, llama.cpp+Vulkan, ComfyUI+Manager, build-pipeline services, desktop entry)
playwright_server.py — browser-automation HTTP server
pipeline-dashboard-server.mjs / pipeline-status.mjs — web and terminal control panels for the build pipeline
genesis-runtime plugins (assistant runtime, ~46 available)
Communication — mail, calendar, GitHub notifications/PR-issue context, podcast-style page reader, multilingual voice capture, voice/avatar emotion + 3D avatar driver

Personal/identity — persona subtabs (personality), persona/skill distillation from history (personality-clone), ambient voice-context observation (presence), belief/philosophy journal (philosophy)

Dev tools — VS Code context bridge, multi-pass code review (security/quality/diff-aware), Hook Explorer/Prompt Review/State Browser (developer-tools), deep security audit (CVE scan, OWASP checklist, attack-surface mapping), git-based deploy pipeline (PR, version bump, CHANGELOG, CI polling), diff-aware QA scoring, sprint phase state machine, decision-automation prompt injection (autoplan), design-token/variant generation, DESIGN.md generation from live sites (stitch-design)

Home/IoT — Home Assistant device control, MQTT transport, Matter protocol stub

Finance/payments — finance ledger + mail-sync, policy-gated payments (allowlist, budget caps, approval thresholds)

Content — social-media research/drafting/campaign reports, worker-activity canvas overlay, WordPress route/UI extensions

Productivity — project config/tab, governance visibility across execution/policy/memory/validation

Infra — sandboxed Docker exec (+ output compression), OS-keychain secrets (keytar), prompt-memory journal, session-memory capture, RAG/vector document retrieval, multi-provider "brain" model registry (Ollama/OpenAI-compatible), workspace change-safety tracking, task-lifecycle HTTP surface, persistent Playwright browser automation with account sessions

Misc — agent task-queue/execution runtime with cron scheduling, escalation/retry re-queuing across brains, idle-time opportunity scanning, memory curation ("dreaming"), web-interest monitoring (information-agent), skills marketplace installer, tool-call/permission/cron security orchestration

CLI tools (python -m tools <command>)
registry — build registry.json from manifests
compile — package workflows into distributable .aiworkflow files
validate — validate manifests against JSON schemas
docs — generate README/catalog docs from manifests
pack-mover — move/remove packs and categories, auto-rebuilds registry
download_models.py — fetch known model files referenced by packs
