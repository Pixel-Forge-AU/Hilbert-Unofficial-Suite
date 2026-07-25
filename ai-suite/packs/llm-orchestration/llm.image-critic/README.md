# LLM Image Critic

Evaluate and critique generated images using LLM intelligence.

## Overview

This workflow analyzes generated images to provide constructive feedback on:
- Composition and visual balance
- Quality and clarity
- Adherence to original prompt
- Strengths and areas for improvement
- Overall quality scoring

## Specifications

- **LLM Models**: GPT-4o, Claude 3.5 Sonnet, Llama 3 70B
- **Critique Depths**: 1 (quick), 2 (detailed), 3 (expert analysis)
- **Focus Areas**: All aspects or specific areas (composition, lighting, anatomy, etc.)
- **Best For**: Quality assurance, iterative refinement, feedback

## Hardware Requirements

- **Minimum VRAM**: 8 GB
- **Recommended VRAM**: 16 GB
- **Low VRAM Support**: Yes
- **CPU Offload**: Supported

## Input Parameters

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| image | image | required | Image to evaluate and critique |
| original_prompt | text | optional | Original prompt used to generate the image |
| critique_depth | int | 2 | Depth of critique (1=quick, 2=detailed, 3=expert analysis) |
| focus_areas | text | "all" | Specific areas to focus on (composition, lighting, anatomy, etc.) |
| llm_model | text | "gpt-4o" | LLM model to use for analysis |

## Model Compatibility

Supports multiple LLM models:
- GPT-4o (best quality, fastest)
- GPT-4 Turbo
- Claude 3.5 Sonnet
- Llama 3 70B
- Other compatible LLMs

## Presets

| Preset | Critique Depth | Analysis | Use Case |
|--------|----------------|----------|----------|
| quick | 1 | Surface level | Fast evaluation, batch processing |
| detailed | 2 | Comprehensive | Detailed analysis for quality control |
| expert | 3 | In-depth | Expert-level critique for final review |

## Example Usage

### Input
- **Image**: Generated image from prompt "a futuristic city with flying cars"
- **Critique Depth**: 2 (detailed)

### Output
```json
{
  "critique": "The composition effectively leads the eye through the city...",
  "strengths": "Excellent use of lighting, good color palette",
  "weaknesses": "Some distant elements appear too small, perspective could be improved",
  "score": 8.5
}
```

## Usage

### Quick Start

1. Load the workflow in ComfyUI
2. Load or generate the image to critique
3. Select critique depth
4. Click "Queue Prompt"
5. Review the comprehensive critique

### API Usage

```bash
curl -X POST http://localhost:39000/workflows/llm.image-critic/run \
  -H "Content-Type: application/json" \
  -d '{
    "image": "path/to/generated_image.png",
    "original_prompt": "a futuristic city with flying cars",
    "critique_depth": 2,
    "llm_model": "gpt-4o"
  }'
```

Response:
```json
{
  "critique": "Comprehensive critique...",
  "strengths": "Identified strengths...",
  "weaknesses": "Identified weaknesses...",
  "score": 8.5
}
```

## Tips for Best Results

1. **Use high-resolution images** - Better analysis quality
2. **Provide original prompt** - Enables prompt adherence analysis
3. **Adjust critique depth** - Higher for important images, lower for batch processing
4. **Focus areas** - Target specific concerns or use "all" for comprehensive review
5. **Iterate** - Use critique to refine prompts and regenerate

## Performance

- **LLM Processing Time**: ~3-15 seconds (depending on model and depth)
- **Memory Usage**: ~4-8 GB VRAM
- **Batch Support**: No (sequential processing only)

## See Also

- [LLM Prompt Engineer](../llm.prompt-engineer) - Enhance prompts
- [LLM Workflow Router](../llm.workflow-router) - Route to appropriate workflow
- [LLM Best of N](../llm.best-of-n) - Generate and select best variants
- [LLM Iterative Refinement](../llm.iterative-refinement) - Multi-step improvement