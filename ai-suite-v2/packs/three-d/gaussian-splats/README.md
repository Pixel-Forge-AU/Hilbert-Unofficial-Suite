# Gaussian Splatting Workflow

Create 3D Gaussian splatting representations from images or multi-view inputs. Generates high-quality NeRF alternative representations with real-time rendering capabilities.

## Description

This workflow creates Gaussian splatting scenes by:
- Converting input images to Gaussian distributions
- Optimizing 3D position, scale, rotation, and SH coefficients
- Generating high-quality novel view synthesis
- Creating real-time renderable 3D assets

Perfect for creating photorealistic 3D representations from 2D inputs with real-time performance.

## Usage

### API

```
POST /api/v1/generate/three-d-gaussian-splats
```

### Presets

- **Quick**: Fast splat generation for preview
- **Balanced**: Good quality with reasonable computation
- **High-quality**: Maximum fidelity with full optimization

## Input Parameters

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| image | image | required | Input image for splatting |
| prompt | string | "" | Description for content guidance |
| views | integer | 1 | Number of views (for multi-view) |
| density | float | 1.0 | Splat density (0.5-2.0) |
| optimization_steps | integer | 500 | Optimization iterations |
| enable_sharpen | boolean | true | Enable post-processing sharpening |

## Models

### Required
- Splatting: gaussian-splatting, gaussian-generation
- Upscaler: real-esrgan (for high-res splats)

### Optional
- LoRA: splat-enhance, detail-preserve
- Multi-view: multi-view-consistency

## Hardware Requirements

- Minimum VRAM: 16 GB
- Recommended VRAM: 24 GB
- Supports Low VRAM mode
- High memory for large splat clouds

## Presets

### Quick
- Density: 0.7
- Steps: 200
- Resolution: 512
- Fast preview splats

### Balanced
- Density: 1.0
- Steps: 500
- Resolution: 1024
- Good quality splats

### High-quality
- Density: 1.5-2.0
- Steps: 1000
- Resolution: 2048
- Maximum fidelity optimization

## Example

```bash
curl -X POST http://localhost:8080/api/v1/generate/three-d-gaussian-splats \
  -H "Content-Type: application/json" \
  -d '{
    "image": "base64_image",
    "prompt": "cute robot character",
    "views": 4,
    "density": 1.0,
    "optimization_steps": 500
  }'
```

## Output

Gaussian splatting representations:
- **Splat Cloud**: PLY file with 3D Gaussians
- **Properties**: Position, scale, rotation, SH coefficients
- **Format**: PLY with binary encoding
- **Render**: Real-time view synthesis

## Supported Formats

- Input: JPEG, PNG, WebP
- Output: PLY (Gaussian splat format)
- Preview: WebP, PNG