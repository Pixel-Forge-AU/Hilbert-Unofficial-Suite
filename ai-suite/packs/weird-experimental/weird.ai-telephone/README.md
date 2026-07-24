# AI Telephone

Multi-generational AI telephone game where an initial prompt is transformed through multiple AI generations, creating progressively more abstract and distorted interpretations.

## Overview

This workflow implements the classic telephone game concept with AI: start with an initial prompt and image, then have AI generate a new interpretation based on the previous output. This process repeats for multiple generations, creating increasingly abstract and transformed results.

### How It Works

1. Start with an initial prompt and generate an image
2. Use the generated image as input for the next generation
3. Apply creative modifications to the prompt at each step
4. Repeat for the specified number of generations
5. The final result is heavily transformed from the original

## Usage

### Quick Start

1. Load the workflow in ComfyUI
2. Enter your initial prompt
3. Set the number of generations (start with 3-5)
4. Click "Queue Prompt"
5. View the final transformed image

### API Usage

```bash
curl -X POST http://localhost:8188/workflows/weird.ai-telephone/run \
  -H "Content-Type: application/json" \
  -d '{
    "prompt": "A beautiful landscape",
    "generations": 5,
    "prompt_modifier": "transform this in an unusual and creative way",
    "width": 1024,
    "height": 1024,
    "cfg": 7.0
  }'
```

## Presets

### Subtle
- 2-3 generations
- Conservative modifications
- Maintains original concept
- Good for experimentation

### Extreme
- 5-10 generations
- Aggressive transformations
- Highly abstract results
- Maximum creative distortion

## Parameters

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| prompt | text | required | Initial prompt to start the telephone game |
| generations | int | 5 | Number of generations to run through |
| prompt_modifier | text | transform in unusual way | Instruction to modify prompt each generation |
| width | int | 1024 | Output image width in pixels |
| height | int | 1024 | Output image height in pixels |
| seed | int | -1 | Random seed (-1 for random) |
| cfg | float | 7.0 | Classifier-free guidance scale |

## Example Prompts

```
A cat sitting on a windowsill
A city skyline at sunset
A forest with waterfalls
A futuristic robot
An abstract geometric pattern
```

## Tips for Best Results

1. **Start simple** - Begin with clear, descriptive prompts
2. **Moderate generations** - 3-5 generations usually work best
3. **Experiment with modifiers** - Try different transformation instructions
4. **Check intermediate results** - View each generation to see the evolution
5. **Vary the seed** - Different seeds create different transformation paths

## Hardware Requirements

- **Minimum VRAM**: 4 GB
- **Recommended VRAM**: 8 GB
- **Low VRAM Support**: Yes
- **CPU Offload**: Supported

## Performance

- **Generation Time**: ~5-15 seconds per generation (depending on hardware)
- **Total Time**: Scales linearly with number of generations
- **Batch Support**: No (sequential processing required)