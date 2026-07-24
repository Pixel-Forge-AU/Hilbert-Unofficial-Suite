# Changelog

All notable changes to AI Suite V2 will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [3.0.0] - 2026-07-24

### ✨ New Features

- **AI build pipeline**: three services developed separately are now first-class,
  `ai-switch`-managed parts of the suite, with matching controls on Studio's new
  "Pipeline" tab and the desktop Switcher's "AI Build Pipeline" row:
  - `planner-pipeline` - turns a rough project brief into a validated, quality-gated
    build manifest via a multi-stage LLM pipeline (Fastify API + BullMQ worker).
  - `implementation-orchestrator` - compiles an approved manifest into a task graph,
    dispatches it to builder agents, and independently verifies the result against a
    real repository.
  - A real **OpenHands agent-server** (`open-hands/`, the standalone
    `openhands-agent-server` package - not the whole Agent Canvas app) is the actual
    builder backend orchestrator dispatches to, running real coding-agent conversations
    against the suite's own local LLM.
  - `genesis-runtime` - a separate, standalone plugin-host runtime (ships with zero
    plugins by default), unrelated to the pipeline above but managed the same way.
- New `ai-switch` commands: `planner`/`planner-stop`/`planner-setup`,
  `orchestrator`/`orchestrator-stop`/`orchestrator-setup`, `genesis`/`genesis-stop`,
  `openhands`/`openhands-stop`. `status`/`stop` now cover all of them.
- `docs/SERVICES.md` documents the whole pipeline: ports, setup, config decisions, and
  how planner/orchestrator/OpenHands actually connect.

### 🔧 Changed

- Every suite-managed port moved to the uncommonly-used **39000-39015** block (Studio,
  llama.cpp, qwen-sidecar, ComfyUI, Chat, Playwright, plus the new pipeline services and
  their docker-managed Postgres/Redis) so nothing collides with other local dev tools.
  Ollama's port is unchanged - it's controlled by its systemd unit, not `config.env`.
- The working repo is now a git repository (previously untracked).

### 🐛 Fixed

- OpenHands' LLM routing (LiteLLM) silently failed every task with
  `LLM Provider NOT provided` unless the configured model name carried a
  `provider/model` prefix (e.g. `openai/qwen-sidecar`, not bare `qwen-sidecar`) - found
  by actually running a real task through it, not by inspection.
- `implementation-orchestrator`'s workspace/artifact paths and OpenHands LLM/workspace
  config referenced a different machine's Windows paths and LAN-only endpoints; both
  services' `node_modules` had broken symlinks from being copied between machines
  (reinstalled cleanly via `pnpm install`/`uv sync`).
- `.gitignore` excluded `implementation-orchestrator/orchestrator-workspaces/` and
  `.../orchestrator-artifacts/`, but those directories are actually created at the repo
  root - the patterns never matched.

---

## [2.1.0] - 2026-07-19

### ✨ New Features

- **Music Video pipeline** (`launcher.py` "Music Video" tab): one concept in, three chained
  generations out - a song (ACE-Step 1.5), cover art (Z-Image Turbo, or Qwen-Image for a
  slower/higher-fidelity option), and a film clip with several varied-motion segments
  stitched together and looped/trimmed to match the song exactly. Also supports starting
  from your own existing song + image instead of generating them, and picking already-
  generated clips instead of generating new segments.
- **Storyboard pipeline** (new "Storyboard" tab): persisted, revisitable shot sequences.
  Generate/upload/pick a distinct image per shot, review and refine independently, then
  generate video any time later by interpolating motion between each consecutive pair of
  shots (WAN 2.2 first-last-frame-to-video) and stitching the results. Ships with both the
  full-quality sampler and a ~5x faster 4-step Lightning LoRA variant
  (`video.keyframe-video` / `video.keyframe-video-fast`).
- New promoted packs: `core.text-to-image`, `core.text-to-image-hq`, `video.keyframe-video`,
  `video.keyframe-video-fast`.

### πŸ› Fixed

- `workflow_to_api()`'s UI-graph-to-API-prompt conversion silently dropped required inputs
  for several node types whose widgets aren't declared in the exported graph's `inputs[]`
  (`TextEncodeAceStepAudio1.5`, `EmptyAceStep1.5LatentAudio`, `DualCLIPLoader`,
  `KSamplerAdvanced`, `SaveAudio`, `WanFirstLastFrameToVideo`, `ModelSamplingSD3`,
  `CreateVideo`, `LoraLoaderModelOnly`) - these workflows would fail validation or silently
  run with wrong defaults. Affects every caller (`launcher.py`, `hilbert_chat.py`).
- Generated audio outputs were invisible to the app: `flatten_outputs()` only looked for a
  `"audios"` history key, but this ComfyUI version reports audio under `"audio"`.
- Generated video from `SaveVideo`-based workflows was misclassified as `image` (reported
  under history's `"images"` key with an `animated` flag) - would render as a broken `<img>`
  tag instead of a video player.
- The Runtime tab's job list marked every submitted job "completed" (100%) the instant
  ComfyUI *accepted* the prompt into its queue, not when it actually finished rendering -
  jobs skipped the "running" state entirely and looked done long before they were. Jobs now
  stay "running" (with real progress) and only flip to "completed" once ComfyUI confirms it.
- `audio.ace-step-1-5`'s "duration" input only drove the latent's length, not the text
  encoder's own separate duration field - mismatched values caused inconsistent/truncated
  generations. Added the missing `conditioning_duration` input and kept both in sync.

### 🧹 Removed

- The standalone V1 "Studio" web server (`comfy_studio.py`'s `StudioHandler`/`run`/`main`,
  the `studio_static/` UI, `legacy-workflows/`, and the V1 migration tool) - superseded by
  `launcher.py`. Filed away in `archive/comfy-studio-v1/` (self-contained, still runnable for
  reference). `comfy_studio.py` itself remains as the shared workflow-execution library that
  `launcher.py` and `hilbert_chat.py` depend on directly.
- Hilbert Chat's image generation now uses the pack system (`core.text-to-image`) instead of
  scanning `legacy-workflows/` directly - the last thing depending on that directory.

---

## [2.0.0] - 2026-07-13

### 🎉 Initial Release

AI Suite V2 represents a complete architectural redesign from version 1.0.0, introducing a modular, extensible platform for AI workflow management.

### ✨ New Features

#### Pack System Architecture
- **Modular Pack System**: All workflows organized into 15 category packs
  - `core-generation`: Fundamental image generation workflows
  - `character`: Character portrait, consistency, and pose workflows
  - `image-editing`: Background removal, object removal, relighting
  - `horror-gore`: Cinematic battle damage, zombie progression, creature mutation
  - `biology-anatomy`: Anatomy overlays, speculative biology, hybrid anatomy
  - `weird-experimental`: AI telephone, dream degradation, alternate universes
  - `video-animation`: Image-to-video, video-to-video, talking head
  - `three-d`: Image-to-mesh, multiview generation, depth-to-relief
  - `materials`: Material texture generation workflows
  - `product-photography`: E-commerce product presentation workflows
  - `game-assets`: Game asset and environment generation workflows
  - `architecture`: Architectural visualization and design workflows
  - `restoration`: Image restoration and enhancement workflows
  - `automation`: Workflow automation and batch processing tools
  - `llm-orchestration`: LLM-assisted workflow orchestration tools

#### Standardized Manifest Format
- **Workflow Manifests**: YAML-based workflow definitions with:
  - Metadata (ID, name, version, status)
  - Category and subcategory classification
  - Detailed descriptions with Markdown support
  - Complete input/output specifications
  - Model dependencies with support for multiple families
  - Custom node requirements
  - Hardware requirements (minimum/recommended VRAM)
  - Runtime class and batch processing support
  - Content rating and tags

#### Enhanced Launcher Platform
- **Web Interface**: Flask-based web launcher with:
  - Category browsing and filtering
  - Advanced search functionality
  - Dynamic form generation from manifests
  - Job queue management
  - Generation history tracking
  - Model compatibility checking
  - Missing dependency warnings
  - Hardware suitability indicators
  - Preset selection
  - Batch job support

- **REST API**: Complete HTTP API for:
  - Workflow execution (`POST /api/workflows/{id}/run`)
  - Job status monitoring (`GET /api/jobs/{id}`)
  - Workflow listing and discovery (`GET /api/workflows`)
  - Dependency checking (`GET /api/workflows/{id}/dependencies`)
  - Pack installation (`POST /api/packs/{id}/install`)

- **CLI Interface**: Command-line tools for:
  - Workflow validation
  - Registry generation
  - Dependency detection
  - Workflow compilation
  - Benchmark testing
  - Documentation generation

#### Model Agnostic Design
- Support for multiple model families:
  - FLUX (Flux.1, Flux.1.1)
  - SDXL (Stable Diffusion XL)
  - SD 1.5 (Stable Diffusion 1.5)
  - Qwen Image
  - HiDream
  - Wan
  - Hunyuan
  - Stable Video Diffusion
  - Future ComfyUI-compatible models

#### Shared Interfaces and Templates
- **Reusable Components**:
  - Model loading templates
  - Prompt construction utilities
  - LoRA loading interfaces
  - ControlNet loading stacks
  - Image and mask input interfaces
  - Sampling configuration templates
  - Upscaling modules
  - Metadata output formats
  - Quality scoring systems
  - Output naming conventions

#### Advanced Workflow Capabilities
- **Regional Prompting**: Independent prompts for different image regions
- **Multi-Checkpoint Comparison**: Run same prompt across multiple models
- **Batch Processing**: Generate multiple outputs in a single job
- **Quality Control**: Automated evaluation with retry logic
- **Identity Preservation**: Face and character consistency tools
- **Pose Control**: Pose estimation and transfer workflows
- **Expression Editing**: Character expression modification tools
- **Clothing Editing**: Garment modification workflows
- **Relighting**: Lighting modification tools

#### Registry and Discovery System
- **Automated Registry Generation**:
  - Automatic workflow discovery from manifests
  - Searchable workflow database
  - Category and tag indexing
  - Status tracking (experimental, beta, stable)
  - Model compatibility indexing
  - Hardware requirements indexing

#### Comprehensive Validation System
- **Validation Tools**:
  - Manifest schema validation
  - JSON workflow validation
  - Node dependency validation
  - Model role validation
  - Input/output mapping validation
  - Smoke testing framework
  - Missing model detection
  - Low-memory testing

### 🔧 Improvements

#### Developer Experience
- **Streamlined Development**: Modular pack system makes adding workflows easier
- **Standardized Patterns**: Consistent manifest format across all workflows
- **Automated Tooling**: Built-in validation, compilation, and testing tools
- **Comprehensive Documentation**: Multiple guides covering architecture, configuration, and API
- **Testing Framework**: Built-in validation and smoke testing

#### User Experience
- **Easy Discovery**: Searchable workflow launcher with filtering
- **Clear Dependencies**: Visible model and node requirements
- **Hardware Guidance**: Clear VRAM and hardware recommendations
- **Preset System**: Pre-configured quality and speed presets
- **Error Handling**: Graceful failures with clear error messages
- **Batch Operations**: Process multiple jobs efficiently

#### Performance
- **Efficient Registry**: Optimized JSON database for fast lookups
- **Job Queue**: Managed execution queue for better resource utilization
- **Batch Support**: Native batch processing capabilities
- **Low VRAM Mode**: Support for memory-constrained environments

### 🚨 Breaking Changes from V1

AI Suite V2 is a complete architectural rewrite. Version 1 workflows are **not compatible** with V2 due to:

1. **Manifest Format**: V1 workflows used JSON-only format; V2 uses YAML manifests with embedded workflow JSON
2. **Pack Organization**: V1 workflows were standalone files; V2 workflows are organized into packs with standardized manifests
3. **API Structure**: V2 has a completely redesigned API with different endpoints and data structures
4. **Launcher Platform**: V2 uses Flask-based launcher instead of V1's architecture
5. **Model References**: V2 uses model families (flux, sdxl, sd1.5) instead of hardcoded paths
6. **Validation System**: V2 has comprehensive validation that V1 workflows won't pass

**Migration Path**: V1 workflows must be:
- Converted to V2 manifest format
- Organized into pack directories
- Updated to use V2 launcher interface
- Validated against V2 schemas

### 📦 Pack Details

#### Core Generation Pack
- Text-to-image (fast, balanced, high-quality, low-VRAM)
- Image-to-image (structure preservation, style transfer)
- Inpainting (manual mask, segmentation, object selection)
- Outpainting (square to landscape, panorama, social media)
- Regional prompting
- Multi-model comparison

#### Character Pack
- Portrait generation
- Full-body rendering
- Character sheets (layout, expression, pose)
- Identity consistency
- Face and hand repair
- Expression editing
- Clothing editing

#### Image Editing Pack
- Background removal and replacement
- Object removal and replacement
- Relighting tools
- Face and hand repair
- Expression editing
- Clothing modification

#### Horror & Gore Pack
- Battle damage effects
- Zombie progression
- Blood splatter and overlays
- Creature mutation
- Eldritch corruption
- Decay progression
- Fictional autopsy

#### Biology & Anatomy Pack
- Anatomy overlays
- Skeleton reference
- Muscle reference
- Speculative species design
- Evolution sequences
- Hybrid anatomy
- Biomechanics

#### Video & Animation Pack
- Image-to-video
- Video-to-video
- Talking head
- Lip sync
- Frame interpolation
- Motion transfer

#### 3D Pack
- Image-to-mesh conversion
- Multiview generation
- Depth-to-relief
- Scan completion
- Gaussian splats

#### LLM Orchestration Pack
- Prompt engineering
- Workflow routing
- Image criticism
- Best-of-N selection
- Iterative refinement
- Storyboard direction

#### Other Packs
- Materials generation
- Product photography
- Game assets
- Architecture visualization
- Restoration tools
- Automation workflows

### 🛠️ Validation and Testing

#### Built-in Validation
- Schema validation for all manifest types
- Workflow JSON parsing validation
- Node dependency checking
- Model role validation
- Input/output mapping validation

#### Testing Framework
- Smoke tests for workflow execution
- Missing model detection tests
- Low-memory compatibility tests
- Batch processing tests
- API endpoint tests

### 📊 System Requirements

**Minimum Requirements**:
- Python 3.9-3.11
- 8 GB RAM
- 4 GB VRAM (for basic workflows)
- 50 GB storage

**Recommended Requirements**:
- Python 3.9-3.11
- 16 GB+ RAM
- 12 GB+ VRAM
- 100 GB+ storage
- NVIDIA GPU with CUDA support

**Optional Requirements**:
- 24 GB+ VRAM for complex workflows
- Additional storage for models
- CPU offload support for low-VRAM systems

### 📝 Documentation

#### Comprehensive Guides
- **Architecture Guide**: Technical system architecture
- **Configuration Guide**: Platform configuration
- **User Guide**: End-user documentation
- **Workflow Developer Guide**: Creating workflows
- **API Reference**: Complete API documentation

#### Examples and Templates
- Workflow templates
- Shared prompt blocks
- Negative prompt libraries
- ControlNet stacks
- Sampler presets

### 🔌 External Integration

#### ComfyUI Integration
- HTTP API communication
- WebSocket progress updates
- Custom node management
- Model path management
- Batch processing support

#### Custom Nodes
- Impact Pack
- ControlNet Aux
- Segment Anything
- Inspire Pack
- And more (see individual workflow requirements)

---

## Version History Notes

### Versioning Scheme
AI Suite V2 uses [Semantic Versioning](https://semver.org/):
- **MAJOR**: Breaking changes (e.g., 2.0.0 → 3.0.0)
- **MINOR**: New features, backward-compatible (e.g., 2.1.0 → 2.2.0)
- **PATCH**: Bug fixes, backward-compatible (e.g., 2.1.1 → 2.1.2)

### Status Values
Workflows use status indicators:
- `experimental`: Work in progress, may be unstable
- `beta`: Functional but may have issues
- `stable`: Production-ready, thoroughly tested

---

## Migration from V1

### For V1 Users

If you're migrating from AI Suite V1:

1. **Backup Existing Workflows**: Preserve your V1 workflows
2. **Review V2 Architecture**: Understand the new pack system
3. **Select Desired Workflows**: Choose workflows to migrate
4. **Convert to V2 Format**: Update to V2 manifest format
5. **Organize into Packs**: Structure according to V2 conventions
6. **Test Thoroughly**: Validate in V2 environment
7. **Replace V1 with V2**: Complete migration

### For V1 Workflow Authors

V1 workflows require significant modification:
1. Extract workflow JSON to pack directory
2. Create standardized YAML manifest
3. Define inputs, outputs, models, dependencies
4. Add hardware requirements
5. Test in V2 launcher
6. Update documentation

---

## Future Versions

### Planned Features (Not in V2)
- Cloud synchronization
- Collaborative workflow sharing
- Advanced version control for workflows
- Distributed processing
- Real-time collaborative editing
- Advanced workflow analytics
- Community workflow ratings
- Automated workflow optimization

### Roadmap
- V2.1: Enhanced animation tools
- V2.2: Advanced 3D integration
- V2.3: Improved LLM orchestration
- V3.0: Major architectural improvements

---

## Support

### Getting Help
- **Documentation**: See `docs/` directory
- **Issues**: Report on GitHub issues
- **Community**: Join Discord server
- **API**: See `docs/API_REFERENCE.md`

### Contributing
See `CONTRIBUTING.md` for contribution guidelines.

---

## Acknowledgments

AI Suite V2 builds on the foundation of ComfyUI and the broader AI art community. We thank all contributors, testers, and users who make this project possible.

---

*For detailed technical information, see the [Architecture Guide](docs/ARCHITECTURE.md) and [API Reference](docs/API_REFERENCE.md).*