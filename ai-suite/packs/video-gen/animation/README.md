# Animation

Create animated videos from images or text descriptions. Generate full animation sequences with character movement and expression.

## Overview

This workflow generates animated videos from source images with text prompts:
- **Text-to-Video**: Generate animations from text descriptions
- **Image Animation**: Bring static images to life
- **Character Movement**: Natural motion and expression
- **Frame Control**: Customize frame count and FPS
- **Motion Strength**: Fine-tune animation intensity

Perfect for:
- Creating animated character videos
- Generating video from images
- Text-to-video animation
- Character expression animation
- Storyboard to video conversion

## Specifications

- **Model**: Video-animation with motion modules
- **Frame Range**: 10-240 frames
- **FPS Control**: 12-60 frames per second
- **Motion Enhancement**: Natural movement simulation
- **Best For**: Character animation, text-to-video, motion graphics

## Hardware Requirements

- **Minimum VRAM**: 16 GB
- **Recommended VRAM**: 24 GB
- **Low VRAM Support**: Yes
- **CPU Offload**: Supported

## Input Parameters

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| source_image | image | required | Source image for animation |
| prompt | string | required | Text description of animation |
| animation_strength | float | 0.7 | Strength of animation movement (0-1) |
| frame_count | int | 60 | Number of frames to generate (10-240) |
| fps | int | 24 | Frames per second (12-60) |
| seed | int | -1 | Random seed (-1 for random) |

## Model Compatibility

Supports multiple animation models:
- Video-animation models
- Character-animation models
- Text-to-video models
- Motion-module models

## Presets

| Preset | Use Case | Description |
|--------|----------|-------------|
| quick | Fast preview | Quick animation with minimal settings |
| balanced | General use | Good quality with natural motion |
| high-quality | Final output | Maximum quality for final videos |

## Example Use Cases

1. **Character Animation**: Bring character images to life
2. **Text-to-Video**: Generate animation from text description
3. **Storyboarding**: Convert static images to animated videos
4. **Social Media**: Create engaging animated content
5. **Marketing**: Generate product demonstrations

## Usage

### Quick Start

1. Load the workflow in ComfyUI
2. Upload your source image
3. Enter your text prompt for animation
4. Adjust animation strength for more or less movement
5. Set frame count and FPS
6. Click "Queue Prompt"
7. View the animated video in Preview node

### API Usage

```bash
curl -X POST http://localhost:39000/workflows/video.animation/run \
  -H "Content-Type: application/json" \
  -d '{
    "image": "base64_encoded_image_data",
    "prompt": "A person smiling and gesturing naturally",
    "animation_strength": 0.7,
    "frame_count": 60,
    "fps": 24
  }'
```

## Tips for Best Results

1. **Clear Source**: Use images with clear character features
2. **Detailed Prompts**: Specific prompts yield better results
3. **Moderate Strength**: Lower strength for natural movement
4. **Frame Count**: Start with 30-60 frames for testing
5. **FPS Choice**: 24fps for cinematic, 30fps for smooth motion

## Performance

- **Generation Time**: ~5-15 minutes (depending on frame count)
- **Memory Usage**: ~16-24 GB VRAM
- **Batch Support**: No (single video at a time)

## See Also

- [Image to Video](../image-to-video) - Convert images to animated videos
- [Video to Video](../video-to-video) - Enhance video quality
- [Lip Sync](../lip-sync) - Synchronize lip movements with audio
- [Frame Interpolation](../frame-interpolation) - Add frames for smooth motion
- [Talking Head](../talking-head) - Animate portraits to speak