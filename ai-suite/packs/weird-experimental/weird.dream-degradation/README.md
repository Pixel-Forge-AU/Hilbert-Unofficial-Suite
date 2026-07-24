# Dream Degradation

Creates dream-like degradation effects that simulate the fading and distortion of memories and dreams. The workflow applies progressive blurring, color shifts, and noise to create an ethereal, fading effect.

## Overview

This workflow simulates how memories and dreams fade over time:
- **Progressive Blur**: Simulates loss of sharp detail
- **Color Shifting**: Creates dreamlike color palettes
- **Noise Injection**: Adds the grainy quality of old memories
- **Gradual Degradation**: Multi-stage transformation process

## Usage

### Quick Start

1. Load the workflow in ComfyUI
2. Enter your initial prompt
3. Adjust degradation strength (0.3-0.7 recommended)
4. Set blur iterations (3-5 recommended)
5. Click "Queue Prompt"
6. View the dreamlike degraded result

### API Usage

```bash
curl -X POST http://localhost:8188/workflows/weird.dream-degradation/run \
  -H "Content-Type: application/json" \
  -d '{
    "prompt": "A peaceful garden",
    "degradation_strength": 0.5,
    "blur_iterations": 3,
    "noise_intensity": 0.2,
    "width": 1024,
    "height": 1024
  }'
```

## Presets

### Subtle
- Light degradation (0.3-0.4 strength)
- Minimal blur (1-2 passes)
- Low noise injection
- Preserves most original details

### Extreme
- Heavy degradation (0.7-0.9 strength)
- Maximum blur (5-8 passes)
- High noise injection
- Creates heavily transformed results

## Parameters

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| prompt | text | required | Prompt describing the initial scene |
| degradation_strength | float | 0.5 | Intensity of dream-like effect (0-1) |
| blur_iterations | int | 3 | Number of blur passes (1-10) |
| color_shift | float | 0.3 | Color shifting intensity (0-1) |
| noise_intensity | float | 0.2 | Amount of noise added (0-1) |
| width | int | 1024 | Output image width in pixels |
| height | int | 1024 | Output image height in pixels |
| seed | int | -1 | Random seed (-1 for random) |

## Example Prompts

```
A peaceful garden at dawn
An old man sitting by a window
A city skyline in the fog
A childhood memory of summer
A dream of flying
The edge of consciousness
```

## Tips for Best Results

1. **Start with clear images** - The degradation works best with well-defined starting points
2. **Balance blur and noise** - Too much of either creates pure noise
3. **Experiment with color shifts** - Small changes create different moods
4. **Check intermediate steps** - View each degradation stage
5. **Combine with other effects** - Try adding other experimental effects

## Hardware Requirements

- **Minimum VRAM**: 4 GB
- **Recommended VRAM**: 8 GB
- **Low VRAM Support**: Yes
- **CPU Offload**: Supported

## Performance

- **Processing Time**: ~10-20 seconds (depending on parameters)
- **Memory Usage**: Scales with blur iterations and image size
- **Batch Support**: No (sequential processing required)

## Technical Details

The degradation process uses:
1. **Gaussian blur** for softening details
2. **Additive noise** for texture
3. **Hue/saturation shifts** for color transformation
4. **Progressive application** for cumulative effects