# Background Replacement Workflow

Replace backgrounds with new images using advanced segmentation. This workflow automatically extracts subjects from their background and composites them onto new background images, creating professional composite images.

## Overview

This workflow provides seamless background replacement with two modes:

- **Automatic Segmentation**: Uses SAM2 or Fast-SAM for precise subject extraction
- **Lighting Matching**: Automatically matches lighting and color tones between subject and background

## Features

- 🔄 Automatic subject extraction from complex backgrounds
- 🎨 Seamless compositing with natural blending
- 💡 Lighting and color matching between subject and background
- 📐 Automatic scaling and positioning
- 🖼️ Multiple format outputs (PNG, JPEG, WEBP)

## Use Cases

- Product photography background replacement
- Portrait compositing with different locations
- E-commerce image creation
- Creative photography and digital art
- Video background replacement

## Dependencies

- **Required**: SAM2 or Fast-SAM for segmentation
- **Optional**: comfyui-impact-pack, comfyui-controlnet-aux

## Inputs

| Input | Type | Description |
|-------|------|-------------|
| subject_image | image | Image containing the subject to keep |
| new_background | image | Background image to composite onto |
| blend_strength | float | Blend factor between subject and background (0.0-1.0) |
| match_lighting | boolean | Match lighting between subject and background |

## Outputs

| Output | Type | Description |
|--------|------|-------------|
| image | image | Composite image with new background |
| mask | mask | Segmentation mask used for compositing |

## Presets

### Quick
Fast background replacement with default settings. Good for simple composites.

### Precise
High-quality compositing with lighting matching and advanced blending.

## Hardware Requirements

- **Minimum VRAM**: 4 GB
- **Recommended VRAM**: 8 GB
- **Low VRAM Support**: Yes
- **CPU Offload Support**: Yes

## Example Prompt

```
Input: Person image + Mountain landscape background
Output: Person seamlessly composited onto mountain background
```

## Tips

- Use high-quality images for both subject and background
- Ensure lighting direction consistency for realistic results
- Adjust blend strength for different artistic effects
- Use lighting matching for more natural composites
- Match image resolutions for best results

## Tags

`#background-replacement #compositing #segmentation #rmbg #sam2 #masking #photography #composite`