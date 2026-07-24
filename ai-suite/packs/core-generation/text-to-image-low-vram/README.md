# Text to Image Low VRAM

Optimized text-to-image generation for low VRAM systems. Uses CPU offloading and memory-efficient settings.

## Overview

This workflow is designed for systems with limited VRAM (4-6 GB), making it perfect for:
- Budget gaming laptops
- Older GPUs with limited memory
- Cloud instances with low VRAM
- Portable setups

## Specifications

- **Steps**: 25 (can be increased for quality)
- **Sampler**: Euler
- **CFG Scale**: 7.0 (moderate for memory efficiency)
- **Best For**: Low VRAM systems, portable setups, budget hardware

## Hardware Requirements

- **Minimum VRAM**: 4 GB
- **Recommended VRAM**: 6 GB
- **Low VRAM Support**: Yes (enabled by default)
- **CPU Offload**: Supported and recommended

## Input Parameters

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| prompt | text | required | Positive prompt describing the desired image |
| negative_prompt | text | optional | Negative prompt for undesirable elements |
| width | int | 768 | Output image width in pixels |
| height | int | 768 | Output image height in pixels |
| seed | int | -1 | Random seed (-1 for random) |
| cfg | float | 7.0 | Classifier-free guidance scale |
| checkpoint | model | sdxl | Checkpoint model to use |

## Model Compatibility

Supports multiple model families:
- SDXL (recommended)
- Flux
- SD 1.5 (recommended for very low VRAM)
- SD 3 (with CPU offload)
- Qwen Image
- Other ComfyUI-compatible models

## Presets

| Preset | Steps | CFG | Sampler | VRAM Usage | Use Case |
|--------|-------|-----|---------|------------|----------|
| fast | 15 | 5.0 | euler | ~3 GB | Quick drafts |
| balanced | 25 | 7.0 | euler | ~4-5 GB | General low VRAM |
| quality | 35 | 7.5 | euler | ~5-6 GB | Better quality |

## Example Prompt

```
masterpiece, best quality, high resolution, detailed, professional, photorealistic, cinematic lighting
```

## Negative Prompt

```
low quality, worst quality, normal quality, lowres, blurry, text, watermark, logo, signature, cropped, out of frame, extra fingers, extra digits, mutated hands, fused fingers, extra arms, extra legs, malformed limbs, missing limbs, drawing, painting, cartoon, graphic, 3d, render
```

## Usage

### Quick Start

1. Load the workflow in ComfyUI
2. Enter your prompt
3. Click "Queue Prompt"
4. Wait for generation (~10-20 seconds)
5. View the generated image in the Preview node

### API Usage

```bash
curl -X POST http://localhost:8188/workflows/core.text-to-image-low-vram/run \
  -H "Content-Type: application/json" \
  -d '{
    "prompt": "A peaceful forest path with sunlight filtering through trees",
    "width": 768,
    "height": 768,
    "cfg": 7.0
  }'
```

## Memory Optimization Features

- **CPU Offloading**: Automatically offloads models to CPU when VRAM is low
- **Tiling**: Processes images in tiles for large outputs
- **Efficient Samplers**: Uses simpler samplers that require less memory
- **Reduced Precision**: Uses 16-bit precision when possible

## Tips for Low VRAM Systems

1. **Use smaller resolutions** - 512x512 or 768x768 work best
2. **Use SD 1.5 models** - They require less memory than SDXL
3. **Enable CPU offload** - In ComfyUI settings
4. **Close other applications** - Free up system RAM
5. **Use smaller batch sizes** - Batch size of 1 recommended

## Performance

- **Generation Time**: ~10-20 seconds (depending on hardware)
- **Memory Usage**: ~3-6 GB VRAM
- **CPU Usage**: Higher during offloading
- **Batch Support**: No (disabled for memory efficiency)

## See Also

- [Text to Image Fast](../text-to-image-fast) - For faster generation
- [Text to Image Quality](../text-to-image-quality) - For balanced quality
- [Text to Image Extreme](../text-to-image-extreme) - For maximum quality
- [Text to Image Batch](../text-to-image-batch) - For batch processing