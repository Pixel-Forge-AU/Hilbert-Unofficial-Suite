# LLM Workflow Router

Route to appropriate workflow based on intent analysis using LLM intelligence.

## Overview

This workflow analyzes user input or context to determine the best workflow for the task.
It supports dynamic routing between prompt engineering, image evaluation, and generation workflows.

## Specifications

- **LLM Models**: GPT-4o, Claude 3.5 Sonnet, Llama 3 70B
- **Routing Modes**: Dynamic intent-based routing
- **Supported Workflows**: All registered workflows (configurable)
- **Best For**: Workflow orchestration, intelligent routing, automation

## Hardware Requirements

- **Minimum VRAM**: 8 GB
- **Recommended VRAM**: 16 GB
- **Low VRAM Support**: Yes
- **CPU Offload**: Supported

## Input Parameters

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| input_text | text | required | Input text or query to analyze for routing |
| context | text | optional | Additional context for routing decisions |
| available_workflows | text | "all" | Comma-separated list of available workflow IDs to consider |
| llm_model | text | "gpt-4o" | LLM model to use for intent analysis |

## Model Compatibility

Supports multiple LLM models:
- GPT-4o (best quality, fastest)
- GPT-4 Turbo
- Claude 3.5 Sonnet
- Llama 3 70B
- Other compatible LLMs

## Presets

| Preset | Confidence Threshold | Analysis | Use Case |
|--------|---------------------|----------|----------|
| balanced | 0.5 | Moderate | General purpose routing |
| creative | 0.3 | High | Creative workflows, exploration |
| precise | 0.7 | Strict | Precision-critical routing |

## Example Usage

### Input
- **Input Text**: "Enhance this prompt: a beautiful landscape"
- **Context**: "User wants better results for image generation"

### Output
```json
{
  "selected_workflow": "llm.prompt-engineer",
  "confidence": 0.92,
  "reasoning": "The input specifically requests prompt enhancement for better image generation results",
  "parameters": {
    "enhancement_level": 3,
    "llm_model": "gpt-4o"
  }
}
```

## Usage

### Quick Start

1. Load the workflow in ComfyUI
2. Enter the input text to route
3. Optionally provide additional context
4. Click "Queue Prompt"
5. Use the selected workflow in your pipeline

### API Usage

```bash
curl -X POST http://localhost:39000/workflows/llm.workflow-router/run \
  -H "Content-Type: application/json" \
  -d '{
    "input_text": "Critique this generated image",
    "context": "Image was generated from prompt: a futuristic city",
    "available_workflows": "llm.prompt-engineer,llm.image-critic,llm.workflow-router,llm.best-of-n,llm.iterative-refinement",
    "llm_model": "gpt-4o"
  }'
```

Response:
```json
{
  "selected_workflow": "llm.image-critic",
  "confidence": 0.88,
  "reasoning": "The input specifically requests image critique functionality",
  "parameters": {
    "critique_depth": 2,
    "llm_model": "gpt-4o"
  }
}
```

## Supported Workflows

| Workflow ID | Description | Best For |
|-------------|-------------|----------|
| llm.prompt-engineer | Prompt enhancement | Improving prompts |
| llm.image-critic | Image evaluation | Quality assessment |
| llm.workflow-router | Workflow routing | Orchestration |
| llm.best-of-n | Variant selection | Quality optimization |
| llm.iterative-refinement | Multi-step improvement | Progressive refinement |

## Tips for Best Results

1. **Be specific in input** - Clear intent leads to better routing
2. **Provide context** - Additional context improves accuracy
3. **Configure available workflows** - Only include relevant workflows
4. **Review reasoning** - Learn from LLM's routing decisions
5. **Adjust confidence thresholds** - Higher for critical routing

## Performance

- **LLM Processing Time**: ~2-8 seconds (depending on model)
- **Memory Usage**: ~4-8 GB VRAM
- **Batch Support**: No (sequential processing only)

## See Also

- [LLM Prompt Engineer](../llm.prompt-engineer) - Enhance prompts
- [LLM Image Critic](../llm.image-critic) - Evaluate images
- [LLM Best of N](../llm.best-of-n) - Generate and select best variants
- [LLM Iterative Refinement](../llm.iterative-refinement) - Multi-step improvement