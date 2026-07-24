# AI Suite - Configuration Guide

## Table of Contents

- [Overview](#overview)
- [suite.yaml - Main Configuration](#suiteyaml---main-configuration)
- [model-paths.yaml - Model Paths](#model-pathsyaml---model-paths)
- [hardware-profiles.yaml - Hardware Profiles](#hardware-profilesyaml---hardware-profiles)
- [categories.yaml - Category Definitions](#categoriesyaml---category-definitions)
- [feature-flags.yaml - Feature Flags](#feature-flagsyaml---feature-flags)
- [Environment Variables](#environment-variables)
- [Configuration Best Practices](#configuration-best-practices)

---

## Overview

AI Suite uses a comprehensive configuration system to manage all aspects of the platform. Configuration files are located in the `config/` directory and use YAML format for readability and flexibility.

### Configuration File Locations

```
config/
├── suite.yaml           # Main suite configuration
├── model-paths.yaml     # Model file paths
├── hardware-profiles.yaml # Hardware-specific optimizations
├── categories.yaml      # Category definitions
└── feature-flags.yaml   # Feature toggles
```

### Configuration Precedence

Configuration values can be set through:

1. **Environment variables** (highest priority)
2. **Configuration files**
3. **Default values** (lowest priority)

### Hot Reloading

Configuration changes are applied when the launcher restarts. Some settings may require a manual refresh.

---

## suite.yaml - Main Configuration

### Complete Configuration Example

```yaml
# Suite Identification
suite:
  name: "AI Suite"
  version: "2.0.0"
  description: "Modular ComfyUI workflow platform"
  environment: "production"  # development, staging, production

# File Paths
paths:
  workflows: "./workflows"
  packs: "./packs"
  shared: "./shared"
  presets: "./presets"
  registry: "./registry"
  config: "./config"
  docs: "./docs"
  tests: "./tests"
  tools: "./tools"

# Runtime Settings
settings:
  # Default generation parameters
  default_width: 1024
  default_height: 1024
  default_steps: 20
  default_guidance: 7.5
  default_sampler: "euler"
  default_scheduler: "normal"
  default_batch_size: 1
  
  # ComfyUI connection
  comfyui_host: "127.0.0.1"
  comfyui_port: 8188
  comfyui_timeout: 300  # seconds
  
  # Launcher settings
  launcher_host: "127.0.0.1"
  launcher_port: 8000
  launcher_debug: false
  
  # Feature flags
  enable_batch_processing: true
  enable_dependency_check: true
  enable_quality_control: true
  enable_workflow_registry: true
  enable_preset_system: true
  
  # Storage settings
  max_queue_size: 50
  max_history_size: 100
  output_format: "webp"
  output_quality: 90
  
  # Performance
  max_concurrent_jobs: 4
  job_timeout: 3600  # seconds
  cache_enabled: true
  cache_ttl: 3600  # seconds

# Logging Configuration
logging:
  level: "info"  # debug, info, warning, error, critical
  format: "json"  # json, text
  file: "./logs/suite.log"
  max_file_size: "10MB"
  backup_count: 5

# Security Settings
security:
  api_keys:
    - key: "your-api-key-here"
      description: "Production API key"
      permissions: ["read", "write", "admin"]
  cors_origins:
    - "http://localhost:3000"
    - "https://your-domain.com"
  rate_limiting:
    enabled: true
    requests_per_minute: 60
  require_authentication: false

# Dependency Management
dependencies:
  check_nodes: true
  auto_install_optional: false
  show_optional_warnings: true
  node_install_path: "./comfyui/custom_nodes"

# Registry Settings
registry:
  auto_refresh: true
  refresh_interval: 300  # seconds
  max_workflow_cache: 1000

# Webhook Settings
webhooks:
  enabled: true
  secret: "your-webhook-secret"
  timeout: 30
  retries: 3
```

### Configuration Sections

#### Suite Identification

Controls the suite's identity and environment:

```yaml
suite:
  name: "AI Suite"
  version: "2.0.0"
  description: "Modular ComfyUI workflow platform"
  environment: "production"
```

#### Paths Configuration

Define locations for all project directories:

```yaml
paths:
  workflows: "./workflows"
  packs: "./packs"
  shared: "./shared"
  presets: "./presets"
  registry: "./registry"
  config: "./config"
  docs: "./docs"
  tests: "./tests"
  tools: "./tools"
```

#### Settings Configuration

Fine-tune runtime behavior:

```yaml
settings:
  default_width: 1024
  default_height: 1024
  default_steps: 20
  comfyui_port: 8188
  launcher_port: 8000
  max_concurrent_jobs: 4
```

#### Logging Configuration

Configure logging behavior:

```yaml
logging:
  level: "info"
  format: "json"
  file: "./logs/suite.log"
  max_file_size: "10MB"
  backup_count: 5
```

#### Security Configuration

Manage security settings:

```yaml
security:
  api_keys:
    - key: "your-api-key-here"
      description: "Production API key"
      permissions: ["read", "write", "admin"]
  cors_origins:
    - "http://localhost:3000"
  rate_limiting:
    enabled: true
    requests_per_minute: 60
```

---

## model-paths.yaml - Model Paths

### Complete Configuration Example

```yaml
model_paths:
  checkpoints:
    - /path/to/stable-diffusion-models
    - /path/to/flux-models
    - /path/to/other-checkpoints
    
  vae:
    - /path/to/vae-models
    - /path/to/custom-vae
    
  loras:
    - /path/to/loras
    - /path/to/style-loras
    - /path/to/detail-loras
    
  controlnets:
    - /path/to/controlnet-models
    - /path/to/custom-controlnets
    
  clip:
    - /path/to/clip-models
    
  unclip:
    - /path/to/unclip-models
    
  ipadapter:
    - /path/to/ipadapter-models
    
  insightface:
    - /path/to/insightface-models
    
 upscale_models:
    - /path/to/upscale-models
    
  custom_nodes:
    - /path/to/comfyui/custom_nodes
    
  embeddings:
    - /path/to/embeddings
    
  timelines:
    - /path/to/timelines
```

### Model Path Types

| Type | Description | Example |
|------|-------------|---------|
| `checkpoints` | Main model files (`.safetensors`, `.ckpt`) | Flux, SDXL, SD 1.5 |
| `vae` | Variational Autoencoder models | `vae-ft-mse-840000-ema-pruned` |
| `loras` | Low-Rank Adaptation models | Style, detail, control LoRAs |
| `controlnets` | ControlNet models | Pose, Depth, Canny, etc. |
| `clip` | CLIP text encoder models | ViT-L, ViT-H |
| `upscale_models` | Upscaling models | RealESRGAN, SwinIR |
| `embeddings` | Textual inversion embeddings | .pt, .bin files |

### Model Path Best Practices

1. **Absolute Paths**: Use absolute paths for reliability
2. **Multiple Paths**: Define multiple paths for flexibility
3. **Consistent Naming**: Follow ComfyUI naming conventions
4. **Organized Structure**: Group models by type and purpose

---

## hardware-profiles.yaml - Hardware Profiles

### Complete Configuration Example

```yaml
profiles:
  low-vram:
    name: "Low VRAM"
    description: "Optimized for systems with 4-8 GB VRAM"
    vram_limit_gb: 8
    optimizations:
      cpu_offload: true
      chunked_attention: true
      memory_efficient_attention: true
      quantize: false
    batch_settings:
      max_batch_size: 1
      enable_batch_processing: false
    quality_settings:
      steps: 12
      guidance: 5.0
      resolution: 512
    model_settings:
      disable_denoise: false
      disable_controlnet: false
      
  medium-vram:
    name: "Medium VRAM"
    description: "Optimized for systems with 8-16 GB VRAM"
    vram_limit_gb: 16
    optimizations:
      cpu_offload: false
      chunked_attention: true
      memory_efficient_attention: true
      quantize: false
    batch_settings:
      max_batch_size: 4
      enable_batch_processing: true
    quality_settings:
      steps: 20
      guidance: 7.0
      resolution: 768
    model_settings:
      disable_denoise: false
      disable_controlnet: false
      
  high-vram:
    name: "High VRAM"
    description: "Optimized for systems with 16+ GB VRAM"
    vram_limit_gb: 24
    optimizations:
      cpu_offload: false
      chunked_attention: false
      memory_efficient_attention: false
      quantize: false
    batch_settings:
      max_batch_size: 8
      enable_batch_processing: true
    quality_settings:
      steps: 30
      guidance: 7.5
      resolution: 1024
    model_settings:
      disable_denoise: false
      disable_controlnet: false
      
  ultra-vram:
    name: "Ultra VRAM"
    description: "Optimized for systems with 24+ GB VRAM"
    vram_limit_gb: 96
    optimizations:
      cpu_offload: false
      chunked_attention: false
      memory_efficient_attention: false
      quantize: false
    batch_settings:
      max_batch_size: 16
      enable_batch_processing: true
    quality_settings:
      steps: 50
      guidance: 8.0
      resolution: 1536
    model_settings:
      disable_denoise: false
      disable_controlnet: false

# Hardware detection settings
detection:
  enabled: true
  gpu_detection_method: "cuda"  # cuda, rocm, metal
  memory_threshold_percent: 90
  fallback_to_cpu: false

# Performance tuning
tuning:
  enable_cuda_graphs: true
  enable_tf32: true
  enable_flash_attention: true
  num_workers: 4
```

### Hardware Profile Options

#### Optimizations

| Option | Description | Impact |
|--------|-------------|--------|
| `cpu_offload` | Move models to CPU when not in use | Reduces VRAM, slower |
| `chunked_attention` | Process attention in chunks | Reduces peak VRAM |
| `memory_efficient_attention` | Use memory-efficient attention | Reduces VRAM, slower |
| `quantize` | Use quantized models | Reduces VRAM, may reduce quality |

#### Batch Settings

| Option | Description | Impact |
|--------|-------------|--------|
| `max_batch_size` | Maximum batch size | Higher = more VRAM |
| `enable_batch_processing` | Enable batch generation | More efficient |

#### Quality Settings

| Option | Description | Impact |
|--------|-------------|--------|
| `steps` | Number of inference steps | More = better quality, slower |
| `guidance` | CFG scale | Higher = more prompt following |
| `resolution` | Output resolution | Higher = more VRAM |

---

## categories.yaml - Category Definitions

### Complete Configuration Example

```yaml
categories:
  core-generation:
    name: "Core Generation"
    description: "Fundamental image generation workflows"
    icon: "wand"
    enabled: true
    workflows:
      - core.text-to-image-fast
      - core.text-to-image-quality
      - core.text-to-image-extreme
      - core.image-to-image
      - core.inpainting
      - core.outpainting-square-to-landscape
      - core.upscale-simple
    presets:
      - quality-fast
      - quality-balanced
      - quality-high
    hardware:
      min_vram_gb: 4
      recommended_vram_gb: 8
      
  character:
    name: "Character"
    description: "Character design and consistency workflows"
    icon: "user"
    enabled: true
    workflows:
      - character.portrait
      - character.full-body
      - character.character-sheet
      - character.expression-sheet
      - character.identity-consistency
    presets:
      - character-quick
      - character-detailed
      - character-reference
    hardware:
      min_vram_gb: 8
      recommended_vram_gb: 16
      
  image-editing:
    name: "Image Editing"
    description: "Image editing and enhancement workflows"
    icon: "edit"
    enabled: true
    workflows:
      - editing.background-removal
      - editing.background-replacement
      - editing.object-removal
      - editing.relighting
      - editing.face-repair
      - editing.hand-repair
    presets:
      - edit-quick
      - edit-detailed
    hardware:
      min_vram_gb: 6
      recommended_vram_gb: 12
      
  horror-gore:
    name: "Horror & Gore"
    description: "Horror, gore, and special effects workflows"
    icon: "skull"
    enabled: true
    workflows:
      - horror.battle-damage
      - horror.zombie-progression
      - horror.blood-overlay
      - horror.creature-mutation
    presets:
      - horror-subtle
      - horror-cinematic
      - horror-extreme
    hardware:
      min_vram_gb: 8
      recommended_vram_gb: 16
      content_warning: true
      
  video-animation:
    name: "Video & Animation"
    description: "Video generation and animation workflows"
    icon: "video"
    enabled: true
    workflows:
      - video.image-to-video
      - video.video-to-video
      - video.talking-head
      - video.frame-interpolation
    presets:
      - video-quick
      - video-quality
    hardware:
      min_vram_gb: 12
      recommended_vram_gb: 24
      
  three-d:
    name: "3D"
    description: "3D reconstruction and generation workflows"
    icon: "cube"
    enabled: true
    workflows:
      - three-d.image-to-mesh
      - three-d.multiview
      - three-d.depth-to-relief
    presets:
      - three-d-quick
      - three-d-quality
    hardware:
      min_vram_gb: 12
      recommended_vram_gb: 24

# Default categories (always visible)
defaults:
  enabled_categories: true
  show_unofficial_categories: false
  hide_adult_categories: false
```

### Category Fields

| Field | Type | Description |
|-------|------|-------------|
| `name` | string | Human-readable category name |
| `description` | string | Category description |
| `icon` | string | Icon name for UI |
| `enabled` | boolean | Whether category is enabled |
| `workflows` | array | List of workflow IDs |
| `presets` | array | Default presets for category |
| `hardware` | object | Hardware requirements |

---

## feature-flags.yaml - Feature Flags

### Complete Configuration Example

```yaml
# Feature Flags
features:
  # Core Features
  batch_processing:
    enabled: true
    max_batch_size: 16
    
  quality_control:
    enabled: true
    default_minimum_score: 0.75
    metrics:
      - prompt_adherence
      - anatomy_quality
      - face_quality
      - hand_quality
      
  workflow_registry:
    enabled: true
    auto_refresh: true
    refresh_interval: 300
    
  preset_system:
    enabled: true
    user_presets_enabled: true
    shared_presets_path: "./shared/presets"
    
  # Advanced Features
  batch_job_queue:
    enabled: true
    max_queue_size: 50
    default_priority: "normal"
    
  job_history:
    enabled: true
    max_history_size: 100
    retention_days: 30
    
  # Web Interface Features
  web_ui:
    enabled: true
    dark_mode_default: false
    show_advanced_options: true
    enable_drag_drop: true
    
  # API Features
  api:
    enabled: true
    rate_limiting_enabled: true
    api_keys_enabled: true
    webhooks_enabled: true
    
  # Developer Features
  developer_mode:
    enabled: false
    verbose_logging: false
    enable_debug_tools: false
    enable_schema_validation: true
    
  # Experimental Features
  experimental:
    enabled: false
    workflows:
      - llm.prompt-engineer
      - automation.best-of-n
      
  # Content Features
  content_warning:
    enabled: true
    show_adult_content: false
    require_adult_confirmation: true

# Plugin System
plugins:
  enabled: true
  plugin_path: "./plugins"
  auto_load_plugins: true
```

### Feature Flag Categories

#### Core Features

| Flag | Description | Default |
|------|-------------|---------|
| `batch_processing` | Enable batch job generation | true |
| `quality_control` | Enable quality assessment | true |
| `workflow_registry` | Enable workflow registry | true |
| `preset_system` | Enable preset system | true |

#### Advanced Features

| Flag | Description | Default |
|------|-------------|---------|
| `batch_job_queue` | Enable job queue system | true |
| `job_history` | Enable job history tracking | true |
| `web_ui` | Enable web interface | true |
| `api` | Enable REST API | true |

#### Developer Features

| Flag | Description | Default |
|------|-------------|---------|
| `developer_mode` | Enable developer tools | false |
| `verbose_logging` | Enable detailed logging | false |
| `enable_debug_tools` | Enable debug endpoints | false |

---

## Environment Variables

### Overview

Environment variables can override any configuration value.

### Configuration Variables

```bash
# Suite identification
export SUITE_NAME="AI Suite"
export SUITE_VERSION="2.0.0"

# Paths
export PATHS_WORKFLOWS="./workflows"
export PATHS_PACKS="./packs"
export PATHS_SHARED="./shared"

# Settings
export SETTINGS_DEFAULT_WIDTH=1024
export SETTINGS_DEFAULT_HEIGHT=1024
export SETTINGS_DEFAULT_STEPS=20
export SETTINGS_COMFYUI_PORT=8188
export SETTINGS_LAUNCHER_PORT=8000

# Logging
export LOGGING_LEVEL="info"
export LOGGING_FORMAT="json"
export LOGGING_FILE="./logs/suite.log"

# Security
export SECURITY_API_KEY="your-api-key"
export SECURITY_REQUIRE_AUTHENTICATION=false
```

### Common Environment Variables

#### ComfyUI Connection

```bash
export COMFYUI_HOST="127.0.0.1"
export COMFYUI_PORT="8188"
export COMFYUI_TIMEOUT="300"
```

#### Hardware Configuration

```bash
export HARDWARE_MIN_VRAM_GB="8"
export HARDWARE_RECOMMENDED_VRAM_GB="16"
export HARDWARE_FORCE_PROFILE="medium-vram"
```

#### Registry Configuration

```bash
export REGISTRY_AUTO_REFRESH="true"
export REGISTRY_REFRESH_INTERVAL="300"
```

### Setting Environment Variables

#### Linux/Mac

```bash
export VARIABLE_NAME="value"
```

#### Windows

```cmd
set VARIABLE_NAME=value
```

#### Docker

```yaml
# docker-compose.yml
environment:
  - SUITE_NAME=AI Suite
  - SETTINGS_LAUNCHER_PORT=8000
```

---

## Configuration Best Practices

### General Best Practices

1. **Use Comments**: Document your configuration choices
2. **Version Control**: Keep configs in version control
3. **Backup Configs**: Maintain backups before changes
4. **Test Changes**: Test configurations in development first
5. **Security**: Never commit sensitive credentials

### Configuration Management

#### Development vs Production

**Development**:
```yaml
settings:
  launcher_debug: true
  enable_batch_processing: false

logging:
  level: "debug"
```

**Production**:
```yaml
settings:
  launcher_debug: false
  enable_batch_processing: true

logging:
  level: "info"
```

#### Multi-Environment Setup

```bash
# Create environment-specific configs
config/
├── suite.development.yaml
├── suite.staging.yaml
└── suite.production.yaml

# Use environment variable
export SUITE_CONFIG="./config/suite.${ENVIRONMENT}.yaml"
```

### Security Recommendations

1. **API Keys**: Use strong, unique API keys
2. **CORS**: Restrict CORS to known domains
3. **Rate Limiting**: Enable rate limiting in production
4. **Authentication**: Require authentication for sensitive operations
5. **Logging**: Don't log sensitive information

### Performance Optimization

1. **Cache**: Enable caching for frequently accessed data
2. **Batch Processing**: Enable batch processing for efficiency
3. **Hardware Profiles**: Use appropriate hardware profiles
4. **Job Queue**: Configure queue size based on resources

### Troubleshooting

#### Configuration Not Applied

1. Check file permissions
2. Verify YAML syntax
3. Restart the launcher
4. Check logs for errors

#### Invalid Configuration

1. Validate YAML syntax
2. Check required fields
3. Verify data types
4. Review error messages

---

*For more configuration examples, check the `config/` directory in the repository and the `example/` directory for sample configurations.*