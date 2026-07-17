# Image to Video

Convert a single image into a smooth animated video using motion interpolation and video generation.

## Overview

This workflow transforms static images into engaging animated videos with smooth movement and transitions. It's perfect for:
- Creating social media content from static images
- Adding motion to illustrations and artwork
- Generating video content from images
- Creating engaging presentations
- Animation prototyping

## Specifications

- **Model**: Motion-adapter with videogen capabilities
- **FPS**: Configurable (12-60)
- **Duration**: Configurable (1-30 seconds)
- **Motion Scale**: Adjustable motion intensity
- **Best For**: Social media content, digital art animation

## Hardware Requirements

- **Minimum VRAM**: 16 GB
- **Recommended VRAM**: 24 GB
- **Low VRAM Support**: Yes
- **CPU Offload**: Supported

## Input Parameters

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| image | image | required | Input image to animate |
| prompt | text | required | Positive prompt describing desired animation |
| negative_prompt | text | optional | Negative prompt for undesirable elements |
| duration | float | 5.0 | Video duration in seconds |
| fps | int | 24 | Frames per second |
| motion_scale | float | 8.0 | Scale of motion intensity |
| seed | int | -1 | Random seed (-1 for random) |

## Model Compatibility

Supports multiple model families:
- Motion Adapter models
- Video generation models (ZeroScope, etc.)
- ComfyUI-compatible video models

## Presets

| Preset | Use Case | Description |
|--------|----------|-------------|
| quick | Fast prototyping | Quick animation for rapid testing |
| balanced | General use | Good quality with reasonable speed |
| high-quality | Final output | Maximum quality for final videos |

## Example Prompt

```
masterpiece, best quality, high resolution, detailed, professional video, smooth motion, flowing movement
```

## Negative Prompt

```
low quality, worst quality, lowres, blurry, text, watermark, logo, signature, cropped, out of frame, stuttering, jerky motion, artifacts
```

## Usage

### Quick Start

1. Load the workflow in ComfyUI
2. Upload your image
3. Enter your animation prompt
4. Adjust settings as needed
5. Click "Queue Prompt"
6. View the generated video in the Preview node

### API Usage

```bash
curl -X POST http://localhost:8188/workflows/video.image-to-video/run \
  -H "Content-Type: application/json" \
  -d '{
    "image": "base64_encoded_image_data",
    "prompt": "A flowing river with smooth motion",
    "duration": 5.0,
    "fps": 24,
    "motion_scale": 8.0
  }'
```

## Tips for Best Results

1. **High-quality images** - Start with high-resolution images for best results
2. **Clear prompts** - Describe the motion you want in detail
3. **Moderate motion** - Start with lower motion scales and increase gradually
4. **Test with presets** - Try quick preset first for rapid iteration
5. **Use negative prompts** - Helps avoid common artifacts and quality issues

## Performance

- **Generation Time**: ~1-5 minutes (depending on duration and hardware)
- **Memory Usage**: ~16-24 GB VRAM
- **Batch Support**: No (single video at a time)

## See Also

- [Video to Video](../video-to-video) - Enhance existing video quality
- [Talking Head](../talking-head) - Animate portraits to speak
- [Lip Sync](../lip-sync) - Synchronize lip movements with audio
- [Frame Interpolation](../frame-interpolation) - Add frames for smooth motion