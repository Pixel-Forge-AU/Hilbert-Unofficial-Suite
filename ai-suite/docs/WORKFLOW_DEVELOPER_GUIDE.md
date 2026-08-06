# AI Suite - Workflow Developer Guide

## Table of Contents

- [Introduction](#introduction)
- [Manifest Structure Reference](#manifest-structure-reference)
- [Creating Workflow Packs](#creating-workflow-packs)
- [Moving and Removing Packs/Categories](#moving-and-removing-packscategories)
- [Defining Inputs and Outputs](#defining-inputs-and-outputs)
- [Adding Presets](#adding-presets)
- [Writing Prompt Templates](#writing-prompt-templates)
- [Testing Workflows](#testing-workflows)
- [Best Practices](#best-practices)
- [Workflow Template](#workflow-template)

---

## Introduction

This guide is for developers and creators who want to build workflows for AI Suite. Whether you're creating a new workflow from scratch or converting an existing ComfyUI workflow to the AI Suite format, this guide will help you.

### What You'll Learn

- How to create and structure workflow manifests
- How to define inputs and outputs
- How to create presets
- How to test workflows
- Best practices for workflow development
- How to submit workflows to the registry

### Prerequisites

- Basic understanding of ComfyUI workflow JSON format
- Experience with YAML and JSON
- Knowledge of AI generation concepts (prompts, models, etc.)
- ComfyUI installation for testing

---

## Manifest Structure Reference

### Complete Manifest Example

```yaml
# Basic workflow identification
id: character.character-sheet
name: Character Sheet
version: "1.0.0"

# Categorization
category: character
subcategory: character-sheet

# Description
description: >
  Character sheet generation with multiple angles (front, side, back).
  Optimized for character design documentation and reference sheets.
  Includes multiple views in a single composition.

# Workflow status
status: stable

# Entrypoint files
entrypoints:
  ui: workflow.json
  api: workflow-api.json

# Input parameters
inputs:
  - id: prompt
    type: text
    required: true
    description: Positive prompt describing the character
    
  - id: negative_prompt
    type: text
    required: false
    default: ""
    description: Negative prompt for undesirable elements
    
  - id: width
    type: int
    required: false
    default: 1536
    minimum: 768
    maximum: 4096
    step: 64
    description: Output image width in pixels
    
  - id: height
    type: int
    required: false
    default: 768
    minimum: 512
    maximum: 4096
    step: 64
    description: Output image height in pixels

# Output definitions
outputs:
  - id: image
    type: image
    description: Generated character sheet with multiple angles

# Model requirements
models:
  required:
    - role: checkpoint
      family:
        - flux
        - sdxl
        - sd15
        - sd3
    - role: vae
      suggested:
        - ae
        - vae-ft-mse-840000-ema-pruned

  optional:
    - role: lora
      suggested:
        - character-style
        - design-sheet
    - role: controlnet
      suggested:
        - pose
        - depth

# Custom node requirements
custom_nodes:
  required:
    - comfyui

  optional:
    - comfyui-impact-pack
    - comfyui-controlnet-aux

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
    - reference-sheet
    - multi-angle
    - documentation
  adult_only: false

# Tags for search and filtering
tags:
  - character-sheet
  - reference
  - multi-angle
  - character-design
  - documentation
  - 1536x768
  - 3-view
  - 4-view

# Available presets
presets:
  - quick
  - detailed
```

### Manifest Field Reference

#### Required Fields

| Field | Type | Description | Example |
|-------|------|-------------|---------|
| `id` | string | Unique workflow identifier | `character.character-sheet` |
| `name` | string | Human-readable name | `Character Sheet` |
| `version` | string | Semantic version | `1.0.0` |
| `category` | string | Category pack name | `character` |
| `description` | string | Detailed description | `Character sheet generation...` |
| `status` | enum | Workflow status | `stable`, `experimental` |
| `entrypoints` | object | Workflow file paths | `{ui: workflow.json, api: workflow-api.json}` |
| `inputs` | array | Input parameters | See examples below |
| `outputs` | array | Output parameters | See examples below |
| `models` | object | Model requirements | See examples below |
| `custom_nodes` | object | Custom node requirements | See examples below |
| `hardware` | object | Hardware requirements | See examples below |

#### Optional Fields

| Field | Type | Description | Example |
|-------|------|-------------|---------|
| `subcategory` | string | Subcategory | `character-sheet` |
| `tags` | array | Search tags | `["character", "reference"]` |
| `runtime` | object | Runtime properties | `{class: large, batch_supported: true}` |
| `content` | object | Content info | `{themes: [...], adult_only: false}` |
| `presets` | array | Available presets | `["quick", "detailed"]` |

---

## Creating Workflow Packs

### Pack Directory Structure

Each workflow belongs to a category pack. Create a new pack like this:

```
packs/
└── your-category/
    ├── pack-manifest.yaml
    └── workflow-name/
        ├── manifest.yaml
        ├── workflow.json
        ├── workflow-api.json
        ├── README.md
        ├── thumbnail.webp
        ├── presets/
        │   ├── quick.yaml
        │   └── detailed.yaml
        └── tests/
            ├── smoke-input.json
            └── expected-output.json
```

### Pack Manifest

Create `pack-manifest.yaml` in your category directory:

```yaml
id: your-category
name: Your Category Name
version: "1.0.0"

description: >
  Brief description of what this category contains.

workflows:
  - your-category.workflow-one
  - your-category.workflow-two
  - your-category.workflow-three

default_enabled: true
```

### Adding Your Pack to Registry

1. Place your pack in `packs/your-category/`
2. Create `pack-manifest.yaml` in that directory (see above) listing your workflow(s)
3. Rebuild registry:
   ```bash
   python -m tools registry
   ```

### Moving and Removing Packs/Categories

Once packs exist, use the `pack-mover` tool instead of hand-editing `pack-manifest.yaml`/`manifest.yaml` files and moving directories yourself — it keeps the `category:` field, the `workflows:` lists in both the old and new `pack-manifest.yaml`, and `registry.json` all in sync, and preserves git history via `git mv`/`git rm` when available.

```bash
# List packs grouped by category
python -m tools pack-mover list
python -m tools pack-mover list --category video-gen

# Move one or more packs to an existing category
python -m tools pack-mover move --pack video.image-to-video --to video-edit

# Move into a brand-new category (creates its pack-manifest.yaml)
python -m tools pack-mover move --pack video.new-thing --to video-fx \
    --category-name "Video FX" --category-description "Stylistic video effects"

# Delete a pack entirely
python -m tools pack-mover remove --pack video.old-thing

# Delete an empty category (fails if it still contains packs)
python -m tools pack-mover remove-category --category video-fx
```

Notes:

- `--pack` is repeatable on `move` and `remove` to operate on several packs in one call.
- `move`/`remove`/`remove-category` rebuild `registry.json` automatically afterward; pass `--no-rebuild-registry` to batch several commands and rebuild once at the end with `python -m tools registry`.
- Restart Studio after any pack-mover command that rebuilds the registry so it picks up the new `registry.json`.
- `remove-category` refuses to run while packs remain in that category — move or remove them first.

---

## Defining Inputs and Outputs

### Input Types

#### Text Input

```yaml
inputs:
  - id: prompt
    type: text
    required: true
    default: ""
    description: Positive prompt describing the subject
    placeholder: "A detailed description of the subject"
```

#### Number Inputs

```yaml
inputs:
  - id: width
    type: int
    required: false
    default: 1024
    minimum: 256
    maximum: 4096
    step: 64
    description: Output image width in pixels
    
  - id: cfg
    type: float
    required: false
    default: 7.0
    minimum: 1.0
    maximum: 20.0
    step: 0.5
    description: Classifier-free guidance scale
```

#### Boolean Input

```yaml
inputs:
  - id: high_quality
    type: boolean
    required: false
    default: true
    description: Enable high quality settings
```

#### Model Input

```yaml
inputs:
  - id: checkpoint
    type: model
    required: false
    default: "flux"
    description: Checkpoint model to use
```

#### Image Input

```yaml
inputs:
  - id: source_image
    type: image
    required: true
    description: Source image for processing
```

#### Mask Input

```yaml
inputs:
  - id: mask
    type: mask
    required: true
    description: Region to modify
```

### Output Types

```yaml
outputs:
  - id: image
    type: image
    description: Generated output image
    
  - id: mask
    type: mask
    description: Generated mask
    
  - id: metadata
    type: metadata
    description: Generation metadata
```

### Input Best Practices

1. **Use clear IDs**: `prompt`, `negative_prompt`, `width`, `height`
2. **Provide defaults**: Always set sensible defaults
3. **Set constraints**: Use minimum/maximum for numeric values
4. **Add descriptions**: Explain what each input does
5. **Mark required**: Set `required: true` for mandatory inputs

---

## Adding Presets

### Preset File Structure

Create preset files in `workflow-name/presets/`:

```yaml
# quick.yaml
id: quick
name: Quick

description: Fast generation with lower quality settings for quick drafts.

settings:
  steps: 8
  guidance: 5.0
  sampler: dpmpp_2m
  scheduler: normal

generation:
  width: 512
  height: 512
  batch_size: 1

quality_control:
  enabled: false
```

```yaml
# detailed.yaml
id: detailed
name: Detailed

description: High quality settings for final outputs.

settings:
  steps: 30
  guidance: 7.5
  sampler: dpmpp_2m
  scheduler: karras

generation:
  width: 1024
  height: 1024
  batch_size: 1

quality_control:
  enabled: true
  minimum_score: 0.8
```

### Preset Types

#### Quality Presets

```yaml
# quality-fast.yaml
id: quality-fast
name: Fast Quality

generation:
  steps: 12
  guidance: 5.0

settings:
  sampler: dpmpp_2m
```

#### Hardware Presets

```yaml
# hardware-low-vram.yaml
id: hardware-low-vram
name: Low VRAM

hardware:
  vram_optimization: true
  cpu_offload: true
  batch_size: 1
```

#### Style Presets

```yaml
# style-realistic.yaml
id: style-realistic
name: Realistic

prompt:
  positive: "realistic, photorealistic, high detail, 8k"
  negative: "cartoon, anime, illustration, drawing"
```

---

## Writing Prompt Templates

### Basic Prompt Template

```yaml
# prompts/positive.txt
portrait of a {{character}}, {{style}}, {{lighting}}, masterpiece, 8k, highly detailed

# prompts/negative.txt
blurry, low quality, deformed, bad anatomy, extra limbs, disfigured, low contrast
```

### Dynamic Prompt Template

```yaml
# prompts/dynamic.txt
{{subject}}, {{style}}, {{environment}}, {{lighting}}, {{quality}}

# Example substitutions:
# subject: "a beautiful landscape"
# style: "cinematic lighting"
# environment: "mountain range at sunset"
# lighting: "golden hour lighting"
# quality: "masterpiece, 8k"
```

### Template Variables

```yaml
variables:
  character:
    type: text
    description: Character description
  style:
    type: text
    description: Artistic style
  environment:
    type: text
    description: Scene environment
  lighting:
    type: text
    description: Lighting conditions
  quality:
    type: text
    description: Quality keywords
```

### Preset-Specific Prompts

```yaml
# presets/character-pose.yaml
id: character-pose
name: Character Pose

presets:
  - id: 3-view
    prompt: "character design sheet, 3-view, front, side, back, clean lines"
  - id: 4-view
    prompt: "character design sheet, 4-view, front, side, back, 3/4, clean lines"
```

---

## Testing Workflows

### Smoke Test Structure

Create smoke tests in `workflow-name/tests/`:

```json
// smoke-input.json
{
  "prompt": "a simple test image",
  "width": 512,
  "height": 512,
  "steps": 4,
  "guidance": 1.0
}
```

```json
// expected-output.json
{
  "min_width": 512,
  "max_width": 512,
  "min_height": 512,
  "max_height": 512,
  "valid_extensions": [".webp", ".png", ".jpg"]
}
```

### Validation Test

```bash
# Validate workflow manifest
python tools/validate_workflows.py --workflow your-category.workflow-name

# Run smoke test
python tools/validate_workflows.py --workflow your-category.workflow-name --smoke

# Validate all workflows
python tools/validate_workflows.py --all
```

### Testing Checklist

- [ ] Manifest validates against schema
- [ ] Required files exist
- [ ] Dependencies are declared
- [ ] Smoke test runs successfully
- [ ] Output matches expected format
- [ ] Missing model handling works
- [ ] Low VRAM mode works
- [ ] API workflow is valid

---

## Best Practices

### Manifest Best Practices

1. **Use Consistent IDs**: Follow pattern `category.workflow-name`
2. **Document Everything**: Add descriptions to all fields
3. **Version Control**: Increment version for changes
4. **Set Status Correctly**: Use experimental for new workflows
5. **Add Tags**: Use relevant tags for discovery
6. **Test Thoroughly**: Validate before submission

### Input/Output Best Practices

1. **Clear Names**: Use descriptive input/output IDs
2. **Type Safety**: Use correct types for inputs
3. **Constraints**: Set reasonable minimum/maximum values
4. **Defaults**: Provide sensible defaults
5. **Documentation**: Add descriptions for all inputs/outputs

### Performance Best Practices

1. **Optimize for Hardware**: Support low VRAM mode
2. **Efficient Workflows**: Minimize unnecessary nodes
3. **Batch Support**: Enable batch processing when possible
4. **Progress Tracking**: Include progress updates
5. **Error Handling**: Graceful failure with clear messages

### Documentation Best Practices

1. **README Files**: Document each workflow
2. **Example Outputs**: Include example images
3. **Preset Examples**: Show preset usage
4. **Troubleshooting**: Document common issues
5. **Version History**: Note changes in versions

### Code Quality Best Practices

1. **Clean JSON**: Format workflow JSON files
2. **Consistent Naming**: Use consistent naming conventions
3. **Modular Design**: Create reusable subgraphs
4. **Parameterization**: Use variables for frequently changed values
5. **Comments**: Add comments for complex sections

### Security Best Practices

1. **Input Validation**: Validate all user inputs
2. **Path Sanitization**: Sanitize file paths
3. **Error Masking**: Hide sensitive error details
4. **Resource Limits**: Set reasonable limits
5. **Access Control**: Secure workflow access

---

## Workflow Template

### Complete Workflow Template

```yaml
# workflow-name/manifest.yaml
id: category.workflow-name
name: Workflow Name
version: "1.0.0"

category: category
subcategory: workflow-type

description: >
  Detailed description of the workflow's purpose and functionality.
  Include what it does, how it works, and any special features.

status: experimental  # Change to stable when ready

entrypoints:
  ui: workflow.json
  api: workflow-api.json

inputs:
  - id: prompt
    type: text
    required: true
    description: Positive prompt describing the desired output

  - id: negative_prompt
    type: text
    required: false
    default: ""
    description: Elements to avoid in the output

  - id: width
    type: int
    required: false
    default: 1024
    minimum: 256
    maximum: 4096
    step: 64
    description: Output image width

  - id: height
    type: int
    required: false
    default: 1024
    minimum: 256
    maximum: 4096
    step: 64
    description: Output image height

  - id: seed
    type: int
    required: false
    default: -1
    minimum: -1
    maximum: 1152921504606846975
    description: Random seed for reproducibility (-1 for random)

  - id: steps
    type: int
    required: false
    default: 30
    minimum: 1
    maximum: 100
    step: 1
    description: Number of inference steps

  - id: guidance
    type: float
    required: false
    default: 7.0
    minimum: 1.0
    maximum: 20.0
    step: 0.5
    description: Classifier-free guidance scale

  - id: checkpoint
    type: model
    required: false
    default: "flux"
    description: Checkpoint model to use

outputs:
  - id: image
    type: image
    description: Generated output image

  - id: metadata
    type: metadata
    description: Generation metadata including seed, steps, etc.

models:
  required:
    - role: checkpoint
      family:
        - flux
        - sdxl
        - sd15
        - sd3
    - role: vae
      suggested:
        - ae
        - vae-ft-mse-840000-ema-pruned

  optional:
    - role: lora
      suggested:
        - style-lora
        - detail-lora
    - role: controlnet
      suggested:
        - pose
        - depth

custom_nodes:
  required:
    - comfyui

  optional:
    - comfyui-impact-pack
    - comfyui-controlnet-aux
    - comfyui-custom-nodes

hardware:
  minimum_vram_gb: 8
  recommended_vram_gb: 16
  supports_low_vram: true
  supports_cpu_offload: true

runtime:
  class: medium
  batch_supported: true

content:
  themes:
    - theme-one
    - theme-two
  adult_only: false

tags:
  - tag-one
  - tag-two
  - workflow-type

presets:
  - quick
  - detailed
```

### README Template

```markdown
# Workflow Name

Brief description of what this workflow does.

## Features

- Feature one
- Feature two
- Feature three

## Requirements

- Required models: Checkpoint, VAE
- Optional models: LoRA, ControlNet
- Custom nodes: comfyui

## Usage

1. Select workflow in launcher
2. Configure inputs
3. Choose preset
4. Click Run

## Presets

- **Quick**: Fast generation for drafts
- **Detailed**: High quality for final outputs

## Input Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| prompt | text | Yes | - | Positive prompt |
| width | int | No | 1024 | Output width |
| height | int | No | 1024 | Output height |

## Troubleshooting

Common issues and solutions.

## Example Output

![Example](../thumbnail.webp)
```

---

## Submitting Workflows

### Pre-Submission Checklist

- [ ] Manifest validates against schema
- [ ] Workflow JSON files are valid
- [ ] Smoke tests pass
- [ ] Documentation is complete
- [ ] Example outputs are included
- [ ] Dependencies are documented
- [ ] Presets are created
- [ ] README is complete

### Submission Process

1. Fork the repository
2. Create a branch for your workflow
3. Add your workflow to appropriate category
4. Update registry files
5. Test thoroughly
6. Submit a pull request

### Pull Request Template

```
## Workflow Submission

**Workflow Name**: 
**Category**: 
**Description**: 

## Checklist

- [ ] Manifest validates
- [ ] Workflow tested
- [ ] Documentation complete
- [ ] Smoke tests pass

## Dependencies

- Required models:
- Optional models:
- Custom nodes:

## Testing

- Tested with Flux models: Yes/No
- Tested with SDXL models: Yes/No
- Low VRAM mode: Yes/No
```

---

*For more examples, check existing workflows in the `packs/` directory. Each workflow includes a complete manifest, examples, and documentation.*