# DiffRhythm Audio Generation

Generate music from text prompts using the DiffRhythm model. Creates full musical tracks with rhythm and melody.

## Requirements

### ComfyUI Custom Node

This workflow requires the `comfyui-diffrhythm` custom node to be installed in ComfyUI.

#### Installation

1. Navigate to your ComfyUI custom nodes directory:
   ```bash
   cd ComfyUI/custom_nodes
   ```

2. Clone the DiffRhythm custom node:
   ```bash
   git clone https://github.com/your-org/comfyui-diffrhythm.git
   ```

3. Restart ComfyUI to load the new custom node.

## Usage

1. Open the DiffRhythm workflow in ComfyUI
2. Enter your text prompt describing the desired music
3. Adjust the generation parameters (steps, guidance, duration, etc.)
4. Click "Queue Prompt" to generate the audio

## Parameters

- **Prompt**: Text prompt describing the desired music (e.g., "A warm synthwave track with pulsing bass and dreamy pads")
- **Steps**: Number of sampling steps (default: 30)
- **Guidance**: Guidance scale for generation (default: 0.8)
- **Duration**: Duration in seconds (default: 1.0)
- **Seed**: Random seed for reproducibility (default: 1)
- **Device**: Device to run on (cuda/cpu, default: cuda)

## Output

The workflow generates an audio file in the configured output directory.

## Troubleshooting

### Missing Custom Node

If you see an error about missing nodes:
- Ensure `comfyui-diffrhythm` is installed in ComfyUI
- Restart ComfyUI after installation
- Check the ComfyUI logs for any errors

### GPU Out of Memory

If you encounter GPU out of memory errors:
- Reduce the batch size
- Lower the resolution
- Enable low VRAM mode in ComfyUI
- Use the CPU device option

## Credits

- DiffRhythm model by the original authors
- Custom node by the ComfyUI community