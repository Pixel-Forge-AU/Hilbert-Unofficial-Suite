# LLM Best of N

Generate multiple variants and use LLM to select the best one.

## Overview

This workflow generates multiple variants of an output and uses LLM intelligence to evaluate and select the best one based on quality criteria.
Perfect for scenarios where you want multiple options and need intelligent selection.

## Specifications

- **LLM Models**: GPT-4o, Claude 3.5 Sonnet, Llama 3 70B
- **Generation Modes**: Multiple variant generation
- **Evaluation**: LLM-based scoring and selection
- **Best For**: Content optimization, variant testing, quality selection

## Hardware Requirements

- **Minimum VRAM**: 8 GB
- **Recommended VRAM**: 16 GB
- **Low VRAM Support**: Yes
- **CPU Offload**: Supported

## Input Parameters

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| input_prompt | text | required | Base prompt for generating variants |
| num_variants | integer | 3 | Number of variants to generate (1-10) |
| llm_model | text | "gpt-4o" | LLM model for evaluation |
| evaluation_criteria | text | "quality, creativity, relevance" | Criteria for selecting the best variant |

## Model Compatibility

Supports multiple LLM models:
- GPT-4o (best quality, fastest)
- GPT-4 Turbo
- Claude 3.5 Sonnet
- Llama 3 70B
- Other compatible LLMs

## Presets

| Preset | Variants | Temperature | Use Case |
|--------|----------|-------------|----------|
| creative | 5 | 0.7 | Creative exploration, many options |
| precise | 3 | 0.5 | Focused generation, quality over quantity |

## Example Usage

### Input
- **Input Prompt**: "a beautiful landscape photo"
- **Number of Variants**: 3
- **Evaluation Criteria**: "visual appeal, composition, creativity"

### Output
```json
{
  "selected_variant": "Variant 2",
  "variant_scores": {
    "0": 7.5,
    "1": 9.2,
    "2": 8.1
  },
  "evaluation_reasoning": "Variant 2 has exceptional composition and visual appeal with creative use of light and shadow",
  "all_variants": [
    "Variant 1 text...",
    "Variant 2 text...",
    "Variant 3 text..."
  ]
}
```

## Usage

### Quick Start

1. Load the workflow in ComfyUI
2. Enter the base prompt
3. Set the number of variants
4. Configure evaluation criteria
5. Click "Queue Prompt"
6. Review the selected best variant

### API Usage

```bash
curl -X POST http://localhost:8188/workflows/llm.best-of-n/run \
  -H "Content-Type: application/json" \
  -d '{
    "input_prompt": "a beautiful landscape photo",
    "num_variants": 3,
    "evaluation_criteria": "visual appeal, composition, creativity",
    "llm_model": "gpt-4o"
  }'
```

Response:
```json
{
  "selected_variant": "Variant 2",
  "variant_scores": {
    "0": 7.5,
    "1": 9.2,
    "2": 8.1
  },
  "evaluation_reasoning": "Variant 2 has exceptional composition and visual appeal with creative use of light and shadow",
  "all_variants": [...]
}
```

## Tips for Best Results

1. **Be specific in base prompt** - Clear prompts yield better variants
2. **Adjust variant count** - More variants = better selection but higher cost
3. **Customize evaluation criteria** - Tailor to your specific needs
4. **Review reasoning** - Learn from LLM's selection decisions
5. **Iterate if needed** - Use selected variant as base for next round

## Performance

- **Variant Generation Time**: ~3-12 seconds (depending on variant count and model)
- **Evaluation Time**: ~2-8 seconds
- **Total Processing Time**: ~5-20 seconds
- **Memory Usage**: ~4-12 GB VRAM (scales with variant count)

## Advanced Usage

### Multi-stage Optimization

1. Generate 5 variants
2. Select best using LLM
3. Use selected variant as base for refinement
4. Iterate until satisfied

### Custom Evaluation Scoring

```json
{
  "input_prompt": "a futuristic city",
  "num_variants": 4,
  "evaluation_criteria": "futuristic elements, realism, color palette, composition",
  "llm_model": "gpt-4o"
}
```

## See Also

- [LLM Prompt Engineer](../llm.prompt-engineer) - Enhance prompts
- [LLM Image Critic](../llm.image-critic) - Evaluate images
- [LLM Workflow Router](../llm.workflow-router) - Intelligent routing
- [LLM Iterative Refinement](../llm.iterative-refinement) - Multi-step improvement