# Battle Damage & Wear Workflow

Apply realistic battle damage including dirt, blood, torn clothing, and combat wear to characters and surfaces. Creates gritty, battle-worn effects perfect for horror and action scenes.

## Description

This workflow generates battle-worn and damaged appearances with customizable levels of:
- Blood splatter and stains
- Dirt and grime accumulation
- Torn and cut clothing damage
- General combat wear and tear

Perfect for horror scenes, action sequences, character design with damage, and gritty visual effects.

## Usage

### API

```
POST /api/v1/generate/horror-battle-damage
```

### Presets

- **Subtle**: Minimal damage for realistic wear
- **Cinematic**: Moderate damage with dramatic blood effects
- **Extreme**: Heavy damage with maximum gore effects

## Input Parameters

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| image | string | required | Base image to apply battle damage to |
| prompt | string | "" | Positive prompt for additional details |
| negative_prompt | string | "" | Negative prompt for undesirable elements |
| damage_intensity | number | 0.7 | Intensity of battle damage (0=none, 1=extreme) |
| blood_amount | number | 0.6 | Amount of blood effect (0=none, 1=heavy) |
| dirt_amount | number | 0.5 | Amount of dirt and grime (0=none, 1=heavy) |
| tear_amount | number | 0.4 | Amount of torn/cut damage (0=none, 1=extreme) |
| seed | integer | -1 | Random seed (-1 for random) |
| cfg | number | 7.0 | Guidance scale |
| steps | integer | 25 | Number of inference steps |

## Models

### Required
- Checkpoint: flux, sdxl, sd15, qwen, wan, hunyuan
- VAE: ae, vae-ft-mse-840000-ema-pruned

### Optional
- ControlNet: depth, canny, normal
- LoRA: damage-overlay, blood-textures, dirt-grime, torn-cloth

## Hardware Requirements

- Minimum VRAM: 12 GB
- Recommended VRAM: 24 GB
- Supports Low VRAM mode
- Supports CPU offload

## Presets

### Subtle
- Damage intensity: 0.3-0.4
- Blood amount: 0.2-0.3
- Dirt amount: 0.4-0.5
- Tear amount: 0.2-0.3
- Realistic minimal wear

### Cinematic
- Damage intensity: 0.6-0.7
- Blood amount: 0.5-0.6
- Dirt amount: 0.5-0.6
- Tear amount: 0.4-0.5
- Dramatic action effects

### Extreme
- Damage intensity: 0.8-1.0
- Blood amount: 0.8-1.0
- Dirt amount: 0.7-0.9
- Tear amount: 0.7-1.0
- Maximum gore effects

## Example

```bash
curl -X POST http://localhost:8080/api/v1/generate/horror-battle-damage \
  -H "Content-Type: application/json" \
  -d '{
    "image": "https://example.com/character.jpg",
    "prompt": "battle damage, blood splatter, torn clothing, dirt and grime",
    "negative_prompt": "clean, fresh, new, pristine",
    "damage_intensity": 0.7,
    "blood_amount": 0.6,
    "dirt_amount": 0.5,
    "tear_amount": 0.4,
    "seed": 42,
    "cfg": 7.0,
    "steps": 25
  }'
```

## Output

Generated image with dimensions:
- Width: 1024-2048 pixels (original image scaled)
- Height: 1024-2048 pixels (original image scaled)
- Format: WEBP
- Contains: Battle damage effects including blood, dirt, and torn clothing