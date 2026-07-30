# Character Full Body

Full body character generation with proper proportions and pose.

## Overview

This workflow is optimized for full body character designs with proper proportions. It's perfect for:
- Character design reference sheets
- Full body portraits
- Cosplay reference generation
- Character pose studies
- Full-length character art

## Specifications

- **Recommended Aspect Ratio**: 2:3 (512x768, 640x960, 768x1152, etc.)
- **Steps**: 25 (configurable)
- **Sampler**: DPM ++ 2M
- **CFG Scale**: 7.0
- **ControlNet Support**: Pose, Depth
- **Best For**: Full body, pose-focused generation

## Hardware Requirements

- **Minimum VRAM**: 6 GB
- **Recommended VRAM**: 12 GB
- **Low VRAM Support**: Yes
- **CPU Offload**: Supported

## Input Parameters

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| prompt | text | required | Positive prompt describing the full body character |
| negative_prompt | text | optional | Negative prompt for undesirable elements |
| width | int | 512 | Output image width in pixels |
| height | int | 768 | Output image height in pixels |
| seed | int | -1 | Random seed (-1 for random) |
| cfg | float | 7.0 | Classifier-free guidance scale |
| steps | int | 25 | Number of inference steps |
| checkpoint | model | juggernaut-xl-v9.safetensors | Checkpoint model to use |
| pose_image | image | optional | Pose reference image for ControlNet |

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
| quick | 15 | 5.0 | 2:3 | Fast generation |
| detailed | 35 | 8.0 | 2:3 | High quality, detailed |

## Example Prompts

### Positive
```
masterpiece, best quality, high resolution, full body, detailed, photorealistic, 8k,
full body portrait of a young warrior with silver armor, standing pose, 
dynamic lighting, cinematic composition, looking at viewer
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
2. Enter your full body character prompt
3. Optionally load a pose reference image for ControlNet
4. Click "Queue Prompt"
5. View the generated image in the Preview node

### API Usage

```bash
curl -X POST http://localhost:39000/workflows/character.full-body/run \
  -H "Content-Type: application/json" \
  -d '{
    "prompt": "full body portrait of a young warrior with silver armor",
    "width": 512,
    "height": 768,
    "cfg": 7.0,
    "steps": 25
  }'
```

## Tips for Best Results

1. **Use pose reference** - Load a pose image for better body proportions
2. **Control aspect ratio** - Use 2:3 or 9:16 for full body
3. **Enable ControlNet** - Use pose ControlNet for consistent poses
4. **Include clothing details** - Be specific about clothing and accessories
5. **Use high res fix** - Enable for final high-resolution output

## Performance

- **Generation Time**: ~10-25 seconds (depending on hardware)
- **Memory Usage**: ~4-8 GB VRAM
- **Batch Support**: Yes (batch size up to 4)

## See Also

- [Character Portrait](../portrait) - For face and upper body
- [Character Sheet](../character-sheet) - For multiple angles
- [Expression Sheet](../expression-sheet) - For facial expressions