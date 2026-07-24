# AI Suite - Architecture Guide

## Table of Contents

- [Introduction](#introduction)
- [System Architecture](#system-architecture)
- [Directory Structure](#directory-structure)
- [Manifest Format Details](#manifest-format-details)
- [Registry System](#registry-system)
- [Validation System](#validation-system)
- [Launcher Architecture](#launcher-architecture)
- [ComfyUI Integration](#comfyui-integration)

---

## Introduction

This architecture guide provides a comprehensive overview of AI Suite's technical design. Understanding the architecture is essential for developers, system administrators, and advanced users who want to customize or extend the platform.

---

## System Architecture

AI Suite follows a modular, layered architecture:

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         Presentation Layer                              │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌────────────┐ │
│  │  Web UI      │  │  REST API    │  │  CLI         │  │  WebSocket │ │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘  └──────┬───┘ │
│         │                  │                  │                  │      │
└─────────┼──────────────────┼──────────────────┼──────────────────┼──────┘
          │                  │                  │                  │
┌─────────▼──────────────────▼──────────────────▼──────────────────▼──────┐
│                         Business Logic Layer                            │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌────────────┐ │
│  │ Workflow     │  │ Registry     │  │ Configuration│  │ Job Queue  │ │
│  │ Manager      │  │ System       │  │ Manager      │  │ Manager    │ │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘  └──────┬───┘ │
│         │                  │                  │                  │      │
└─────────┼──────────────────┼──────────────────┼──────────────────┼──────┘
          │                  │                  │                  │
┌─────────▼──────────────────▼──────────────────▼──────────────────▼──────┐
│                         Data Layer                                      │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌────────────┐ │
│  │ Manifests    │  │ Workflows    │  │ Models       │  │ Registry   │ │
│  │              │  │ JSON Files   │  │ Databases  │  │ Databases  │ │
│  └──────────────┘  └──────────────┘  └──────────────┘  └────────────┘ │
│                                                                         │
┌─────────▼────────────────────────────────────────────────────────────────▼───┐
│                         External Integration Layer                            │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌────────────┐       │
│  │ ComfyUI      │  │ File System  │  │ Custom Nodes │  │ GPU        │       │
│  │ Integration  │  │ Storage      │  │ Management   │  │ Resources  │       │
│  └──────────────┘  └──────────────┘  └──────────────┘  └────────────┘       │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Layer Descriptions

#### Presentation Layer
The presentation layer handles user interaction:

- **Web UI**: Flask-based web interface for browsing and running workflows
- **REST API**: JSON-based HTTP API for programmatic access
- **CLI**: Command-line interface for automation and scripting
- **WebSocket**: Real-time communication for job progress

#### Business Logic Layer
The business logic layer processes requests and manages workflows:

- **Workflow Manager**: Loads, validates, and executes workflows
- **Registry System**: Maintains searchable database of workflows
- **Configuration Manager**: Manages platform settings
- **Job Queue Manager**: Handles workflow execution queue

#### Data Layer
The data layer stores and retrieves information:

- **Manifests**: YAML files defining workflow parameters
- **Workflow JSON**: ComfyUI workflow graphs
- **Models Database**: Registry of available models
- **Registry Databases**: JSON databases for quick lookup

#### External Integration Layer
The external integration layer connects to external systems:

- **ComfyUI Integration**: HTTP API and WebSocket connections
- **File System**: Storage for workflows, models, and outputs
- **Custom Node Management**: Detection and validation of custom nodes
- **GPU Resources**: CUDA and GPU memory management

---

## Directory Structure

### Root Directory

```
ai-suite/
├── docs/                      # Documentation
├── config/                    # Configuration files
├── registry/                  # Registry databases
├── packs/                     # Workflow packs
├── workflows/                 # Compiled workflows
├── shared/                    # Shared resources
├── presets/                   # Preset configurations
├── tools/                     # Utility scripts
├── schemas/                   # JSON schemas
├── launcher/                  # Launcher web interface
├── tests/                     # Test suite
├── logs/                      # Log files
├── launcher.py               # Main launcher
├── requirements.txt          # Python dependencies
├── README.md                 # Project overview
└── Instructions.md           # Developer instructions
```

### Detailed Directory Descriptions

#### `docs/` - Documentation
Contains all project documentation:
- `README.md` - Project overview
- `USER_GUIDE.md` - User-facing documentation
- `ARCHITECTURE.md` - This file
- `WORKFLOW_DEVELOPER_GUIDE.md` - Workflow creation guide
- `API_REFERENCE.md` - API documentation
- `CONFIGURATION_GUIDE.md` - Configuration reference

#### `config/` - Configuration Files
Contains YAML configuration files:

```
config/
├── suite.yaml           # Main suite configuration
├── model-paths.yaml     # Model file paths
├── hardware-profiles.yaml # Hardware-specific optimizations
├── categories.yaml      # Category definitions
└── feature-flags.yaml   # Feature toggles
```

**suite.yaml** - Main configuration:
```yaml
suite:
  name: "AI Suite"
  version: "2.0.0"

paths:
  workflows: "./workflows"
  packs: "./packs"
  shared: "./shared"

settings:
  default_width: 1024
  default_height: 1024
  comfyui_port: 8188
```

**model-paths.yaml** - Model location configuration:
```yaml
model_paths:
  checkpoints:
    - /path/to/checkpoint/models
  vae:
    - /path/to/vae/models
  loras:
    - /path/to/loras
```

#### `registry/` - Registry Databases
Contains JSON databases:

```
registry/
├── workflows.json       # Workflow registry
├── models.json          # Model registry
├── nodes.json           # Custom nodes registry
└── packs.json           # Pack registry
```

**workflows.json** - Workflow registry:
```json
{
  "workflows": [
    {
      "id": "core.text-to-image-fast",
      "name": "Fast Text-to-Image",
      "category": "core-generation",
      "status": "stable",
      "thumbnail": "thumbnails/core.text-to-image-fast.webp"
    }
  ]
}
```

#### `packs/` - Workflow Packs
Contains workflow categories:

```
packs/
├── core-generation/     # Core generation workflows
├── character/           # Character workflows
├── image-editing/       # Image editing workflows
├── horror-gore/         # Horror effects workflows
├── video-animation/     # Video workflows
├── three-d/             # 3D workflows
└── ...                  # More categories
```

Each pack contains:
```
pack/
├── pack-manifest.yaml   # Pack-level configuration
└── workflow-name/
    ├── manifest.yaml    # Workflow manifest
    ├── workflow.json    # UI workflow
    ├── workflow-api.json # API workflow
    ├── README.md        # Workflow documentation
    ├── presets/         # Preset configurations
    │   ├── quick.yaml
    │   └── detailed.yaml
    └── tests/           # Test files
        ├── smoke-input.json
        └── expected-output.json
```

#### `workflows/` - Compiled Workflows
Contains compiled workflow files:

```
workflows/
├── source/              # Source workflows
├── compiled/            # Compiled workflows
└── thumbnails/          # Workflow thumbnails
```

#### `shared/` - Shared Resources
Contains reusable components:

```
shared/
├── templates/           # Reusable templates
├── prompt-blocks/       # Prompt templates
├── negative-prompts/    # Negative prompt collections
├── controlnet-stacks/   # ControlNet configurations
├── sampler-presets/     # Sampler configurations
├── output-naming/       # Output naming templates
└── utility-subgraphs/   # Reusable subgraphs
```

#### `presets/` - Preset Configurations
Contains preset configurations:

```
presets/
├── quality/             # Quality presets
├── speed/               # Speed presets
├── hardware/            # Hardware presets
└── styles/              # Style presets
```

#### `tools/` - Utility Scripts
Contains Python scripts:

```
tools/
├── validate_workflows.py    # Validate workflow manifests
├── build_registry.py        # Build registry databases
├── detect_dependencies.py   # Detect workflow dependencies
├── compile_workflows.py     # Compile workflows
├── benchmark_workflows.py   # Benchmark workflow performance
└── generate_docs.py         # Generate documentation
```

#### `schemas/` - JSON Schemas
Contains validation schemas:

```
schemas/
├── workflow-manifest.schema.json   # Workflow manifest schema
├── model-manifest.schema.json      # Model manifest schema
├── pack-manifest.schema.json       # Pack manifest schema
└── preset.schema.json              # Preset schema
```

#### `launcher/` - Launcher Interface
Contains launcher web interface:

```
launcher/
├── backend/             # Backend API
├── frontend/            # Frontend UI
└── static/              # Static assets
```

#### `tests/` - Test Suite
Contains test files:

```
tests/
├── manifests/           # Manifest tests
├── workflows/           # Workflow tests
├── dependencies/        # Dependency tests
└── smoke/               # Smoke tests
```

---

## Manifest Format Details

### Workflow Manifest Structure

Every workflow includes a `manifest.yaml` file that defines:

```yaml
# Required fields
id: character.character-sheet
name: Character Character Sheet
version: "1.0.0"
category: character
description: >
  Character sheet generation with multiple angles.
status: stable

# Entrypoints
entrypoints:
  ui: workflow.json
  api: workflow-api.json

# Inputs
inputs:
  - id: prompt
    type: text
    required: true
    description: Positive prompt describing the character

# Outputs
outputs:
  - id: image
    type: image
    description: Generated character sheet

# Models
models:
  required:
    - role: checkpoint
      family:
        - flux
        - sdxl
  optional:
    - role: lora
      suggested:
        - character-style

# Custom nodes
custom_nodes:
  required:
    - comfyui
  optional:
    - comfyui-impact-pack

# Hardware requirements
hardware:
  minimum_vram_gb: 8
  recommended_vram_gb: 16
  supports_low_vram: true
  supports_cpu_offload: true

# Runtime properties
runtime:
  class: large
  batch_supported: true

# Content information
content:
  themes:
    - character-design
  adult_only: false

# Tags
tags:
  - character-sheet
  - reference
  - multi-angle
```

### Manifest Field Reference

#### `id` (Required)
Unique workflow identifier following pattern `category.workflow-name`.

Example: `character.character-sheet`

#### `name` (Required)
Human-readable workflow name.

Example: `Character Sheet`

#### `version` (Required)
Semantic version string.

Example: `1.0.0`

#### `category` (Required)
Category pack name where workflow is located.

Example: `character`

#### `subcategory` (Optional)
Subcategory for better organization.

Example: `character-sheet`

#### `description` (Required)
Detailed description of workflow functionality.

#### `status` (Required)
Workflow maturity status: `experimental`, `stable`, or `deprecated`.

#### `entrypoints` (Required)
Paths to workflow files:

```yaml
entrypoints:
  ui: workflow.json
  api: workflow-api.json
```

#### `inputs` (Required)
List of input parameters:

```yaml
inputs:
  - id: prompt
    type: text
    required: true
    default: ""
    description: Positive prompt
```

Input types: `image`, `text`, `float`, `int`, `boolean`, `model`, `mask`

#### `outputs` (Required)
List of output parameters:

```yaml
outputs:
  - id: image
    type: image
    description: Generated image
```

Output types: `image`, `mask`, `video`, `text`, `metadata`

#### `models` (Required)
Model requirements:

```yaml
models:
  required:
    - role: checkpoint
      family:
        - flux
        - sdxl
  optional:
    - role: lora
      suggested:
        - character-style
```

Model roles: `checkpoint`, `vae`, `text_encoder`, `lora`, `controlnet`, etc.

#### `custom_nodes` (Required)
Custom node requirements:

```yaml
custom_nodes:
  required:
    - comfyui
  optional:
    - comfyui-impact-pack
    - comfyui-controlnet-aux
```

#### `hardware` (Required)
Hardware requirements:

```yaml
hardware:
  minimum_vram_gb: 8
  recommended_vram_gb: 16
  supports_low_vram: true
  supports_cpu_offload: true
```

#### `runtime` (Optional)
Runtime properties:

```yaml
runtime:
  class: large        # light, medium, heavy
  batch_supported: true
```

#### `content` (Optional)
Content information:

```yaml
content:
  themes:
    - character-design
  adult_only: false
```

#### `tags` (Optional)
Search tags:

```yaml
tags:
  - character-sheet
  - reference
  - multi-angle
```

#### `presets` (Optional)
Available presets:

```yaml
presets:
  - quick
  - detailed
```

---

## Registry System

### Registry Architecture

The registry system maintains searchable databases of:

- **Workflows**: All available workflows
- **Models**: Available checkpoint, VAE, LoRA models
- **Nodes**: Available custom nodes
- **Packs**: Workflow category packs

### Registry Generation

Registries are automatically generated when manifests change:

```bash
# Build all registries
python tools/build_registry.py

# Build specific registry
python tools/build_registry.py --workflows
python tools/build_registry.py --models
python tools/build_registry.py --nodes
```

### Registry API

The launcher provides API endpoints for registry access:

```http
GET /api/registry/workflows
GET /api/registry/workflows/{workflow_id}
GET /api/registry/models
GET /api/registry/nodes
GET /api/registry/packs
```

### Registry Search

Search functionality supports:

- Full-text search
- Category filtering
- Tag filtering
- Status filtering
- Hardware filtering

Example search query:
```
GET /api/registry/workflows?search=character&tag=portrait&status=stable
```

---

## Validation System

### Validation Pipeline

Workflows are validated through multiple stages:

```
Manifest → Schema Validation → Structure Validation → 
Dependency Validation → API Validation → Smoke Test
```

### Validation Commands

```bash
# Validate all workflows
python tools/validate_workflows.py --all

# Validate specific workflow
python tools/validate_workflows.py --workflow core.text-to-image-fast

# Validate with verbose output
python tools/validate_workflows.py --verbose
```

### Validation Checks

1. **Schema Validation**: Validate against JSON schema
2. **Structure Validation**: Check required files exist
3. **Dependency Validation**: Check model and node dependencies
4. **API Validation**: Validate API workflow format
5. **Smoke Test**: Run with minimal inputs
6. **Missing Model Test**: Verify graceful handling of missing models
7. **Low Memory Test**: Verify low VRAM compatibility

### Validation Errors

Common validation errors:

| Error | Description | Solution |
|-------|-------------|----------|
| Schema Error | Manifest doesn't match schema | Fix manifest structure |
| Missing File | Required file not found | Create missing file |
| Missing Model | Required model not installed | Install required model |
| Missing Node | Required custom node not installed | Install custom node |
| API Error | Workflow API format invalid | Fix workflow-api.json |
| Test Failure | Smoke test failed | Debug workflow |

---

## Launcher Architecture

### Launcher Components

The launcher consists of:

1. **Configuration Manager**: Loads and manages configuration
2. **Registry Loader**: Loads registry databases
3. **Workflow Manager**: Loads and manages workflows
4. **Job Queue Manager**: Manages workflow execution queue
5. **ComfyUI Client**: Communicates with ComfyUI
6. **Web Server**: Serves web interface and API
7. **Job Executor**: Executes workflows

### Launcher Lifecycle

```
1. Load Configuration
2. Load Registry
3. Load Workflows
4. Check Dependencies
5. Start Web Server
6. Listen for Requests
```

### Job Execution Flow

```
User Request → Validate Input → Check Dependencies → 
Add to Queue → Execute → Monitor Progress → 
Save Output → Notify User
```

### Job Queue Architecture

Jobs are processed in a queue with the following states:

- **Queued**: Waiting for execution
- **Pending**: Waiting for dependencies
- **Running**: Currently executing
- **Completed**: Successfully finished
- **Failed**: Execution failed
- **Cancelled**: User cancelled

### Concurrency Model

- **Async Execution**: Workflows run asynchronously
- **Thread Pool**: Manage concurrent jobs
- **Resource Locking**: Prevent resource conflicts
- **Progress Tracking**: Real-time progress updates

---

## ComfyUI Integration

### Integration Architecture

```
AI Suite Launcher
        │
        ├── HTTP API (port 8188)
        │   ├── POST /prompt
        │   ├── GET /history
        │   └── GET /system_stats
        │
        └── WebSocket
            ├── Progress updates
            ├── Executing status
            └── Images (preview)
```

### API Endpoints

The launcher interacts with ComfyUI through:

#### POST /prompt
Execute a workflow:

```json
{
  "prompt": { workflow_graph },
  "client_id": "launcher_client_id"
}
```

#### GET /history
Get execution history:

```json
{
  "history": {
    "prompt_id": { execution_results }
  }
}
```

#### GET /system_stats
Get system information:

```json
{
  "devices": [ { "name": "GPU", "type": "cuda" } ],
  "python_version": "3.10.0",
  "comfyui_version": "1.0.0"
}
```

### WebSocket Protocol

ComfyUI WebSocket messages:

```json
// Executing
{
  "type": "executing",
  "data": {
    "node": null,
    "prompt_id": "prompt_id"
  }
}

// Progress
{
  "type": "progress",
  "data": {
    "value": 0.5,
    "max": 1.0,
    "node": "node_id"
  }
}

// Executed
{
  "type": "executed",
  "data": {
    "output": { images },
    "node": "node_id",
    "prompt_id": "prompt_id"
  }
}
```

### Connection Management

The launcher manages ComfyUI connections:

1. **Auto-detection**: Try to detect running ComfyUI
2. **Connection pooling**: Maintain connections
3. **Retry logic**: Retry failed connections
4. **Health checks**: Monitor ComfyUI status

---

## Data Flow

### Workflow Loading Flow

```
1. Read manifest.yaml
2. Parse YAML
3. Validate against schema
4. Load workflow.json
5. Load workflow-api.json
6. Load presets
7. Register in registry
```

### Job Execution Flow

```
1. User submits job
2. Validate inputs
3. Check dependencies
4. Add to queue
5. Dequeue job
6. Load workflow
7. Compile with inputs
8. Send to ComfyUI
9. Monitor progress
10. Retrieve outputs
11. Save outputs
12. Update job status
13. Notify user
```

### Configuration Loading Flow

```
1. Load suite.yaml
2. Load model-paths.yaml
3. Load hardware-profiles.yaml
4. Merge configurations
5. Apply defaults
6. Validate configuration
7. Store in ConfigManager
```

---

## Error Handling

### Error Categories

1. **Configuration Errors**: Invalid configuration
2. **Dependency Errors**: Missing models or nodes
3. **Execution Errors**: Workflow execution failures
4. **Network Errors**: ComfyUI connection issues
5. **Validation Errors**: Manifest validation failures

### Error Handling Strategy

- **Graceful Degradation**: Continue with partial functionality
- **Clear Error Messages**: User-friendly error descriptions
- **Retry Logic**: Automatic retries for transient errors
- **Fallback Options**: Provide alternative solutions
- **Logging**: Detailed error logging for debugging

---

## Security Considerations

### Security Features

1. **Input Validation**: Validate all user inputs
2. **Path Sanitization**: Sanitize file paths
3. **Access Control**: Secure API endpoints
4. **Rate Limiting**: Prevent abuse
5. **Error Masking**: Hide sensitive error details

### Security Best Practices

- Validate all manifest inputs
- Sanitize file paths
- Use environment variables for sensitive data
- Implement CORS policies
- Log security events
- Regular security audits

---

*For detailed information on specific components, refer to the linked documentation files.*