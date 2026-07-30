# Everything Muppet

Transforms any input to look like it was created by Jim Henson's Muppets - handmade, fabric-textured, and whimsically stylized.

## Overview

This workflow applies the iconic Muppet aesthetic to any image or concept:
- **Fabric Texture**: Simulates stitched fabric and textile materials
- **Vibrant Colors**: Enhances colors with the classic Muppet palette
- **Handmade Look**: Adds visible seams, stitching, and craft-like details
- **Whimsical Styling**: Creates a playful, theatrical appearance

## Usage

### Quick Start

1. Load the workflow in ComfyUI
2. Enter your prompt (anything can be transformed!)
3. Adjust muppet intensity (0.5-0.9 recommended)
4. Set texture detail level
5. Choose edge style (hand-stitched, painted-outline, etc.)
6. Click "Queue Prompt"
7. See your creation in Muppet style!

### API Usage

```bash
curl -X POST http://localhost:39000/workflows/weird.everything-muppet/run \
  -H "Content-Type: application/json" \
  -d '{
    "prompt": "A cyberpunk city",
    "muppet_intensity": 0.8,
    "texture_detail": 10,
    "edge_style": "hand-stitched",
    "width": 1024,
    "height": 1024
  }'
```

## Presets

### Subtle
- Light muppet effect (0.5 intensity)
- Minimal texture detail (4-6 levels)
- Soft color enhancement
- Preserves original details

### Extreme
- Heavy muppet effect (0.9 intensity)
- Maximum texture detail (12-16 levels)
- Vibrant color saturation
- Highly stylized appearance

## Parameters

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| prompt | text | required | Prompt describing what you want to transform |
| muppet_intensity | float | 0.7 | Strength of muppet transformation (0-1) |
| texture_detail | int | 8 | Texture detail level (1-16) |
| color_saturation | float | 1.3 | Color saturation multiplier |
| edge_style | string | hand-stitched | Style of edges (see enum) |
| width | int | 1024 | Output image width in pixels |
| height | int | 1024 | Output image height in pixels |
| seed | int | -1 | Random seed (-1 for random) |

## Edge Styles

- **hand-stitched**: Visible stitching lines like classic Muppets
- **painted-outline**: Bold, hand-painted outlines
- **fabric-fold**: Textured fabric folds and creases
- **charcoal-sketch**: Rough, sketch-like edges

## Example Transformations

```
Input: "A cyberpunk city"
Output: A muppet-style city with fabric buildings and stitched seams

Input: "A futuristic robot"
Output: A robot made of colorful fabric with visible seams

Input: "A forest landscape"
Output: A muppet forest with textile trees and embroidered details

Input: "A human portrait"
Output: A character in Muppet style with expressive fabric features
```

## Tips for Best Results

1. **Be descriptive** - Clear prompts work better with stylization
2. **Start moderate** - Begin with 0.6-0.8 intensity
3. **Experiment with edges** - Different edges create different feels
4. **Balance colors** - Higher saturation often looks better
5. **Try unusual combinations** - The weirder the input, the funnier the result

## Hardware Requirements

- **Minimum VRAM**: 6 GB
- **Recommended VRAM**: 12 GB
- **Low VRAM Support**: Yes (with reduced texture detail)
- **CPU Offload**: Supported

## Performance

- **Processing Time**: ~15-30 seconds (depending on parameters)
- **Memory Usage**: Scales with texture detail and image size
- **Batch Support**: No (memory-intensive stylization)

## Technical Details

The Muppet transformation uses:
1. **Texture synthesis** for fabric-like surfaces
2. **Edge detection** with stylized outlining
3. **Color grading** for vibrant, theatrical colors
4. **Stylized noise** for handmade appearance