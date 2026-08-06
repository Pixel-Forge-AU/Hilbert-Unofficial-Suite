# AI Suite - Comprehensive Documentation

## Table of Contents

- [Overview](#overview)
- [Features](#features)
- [Architecture Overview](#architecture-overview)
- [System Requirements](#system-requirements)
- [Quick Start](#quick-start)
- [Project Structure](#project-structure)
- [Documentation Navigation](#documentation-navigation)
- [Strix Halo Owner Walkthrough](STRIX_HALO_OWNER_WALKTHROUGH.md)

---

## Overview

AI Suite is a modular, extensible ComfyUI workflow platform that provides a comprehensive suite of AI-powered image generation, editing, and animation tools. The platform treats every workflow as an installable module rather than a standalone JSON file, enabling easy discovery, management, and sharing of AI generation pipelines.

### Project Goals

AI Suite aims to:

- **Modularity**: Provide workflows as modular, self-contained packages with standardized interfaces
- **Model Agnosticism**: Support multiple model families (Flux, SDXL, SD 1.5, Qwen Image, and more)
- **Dependency Awareness**: Automatically detect and validate required models and custom nodes
- **Replaceable Components**: Allow seamless swapping of models, samplers, controlnets, and other components
- **Local-First**: Run entirely offline after initial model and node installation
- **Safe Failure**: Gracefully handle missing dependencies with clear error messages
- **Extensibility**: Enable easy addition of new workflow categories and packs

### What is AI Suite?

AI Suite is a workflow management platform built on top of ComfyUI that provides:

- **50+ production-ready workflows** across 15+ categories
- **Centralized workflow registry** with searchable discovery
- **Intelligent dependency management** with automatic checking
- **Hardware-aware recommendations** for optimal performance
- **Preset system** for quick configuration
- **API-first architecture** for programmatic access
- **Workflow validation** to ensure reliability
- **Batch processing support** for efficiency

---

## Features

### Core Capabilities

#### Image Generation
- Text-to-image generation with multiple quality presets
- Image-to-image generation with structure preservation
- Inpainting with multiple mask modes
- Outpainting in various aspect ratios
- Upscaling with multiple algorithms

#### Character Consistency
- Character sheets with multiple angles
- Expression sheets for animation reference
- Full-body character generation
- Identity consistency across generations
- Character design documentation

#### Image Editing
- Background removal and replacement
- Object removal and editing
- Relighting and color correction
- Face and hand repair
- Expression and clothing editing

#### Video & Animation
- Image-to-video generation
- Video-to-video processing
- Talking head generation
- Lip sync and animation
- Frame interpolation

#### 3D Reconstruction
- Image-to-3D adapters
- Multi-view generation
- Depth-to-mesh conversion
- Scan completion
- Gaussian splatting

#### Specialized Workflows
- Horror and cinematic gore effects
- Biology and anatomy overlays
- Speculative biology design
- Material generation
- Product photography
- Game asset generation

### Advanced Features

#### Preset System
- **Quality presets**: Fast, balanced, high-quality, extreme resolution
- **Hardware presets**: Optimized for different VRAM configurations
- **Style presets**: Different artistic styles and approaches
- **Custom presets**: User-defined configurations

#### Workflow Registry
- **Searchable database** of all available workflows
- **Category browsing** for easy discovery
- **Tag filtering** by use case, theme, or technique
- **Status indicators** showing workflow stability
- **Hardware suitability** indicators

#### Dependency Management
- **Automatic detection** of required models and nodes
- **Compatibility checking** against installed components
- **Missing dependency warnings** with installation guidance
- **Optional dependency support** for enhanced functionality

#### Quality Control
- **Prompt adherence scoring**
- **Anatomy quality assessment**
- **Face and hand quality metrics**
- **Composition analysis**
- **Blur and artifact detection**

#### Batch Processing
- **Multiple image generation** in a single run
- **Sequential job queue** management
- **Batch job monitoring** with progress tracking
- **Automated output organization**

---

## Architecture Overview

AI Suite follows a modular architecture with clear separation of concerns:

```
┌─────────────────────────────────────────────────────────────────────┐
│                         AI Suite Launcher                         │
│                    (Flask Web Interface + CLI)                       │
└─────────────────────────┬───────────────────────────────────────────┘
                          │
          ┌───────────────┼───────────────┐
          │               │               │
          ▼               ▼               ▼
┌─────────────────┐ ┌───────────────┐ ┌─────────────────┐
│   Registry      │ │  Configuration│ │   Workflow      │
│   System        │ │  Management   │ │   Launcher      │
└────────┬────────┘ └───────────────┘ └────────┬────────┘
         │                                     │
         │          ┌──────────────────────────┘
         │          ▼
┌─────────────────┐ ┌───────────────┐ ┌─────────────────┐
│   Manifest      │ │   Workflow    │ │   ComfyUI     │
│   Parsing       │ │   Validation  │ │   Integration │
└─────────────────┘ └───────────────┘ └─────────────────┘
```

### Key Components

#### 1. Registry System
The registry system maintains a searchable database of all workflows, models, and custom nodes. It's automatically updated when manifests change and provides:
- Workflow discovery and search
- Dependency resolution
- Compatibility checking
- Status tracking

#### 2. Configuration Management
Configuration is managed through YAML files in the `config/` directory:
- `suite.yaml`: Main suite configuration
- `model-paths.yaml`: Model file paths
- `hardware-profiles.yaml`: Hardware-specific optimizations
- `categories.yaml`: Category definitions
- `feature-flags.yaml`: Feature toggles

#### 3. Workflow Launcher
The launcher provides both a web interface and CLI for:
- Workflow browsing and discovery
- Job management and queuing
- Progress monitoring
- Output visualization

#### 4. Manifest System
Each workflow includes a standardized manifest (`manifest.yaml`) that describes:
- Inputs and outputs
- Required models and nodes
- Hardware requirements
- Content themes and tags
- Presets and examples

#### 5. ComfyUI Integration
The platform integrates with ComfyUI through:
- HTTP API for workflow execution
- WebSocket for real-time progress updates
- Automatic graph compilation from manifests

---

## System Requirements

### Minimum Requirements

| Component | Minimum |
|-----------|---------|
| Operating System | Windows 10/11, macOS 10.15+, Linux (Ubuntu 20.04+) |
| Python | 3.9 - 3.11 |
| RAM | 16 GB |
| Storage | 50 GB free space |
| GPU | NVIDIA GPU with 4 GB VRAM |
| GPU Driver | CUDA 11.8+ compatible driver |

### Recommended Requirements

| Component | Recommended |
|-----------|-------------|
| RAM | 32 GB or more |
| GPU | NVIDIA RTX 3060 (12 GB) or better |
| GPU VRAM | 16 GB+ for complex workflows |
| Storage | SSD with 100+ GB free space |
| CPU | Multi-core processor (6+ cores) |

### Hardware-Specific Optimizations

The platform automatically optimizes workflows based on detected hardware:

#### Low VRAM (< 8 GB)
- Automatic CPU offloading
- Reduced batch sizes
- Memory-efficient samplers
- Gradient checkpointing

#### Medium VRAM (8-16 GB)
- Balanced optimization
- Moderate batch sizes
- Standard precision

#### High VRAM (16+ GB)
- Full precision processing
- Large batch sizes
- Advanced upscaling
- Complex controlnet stacks

---

## Quick Start

### Installation

1. **Clone the repository**:
   ```bash
   git clone https://github.com/YOUR_USERNAME/ai-suite.git
   cd ai-suite
   ```

2. **Install dependencies**:
   ```bash
   pip install -r requirements.txt
   ```

3. **Configure paths** (optional):
   Edit `config/model-paths.yaml` to specify your model locations

4. **Launch the platform**:
   ```bash
   python launcher.py
   ```

5. **Access the web interface**:
   Open your browser to `http://127.0.0.1:8000`

### First Workflow

1. Browse workflows in the web interface
2. Select a workflow (e.g., "Core Text-to-Image Fast")
3. Configure inputs and settings
4. Click "Run Workflow"
5. Monitor progress in real-time
6. Download results

### Command Line Usage

```bash
# List all workflows
python launcher.py --list

# Run a specific workflow
python launcher.py --workflow core.text-to-image-fast --preset quality

# Check dependencies
python launcher.py --check-deps

# Validate workflows
python launcher.py --validate
```

---

## Project Structure

```
ai-suite/
├── docs/                      # Documentation (this directory)
│   ├── README.md             # This file
│   ├── USER_GUIDE.md         # User-facing documentation
│   ├── ARCHITECTURE.md       # Technical architecture
│   ├── WORKFLOW_DEVELOPER_GUIDE.md  # For workflow creators
│   ├── API_REFERENCE.md      # API documentation
│   └── CONFIGURATION_GUIDE.md # Configuration reference
├── config/                    # Configuration files
│   ├── suite.yaml           # Main configuration
│   ├── model-paths.yaml     # Model paths
│   ├── hardware-profiles.yaml # Hardware profiles
│   ├── categories.yaml      # Category definitions
│   └── feature-flags.yaml   # Feature toggles
├── registry/                  # Workflow registry
│   ├── workflows.json       # Workflow registry
│   ├── models.json          # Model registry
│   ├── nodes.json           # Custom nodes registry
│   └── packs.json           # Pack registry
├── packs/                     # Workflow packs
│   ├── core-generation/     # Core generation workflows
│   ├── character/           # Character workflows
│   ├── image-editing/       # Image editing workflows
│   ├── horror-gore/         # Horror effects workflows
│   ├── video-animation/     # Video workflows
│   ├── three-d/             # 3D workflows
│   ├── materials/           # Material workflows
│   ├── product-photography/ # Product workflows
│   ├── game-assets/         # Game asset workflows
│   ├── architecture/        # Architecture workflows
│   ├── restoration/         # Restoration workflows
│   ├── automation/          # Automation workflows
│   ├── llm-orchestration/   # LLM workflows
│   └── weird-experimental/  # Experimental workflows
├── workflows/                 # Compiled workflows
│   ├── source/              # Source workflows
│   ├── compiled/            # Compiled workflows
│   └── thumbnails/          # Workflow thumbnails
├── shared/                    # Shared resources
│   ├── templates/           # Reusable templates
│   ├── prompt-blocks/       # Prompt templates
│   ├── negative-prompts/    # Negative prompt collections
│   ├── controlnet-stacks/   # ControlNet configurations
│   ├── sampler-presets/     # Sampler configurations
│   ├── output-naming/       # Output naming templates
│   └── utility-subgraphs/   # Reusable subgraphs
├── presets/                   # Preset configurations
│   ├── quality/             # Quality presets
│   ├── speed/               # Speed presets
│   ├── hardware/            # Hardware presets
│   └── styles/              # Style presets
├── tools/                     # Unified CLI: python -m tools <command>
│   ├── __main__.py
│   ├── registry_generator.py   # registry
│   ├── workflow_compiler.py    # compile
│   ├── validator.py            # validate
│   ├── documentation_generator.py  # docs
│   ├── pack_mover.py           # pack-mover (list/move/remove/remove-category)
│   └── download_models.py
├── schemas/                   # JSON schemas
│   ├── workflow-manifest.schema.json
│   ├── model-manifest.schema.json
│   ├── pack-manifest.schema.json
│   └── preset.schema.json
├── launcher.py               # Main launcher application
├── launcher/                 # Launcher web interface
│   ├── backend/             # Backend API
│   └── frontend/            # Frontend UI
├── tests/                    # Test suite
│   ├── manifests/           # Manifest tests
│   ├── workflows/           # Workflow tests
│   ├── dependencies/        # Dependency tests
│   └── smoke/               # Smoke tests
└── requirements.txt          # Python dependencies
```

---

## Documentation Navigation

### Getting Started
- **[README.md](README.md)** - Overview and quick start guide
- **[USER_GUIDE.md](USER_GUIDE.md)** - Detailed user documentation
- **[CONFIGURATION_GUIDE.md](CONFIGURATION_GUIDE.md)** - Configuration reference

### Technical Documentation
- **[ARCHITECTURE.md](ARCHITECTURE.md)** - System architecture and design
- **[API_REFERENCE.md](API_REFERENCE.md)** - API endpoints and usage

### Developer Documentation
- **[WORKFLOW_DEVELOPER_GUIDE.md](WORKFLOW_DEVELOPER_GUIDE.md)** - Creating workflows and packs

---

## Getting Help

- **Documentation**: See individual documentation files for detailed guides
- **Issues**: Report bugs and request features on GitHub
- **Discussions**: Join community discussions
- **Examples**: Check the `example/` directory for sample workflows

---

## Contributing

AI Suite is built as an open, modular platform. Contributions are welcome!

### Ways to Contribute
- Create new workflows
- Add workflow packs
- Improve documentation
- Fix bugs
- Add new features
- Share presets and templates

### Workflow Submission Guidelines
1. Follow the manifest structure
2. Include comprehensive documentation
3. Test thoroughly before submission
4. Provide example outputs
5. Document dependencies clearly

---

## License

This project is licensed under the MIT License - see the LICENSE file for details.

---

## Acknowledgments

AI Suite builds on the foundations of:
- [ComfyUI](https://github.com/comfyanonymous/ComfyUI) - The underlying workflow engine
- Stable Diffusion community - For model development and sharing
- AI research community - For continuous innovation

---

*For more information, explore the documentation directories linked above.*
