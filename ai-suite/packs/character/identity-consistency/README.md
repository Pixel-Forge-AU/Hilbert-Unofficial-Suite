# Character Identity Consistency

Stable reference-preserving character edits using a local ComfyUI SDXL img2img
graph.

This pack preserves identity by starting from the uploaded reference image and
keeping sampler denoise low. It is good for polish, lighting, cleanup, and modest
style changes. It is not InstantID, PuLID, or IPAdapter face transfer.

## Inputs

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| identity_image | file | example.png | Source image used as the identity reference |
| prompt | textarea | polished portrait edit | Requested modest change |
| identity_mode | select | balanced | strict, balanced, or creative preservation |
| negative_prompt | textarea | identity-change negatives | Things to avoid |
| edit_strength | number | 0.22 | Lower preserves the reference more; higher follows the prompt more |
| width | integer | 768 | Output width |
| height | integer | 768 | Output height |
| seed | integer | -1 | Random seed; -1 randomizes |
| cfg | number | 5.5 | Guidance scale |
| steps | integer | 30 | Sampling steps |

Use `strict` for the strongest preservation, `balanced` for ordinary portrait
edits, and `creative` only when some drift is acceptable.
