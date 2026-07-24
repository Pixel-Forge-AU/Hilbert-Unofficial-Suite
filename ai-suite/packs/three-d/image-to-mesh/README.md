# Image to 3D Mesh Workflow

Generate 3D mesh models from 2D images using advanced reconstruction techniques. This workflow supports both RGB images and depth maps to produce geometry-rich 3D assets with texture mapping.

## Description

This workflow converts 2D images into 3D printable meshes using:
- Depth estimation from single images
- Geometry reconstruction using multi-view stereo
- Texture mapping from the original image
- Mesh smoothing and optimization

Perfect for rapid 3D content creation, game asset prototyping, and 3D printing preparation.

## Usage

### API

```
POST /api/v1/generate/three-d-image-to-mesh
```

### Presets

- **Quick**: Fast mesh generation for prototyping
- **Balanced**: Good quality with reasonable computation time
- **High-quality**: Detailed meshes with full texture resolution

## Input Parameters

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| image | image | required | Input 2D image for 3D mesh generation |
| prompt | string | "" | Positive prompt describing the 3D subject |
| negative_prompt | string | "" | Negative prompt for undesirable elements |
| mesh_resolution | integer | 1024 | Mesh vertex resolution (512-4096) |
| smooth_iterations | integer | 3 | Mesh smoothing iterations (0-20) |
| texture_quality | integer | 2048 | Texture resolution (1024-4096) |

## Models

### Required
- Checkpoint: flux, sdxl
- Depth Estimator: depth-anything, midas
- Super Resolution: real-esrgan, swinir

### Optional
- LoRA: three-d-texture, mesh-refinement
- Inpainting: inpaint

## Hardware Requirements

- Minimum VRAM: 16 GB
- Recommended VRAM: 24 GB
- Supports Low VRAM mode
- Supports CPU offload

## Presets

### Quick
- Mesh Resolution: 512
- Smooth Iterations: 1
- Texture Quality: 1024
- Fast generation for prototyping

### Balanced
- Mesh Resolution: 1024
- Smooth Iterations: 3
- Texture Quality: 2048
- Good quality with reasonable computation time

### High-quality
- Mesh Resolution: 2048-4096
- Smooth Iterations: 5-10
- Texture Quality: 4096
- Maximum detail with full optimization

## Example

```bash
curl -X POST http://localhost:8080/api/v1/generate/three-d-image-to-mesh \
  -H "Content-Type: application/json" \
  -d '{
    "image": "base64_encoded_image_data",
    "prompt": "detailed 3D model of a futuristic robot",
    "mesh_resolution": 1024,
    "smooth_iterations": 3,
    "texture_quality": 2048
  }'
```

## Output

Generated 3D assets:
- **Mesh**: OBJ or GLTF format with vertex positions and UV coordinates
- **Texture**: 2048x2048 or 4096x4096 texture map
- **Preview**: WebP render of the 3D mesh
- **File Size**: Typically 10-100MB depending on resolution

## Supported Formats

- Input: JPEG, PNG, WebP
- Output: OBJ, GLTF, STL
- Textures: PNG, WebP