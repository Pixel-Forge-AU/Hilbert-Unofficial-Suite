# Hand Repair Workflow

Repair and enhance human hands in images using specialized restoration models. Automatically detects hands and repairs common issues like poor geometry, extra fingers, or poor lighting while maintaining realistic anatomy.

## Overview

This workflow provides professional-grade hand repair with models specifically trained for hand anatomy:

- **Hand-GFPGAN**: Specialized model for general hand restoration
- **Hand-Anatomy-Restorer**: Advanced model for anatomically correct repairs

## Features

- 🖐️ Automatic hand detection and analysis
- 🎨 Specialized hand restoration models
- 🔧 Adjustable enhancement strength
- 🦴 Anatomy preservation control
- 📐 Realistic hand geometry maintenance

## Use Cases

- Portrait hand restoration
- Poor hand geometry correction
- Extra finger correction
- Hand detail enhancement
- Poor lighting hand repair
- Professional portrait hand enhancement

## Dependencies

- **Required**: Hand-GFPGAN or Hand-Anatomy-Restorer model
- **Optional**: Hand detection models (Hand-Pose-Estimator, Hand-Segmenter)

## Inputs

| Input | Type | Description |
|-------|------|-------------|
| image | image | Input image containing hands to repair |
| enhancement_strength | float | Enhancement strength (0.0-1.0) |
| anatomy_preservation | float | Anatomy preservation factor (0.0-1.0) |

## Outputs

| Output | Type | Description |
|--------|------|-------------|
| image | image | Image with hands repaired and enhanced |
| hand_mask | mask | Mask of processed hand areas |

## Presets

### Quick
Fast hand repair with standard settings. Good for mild enhancements.

### Precise
High-quality repair with detailed enhancement and natural appearance.

## Hardware Requirements

- **Minimum VRAM**: 4 GB
- **Recommended VRAM**: 8 GB
- **Low VRAM Support**: Yes
- **CPU Offload Support**: Yes

## Example Prompt

```
Input: Portrait with poorly rendered hands
Output: Portrait with natural hand anatomy, proper finger count, and enhanced details
```

## Tips

- Use higher enhancement for severely deformed hands
- Lower enhancement preserves original character
- Anatomy preservation is critical for medical/forensic applications
- Works best with clear, well-lit hand images
- Consider hand position consistency for group photos

## Tags

`#hand-repair #hand-restoration #hand-enhancement #hand-correction #fingers-correction #hand-detail #hand-gfpgan #hand-anatomy`