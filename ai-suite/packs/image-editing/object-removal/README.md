# Object Removal Workflow

Remove unwanted objects from images using advanced inpainting techniques. This workflow automatically detects and removes objects while seamlessly filling the gap with contextually appropriate content.

## Overview

This workflow provides intelligent object removal with two modes:

- **Automatic Detection**: Uses SAM2 for precise object detection
- **Smart Inpainting**: Uses SDXL inpainting models for realistic reconstruction

## Features

- 🧹 Automatic object detection and removal
- 🎨 Context-aware filling with realistic details
- 🖌️ Manual mask support for precise control
- 🔄 Multiple inpainting strength options
- 📐 Adaptive context preservation

## Use Cases

- Photo retouching and cleanup
- Product photography enhancement
- Architectural photo correction
- Removing unwanted people from scenes
- Removing logos or watermarks
- Historical photo restoration

## Dependencies

- **Required**: SDXL inpainting model or Stable Diffusion inpainting
- **Optional**: SAM2 for automatic object detection

## Inputs

| Input | Type | Description |
|-------|------|-------------|
| image | image | Input image containing objects to remove |
| object_mask | mask | Manual mask specifying areas to remove (optional) |
| inpainting_strength | float | Inpainting strength (0.0-1.0) |
| context_preservation | float | Context preservation factor (0.0-1.0) |

## Outputs

| Output | Type | Description |
|--------|------|-------------|
| image | image | Image with objects removed |
| mask | mask | Mask of removed areas |

## Presets

### Quick
Fast object removal with standard settings. Good for simple objects.

### Precise
High-quality removal with detailed inpainting and context matching.

## Hardware Requirements

- **Minimum VRAM**: 4 GB
- **Recommended VRAM**: 8 GB
- **Low VRAM Support**: Yes
- **CPU Offload Support**: Yes

## Example Prompt

```
Input: Photo with unwanted person in background
Output: Photo with person removed, background seamlessly filled
```

## Tips

- Use manual masks for precise control over removal areas
- Adjust inpainting strength for different object complexities
- Higher context preservation maintains original textures better
- Works best on well-lit, detailed scenes
- For best results, use high-resolution input images

## Tags

`#object-removal #inpainting #object-erasing #photo-editing #retouching #cleanup #remove-object #healing`