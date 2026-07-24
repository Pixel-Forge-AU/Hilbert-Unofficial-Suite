# Text to Image Batch

Batch processing support for generating multiple images from prompts. Perfect for exploring variations and creating image collections.

## Overview

This workflow allows you to generate multiple images in a single run, ideal for:
- Exploring prompt variations
- Creating image collections
- Generating multiple assets at once
- Finding the best result quickly

## Specifications

- **Steps**: 25
- **Sampler**: DPM ++ 2M
- **CFG Scale**: 8.0
- **Batch Support**: Yes (up to 16 images)
- **Best For**: Creating collections, exploring variations

## Hardware Requirements

- **Minimum VRAM**: 8 GB
- **Recommended VRAM**: 12 GB
- **Low VRAM Support**: No (batch mode requires full VRAM)
- **CPU Offload**: Supported (may reduce batch size)

## Input Parameters

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| prompt | text | required | Positive prompt describing the desired image |
| negative_prompt | text | optional | Negative prompt for undesirable elements |
| width | int | 1024 | Output image width in pixels |
| height | int | 1024 | Output image height in pixels |
| batch_size | int | 4 | Number of images to generate (1-16) |
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

| Preset | Steps | CFG | Sampler | Batch Size | Use Case |
|--------|-------|-----|---------|------------|----------|
| fast | 20 | 6.0 | dpmpp_2m | 8 | Quick batch drafts |
| balanced | 25 | 8.0 | dpmpp_2m | 4 | General batch generation |
| quality | 35 | 8.5 | dpmpp_2m | 2 | High-quality batches |

## Example Prompt

```
masterpiece, best quality, high resolution, detailed, professional, 8k, ultra-detailed
```

## Negative Prompt

```
low quality, worst quality, normal quality, lowres, blurry, text, watermark, logo, signature, cropped, out of frame, extra fingers, extra digits, mutated hands, fused fingers, extra arms, extra legs, malformed limbs, missing limbs, drawing, painting, cartoon, graphic, 3d, render
```

## Usage

### Quick Start

1. Load the workflow in ComfyUI
2. Enter your prompt
3. Set batch_size to desired number (up to 16)
4. Click "Queue Prompt"
5. Wait for all images to generate
6. View all generated images in the Preview node

### API Usage

```bash
curl -X POST http://localhost:8188/workflows/core.text-to-image-batch/run \
  -H "Content-Type: application/json" \
  -d '{
    "prompt": "A beautiful sunset over the ocean",
    "batch_size": 4,
    "width": 1024,
    "height": 1024
  }'
```

## Batch Processing Tips

1. **Start with smaller batches** - Test with 2-4 images first
2. **Use lower resolution** - Reduces VRAM per image
3. **Monitor VRAM** - 16GB VRAM can handle ~4-6 images at 1024x1024
4. **Sequential saving** - Images save one at a time to reduce memory
5. **Auto-reduce on OOM** - System automatically reduces batch size if needed

## Performance

- **Generation Time**: ~15-30 seconds per image
- **Total Time**: ~60-120 seconds for batch of 4
- **Memory Usage**: ~8-12 GB VRAM (scales with batch size)
- **Batch Support**: Up to 16 images (depends on VRAM)

## Output Files

Images are saved with timestamps and can be:
- Saved individually
- Saved as a sequence
- Saved in a batch folder

## See Also

- [Text to Image Fast](../text-to-image-fast) - For single fast generation
- [Text to Image Quality](../text-to-image-quality) - For single high-quality
- [Text to Image Extreme](../text-to-image-extreme) - For single extreme quality
- [Text to Image Low VRAM](../text-to-image-low-vram) - For low memory systems