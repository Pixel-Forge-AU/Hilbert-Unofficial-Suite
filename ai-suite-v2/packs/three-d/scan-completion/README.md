# Scan/View Completion Mesh

Complete a sparse object scan or limited photo set into a GLB mesh using the local
Hunyuan3D multi-view workflow.

This pack reconstructs from images: a front/reference view and, optionally, a
back or secondary view. It does not perform direct OBJ/STL mesh inpainting because
this suite does not currently include a local mesh-gap-fill model.

## Inputs

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| front_image | file | 3d_hunyuan3d_multiview_to_model_front_image.png | Primary scan/photo view |
| back_image | file | 3d_hunyuan3d_multiview_to_model_back_image.png | Optional opposite or secondary view |
| steps | integer | 20 | Sampling steps |
| cfg | number | 7.5 | Guidance scale |
| seed | integer | -1 | Random seed; -1 randomizes |
| mesh_threshold | number | 0.6 | Voxel-to-mesh extraction threshold |
| mesh_resolution | integer | 3072 | Hunyuan3D latent/mesh resolution |
| filename_prefix | text | mesh/scan-completion | Output path prefix |

## Notes

Use clean object photos or scan renders on a plain background. A back/secondary
view helps fill hidden geometry, but the result is a reconstructed approximation
rather than a surgical repair of an existing mesh file.

## Output

The workflow saves a GLB mesh suitable for previewing in the Studio library or
opening in a 3D viewer.
