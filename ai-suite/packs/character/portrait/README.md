# Character Portrait

High-quality character portrait generation focusing on face and upper body.

## Overview

This workflow is optimized for detailed facial features, expressions, and character consistency. It's perfect for:
- Character design headshots
- Detailed facial portraits
- Expression-focused character art
- High-resolution face generation
- Consistent character appearances

## Specifications

- **Recommended Aspect Ratio**: 3:4 (768x1024, 896x1280, etc.)
- **Steps**: 25 (configurable)
- **Sampler**: DPM++ 2M
- **CFG Scale**: 7.0
- **Best For**: Detailed portraits, face-focused generation

## Hardware Requirements

- **Minimum VRAM**: 6 GB
- **Recommended VRAM**: 12 GB
- **Low VRAM Support**: Yes
- **CPU Offload**: Supported

## Input Parameters

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| prompt | text | required | Positive prompt describing the character portrait |
| negative_prompt | text | optional | Negative prompt for undesirable elements |
| width | int | 768 | Output image width in pixels |
| height | int | 1024 | Output image height in pixels |
| seed | int | -1 | Random seed (-1 for random) |
| cfg | float | 7.0 | Classifier-free guidance scale |
| steps | int | 25 | Number of inference steps |
| checkpoint | model | juggernaut-xl-v9.safetensors | Checkpoint model to use |
| reference_image | image | optional | Reference image for character consistency |

## Model Compatibility

Supports multiple model families:
- Flux
- SDXL
- SD 1.5
- SD 3
- Other ComfyUI-compatible models

## Presets

| Preset | Steps | CFG | Aspect Ratio | Use Case |
|--------|-------|-----|--------------|----------|
| quick | 15 | 5.0 | 3:4 | Fast generation |
| detailed | 35 | 8.0 | 3:4 | High quality, detailed |

## Example Prompts

### Positive
```
masterpiece, best quality, high resolution, detailed face, photorealistic, 8k, 
portrait of a young woman with blue eyes, long brown hair, wearing a white dress, 
looking at viewer, soft lighting, cinematic lighting
```

### Negative
```
low quality, worst quality, lowres, blurry, text, watermark, signature, cropped, 
out of frame, extra fingers, extra digits, mutated hands, fused fingers, extra arms, 
extra legs, malformed limbs, missing limbs, drawing, cartoon, graphic, 3d, render
```

## Usage

### Quick Start

1. Load the workflow in ComfyUI
2. Enter your character portrait prompt
3. Optionally load a reference image for consistency
4. Click "Queue Prompt"
5. View the generated portrait in the Preview node

### API Usage

```bash
curl -X POST http://localhost:8188/workflows/character.portrait/run \
  -H "Content-Type: application/json" \
  -d '{
    "prompt": "portrait of a young woman with blue eyes, long brown hair, wearing a white dress",
    "width": 768,
    "height": 1024,
    "cfg": 7.0,
    "steps": 25
  }'
```

## Tips for Best Results

1. **Use reference images** - Load a reference image for better character consistency
2. **Focus on facial details** - Include details about eyes, hair, facial features
3. **Control aspect ratio** - Use 3:4 or 9:16 for portrait orientation
4. **Use ControlNet** - Enable ControlNet for pose/depth guidance
5. **Face detailer** - Enable face detailer for enhanced facial features

## Performance

- **Generation Time**: ~10-25 seconds (depending on hardware)
- **Memory Usage**: ~4-8 GB VRAM
- **Batch Support**: Yes (batch size up to 4)

## See Also

- [Character Full Body](../full-body) - For full body character shots
- [Character Sheet](../character-sheet) - For multiple angles
- [Expression Sheet](../expression-sheet) - For facial expressions
- [Identity Consistency](../identity-consistency) - For identity preservation