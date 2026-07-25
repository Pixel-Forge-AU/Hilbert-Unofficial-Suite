# Video to Video

Enhance video quality using advanced AI models. Improve resolution, reduce artifacts, stabilize motion, and boost overall video quality with state-of-the-art enhancement algorithms.

## Overview

This workflow takes existing video content and enhances it through multiple processing stages:
- **Noise Reduction**: Remove compression artifacts and noise
- **Upscaling**: Increase resolution up to 4x
- **Stabilization**: Smooth out camera shake and motion artifacts
- **Quality Enhancement**: Boost colors, contrast, and detail

Perfect for:
- Restoring old or low-quality videos
- Preparing videos for high-quality display
- Enhancing user-uploaded content
- Pre-processing for video-to-video workflows
- Professional video post-production

## Specifications

- **Enhancement Factor**: 1x-4x configurable
- **Stabilization**: Advanced motion smoothing
- **Noise Reduction**: Smart artifact removal
- **FPS Boost**: Optional frame interpolation
- **Best For**: Video restoration, professional enhancement

## Hardware Requirements

- **Minimum VRAM**: 16 GB
- **Recommended VRAM**: 24 GB
- **Low VRAM Support**: Yes
- **CPU Offload**: Supported
- **Batch Processing**: Yes (up to 4 videos)

## Input Parameters

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| video | video | required | Input video to enhance |
| enhancement_factor | float | 2.0 | Enhancement multiplier (1x-4x) |
| denoise_strength | float | 0.5 | Strength of noise reduction (0-1) |
| stabilization | bool | true | Enable video stabilization |
| fps_boost | bool | false | Enable FPS boost for smoother playback |
| seed | int | -1 | Random seed (-1 for random) |

## Model Compatibility

Supports multiple enhancement models:
- Real-ESRGAN for upscaling
- Video enhancement models
- Super-resolution architectures
- Denoising UNet models

## Presets

| Preset | Use Case | Description |
|--------|----------|-------------|
| quick | Fast processing | Quick enhancement with minimal settings |
| balanced | General use | Good quality with reasonable speed |
| high-quality | Professional output | Maximum quality for final videos |

## Usage

### Quick Start

1. Load the workflow in ComfyUI
2. Upload or select your video
3. Choose enhancement factor (2x recommended for most cases)
4. Adjust denoising if needed
5. Enable stabilization for shaky footage
6. Click "Queue Prompt"
7. View enhanced video in Preview node

### API Usage

```bash
curl -X POST http://localhost:39000/workflows/video.video-to-video/run \
  -H "Content-Type: application/json" \
  -d '{
    "video": "base64_encoded_video_data",
    "enhancement_factor": 2.0,
    "denoise_strength": 0.5,
    "stabilization": true,
    "fps_boost": false
  }'
```

## Tips for Best Results

1. **Start with 2x enhancement** - Higher factors increase processing time
2. **Adjust denoising** - More noisy videos need higher denoising
3. **Use stabilization** - Essential for handheld camera footage
4. **Preview first** - Test with quick preset before full quality
5. **Original comparison** - Compare before/after to avoid over-enhancement

## Performance

- **Processing Time**: ~2-10 minutes (depending on input and settings)
- **Memory Usage**: ~16-24 GB VRAM
- **Batch Support**: Up to 4 videos simultaneously
- **Output Format**: WebP/MP4 with original aspect ratio

## See Also

- [Image to Video](../image-to-video) - Convert images to animated videos
- [Talking Head](../talking-head) - Animate portraits to speak
- [Lip Sync](../lip-sync) - Synchronize lip movements with audio
- [Frame Interpolation](../frame-interpolation) - Add frames for smooth motion