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

1. The reference image optionally gets its background stripped:
   `RemBGSession+` / `ImageRemoveBackground+` (isnet-general-use model)
   produce a foreground mask, which `MaskToImage` + `ImageBlend`
   (multiply) then use to composite the *original* image onto black -
   controlled by `remove_background`. This does **not** use
   `ImageRemoveBackground+`'s own `image` output directly: that output is
   RGBA (its alpha-stripping line is commented out upstream in
   `ComfyUI_essentials`), and feeding a 4-channel image into the
   Hunyuan3D nodes further down - built for plain 3-channel RGB - caused
   a 128GB HIP OOM crash inside `Hy3DDelightImage`'s VAE attention block
   the first time this ran. Compositing through the mask also happens to
   be more correct anyway: rembg's own RGBA output leaves original
   background pixels intact under `alpha=0`, so using it directly
   wouldn't actually have removed the background from what the shape/paint
   models see, even without the crash.
2. The (possibly background-removed) image optionally gets "delighted" (its
   own lighting/shadows removed, `Hy3DDelightImage`) - controlled by
   `remove_shadows`. Both toggles are real `ComfySwitchNode` switches, so the
   unused branch doesn't even execute.
3. `Hy3DGenerateMesh` generates the raw shape from that processed image -
   *not* the raw upload - so background clutter and baked-in shadows don't
   get read as geometry. It also receives the rembg segmentation mask
   directly (its optional `mask` input) as an explicit foreground/background
   hint - a plain blackened-background RGB image alone wasn't enough signal;
   without the mask, shape generation was hallucinating a flat backdrop
   plane behind the subject instead of leaving that space empty. The mask
   is always computed and passed, independent of the `remove_background`
   toggle (which only controls whether the *visible* background pixels get
   blackened for the stages after this one).
4. `Hy3DPostprocessMesh` removes floating fragments and degenerate faces and
   reduces the mesh to a target face count.
5. `Hy3DMeshUVWrap` unwraps UVs on the now-clean mesh.
6. The mesh is rendered from six camera angles for normal/position maps.
7. The same processed image conditions a multi-view diffusion model that
   paints six matching views (at `view_size`, default 1024x1024).
7a. Those six views are upscaled 4x (`RealESRGAN_x4plus`, already installed
    in `models/upscale_models/`) before baking - at the default `view_size`
    this lands exactly on `texture_size`'s 4096, so the atlas gets real
    upscaled detail instead of the bake step's own plain interpolation
    stretching a 1024 source up to 4096. This is unconditional (no toggle);
    it adds a modest amount of time on top of an already 12-15 minute paint
    stage.
8. Those (now upscaled) views are baked onto the UV texture, then gap-filled
   in two passes (mesh-topology-aware inpaint, then a regular image inpaint
   for anything left over).
9. The textured mesh is exported as a GLB.

## Inputs

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| image | file | example.png | Drives both the mesh's shape and its texture |
| remove_background | boolean | true | Segments the subject out (rembg, isnet-general-use, CPU) before shape/texture generation |
| remove_shadows | boolean | true | Delights the image (strips existing lighting/shadows) before shape/texture generation |
| delight_cfg_image | number | 1.5 | Image guidance scale for delighting - must stay above 1.0, see below |
| box_v | number | 1.01 | Bounding-box padding for shape decoding; raise if protruding parts get clipped |
| shape_steps | integer | 75 | Diffusion steps for shape generation |
| shape_guidance_scale | number | 5.5 | Guidance scale for shape generation |
| shape_seed | integer | 123 | Shape generation seed |
| octree_resolution | integer | 512 | Geometry detail for shape decoding |
| max_facenum | integer | 80000 | Mesh is simplified to at most this many faces before texturing |
| smooth_normals | boolean | true | Smooth shading on the postprocessed mesh |
| render_size | integer | 2048 | Resolution for multi-view normal/position map rendering |
| texture_size | integer | 4096 | Resolution of the baked output texture |
| delight_steps | integer | 50 | Steps for stripping lighting from the reference image |
| paint_steps | integer | 50 | Diffusion steps for the multi-view paint model |
| view_size | integer | 1024 | Resolution per view during texture painting (gets 4x'd by RealESRGAN before baking - see below) |
| paint_seed | integer | 1024 | Paint model seed |
| filename_prefix | text | 3d/image-to-textured-mesh | Output folder/prefix |

## The delighting bug (fixed) and `delight_cfg_image`

Debug taps on the delit image (temporarily added, since removed) showed
delighting badly posterizing the reference image tested here - flattened
skin tones into solid color blocks, lost facial features and clothing
detail entirely - which was then feeding both shape generation and texture
painting, explaining both the shape and texture quality complaints at once.

The actual cause, found in `ComfyUI-Hunyuan3DWrapper/nodes.py`'s
`Hy3DDelightImage.process`:

```python
guidance_scale=1.0 if cfg_image == 1.0 else 1.01,  # enable cfg for image, value doesn't matter as it do anything for text anyway
```

Diffusers' `StableDiffusionInstructPix2PixPipeline` only enables
classifier-free guidance at all when `guidance_scale > 1.0` or
`image_guidance_scale > 1.0`. This pack's `cfg_image` had been left at the
node's own default of exactly `1.0`, which the line above maps straight to
`guidance_scale=1.0` too - so both scales sit at the disabling threshold,
CFG never activates, and the delight pass runs completely ungrounded from
the source image instead of being pulled back toward it. Kijai's own
comment shows he built the workaround deliberately; the value just needed
to actually be off of `1.0` to trigger it.

Fixed by setting `cfg_image` to `1.5` and exposing it as `delight_cfg_image`
so it's tunable. It must stay above `1.0`, or this bug recurs. This is a
real, source-verified bug fix, not a tuned guess - but it hasn't been
confirmed against a real run yet, so treat the first result as a check, not
a given.

## Runtime notes

- Experimental: same `ComfyUI-Hunyuan3DWrapper` install as `three-d.texture-mesh`,
  its rasterizer compiled from source against ROCm/HIP. `workflow.json` (opens
  in the ComfyUI UI) and `workflow-api.json` (what actually runs when you
  generate through the app) must be kept in sync by hand — there's no compile
  step that derives one from the other, so any future edit to this pack needs
  to touch both files.
- Background removal (`RemBGSession+`) uses the `isnet-general-use` rembg
  model over the `CPU` execution provider — it's a small model, so this stays
  fast without depending on `onnxruntime-rocm` being installed. Switch node
  18's `providers` to `ROCM` later if you've confirmed that package is
  present and want it off the CPU. rembg downloads the model to its own
  cache on first use, so the first run needs internet access.
- `remove_background` and `remove_shadows` are real `ComfySwitchNode`
  branches (ComfyUI's lazy evaluation means the unused branch's nodes don't
  execute at all when a toggle is off), not just cosmetic flags.
- Requires `ComfyUI_essentials` installed alongside `ComfyUI-Hunyuan3DWrapper`
  for the background-removal nodes.
- VRAM is dominated by three diffusion models in sequence (shape, delight,
  paint) — 12GB is a practical floor, 16GB+ recommended.
