# Face Repair Workflow

Repair and enhance facial features using advanced restoration models. Automatically detects faces and repairs imperfections, enhances details, and improves overall facial quality while maintaining natural appearance.

## Overview

This workflow provides professional-grade face repair with two powerful models:

- **GFPGAN**: General face restoration for natural-looking repairs
- **CodeFormer**: Advanced detail preservation with fidelity control

## Features

- 🧍 Automatic face detection and analysis
- 🎨 Multiple restoration models (GFPGAN/CodeFormer)
- 🔧 Adjustable enhancement strength
- 🖼️ Detail preservation control
- 📐 Natural appearance maintenance

## Use Cases

- Portrait restoration
- Old photo facial repair
- Poor lighting enhancement
- Skin imperfection reduction
- Facial detail enhancement
- Celebrity-style portrait enhancement

## Dependencies

- **Required**: GFPGAN or CodeFormer model
- **Optional**: Face detection models (RetinaFace, YOLOv5Face)

## Inputs

| Input | Type | Description |
|-------|------|-------------|
| image | image | Input image containing faces to repair |
| enhancement_strength | float | Enhancement strength (0.0-1.0) |
| detail_preservation | float | Detail preservation factor (0.0-1.0) |

## Outputs

| Output | Type | Description |
|--------|------|-------------|
| image | image | Image with faces repaired and enhanced |
| face_mask | mask | Mask of processed face areas |

## Presets

### Quick
Fast face repair with standard settings. Good for mild enhancements.

### Precise
High-quality repair with detailed enhancement and natural appearance.

## Hardware Requirements

- **Minimum VRAM**: 4 GB
- **Recommended VRAM**: 8 GB
- **Low VRAM Support**: Yes
- **CPU Offload Support**: Yes

## Example Prompt

```
Input: Portrait with visible skin imperfections and poor lighting
Output: Portrait with smooth skin, even lighting, and enhanced features
```

## Tips

- Use higher enhancement for severely degraded faces
- Lower enhancement preserves original character
- CodeFormer offers fidelity control for detail tuning
- Works best with clear, well-lit face images
- Consider skin tone consistency for group photos

## Tags

`#face-repair #face-restoration #face-enhancement #portrait-enhancement #skin-smoothing #detail-enhancement #gfpgan #codeformer`