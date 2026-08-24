# Text to 3D (Hunyuan3D-2)

Generate a 3D mesh directly from text using Tencent's Hunyuan3D-2 shape generation model.

## Overview

This workflow uses the native text-to-3d capabilities of Hunyuan3D-DiT-v2-0, which is a large-scale flow-based diffusion transformer that creates geometry aligned with text conditions.

## Model Requirements

- `hunyuan3d-dit-v2-0-fp16.safetensors` - Hunyuan3D-2 shape generation model

## Hardware Requirements

- **Minimum VRAM:** 12 GB
- **Recommended VRAM:** 16 GB
- **CPU Offload:** Supported

## Custom Nodes Required

- `comfyui` (core)
- `ComfyUI-Hunyuan3DWrapper`

## Workflow Steps

1. **Load Hunyuan3D Model** - Loads the Hunyuan3D-DiT-v2-0 model
2. **Generate Mesh from Text** - Uses the text prompt to generate the 3D shape
3. **VAE Decode** - Decodes the latent representation to a voxel grid
4. **Postprocess Mesh** - Cleans up the mesh (removes floaters, degenerate faces, reduces face count)
5. **Export Mesh** - Saves the final mesh as a GLB file

## Usage

1. Select the "Text to 3D (Hunyuan3D-2)" workflow from the 3D category
2. Enter your text prompt describing the 3D model you want to generate
3. Optionally adjust the negative prompt, generation steps, guidance scale, and other parameters
4. Run the workflow to generate your 3D model

## Model Sources

- Hunyuan3D-DiT-v2-0: https://huggingface.co/Kijai/Hunyuan3D-2_safetensors