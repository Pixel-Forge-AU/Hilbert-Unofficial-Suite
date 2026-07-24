# Image to Textured 3D Model

Generate a 3D mesh from a single image and paint it — in one pass — using
Tencent's Hunyuan3D-2 shape and paint pipelines
([kijai/ComfyUI-Hunyuan3DWrapper](https://github.com/kijai/ComfyUI-Hunyuan3DWrapper)).

## Why this exists instead of `three-d.texture-mesh`

`three-d.texture-mesh` takes an already-made mesh and tries to paint it, but
in practice the raw output of shape-generation (marching-cubes/voxel surfaces)
is too messy to UV-unwrap and texture-bake cleanly — it came back with no
visible texture ("no skin") when tested against a generated model. The
official Hunyuan3D pipeline always cleans the mesh up first: floater removal,
degenerate-face removal, and face-count reduction, *before* UV-wrapping. This
workflow does exactly that, generating the mesh and immediately running it
through that cleanup before texturing, so there's no mismatch between what
shape-generation produces and what the texture pipeline expects.

If you already have a clean, properly UV-mapped mesh from somewhere else,
`three-d.texture-mesh` is still the right tool — the cleanup step just isn't
needed in that case.

## How it works

1. `Hy3DGenerateMesh` generates the raw shape from the reference image.
2. `Hy3DPostprocessMesh` removes floating fragments and degenerate faces and
   reduces the mesh to a target face count.
3. `Hy3DMeshUVWrap` unwraps UVs on the now-clean mesh.
4. The mesh is rendered from six camera angles for normal/position maps.
5. The reference image is "delighted" (its own lighting removed) and used to
   condition a multi-view diffusion model that paints six matching views.
6. Those views are baked onto the UV texture, then gap-filled in two passes
   (mesh-topology-aware inpaint, then a regular image inpaint for anything
   left over).
7. The textured mesh is exported as a GLB.

## Inputs

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| image | file | example.png | Drives both the mesh's shape and its texture |
| shape_steps | integer | 50 | Diffusion steps for shape generation |
| shape_guidance_scale | number | 5.5 | Guidance scale for shape generation |
| shape_seed | integer | 123 | Shape generation seed |
| max_facenum | integer | 40000 | Mesh is simplified to at most this many faces before texturing |
| texture_size | integer | 2048 | Resolution of the baked output texture |
| delight_steps | integer | 50 | Steps for stripping lighting from the reference image |
| paint_steps | integer | 25 | Diffusion steps for the multi-view paint model |
| paint_seed | integer | 1024 | Paint model seed |
| filename_prefix | text | 3d/image-to-textured-mesh | Output folder/prefix |

## Runtime notes

- Experimental: newly installed on this machine (same
  `ComfyUI-Hunyuan3DWrapper` install as `three-d.texture-mesh`, its rasterizer
  compiled from source against ROCm/HIP) and not yet run to a finished GLB
  here — the running ComfyUI server needs a restart to see the custom node
  before either pack can execute.
- Use a subject shot against a plain or transparent background for the best
  shape and texture results; this workflow does no background removal itself.
- VRAM is dominated by three diffusion models in sequence (shape, delight,
  paint) — 12GB is a practical floor, 16GB+ recommended.
