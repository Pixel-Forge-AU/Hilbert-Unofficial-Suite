# Texture Mesh From Image

Paint a texture onto an existing 3D mesh from a single reference image, using
Tencent's Hunyuan3D-2 paint pipeline via kijai's `ComfyUI-Hunyuan3DWrapper`.

This is different from `image-to-mesh`, which *generates* a new mesh's shape
from an image (no reliable texture). This workflow takes a mesh you already
have and paints it.

## How it works

1. The uploaded mesh is UV-unwrapped (if it doesn't already have UVs).
2. It's rendered from six camera angles to get normal maps and position maps.
3. The reference image is "delighted" — its own lighting/shadows are removed
   so it reads as a flat, lit-from-nowhere source — then used to condition a
   multi-view diffusion model that paints six matching views of the mesh.
4. Those views are baked back onto the mesh's UV texture and any gaps left by
   occluded surfaces are filled in.
5. The result is exported as a textured GLB.

## Inputs

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| mesh | file | example.glb | Existing 3D mesh to texture |
| image | file | example.png | Reference image driving the texture's appearance |
| render_size | integer | 1024 | Resolution for the mesh's normal/position renders |
| texture_size | integer | 1024 | Resolution of the baked output texture |
| delight_steps | integer | 50 | Steps for stripping lighting from the reference image |
| paint_view_size | integer | 512 | Resolution of each generated view |
| paint_steps | integer | 30 | Diffusion steps for the multi-view paint model |
| paint_seed | integer | 0 | Random seed for the paint model |
| filename_prefix | text | 3d/texture-mesh | Output folder/prefix |

## Setup notes (installed on this machine on 2026-07-23)

This pack needed a custom node that isn't part of stock ComfyUI:
[kijai/ComfyUI-Hunyuan3DWrapper](https://github.com/kijai/ComfyUI-Hunyuan3DWrapper),
cloned into `custom_nodes/`. Its texture pipeline depends on a small CUDA
rasterizer extension that only ships prebuilt for Windows+CUDA; on this
machine's AMD ROCm 7.2.1 GPU it had to be compiled from source
(`hy3dgen/texgen/custom_rasterizer`, built via PyTorch's HIP backend — the
repo's own `setup.py` already knows to target ROCm when `torch.version.hip`
is set). The build needed one override: clang defaults to the newest
installed gcc's directory for standard-library headers, but only
`libstdc++-13-dev` (not 14) is installed here, so `setup.py` now passes
`--gcc-install-dir=/usr/lib/gcc/x86_64-linux-gnu/13` explicitly. The plain
C++ `mesh_processor` extension (used for vertex-color inpainting) needed no
changes. The `hunyuan3d-delight-v2-0` and `hunyuan3d-paint-v2-0` diffusers
models (~13.5GB total) were downloaded to `models/diffusers/`.

**The running ComfyUI server won't see the new node types until it's
restarted** (custom nodes are only scanned at startup) — restart it whenever
convenient, then this pack should be ready to run.

## Runtime notes

- Marked experimental: this is a newly-installed pipeline that hasn't yet been
  run end-to-end to a finished GLB on this machine (blocked on the ComfyUI
  restart above), unlike other packs in this suite which were smoke-tested
  live before being marked stable.
- Texture quality depends heavily on how well the six fixed camera angles
  (front/right/back/left + top/bottom) cover the mesh's surface — deep
  concavities or thin protrusions may be left with baked-in seams even after
  the gap-fill pass.
- VRAM usage is dominated by the delight and paint diffusion models (both
  SD-scale); 12GB is a practical floor, 16GB+ recommended for the default
  1024px texture size.
