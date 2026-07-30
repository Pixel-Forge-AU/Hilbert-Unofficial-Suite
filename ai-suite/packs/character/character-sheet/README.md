# Character Sheet Workflow

Character sheet generation with multiple angles (front, side, back). Optimized for character design documentation and reference sheets.

## Description

This workflow generates character reference sheets with multiple views including:
- Front view
- Side view  
- Back view
- Optional 4-view layouts

Perfect for character design documentation, game asset preparation, and animation reference sheets.

## Usage

### API

```
POST /api/v1/generate/character-character-sheet
```

### Presets

- **Quick**: Fast generation for quick reference
- **Detailed**: High-quality output with enhanced details

## Input Parameters

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| prompt | string | required | Positive prompt describing the character |
| negative_prompt | string | "" | Negative prompt for undesirable elements |
| width | integer | 1536 | Output width in pixels |
| height | integer | 768 | Output height in pixels |
| seed | integer | -1 | Random seed (-1 for random) |
| cfg | number | 7.0 | Guidance scale |
| steps | integer | 30 | Number of inference steps |
| checkpoint | string | "juggernaut-xl-v9.safetensors" | Checkpoint model to use |
| view_configuration | string | "3-view" | Layout: 3-view, 4-view, or character-design |

## Models

### Required
- Checkpoint: juggernaut-xl-v9.safetensors, sdxl
- VAE: ae, vae-ft-mse-840000-ema-pruned

### Optional
- LoRA: character-style, design-sheet
- ControlNet: pose, depth

## Hardware Requirements

- Minimum VRAM: 8 GB
- Recommended VRAM: 16 GB
- Supports Low VRAM mode
- Supports CPU offload

## Presets

### Quick
- Steps: 20
- CFG: 6.0
- Resolution: 1024x768
- Fast generation

### Detailed
- Steps: 40
- CFG: 8.0
- Resolution: 1024x768
- High quality with upscaling and face restoration

## Example

```bash
curl -X POST http://localhost:8080/api/v1/generate/character-character-sheet \
  -H "Content-Type: application/json" \
  -d '{
    "prompt": "character design sheet with 3-view: front, side, back views of a young warrior with silver armor",
    "negative_prompt": "low quality, blurry, text, watermark",
    "width": 1536,
    "height": 768,
    "seed": 42,
    "cfg": 7.0,
    "steps": 30
  }'
```

## Output

Generated image with dimensions:
- Width: 1536-4096 pixels
- Height: 768-4096 pixels
- Format: WEBP
- Contains: Multiple character angles in a single composition