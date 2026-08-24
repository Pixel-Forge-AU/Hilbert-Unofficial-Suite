# Text to Image Fast

Fast text-to-image generation with 12 steps for quick drafts, thumbnails, and concept art.

## Overview

This workflow is optimized for speed while maintaining acceptable quality. It's perfect for:
- Rapid prototyping and concept art
- Thumbnail generation
- Quick iterations on ideas
- Low-resource hardware
- Testing prompt concepts

## Specifications

- **Steps**: 12
- **Sampler**: Euler
- **CFG Scale**: 2.0 (lower for faster generation)
- **Best For**: Drafting, thumbnails, quick iterations

## Hardware Requirements

- **Minimum VRAM**: 4 GB
- **Recommended VRAM**: 8 GB
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
| cfg | float | 2.0 | Classifier-free guidance scale |
| checkpoint | model | juggernaut-xl-v9.safetensors | Checkpoint model to use |

## Model Compatibility

Supports multiple model families:
- Flux
- SDXL
- SD 1.5
- SD 3
- SDXL-Lightning
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
masterpiece, best quality, high resolution, detailed, professional
```

## Negative Prompt

```
low quality, worst quality, lowres, blurry, text, watermark, signature, cropped, out of frame, extra fingers, extra digits, mutated hands, fused fingers, extra arms, extra legs
```

## Usage

### Quick Start

1. Load the workflow in ComfyUI
2. Enter your prompt
3. Click "Queue Prompt"
4. View the generated image in the Preview node

### API Usage

```bash
curl -X POST http://localhost:39000/workflows/core.text-to-image-fast/run \
  -H "Content-Type: application/json" \
  -d '{
    "prompt": "A futuristic city in the clouds",
    "width": 1024,
    "height": 1024,
    "cfg": 2.0
  }'
```

## Tips for Best Results

1. **Use simple prompts** - This workflow is optimized for quick generation
2. **Lower CFG** - The default CFG of 2.0 provides faster generation
3. **Batch processing** - Can process multiple images simultaneously
4. **Low VRAM mode** - Enable for systems with limited VRAM
5. **Preview first** - Use the preview node to check results before saving

## Performance

- **Generation Time**: ~5-15 seconds (depending on hardware)
- **Memory Usage**: ~2-4 GB VRAM
- **Batch Support**: Yes (batch size up to 8)

## See Also

- [Text to Image Quality](../text-to-image-quality) - For higher quality results
- [Text to Image Extreme](../text-to-image-extreme) - For maximum quality
- [Text to Image Low VRAM](../text-to-image-low-vram) - For low memory systems
