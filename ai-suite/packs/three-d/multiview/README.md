# Multiview Generation Workflow

Generate multiple camera views of a 3D subject for 3D reconstruction. Creates consistent multi-view imagery for NeRF, Gaussian splatting, and other 3D reconstruction techniques.

## Description

This workflow generates multiple consistent camera views of a 3D subject including:
- Front, side, back, and top-down views
- 4-view, 6-view, or circular arrangements
- Consistent lighting and style across all views
- Cross-view consistency enforcement

Perfect for NeRF training, Gaussian splatting, and multi-view reconstruction pipelines.

## Usage

### API

```
POST /api/v1/generate/three-d-multiview
```

### Presets

- **Quick**: Fast view generation for prototyping
- **Balanced**: Good consistency with reasonable computation
- **High-quality**: Maximum view consistency and detail

## Input Parameters

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| prompt | string | required | Positive prompt describing the 3D subject |
| negative_prompt | string | "" | Negative prompt for undesirable elements |
| views | string | "4-view" | View arrangement: 4-view, 6-view, 8-view, circular |
| width | integer | 1024 | Output image width (512-2048) |
| height | integer | 1024 | Output image height (512-2048) |
| consistency_strength | number | 0.7 | Cross-view consistency (0.1-1.0) |

## Models

### Required
- Checkpoint: flux, sdxl, sd15
- ControlNet: depth, pose, canny

### Optional
- LoRA: 3d-style, multi-view
- Upscaler: real-esrgan, swinir

## Hardware Requirements

- Minimum VRAM: 16 GB
- Recommended VRAM: 24 GB
- Supports Low VRAM mode
- Supports CPU offload

## Presets

### Quick
- Views: 4-view
- Resolution: 512x512
- Steps: 20
- Consistency: 0.5

### Balanced
- Views: 4-view or 6-view
- Resolution: 1024x1024
- Steps: 30
- Consistency: 0.7

### High-quality
- Views: 6-view or 8-view
- Resolution: 2048x2048
- Steps: 40-50
- Consistency: 0.9

## Example

```bash
curl -X POST http://localhost:8080/api/v1/generate/three-d-multiview \
  -H "Content-Type: application/json" \
  -d '{
    "prompt": "3D model of a cute robot character",
    "negative_prompt": "blurry, low quality, artifacts",
    "views": "4-view",
    "width": 1024,
    "height": 1024,
    "consistency_strength": 0.7
  }'
```

## Output

Generated multi-view images:
- **Layout**: Grid or circular arrangement
- **Views**: 4, 6, or 8 camera angles
- **Format**: WEBP
- **Resolution**: 512x512 to 2048x2048
- **Consistency**: Enforced across all views