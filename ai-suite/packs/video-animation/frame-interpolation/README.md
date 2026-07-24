# Frame Interpolation

Add intermediate frames to existing videos for smoother motion. Perfect for enhancing frame rates and creating fluid animation effects.

## Overview

This workflow takes existing video content and adds intermediate frames to make motion appear smoother and more fluid:
- **Smooth Motion**: Creates natural-looking intermediate frames
- **FPS Enhancement**: Increase frame rate by up to 8x
- **Motion Preservation**: Maintain original motion patterns
- **Quality Enhancement**: Reduce artifacts and noise
- **Customizable**: Fine-tune interpolation strength

Perfect for:
- Converting 24fps to 60fps for smoother viewing
- Creating slow-motion effects
- Enhancing game recordings
- Improving video streaming quality
- Animation frame doubling

## Specifications

- **Model**: Frame interpolation with optical flow estimation
- **FPS Enhancement**: Up to 8x multiplier
- **Quality Enhancement**: Artifact reduction
- **Best For**: Smooth motion, slow-motion, frame rate increase

## Hardware Requirements

- **Minimum VRAM**: 16 GB
- **Recommended VRAM**: 24 GB
- **Low VRAM Support**: Yes
- **CPU Offload**: Supported

## Input Parameters

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| video | video | required | Input video to process |
| fps_multiplier | float | 2.0 | Multiplier for frame rate increase (1-8) |
| interpolation_quality | float | 0.8 | Quality vs speed tradeoff (0-1) |
| motion_preservation | float | 0.9 | How much to preserve original motion (0-1) |
| smoothing | float | 0.3 | Amount of motion smoothing (0-1) |
| seed | int | -1 | Random seed (-1 for random) |

## Model Compatibility

Supports multiple interpolation models:
- Frame-interpolation models
- Video-smoothing models
- Slow-motion models
- Optical-flow models

## Presets

| Preset | Use Case | Description |
|--------|----------|-------------|
| quick | Fast preview | Quick interpolation with minimal settings |
| balanced | General use | Good quality with natural motion |
| high-quality | Final output | Maximum quality for final videos |

## Example Use Cases

1. **Video Enhancement**: Convert 24fps to 60fps for smoother viewing
2. **Slow Motion**: Create smooth slow-motion effects
3. **Gaming**: Enhance game recordings for streaming
4. **Animation**: Add frames for smoother animation
5. **Video Streaming**: Improve streaming quality

## Usage

### Quick Start

1. Load the workflow in ComfyUI
2. Upload your video
3. Set the desired FPS multiplier
4. Adjust interpolation quality and smoothing
5. Enable motion preservation for natural results
6. Click "Queue Prompt"
7. View the enhanced video in Preview node

### API Usage

```bash
curl -X POST http://localhost:8188/workflows/video.frame-interpolation/run \
  -H "Content-Type: application/json" \
  -d '{
    "video": "base64_encoded_video_data",
    "fps_multiplier": 2.0,
    "interpolation_quality": 0.8,
    "motion_preservation": 0.9,
    "smoothing": 0.3
  }'
```

## Tips for Best Results

1. **Source Quality**: Start with high-quality video for best results
2. **Moderate Multipliers**: 2x-4x multipliers work best for most content
3. **Motion Preservation**: Keep high for natural motion
4. **Smoothing**: Lower values preserve original motion better
5. **Quality vs Speed**: Higher quality settings take longer but produce better results

## Performance

- **Generation Time**: ~3-10 minutes (depending on video length and multiplier)
- **Memory Usage**: ~16-24 GB VRAM
- **Batch Support**: No (single video at a time)

## See Also

- [Image to Video](../image-to-video) - Convert images to animated videos
- [Video to Video](../video-to-video) - Enhance video quality
- [Lip Sync](../lip-sync) - Synchronize lip movements with audio
- [Talking Head](../talking-head) - Animate portraits to speak