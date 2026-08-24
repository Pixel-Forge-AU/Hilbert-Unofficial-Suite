# Image to Textured 3D Model (Hunyuan3D 2.1, PBR)

Generate a 3D mesh from a single image and paint it with proper PBR
materials, using Tencent's Hunyuan3D-2.1 shape and paint pipelines
([visualbruno/ComfyUI-Hunyuan3d-2-1](https://github.com/visualbruno/ComfyUI-Hunyuan3d-2-1)).

## How this differs from `three-d.image-to-textured-mesh`

That pack uses Hunyuan3D-2.0 via kijai's `ComfyUI-Hunyuan3DWrapper`, which
kijai's wrapper never added 2.1 support to (confirmed via upstream issues
[#159](https://github.com/kijai/ComfyUI-Hunyuan3DWrapper/issues/159) and
[#167](https://github.com/kijai/ComfyUI-Hunyuan3DWrapper/issues/167)). 2.1
needs an entirely separate, unrelated wrapper with its own custom
rasterizer/renderer build.

The two pipelines are structured differently, not just newer-version-of-the-same-nodes:

- 2.0's paint stage is a manual chain (render multi-view maps -> delight
  reference image -> sample multi-view -> bake -> two inpaint passes) that
  outputs one flat RGB texture.
- 2.1's paint stage (`Hy3DMultiViewsGenerator` + `Hy3DBakeMultiViews` +
  `Hy3DInPaint`) is a smaller number of more integrated nodes that output
  **separate albedo and metallic-roughness textures** - real PBR materials,
  not a single baked-lighting texture. There's no standalone delight node in
  this wrapper; the PBR paint model predicts material properties directly
  rather than lit color, so it isn't clear the same delight step 2.0 needs is
  even applicable here.

## Runtime notes - read before running

- **This pack has not been run end-to-end yet.** `custom_rasterizer` and
  `mesh_inpaint_processor` were built from source against this machine's
  ROCm/HIP toolchain (torch 2.9.1+rocm7.2.1, hipcc 7.2.53211, gfx1151) via
  `repos/ComfyUI/custom_nodes/install-hunyuan3d-2-1-rocm.sh` and passed a
  GPU smoke test, but no actual generation through this workflow has
  completed. Node signatures were read directly from
  `visualbruno/ComfyUI-Hunyuan3d-2-1`'s source rather than verified by
  running them - expect to debug on first use.
- **First run downloads ~15GB**, automatically, no action needed: the dit
  and vae checkpoints (`Hy3D21ModelLoader`, no inputs of its own - always
  checks `models/diffusion_models/hunyuan3D-dit-v2-1-fp16.ckpt` and
  `models/vae/Hunyuan3D-vae-v2-1-fp16.ckpt`, downloading via `hf_hub_download`
  if missing) and the full `hunyuan3d-paintpbr-v2-1` diffusers pipeline
  (downloaded by `Hy3DMultiViewsGenerator` via `huggingface_hub.snapshot_download`
  on first execution). Needs internet access and ~15GB free disk on first
  generate; slow on that first run, normal after.
- The loader sets `HF_HUB_ENABLE_HF_TRANSFER=1` for faster downloads - if
  downloads fail with an import error mentioning `hf_transfer`, install it
  in the ComfyUI venv (`pip install hf_transfer`) and retry.
- `octree_resolution`, `max_facenum`, `paint_steps`, etc. default here to
  this wrapper's own stated node defaults, not the "best possible quality"
  values `three-d.image-to-textured-mesh` uses - I don't have a confirmed
  finished run from this exact pipeline to validate quality/speed tradeoffs
  against yet. Once you've got a working baseline, these are worth pushing
  up.
- `mc_algo` offers `dmc` as an alternative to `mc` (marching cubes) - unverified
  which one this wrapper actually intends as the improved default.
- Background removal reuses the same `RemBGSession+` / `ImageRemoveBackground+`
  (rembg, CPU) setup as the 2.0 pack - see that pack's README for why CPU
  over ROCm.

## Inputs

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| image | file | example.png | Drives both the mesh's shape and its PBR texture |
| remove_background | boolean | true | Segments the subject out before shape/texture generation |
| shape_steps | integer | 50 | Diffusion steps for shape generation |
| shape_guidance_scale | number | 5.0 | Guidance scale for shape generation |
| shape_seed | integer | 123 | Shape generation seed |
| attention_mode | choice | sdpa | sdpa or sageattn (sageattn needs a separate package) |
| box_v | number | 1.01 | Bounding-box padding for shape decoding |
| octree_resolution | integer | 384 | Geometry detail for shape decoding |
| mc_algo | choice | mc | Marching cubes algorithm: mc or dmc |
| max_facenum | integer | 40000 | Mesh is simplified to at most this many faces before texturing |
| smooth_normals | boolean | false | Smooth shading on the postprocessed mesh |
| view_size | integer | 512 | Resolution per view during multi-view PBR painting |
| paint_steps | integer | 10 | Diffusion steps for the multi-view PBR paint model |
| paint_guidance_scale | number | 3.0 | Guidance scale for the paint model |
| texture_size | integer | 1024 | Resolution of the baked albedo/MR textures |
| paint_seed | integer | 123 | Paint model seed |
| filename_prefix | text | 3d/image-to-textured-mesh-2.1 | Output folder/prefix |

## How it works

1. The reference image optionally gets its background stripped (same
   `RemBGSession+` / `ImageRemoveBackground+` -> `MaskToImage` + `ImageBlend`
   (multiply) -> `ComfySwitchNode` pattern as `three-d.image-to-textured-mesh` -
   see that pack's README for why it composites through the mask rather than
   using `ImageRemoveBackground+`'s own RGBA output directly), controlled by
   `remove_background`.
2. `Hy3D21ModelLoader` returns the shape model's path and a loaded VAE,
   auto-downloading both if missing.
3. `Hy3D21MeshGenerator` generates the raw shape latents from the processed
   image.
4. `Hy3D21VAEDecode` decodes latents to a mesh.
5. `Hy3D21PostprocessMesh` removes floaters/degenerate faces and reduces
   face count.
6. `Hy3D21CameraConfig` defines the six render views.
7. `Hy3DMultiViewsGenerator` unwraps UVs (if `unwrap_mesh` is on, which it
   is here) and generates matching albedo + metallic-roughness multi-view
   paintings in one step, auto-downloading the PBR paint pipeline on first
   use.
8. `Hy3DBakeMultiViews` bakes both texture sets onto the mesh's UVs.
9. `Hy3DInPaint` fills any gaps left in either texture.
10. `Hy3D21ExportMesh` exports the final mesh as a GLB with separate albedo
    and metallic-roughness textures.
