# AI Suite — Feature List

AI Suite is an **offline-first AI workstation platform** combining:

- **Hilbert Studio** — a ComfyUI workflow orchestration and production platform
- **Genesis Runtime** — a plugin-based personal assistant and agent runtime
- **AI Code Build Pipeline** — autonomous development and deployment tooling
- **ai-switch** — resource manager that switches between AI workloads (only one GPU-heavy stack runs at a time)

---

# 1. Workflow Pack Platform

## Workflow System

Manifest-driven workflow packs defining:

- Inputs / outputs
- Required models
- Hardware requirements
- Tags
- Presets
- Metadata

Features:

- Model-agnostic support:
  - Flux
  - SDXL
  - SD 1.5 / SD 3
  - Qwen
  - Other compatible models

- Hardware-aware VRAM tiering
- Registry-driven workflow discovery
- JSON-schema validation
- Batch processing
- Quality-control scoring

## Workflow Registry

**Public Registry**

12 categories containing **89 workflows**:

| Category | Purpose |
|---|---|
| audio | Audio generation and processing |
| character | Character creation workflows |
| core-generation | General image generation |
| horror-gore | Horror and dark-content workflows |
| image-analysis | Image understanding and extraction |
| image-editing | Image modification workflows |
| llm-orchestration | LLM-assisted workflows |
| three-d | 3D generation workflows |
| video-edit | Video manipulation |
| video-gen | Video generation |
| video-stitch | Video assembly |
| weird-experimental | Experimental workflows |

**Private Registry Categories**

Excluded from public discovery:

- `adult`
- `community-models`
  - User supplied checkpoints
  - LoRAs
  - Custom models

---

# 2. Hilbert Studio

## Web Dashboard

Browser-based AI workstation interface.

Features:

- Workflow grid
- Category filtering
- Tag search
- Status filtering
- Hardware compatibility search
- Workflow detail pages
- Run modal
- Job queue management:
  - Queue
  - Move
  - Cancel
  - Retry
- Input/output file browser
- File uploads
- Live ComfyUI progress via WebSocket
- Model listing

---

## Music Video Pipeline

Complete AI-assisted music video workflow:

- Music + video muxing
- Lyrics burn-in
- Clip stitching
- Song library management
- CRUD operations

---

## Storyboard Pipeline

Persistent cinematic planning system:

- Shot sequence storage
- Storyboard management
- Motion interpolation between shots
- Storyboard CRUD operations

---

## Hilbert Chat

Integrated AI conversation workspace:

- Chat sessions
- Message history
- Model selection
- Web-search citations
- Inline image generation

---

## Pipeline / Services Panel

Central service management:

Start, stop, monitor:

- llama.cpp
- ComfyUI
- Hilbert Studio
- Planner
- Orchestrator
- OpenHands
- Dashboard

---

## Performance Panel

Hardware-aware optimisation:

- Strix Halo APU model-slot management
- Active model optimisation
- Task-to-model switching
- Resource balancing

---

# 3. System Tools

## CLI Interface

Equivalent command access:

```bash
ai-suite list
ai-suite show
ai-suite run
ai-suite jobs
ai-suite config
ai-suite categories
ai-suite service <command>
