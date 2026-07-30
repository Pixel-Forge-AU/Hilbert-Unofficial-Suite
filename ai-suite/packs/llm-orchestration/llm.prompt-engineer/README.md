# LLM Prompt Engineer

Enhance and refine prompts using LLM intelligence for better image generation results.

## Overview

This workflow analyzes and optimizes prompts with natural language processing to improve output quality, consistency, and creative potential. It's perfect for:

- Improving vague or simple prompts
- Adding professional quality keywords
- Enhancing creative potential with better descriptors
- Generating complementary negative prompts
- Analyzing prompt effectiveness

## Specifications

- **LLM Models**: GPT-4o, Claude 3.5 Sonnet, Llama 3 70B
- **Max Prompt Length**: 500 characters
- **Enhancement Levels**: 1-5 (minimal to maximum creativity)
- **Best For**: Prompt refinement, quality improvement, creative enhancement

## Hardware Requirements

- **Minimum VRAM**: 8 GB
- **Recommended VRAM**: 16 GB
- **Low VRAM Support**: Yes
- **CPU Offload**: Supported

## Input Parameters

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| prompt | text | required | Original prompt to enhance and refine |
| negative_prompt | text | optional | Negative prompt for unwanted elements |
| enhancement_level | int | 2 | Level of enhancement (1=minimal, 5=maximum creativity) |
| style_presets | text | "masterpiece, best quality" | Style presets to apply |
| llm_model | text | "gpt-4o" | LLM model to use for enhancement |

## Model Compatibility

Supports multiple LLM models:
- GPT-4o (best quality, fastest)
- GPT-4 Turbo
- Claude 3.5 Sonnet
- Llama 3 70B
- Qwen 2 72B
- Other compatible LLMs

## Presets

| Preset | Enhancement Level | Creativity | Use Case |
|--------|-------------------|------------|----------|
| creative | 4-5 | High | Maximum creativity, artistic |
| precise | 1-2 | Low | Fidelity to original, technical |

## Example Input

```
Input: "a cat"
Enhanced: "a fluffy ginger tabby cat sitting gracefully on a windowsill, sunlight illuminating its fur, highly detailed, professional photography, 8k resolution, masterpiece quality"
```

## Usage

### Quick Start

1. Load the workflow in ComfyUI
2. Enter your prompt
3. Select enhancement level
4. Click "Queue Prompt"
5. View the enhanced prompt in the output

### API Usage

```bash
curl -X POST http://localhost:39000/workflows/llm.prompt-engineer/run \
  -H "Content-Type: application/json" \
  -d '{
    "prompt": "a beautiful landscape",
    "enhancement_level": 3,
    "llm_model": "gpt-4o"
  }'
```

Response:
```json
{
  "enhanced_prompt": "masterpiece, best quality, breathtaking landscape...",
  "negative_prompt_enhanced": "low quality, blurry, lowres...",
  "analysis": "Original prompt was good but lacked specific details..."
}
```

## Tips for Best Results

1. **Be specific in original prompt** - Helps LLM understand intent
2. **Adjust enhancement level** - Higher for artistic, lower for accuracy
3. **Use style presets** - Apply consistent styles across generations
4. **Review analysis** - Learn from LLM feedback on your prompts
5. **Iterate** - Use enhanced prompts as base for next refinement

## Performance

- **LLM Processing Time**: ~2-10 seconds (depending on model)
- **Memory Usage**: ~4-8 GB VRAM
- **Batch Support**: No (sequential processing only)

## See Also

- [LLM Image Critic](../llm.image-critic) - Evaluate generated images
- [LLM Workflow Router](../llm.workflow-router) - Route to appropriate workflow
- [LLM Best of N](../llm.best-of-n) - Generate and select best variants
- [LLM Iterative Refinement](../llm.iterative-refinement) - Multi-step improvement