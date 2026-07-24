# Character Expression Sheet Workflow

Facial expression sheet generation with multiple expressions. Optimized for character animation, expression reference, and facial expression documentation.

## Description

This workflow generates expression sheets containing multiple facial expressions:
- Happy
- Sad
- Angry
- Surprised
- Neutral
- And custom expressions

Perfect for character animation reference, facial expression documentation, and animation preparation.

## Usage

### API

```
POST /api/v1/generate/character-expression-sheet
```

### Presets

- **Quick**: Fast generation for quick reference
- **Detailed**: High-quality output with enhanced details

## Input Parameters

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| prompt | string | required | Positive prompt describing the character face |
| negative_prompt | string | "" | Negative prompt for undesirable elements |
| width | integer | 1024 | Output width in pixels |
| height | integer | 768 | Output height in pixels |
| seed | integer | -1 | Random seed (-1 for random) |
| cfg | number | 7.0 | Guidance scale |
| steps | integer | 30 | Number of inference steps |
| checkpoint | string | "juggernaut-xl-v9.safetensors" | Checkpoint model to use |
| expressions | string | "happy,sad,angry,surprised,neutral" | Comma-separated expressions |

## Models

### Required
- Checkpoint: juggernaut-xl-v9.safetensors, sdxl
- VAE: ae, vae-ft-mse-840000-ema-pruned

### Optional
- LoRA: character-style, expression-sheet
- ControlNet: face, pose

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
curl -X POST http://localhost:8080/api/v1/generate/character-expression-sheet \
  -H "Content-Type: application/json" \
  -d '{
    "prompt": "expression sheet of a young woman with blue eyes showing happy, sad, angry, surprised, and neutral expressions",
    "negative_prompt": "low quality, blurry, text, watermark",
    "width": 1024,
    "height": 768,
    "seed": 42,
    "cfg": 7.0,
    "steps": 30
  }'
```

## Output

Generated image with dimensions:
- Width: 512-4096 pixels
- Height: 512-4096 pixels
- Format: WEBP
- Contains: Multiple facial expressions in a grid layout