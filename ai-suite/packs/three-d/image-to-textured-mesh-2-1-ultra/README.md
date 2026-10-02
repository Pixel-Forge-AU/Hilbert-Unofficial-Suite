# Image to Textured 3D Model (Hunyuan3D 2.1, Ultra Detail)

Ultra-detail variant of [`three-d.image-to-textured-mesh-2-1`](../image-to-textured-mesh-2-1/README.md).
Same Hunyuan3D-2.1 shape + PBR paint pipeline
([visualbruno/ComfyUI-Hunyuan3d-2-1](https://github.com/visualbruno/ComfyUI-Hunyuan3d-2-1)),
but pushed further in four ways. `three-d.image-to-textured-mesh-2-1` is left
completely unmodified — use this pack once you've maxed that one's sliders
and want more, not as a replacement for it.

## What's different from the base pack

1. **Every slider defaults to the underlying node's real maximum, not just
   the base pack's exposed range.** Checked directly against
   `ComfyUI-Hunyuan3d-2-1`'s node source (`repos/ComfyUI/custom_nodes/ComfyUI-Hunyuan3d-2-1/nodes.py`):
   - `shape_steps` and `paint_steps`: 100 (both nodes' hard max; base defaults to 50/10).
   - `octree_resolution`: 4096 (`Hy3D21VAEDecode`'s hard max; base defaults to 384).
   - `texture_size`: 4096 (`Hy3DMultiViewsGenerator`'s hard max; base defaults to 1024).
   - `max_facenum`: defaults to 300000, ceiling raised to 2,000,000. The base
     pack caps this at 500000, but `Hy3D21PostprocessMesh` itself accepts up
     to 10,000,000 — worth knowing, because a maxed `octree_resolution` with
     a low face cap just throws the extra geometric detail away at the
     simplification step right after. A new `reduce_faces` toggle also lets
     you skip simplification entirely for the maximum possible geometry
     (expect a very large file).
   - `view_size` is still capped at 1024 — that's this node's actual hard
     limit, not an oversight. It's the real ceiling on how much native detail
     the paint model itself can produce per view, independent of
     `texture_size`. This pack compensates for that ceiling with point 4
     below rather than pretending `texture_size` alone can exceed it.

2. **A separate reference image for texture painting** (`texture_image`).
   In the base pack, the same image drives both the mesh's shape and its
   texture. Here, `Hy3DMultiViewsGenerator`'s `image` input is wired to its
   own `LoadImage` → background-removal chain, independent of the shape
   image. Leave it as the default to reproduce the base pack's single-image
   behavior, or upload a sharper/better-lit/higher-resolution photo of the
   same subject to give the paint model more to work with than the
   (possibly lower quality) shape photo alone provides.

3. **Wider, more even bake camera coverage.** The base pack's
   `Hy3D21CameraConfig` renders only 6 fixed views (front/back/left/right/
   top/bottom) with weights that heavily favor the front (as low as 0.05 on
   the sides) — anything not facing the camera gets thin texture coverage
   almost by construction. This pack defaults to 10 views (8 evenly spaced
   around the object plus top/bottom) with much more even weights, and
   exposes `camera_azimuths`/`camera_elevations`/`view_weights` as real
   inputs so the coverage can be tuned further. `Hy3D21CameraConfig` parses
   these as plain comma-separated lists with no hardcoded view count, so
   this should work — but it hasn't been run end-to-end (see Runtime notes).

4. **Real-ESRGAN 4x upscale of the painted views before baking.** After
   `Hy3DMultiViewsGenerator` produces its per-view albedo and
   metallic-roughness images (capped at 1024px per view — see point 1), both
   are run through `UpscaleModelLoader` + `ImageUpscaleWithModel`
   (`RealESRGAN_x4plus.safetensors`) before `Hy3DBakeMultiViews` projects
   them onto the mesh's UV texture. This raises the effective source pixel
   density feeding the bake instead of just upsampling the final flat
   texture afterward. This exact pattern (upscale-then-bake) is already used
   and working in `three-d.image-to-textured-mesh` (the 2.0 pack) —
   see its `workflow-api.json` nodes 26/27 — this pack applies the same idea
   to 2.1's separate albedo/MR channels.

## Runtime notes — read before running

- **Confirmed bugs found and fixed by actually running this pack:**
  - `Hy3D21MeshGenerator` (node 6) wants a `model` value selected from a
    fixed filename dropdown, not a socket connection — wiring
    `Hy3D21ModelLoader`'s `STRING` `model_path` output into it (which is what
    the base `three-d.image-to-textured-mesh-2-1` pack still does) fails
    ComfyUI's own prompt validation with a `return_type_mismatch` error
    before anything even runs. Fixed here by swapping in
    `Hy3D21MeshGenerator2`, which is built to take `model_path` as a
    `STRING` input instead.
  - `enable_flash_vdm`'s hierarchical decoder is broken on this machine at
    essentially any resolution, not just very high ones. Its `dilate()` step
    (`volume_decoders.py`, a `conv3d` used for morphological refinement
    between resolution-ladder levels) throws `RuntimeError: CUDA error:
    HIPBLAS_STATUS_NOT_SUPPORTED` — a ROCm/hipBLAS limitation — as soon as
    the ladder has more than one level. Confirmed failing identically at
    `octree_resolution` 4096 (ladder top ~4032) and 2048 (ladder top 2016);
    the ladder is built by doubling from a base of ~63
    (63→126→252→504→1008→2016→4032...), so even the base pack's own default
    of 384 would build a 3-level ladder (63→126→252) and likely hit this
    same crash — this looks like an environment-wide incompatibility with
    this specific op on this GPU, not something specific to pushing
    resolution high.
  - Because of that, `enable_flash_vdm` is off here and mesh extraction uses
    the plain dense decoder instead, which allocates one
    `(octree_resolution+1)^3` float32 array up front — confirmed to
    correctly compute to a 256GiB allocation (and fail) at 4096, so this
    path's memory cost is fully explicit and controlled directly by
    `octree_resolution` rather than by an opaque hierarchical algorithm.
    Defaulted to 1536 (~14.5GB) as a safe, still-well-above-the-base-pack's-384
    starting point; 2048 (~34GB), 2560 (~67GB) are reasonable steps up from
    there if you have the memory headroom, but none of these dense-mode
    resolutions have been confirmed to actually complete a run yet.
- Everything else about this pack is still unverified beyond the run(s)
  that surfaced the bugs above:
  - Whether `Hy3DBakeMultiViews`/the underlying `bake_from_multiview` call
    truly has no hardcoded assumption of exactly 6 views.
  - Whether `dmc` (vs `mc`) is actually the better default for this
    wrapper's marching-cubes extraction — the base pack's README flags this
    as unconfirmed; this pack picks `dmc` as a default worth trying, not a
    verified improvement.
  - VRAM/time headroom with `enable_flash_vdm` off at full resolution — this
    decoder path is slower and more memory-hungry by design (that's what
    FlashVDM exists to avoid); hardware numbers below are still an estimate,
    not a measured figure.
- Shares the base pack's model auto-download behavior (~15GB on first run:
  dit + vae checkpoints, plus the full PBR paint diffusers pipeline) and
  `HF_HUB_ENABLE_HF_TRANSFER=1` requirement.
- `RealESRGAN_x4plus.safetensors` must be present in
  `models/upscale_models/` (auto-downloadable via the model manager, same
  source as `three-d.image-to-textured-mesh` already uses).
- Background removal on `texture_image` is always on (not exposed as a
  separate toggle) — only the shape image's `remove_background` is
  user-controlled, to avoid two switches sharing state in a way the current
  input-routing (one manifest input → one node) can't cleanly express.

## Inputs

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| image | file | example.png | Drives the mesh's shape |
| texture_image | file | example.png | Optional separate image driving the PBR texture paint; defaults to the same file as `image` |
| remove_background | boolean | true | Background removal for the shape image (texture image is always background-removed) |
| shape_steps | integer | 100 | Diffusion steps for shape generation (node maximum) |
| shape_guidance_scale | number | 5.0 | Guidance scale for shape generation (unchanged from base — not a detail lever) |
| shape_seed | integer | 123 | Shape generation seed |
| attention_mode | choice | sdpa | sdpa or sageattn |
| box_v | number | 1.01 | Bounding-box padding for shape decoding |
| octree_resolution | integer | 1536 | Geometry detail for shape decoding; directly sets dense-decode memory use (~14.5GB at 1536) - see Runtime notes |
| mc_algo | choice | dmc | Marching cubes algorithm: mc or dmc (dmc is the untested-but-promising default here) |
| enable_flash_vdm | boolean | false | Hierarchical fast decoding. Off - confirmed broken on this machine's ROCm setup at almost any resolution, see Runtime notes |
| max_facenum | integer | 300000 | Mesh face cap after shape decoding (ceiling raised to 2,000,000) |
| reduce_faces | boolean | true | Off = export the raw, unsimplified mesh (can be huge) |
| smooth_normals | boolean | false | Smooth shading on the postprocessed mesh |
| camera_azimuths / camera_elevations / view_weights | text | 10-view spread | Bake camera coverage — see point 3 above |
| ortho_scale | number | 1.0 | Bake camera ortho scale |
| view_size | integer | 1024 | Per-view paint resolution (node's hard maximum) |
| paint_steps | integer | 100 | Diffusion steps for the paint model (node maximum) |
| paint_guidance_scale | number | 3.0 | Guidance scale for the paint model |
| texture_size | integer | 4096 | Baked UV texture resolution (node maximum) |
| paint_seed | integer | 123 | Paint model seed |
| filename_prefix | text | 3d/image-to-textured-mesh-2.1-ultra | Output folder/prefix |

## How it works

1. The shape reference image optionally gets its background stripped
   (`RemBGSession+` / `ImageRemoveBackground+` → `MaskToImage` + `ImageBlend`
   multiply → `ComfySwitchNode`), controlled by `remove_background`. The
   texture reference image goes through the same chain, sharing the loaded
   `RemBGSession+`, always with background removal on.
2. `Hy3D21ModelLoader` returns the shape model's path and a loaded VAE,
   auto-downloading both if missing.
3. `Hy3D21MeshGenerator` generates raw shape latents from the processed
   shape image at `shape_steps`/`shape_guidance_scale`.
4. `Hy3D21VAEDecode` decodes latents to a mesh at `octree_resolution` using
   `mc_algo`.
5. `Hy3D21PostprocessMesh` removes floaters/degenerate faces and, if
   `reduce_faces` is on, reduces to `max_facenum`.
6. `Hy3D21CameraConfig` defines the (now wider, more even) render views.
7. `Hy3DMultiViewsGenerator` unwraps UVs and paints matching albedo +
   metallic-roughness views at `view_size`, conditioned on the processed
   texture image, auto-downloading the PBR paint pipeline on first use.
8. Both painted view sets are upscaled 4x with `RealESRGAN_x4plus` via
   `UpscaleModelLoader` + `ImageUpscaleWithModel`.
9. `Hy3DBakeMultiViews` bakes the upscaled texture sets onto the mesh's UVs
   at `texture_size`.
10. `Hy3DInPaint` fills any gaps left in either texture.
11. `Hy3D21ExportMesh` exports the final mesh as a GLB with separate albedo
    and metallic-roughness textures.
