# Text to Image Extreme

High-quality text-to-image generation with 50 steps for maximum detail. Optimized for ultimate quality at the cost of longer generation time.

## Overview

This workflow provides the highest quality image generation with maximum detail, ideal for:
- Professional printing
- High-resolution displays
- Portfolio-quality work
- When every detail matters

## Specifications

- **Steps**: 50
- **Sampler**: DPM ++ 2M
- **CFG Scale**: 8.0 (higher for extreme detail)
- **Best For**: Professional printing, high-resolution work, portfolio pieces

## Hardware Requirements

- **Minimum VRAM**: 12 GB
- **Recommended VRAM**: 16 GB
- **Low VRAM Support**: Yes (with CPU offload)
- **CPU Offload**: Supported

## Input Parameters

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| prompt | text | required | Positive prompt describing the desired image |
| negative_prompt | text | optional | Negative prompt for undesirable elements |
| width | int | 1024 | Output image width in pixels |
| height | int | 1024 | Output image height in pixels |
| seed | int | -1 | Random seed (-1 for random) |
| cfg | float | 8.0 | Classifier-free guidance scale |
| checkpoint | model | sdxl | Checkpoint model to use |

## Model Compatibility

Supports multiple model families:
- SDXL (recommended)
- Flux
- SD 1.5
- SD 3
- Qwen Image
- Other ComfyUI-compatible models

## Presets

| Preset | Steps | CFG | Sampler | Use Case |
|--------|-------|-----|---------|----------|
| fast | 25 | 5.0 | dpmpp_2m | Quick drafts |
| balanced | 50 | 8.0 | dpmpp_2m | General extreme quality |
| quality | 75 | 8.5 | dpmpp_2m | Maximum detail |

## Example Prompt

```
masterpiece, best quality, ultra-detailed, 8k, highly detailed, photorealistic, cinematic lighting, masterpiece, award winning
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
4. Wait for generation (~30-60 seconds)
5. View the generated image in the Preview node

### API Usage

```bash
curl -X POST http://localhost:39000/workflows/core.text-to-image-extreme/run \
  -H "Content-Type: application/json" \
  -d '{
    "prompt": "A breathtaking view of the northern lights over a mountain lake",
    "width": 1920,
    "height": 1080,
    "cfg": 8.0
  }'
```

## Tips for Best Results

1. **Use highly descriptive prompts** - More detail leads to better results
2. **Higher CFG values** - 8.0 helps maintain prompt adherence
3. **Use SDXL or SD 1.5** - Best models for extreme quality
4. **Test with lower steps first** - Use the fast preset for iteration
5. **Upscale for printing** - Use extreme quality for high-res needs

## Performance

- **Generation Time**: ~30-60 seconds (depending on hardware)
- **Memory Usage**: ~6-8 GB VRAM
- **Batch Support**: Yes (batch size up to 2 for 16GB VRAM)

## See Also

- [Text to Image Fast](../text-to-image-fast) - For faster generation
- [Text to Image Quality](../text-to-image-quality) - For balanced quality
- [Text to Image Low VRAM](../text-to-image-low-vram) - For low memory systems
- [Text to Image Batch](../text-to-image-batch) - For batch processing