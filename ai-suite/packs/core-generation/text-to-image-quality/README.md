# Text to Image Quality

Balanced text-to-image generation with 25 steps for high-quality results. Optimized for good quality with reasonable generation time.

## Overview

This workflow provides a balance between quality and speed, making it ideal for:
- Professional work
- Web images and social media
- General purpose generation
- When you need consistently good results

## Specifications

- **Steps**: 25
- **Sampler**: DPM++ 2M
- **CFG Scale**: 7.0 (balanced for quality)
- **Best For**: Professional use, web images, social media

## Hardware Requirements

- **Minimum VRAM**: 8 GB
- **Recommended VRAM**: 12 GB
- **Low VRAM Support**: Yes
- **CPU Offload**: Supported

## Input Parameters

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| prompt | text | required | Positive prompt describing the desired image |
| negative_prompt | text | optional | Negative prompt for undesirable elements |
| width | int | 1024 | Output image width in pixels |
| height | int | 1024 | Output image height in pixels |
| seed | int | -1 | Random seed (-1 for random) |
| cfg | float | 7.0 | Classifier-free guidance scale |
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
| fast | 12 | 2.0 | euler | Quick drafts, thumbnails |
| balanced | 25 | 7.0 | dpmpp_2m | General use |
| quality | 35 | 7.5 | dpmpp_2m | Higher quality |

## Example Prompt

```
masterpiece, best quality, high resolution, detailed, professional, 8k, highly detailed
```

## Negative Prompt

```
low quality, worst quality, normal quality, lowres, blurry, text, watermark, signature, cropped, out of frame, extra fingers, extra digits, mutated hands, fused fingers, extra arms, extra legs
```

## Usage

### Quick Start

1. Load the workflow in ComfyUI
2. Enter your prompt
3. Click "Queue Prompt"
4. View the generated image in the Preview node

### API Usage

```bash
curl -X POST http://localhost:8188/workflows/core.text-to-image-quality/run \
  -H "Content-Type: application/json" \
  -d '{
    "prompt": "A beautiful sunset over the mountains",
    "width": 1024,
    "height": 1024,
    "cfg": 7.0
  }'
```

## Tips for Best Results

1. **Use descriptive prompts** - More detail leads to better results
2. **Balance CFG** - 7.0 is a good starting point for most prompts
3. **Use SDXL models** - For best quality with this workflow
4. **Try different seeds** - For variations on the same prompt
5. **Preview first** - Use the preview node to check results

## Performance

- **Generation Time**: ~10-30 seconds (depending on hardware)
- **Memory Usage**: ~4-6 GB VRAM
- **Batch Support**: Yes (batch size up to 4)

## See Also

- [Text to Image Fast](../text-to-image-fast) - For faster generation
- [Text to Image Extreme](../text-to-image-extreme) - For maximum quality
- [Text to Image Low VRAM](../text-to-image-low-vram) - For low memory systems