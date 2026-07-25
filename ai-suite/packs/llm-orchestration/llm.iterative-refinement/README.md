# LLM Iterative Refinement

Refine content through multiple iterations using LLM feedback.

## Overview

This workflow refines content through multiple iterations using LLM feedback, perfect for progressive improvement and quality optimization.
Supports text, images, and other content types with automated feedback loops.

## Specifications

- **LLM Models**: GPT-4o, Claude 3.5 Sonnet, Llama 3 70B
- **Refinement Modes**: Multi-stage iterative improvement
- **Feedback**: Automated LLM-driven feedback
- **Best For**: Content optimization, quality improvement, multi-stage refinement

## Hardware Requirements

- **Minimum VRAM**: 8 GB
- **Recommended VRAM**: 16 GB
- **Low VRAM Support**: Yes
- **CPU Offload**: Supported

## Input Parameters

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| initial_content | text | required | Initial content to refine |
| refinement_iterations | integer | 3 | Number of refinement iterations (1-10) |
| llm_model | text | "gpt-4o" | LLM model for feedback |
| refinement_focus | text | "overall quality" | Primary focus area for refinement |

## Model Compatibility

Supports multiple LLM models:
- GPT-4o (best quality, fastest)
- GPT-4 Turbo
- Claude 3.5 Sonnet
- Llama 3 70B
- Other compatible LLMs

## Presets

| Preset | Iterations | Temperature | Use Case |
|--------|------------|-------------|----------|
| thorough | 5 | 0.5 | Deep refinement, maximum quality |
| efficient | 3 | 0.6 | Balanced refinement, efficient processing |

## Example Usage

### Input
- **Initial Content**: "a landscape photo"
- **Refinement Iterations**: 3
- **Refinement Focus**: "visual composition and detail"

### Output
```json
{
  "final_content": "A breathtaking landscape photo featuring a serene mountain lake at golden hour...",
  "iteration_history": [
    {
      "iteration": 1,
      "content": "a landscape photo",
      "feedback": "Add more specific details about the scene..."
    },
    {
      "iteration": 2,
      "content": "a landscape photo with mountains and water",
      "feedback": "Enhance the visual composition with lighting details..."
    },
    {
      "iteration": 3,
      "content": "a breathtaking landscape photo...",
      "feedback": "Excellent work, final details added."
    }
  ],
  "feedback_summary": "Improved composition and added specific visual details...",
  "improvement_metrics": {
    "initial_score": 3.2,
    "final_score": 8.7,
    "improvement_percentage": 171.9
  }
}
```

## Usage

### Quick Start

1. Load the workflow in ComfyUI
2. Enter the initial content
3. Set the number of refinement iterations
4. Specify refinement focus area
5. Click "Queue Prompt"
6. Review the refined final content

### API Usage

```bash
curl -X POST http://localhost:39000/workflows/llm.iterative-refinement/run \
  -H "Content-Type: application/json" \
  -d '{
    "initial_content": "a landscape photo",
    "refinement_iterations": 3,
    "refinement_focus": "visual composition and detail",
    "llm_model": "gpt-4o"
  }'
```

Response:
```json
{
  "final_content": "...",
  "iteration_history": [...],
  "feedback_summary": "...",
  "improvement_metrics": {...}
}
```

## Tips for Best Results

1. **Start with clear content** - Better initial input leads to better refinement
2. **Specify focus areas** - Clear focus guides targeted improvement
3. **Adjust iteration count** - More iterations = better results but higher cost
4. **Review feedback** - Learn from LLM's improvement suggestions
5. **Iterate on refined output** - Use output as new starting point

## Performance

- **Per-Iteration Time**: ~2-8 seconds (depending on model and content length)
- **Total Processing Time**: ~6-40 seconds (based on iteration count)
- **Memory Usage**: ~4-12 GB VRAM (scales with iteration count)

## Advanced Usage

### Multi-stage Optimization

1. Generate initial version
2. Refine for 3 iterations
3. Use refined output as base for next refinement stage
4. Continue until desired quality achieved

### Custom Refinement Focus

```json
{
  "initial_content": "a product description",
  "refinement_iterations": 4,
  "refinement_focus": "clarity, persuasive language, technical accuracy",
  "llm_model": "gpt-4o"
}
```

## See Also

- [LLM Prompt Engineer](../llm.prompt-engineer) - Enhance prompts
- [LLM Image Critic](../llm.image-critic) - Evaluate images
- [LLM Workflow Router](../llm.workflow-router) - Intelligent routing
- [LLM Best of N](../llm.best-of-n) - Generate and select best variants