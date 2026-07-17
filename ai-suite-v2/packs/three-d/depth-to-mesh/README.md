# Depth to Mesh Workflow

Generate 3D meshes from depth maps using geometry reconstruction techniques. This workflow converts depth information into 3D-printable meshes with proper surface normals and watertight geometry.

## Description

This workflow processes depth maps to create:
- Vertex-extruded meshes from depth information
- Surface normal generation and optimization
- Watertight mesh closure
- Texture mapping from original image

Perfect for converting depth sensor data, depth estimation outputs, or monocular depth maps into 3D assets.

## Usage

### API

```
POST /api/v1/generate/three-d-depth-to-mesh
```

### Presets

- **Quick**: Fast mesh extraction for prototyping
- **Balanced**: Good surface quality with reasonable computation
- **High-quality**: Detailed geometry with full surface optimization

## Input Parameters

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| depth_map | image | required | Input depth map (grayscale) |
| original_image | image | optional | Original image for texture mapping |
| prompt | string | "" | Positive prompt for mesh refinement |
| mesh_resolution | integer | 1024 | Mesh vertex density (512-4096) |
| depth_scale | float | 1.0 | Depth scaling factor (0.1-10.0) |
| watertight | boolean | true | Enable watertight mesh closure |

## Models

### Required
- Depth processor: depth-to-mesh, geometry-extraction
- Upscaler: real-esrgan (for high-res depth)

### Optional
- LoRA: mesh-refinement, geometry-enhance
- Texture: texture-mapping

## Hardware Requirements

- Minimum VRAM: 16 GB
- Recommended VRAM: 24 GB
- Supports Low VRAM mode
- Supports CPU offload

## Presets

### Quick
- Resolution: 512
- Depth Scale: 1.0
- Watertight: true
- Fast generation

### Balanced
- Resolution: 1024
- Depth Scale: 1.0
- Watertight: true
- Good surface quality

### High-quality
- Resolution: 2048-4096
- Depth Scale: 1.5-2.0
- Watertight: true
- Full surface optimization

## Example

```bash
curl -X POST http://localhost:8080/api/v1/generate/three-d-depth-to-mesh \
  -H "Content-Type: application/json" \
  -d '{
    "depth_map": "base64_depth_map",
    "original_image": "base64_original_image",
    "mesh_resolution": 1024,
    "depth_scale": 1.0,
    "watertight": true
  }'
```

## Output

Generated 3D assets:
- **Mesh**: OBJ or GLTF with vertex positions from depth
- **Normals**: Generated surface normals
- **Texture**: UV-mapped texture from original image
- **Format**: Watertight or open mesh

## Supported Formats

- Input: JPEG, PNG, WebP (grayscale depth maps)
- Output: OBJ, GLTF, STL
- Textures: PNG, WebP