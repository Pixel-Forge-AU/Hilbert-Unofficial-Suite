# Background Removal Workflow

Automatic background removal using advanced segmentation techniques. This workflow extracts subjects from their background and replaces it with transparency, perfect for product photography, portrait editing, and digital art creation.

## Overview

This workflow provides two modes of operation:

- **Fast Mode**: Uses efficient segmentation for quick results
- **Precise Mode**: Uses SAM2 for pixel-perfect segmentation with complex edges

## Features

- 🚀 Fast background removal with default settings
- 🎯 SAM2-powered precise segmentation for complex images
- 🎨 Smooth edge transitions with configurable blur
- 📦 Transparent PNG output
- 🖼️ Preview masks for quality verification

## Use Cases

- Product photography background removal
- Portrait editing and cutouts
- E-commerce image preparation
- Digital art and graphic design
- Social media content creation

## Dependencies

- **Required**: SAM2 (Segment Anything Model 2)
- **Optional**: comfyui-impact-pack, comfyui-controlnet-aux

## Inputs

| Input | Type | Description |
|-------|------|-------------|
| image | image | Input image to process |
| precision_mode | boolean | Use precise SAM2 segmentation (slower but more accurate) |
| dilation | int | Expand or shrink the segmentation mask (-10 to 50) |
| blur_edges | float | Blur radius for smooth transitions (0.0 to 20.0) |

## Outputs

| Output | Type | Description |
|--------|------|-------------|
| image | image | Image with transparent background |
| mask | mask | Output segmentation mask |

## Presets

### Quick
Fast background removal optimized for speed. Good for simple backgrounds.

### Precise
High-quality segmentation using SAM2, ideal for complex edges and challenging images.

## Hardware Requirements

- **Minimum VRAM**: 4 GB
- **Recommended VRAM**: 8 GB
- **Low VRAM Support**: Yes
- **CPU Offload Support**: Yes

## Example Prompt

```
Input: A person standing in front of a complex outdoor background
Output: Person with transparent background, ready for compositing
```

## Tips

- Use **Precise Mode** for images with fine details like hair or fur
- Adjust **dilation** to include or exclude small background artifacts
- Use **blur_edges** to create natural transitions around subjects
- For best results, ensure good subject-background contrast

## Tags

`#background-removal #segmentation #transparency #rmbg #sam2 #fast-sam #masking #isolation`