# Zombie Infection Progression

Generate zombie infection progression effects with customizable horror levels.

## Description

This workflow generates zombie infection progression effects with customizable levels of horror and gore elements.

## Usage

### API

```
POST /api/v1/generate/horror-zombie-progression
```

### Presets

Check the `presets/` directory for available preset configurations.

## Input Parameters

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| image | string | required | Base image to apply effects to |
| prompt | string | "" | Positive prompt for additional details |
| negative_prompt | string | "" | Negative prompt for undesirable elements |
| seed | integer | -1 | Random seed (-1 for random) |
| cfg | number | 7.0 | Guidance scale |
| steps | integer | 25 | Number of inference steps |

## Models

### Required
- Checkpoint: flux, sdxl, sd15, qwen, wan, hunyuan
- VAE: ae, vae-ft-mse-840000-ema-pruned

### Optional
- ControlNet: depth, canny, normal
- LoRA: overlay, texture

## Hardware Requirements

- Minimum VRAM: 12 GB
- Recommended VRAM: 24 GB
- Supports Low VRAM mode
- Supports CPU offload

## Example

```bash
curl -X POST http://localhost:8080/api/v1/generate/horror-zombie-progression \
  -H "Content-Type: application/json" \
  -d '{
    "image": "https://example.com/input.jpg",
    "prompt": "zombie-progression effects, horror atmosphere",
    "negative_prompt": "clean, normal, no effects",
    "seed": 42,
    "cfg": 7.0,
    "steps": 25
  }'
```

## Output

Generated image with dimensions:
- Width: 1024-2048 pixels (original image scaled)
- Height: 1024-2048 pixels (original image scaled)
- Format: WEBP
- Contains: zombie infection progression effects
