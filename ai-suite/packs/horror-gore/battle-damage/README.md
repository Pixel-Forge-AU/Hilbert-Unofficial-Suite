# Battle Damage & Wear Workflow

Apply realistic battle damage — dirt, blood, torn clothing, and combat wear — to a photo. Creates gritty, battle-worn effects perfect for horror and action scenes.

## How it works

This is an img2img redraw of the uploaded photo: the source image is scaled, VAE-encoded, and redrawn by an SDXL/SD1.5 checkpoint with `damage_intensity` as the denoise strength (0 = barely touched, 1 = fully redrawn). The blood/dirt/tear sliders each blend a dedicated concept prompt ("blood splatter, blood stains...", "dirt, grime, mud...", "torn fabric, ripped clothing...") into the positive conditioning via `ConditioningAverage`, on top of whatever you write in `prompt`.

## Input Parameters

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| checkpoint | model | reedXXXIllustrious_v150.safetensors | SDXL/SD1.5 checkpoint to sample with |
| image | file | required | Photo to apply battle damage to |
| prompt | textarea | see manifest | Positive prompt for additional details |
| negative_prompt | textarea | see manifest | Negative prompt for undesirable elements |
| damage_intensity | float | 0.7 | How strongly the source is redrawn (denoise strength) |
| blood_amount | float | 0.6 | How much the blood-splatter concept is blended in |
| dirt_amount | float | 0.5 | How much the dirt/grime concept is blended in |
| tear_amount | float | 0.4 | How much the torn-cloth concept is blended in |
| seed | int | -1 | Random seed (-1 for random) |
| cfg | float | 7.0 | Classifier-free guidance scale |
| steps | int | 25 | Number of inference steps |
| width / height | int | 1024 / 1024 | Source image is scaled to this before redrawing |

## Presets

- **Subtle** — minimal damage for realistic wear
- **Cinematic** — moderate damage with dramatic blood effects
- **Extreme** — heavy damage with maximum gore effects

## Models

- Checkpoint: any installed SDXL or SD1.5 checkpoint (defaults to `reedXXXIllustrious_v150.safetensors`)

## Hardware Requirements

- Minimum VRAM: 6 GB
- Recommended VRAM: 12 GB
- Supports Low VRAM mode
- Supports CPU offload

## Output

Redrawn image (WEBP), same aspect ratio as the scaled source.
