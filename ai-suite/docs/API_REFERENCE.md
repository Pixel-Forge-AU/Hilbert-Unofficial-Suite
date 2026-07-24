# AI Suite - API Reference

## Table of Contents

- [Overview](#overview)
- [Authentication](#authentication)
- [REST API Endpoints](#rest-api-endpoints)
- [Request and Response Schemas](#request-and-response-schemas)
- [Webhooks](#webhooks)
- [Error Handling](#error-handling)
- [Examples](#examples)

---

## Overview

AI Suite provides a comprehensive REST API for programmatic access to all workflow functionality. The API is built on Flask and follows RESTful conventions.

### API Basics

- **Base URL**: `http://localhost:8000/api`
- **Format**: JSON
- **Authentication**: Optional (for protected endpoints)
- **Rate Limiting**: Configurable

### API Versions

- **v1**: Current API version (default)
- **v2**: Upcoming version (under development)

---

## Authentication

### Overview

The API supports multiple authentication methods:

- **None**: Public endpoints
- **API Key**: Simple key-based authentication
- **Session**: Cookie-based authentication (for web UI)

### API Key Authentication

1. Generate an API key in settings:
   ```yaml
   # config/suite.yaml
   security:
     api_keys:
       - key: "your-api-key-here"
         description: "Production API key"
         permissions: ["read", "write", "admin"]
   ```

2. Include in requests:
   ```bash
   curl -H "X-API-Key: your-api-key-here" \
        http://localhost:8000/api/workflows
   ```

### Session Authentication

For web-based applications, use session authentication:

```python
import requests

# Login
session = requests.Session()
session.post("http://localhost:8000/api/auth/login", json={
    "username": "admin",
    "password": "password"
})

# Use session for authenticated requests
response = session.get("http://localhost:8000/api/jobs")
```

---

## REST API Endpoints

### Workflows

#### List All Workflows

```http
GET /api/v1/workflows
```

**Parameters**:

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `search` | string | No | Search query |
| `category` | string | No | Filter by category |
| `tag` | string | No | Filter by tag |
| `status` | string | No | Filter by status (stable/experimental) |
| `page` | integer | No | Page number (default: 1) |
| `limit` | integer | No | Results per page (default: 20) |

**Response**:

```json
{
  "workflows": [
    {
      "id": "core.text-to-image-fast",
      "name": "Fast Text-to-Image",
      "category": "core-generation",
      "subcategory": "text-to-image",
      "version": "1.0.0",
      "status": "stable",
      "description": "Fast text-to-image generation",
      "thumbnail": "/api/v1/workflows/core.text-to-image-fast/thumbnail",
      "tags": ["text-to-image", "fast", "quick"],
      "hardware": {
        "minimum_vram_gb": 4,
        "recommended_vram_gb": 8
      },
      "inputs": ["prompt", "width", "height"],
      "outputs": ["image"]
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": 1,
    "total_pages": 1
  }
}
```

#### Get Workflow Details

```http
GET /api/v1/workflows/{workflow_id}
```

**Response**:

```json
{
  "id": "character.character-sheet",
  "name": "Character Character Sheet",
  "version": "1.0.0",
  "category": "character",
  "subcategory": "character-sheet",
  "description": "Character sheet generation with multiple angles",
  "status": "stable",
  "entrypoints": {
    "ui": "workflow.json",
    "api": "workflow-api.json"
  },
  "inputs": [
    {
      "id": "prompt",
      "type": "text",
      "required": true,
      "default": "",
      "description": "Positive prompt"
    }
  ],
  "outputs": [
    {
      "id": "image",
      "type": "image",
      "description": "Generated image"
    }
  ],
  "models": {
    "required": [
      {
        "role": "checkpoint",
        "family": ["flux", "sdxl", "sd15", "sd3"]
      }
    ],
    "optional": [
      {
        "role": "lora",
        "suggested": ["character-style"]
      }
    ]
  },
  "custom_nodes": {
    "required": ["comfyui"],
    "optional": ["comfyui-impact-pack"]
  },
  "hardware": {
    "minimum_vram_gb": 8,
    "recommended_vram_gb": 16,
    "supports_low_vram": true,
    "supports_cpu_offload": true
  },
  "runtime": {
    "class": "large",
    "batch_supported": true
  },
  "content": {
    "themes": ["character-design", "reference-sheet"],
    "adult_only": false
  },
  "tags": ["character-sheet", "reference"],
  "presets": ["quick", "detailed"],
  "dependencies": {
    "models": {
      "available": ["flux", "sdxl"],
      "missing": ["vae"],
      "recommended": ["lora"]
    },
    "nodes": {
      "available": ["comfyui"],
      "missing": [],
      "recommended": ["comfyui-impact-pack"]
    }
  }
}
```

#### Get Workflow Thumbnail

```http
GET /api/v1/workflows/{workflow_id}/thumbnail
```

Returns the workflow thumbnail as a WebP image.

#### Check Workflow Dependencies

```http
GET /api/v1/workflows/{workflow_id}/dependencies
```

**Response**:

```json
{
  "models": {
    "required": [
      {"role": "checkpoint", "family": ["flux", "sdxl"]},
      {"role": "vae", "suggested": ["ae"]}
    ],
    "available": ["flux"],
    "missing": ["vae"]
  },
  "custom_nodes": {
    "required": ["comfyui"],
    "available": ["comfyui"],
    "missing": [],
    "recommended": ["comfyui-impact-pack"]
  },
  "hardware": {
    "meets_minimum": true,
    "recommended": true
  }
}
```

### Jobs

#### Create New Job

```http
POST /api/v1/jobs
```

**Request Body**:

```json
{
  "workflow_id": "character.character-sheet",
  "preset": "detailed",
  "inputs": {
    "prompt": "A beautiful character design",
    "width": 1024,
    "height": 1024
  }
}
```

**Response**:

```json
{
  "job_id": "job_01JXYZ",
  "workflow_id": "character.character-sheet",
  "preset": "detailed",
  "status": "queued",
  "created_at": "2024-01-01T00:00:00Z",
  "priority": "normal",
  "queue_position": 1
}
```

#### Get Job Status

```http
GET /api/v1/jobs/{job_id}
```

**Response**:

```json
{
  "job_id": "job_01JXYZ",
  "workflow_id": "character.character-sheet",
  "status": "running",
  "progress": 0.75,
  "created_at": "2024-01-01T00:00:00Z",
  "started_at": "2024-01-01T00:00:10Z",
  "completed_at": null,
  "outputs": [],
  "logs": [
    {"timestamp": "2024-01-01T00:00:10Z", "level": "info", "message": "Job started"},
    {"timestamp": "2024-01-01T00:00:15Z", "level": "info", "message": "ComfyUI connection established"}
  ],
  "error": null
}
```

#### Get Job Outputs

```http
GET /api/v1/jobs/{job_id}/outputs
```

**Response**:

```json
{
  "outputs": [
    {
      "id": "image",
      "type": "image",
      "path": "/output/job_01JXYZ_image_0.webp",
      "format": "webp",
      "width": 1024,
      "height": 1024
    }
  ],
  "metadata": {
    "seed": 12345,
    "steps": 30,
    "guidance": 7.5
  }
}
```

#### Cancel Job

```http
DELETE /api/v1/jobs/{job_id}
```

**Response**:

```json
{
  "job_id": "job_01JXYZ",
  "status": "cancelled",
  "cancelled_at": "2024-01-01T00:01:00Z"
}
```

#### List Jobs

```http
GET /api/v1/jobs
```

**Parameters**:

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `status` | string | No | Filter by status |
| `workflow_id` | string | No | Filter by workflow |
| `limit` | integer | No | Results per page |
| `page` | integer | No | Page number |

### Presets

#### List All Presets

```http
GET /api/v1/presets
```

**Response**:

```json
{
  "presets": [
    {
      "id": "quality-fast",
      "name": "Fast Quality",
      "category": "quality",
      "settings": {
        "steps": 12,
        "guidance": 5.0
      }
    },
    {
      "id": "hardware-low-vram",
      "name": "Low VRAM",
      "category": "hardware",
      "settings": {
        "vram_optimization": true
      }
    }
  ]
}
```

#### Get Preset Details

```http
GET /api/v1/presets/{preset_id}
```

### Models

#### List Available Models

```http
GET /api/v1/models
```

**Response**:

```json
{
  "models": [
    {
      "id": "flux/model.safetensors",
      "name": "Flux Model",
      "type": "checkpoint",
      "path": "/models/checkpoints/flux/model.safetensors",
      "family": "flux",
      "size": "12GB"
    }
  ]
}
```

#### Check Model Availability

```http
GET /api/v1/models/{model_id}
```

### Hardware

#### Get Hardware Profile

```http
GET /api/v1/hardware/profile
```

**Response**:

```json
{
  "gpu": {
    "name": "NVIDIA RTX 3090",
    "vram_gb": 24,
    "compute_capability": "8.6"
  },
  "cpu": {
    "cores": 16,
    "threads": 32
  },
  "ram_gb": 64,
  "recommended_profile": "high-vram",
  "profiles": {
    "low-vram": {
      "max_vram_gb": 8,
      "batch_size": 1
    },
    "medium-vram": {
      "max_vram_gb": 16,
      "batch_size": 4
    },
    "high-vram": {
      "max_vram_gb": 24,
      "batch_size": 8
    }
  }
}
```

### Registry

#### Refresh Registry

```http
POST /api/v1/registry/refresh
```

**Response**:

```json
{
  "status": "success",
  "refreshed_at": "2024-01-01T00:00:00Z",
  "workflows_count": 50,
  "models_count": 100,
  "nodes_count": 20
}
```

---

## Request and Response Schemas

### Common Request Schemas

#### Job Creation Request

```json
{
  "workflow_id": "character.character-sheet",
  "preset": "detailed",
  "inputs": {
    "prompt": "A beautiful character design",
    "width": 1024,
    "height": 1024,
    "seed": 12345
  },
  "options": {
    "high_priority": false,
    "skip_dependencies": false
  }
}
```

#### Input Validation

All inputs are validated against the workflow manifest:

```json
{
  "valid": true,
  "validated_inputs": {
    "prompt": "A beautiful character design",
    "width": 1024,
    "height": 1024
  },
  "errors": []
}
```

### Common Response Schemas

#### Success Response

```json
{
  "success": true,
  "data": { ... },
  "timestamp": "2024-01-01T00:00:00Z"
}
```

#### Error Response

```json
{
  "success": false,
  "error": {
    "code": "WORKFLOW_NOT_FOUND",
    "message": "Workflow 'character.character-sheet' not found",
    "details": {
      "workflow_id": "character.character-sheet"
    }
  },
  "timestamp": "2024-01-01T00:00:00Z"
}
```

#### Pagination Response

```json
{
  "data": [ ... ],
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": 100,
    "total_pages": 5
  }
}
```

---

## Webhooks

### Overview

Webhooks allow you to receive notifications when workflow jobs complete or fail.

### Webhook Configuration

1. **Create Webhook**:
   ```http
   POST /api/v1/webhooks
   ```

2. **Request Body**:
   ```json
   {
     "url": "https://your-app.com/webhook",
     "events": ["job.completed", "job.failed"],
     "secret": "your-webhook-secret",
     "active": true
   }
   ```

3. **Response**:
   ```json
   {
     "id": "webhook_01JXYZ",
     "url": "https://your-app.com/webhook",
     "events": ["job.completed", "job.failed"],
     "active": true,
     "created_at": "2024-01-01T00:00:00Z"
   }
   ```

### Webhook Events

#### Job Completed

```json
{
  "event": "job.completed",
  "timestamp": "2024-01-01T00:00:00Z",
  "job": {
    "id": "job_01JXYZ",
    "workflow_id": "character.character-sheet",
    "outputs": [
      {
        "id": "image",
        "type": "image",
        "path": "/output/job_01JXYZ_image_0.webp"
      }
    ],
    "metadata": {
      "seed": 12345,
      "steps": 30
    }
  }
}
```

#### Job Failed

```json
{
  "event": "job.failed",
  "timestamp": "2024-01-01T00:00:00Z",
  "job": {
    "id": "job_01JXYZ",
    "workflow_id": "character.character-sheet",
    "error": {
      "code": "OUT_OF_MEMORY",
      "message": "GPU out of memory"
    }
  }
}
```

### Webhook Verification

All webhooks include a signature in the `X-Webhook-Signature` header:

```python
import hmac
import hashlib

def verify_webhook(payload, signature, secret):
    expected_signature = hmac.new(
        secret.encode(),
        payload.encode(),
        hashlib.sha256
    ).hexdigest()
    return hmac.compare_digest(signature, expected_signature)
```

---

## Error Handling

### Error Codes

| Code | Description | HTTP Status |
|------|-------------|-------------|
| `WORKFLOW_NOT_FOUND` | Workflow not found | 404 |
| `INVALID_INPUT` | Invalid input parameters | 400 |
| `MISSING_DEPENDENCY` | Missing required dependency | 424 |
| `OUT_OF_MEMORY` | GPU out of memory | 424 |
| `WORKFLOW_FAILED` | Workflow execution failed | 500 |
| `QUEUE_FULL` | Job queue is full | 503 |
| `COMFYUI_UNAVAILABLE` | ComfyUI is unavailable | 503 |

### Error Response Format

```json
{
  "success": false,
  "error": {
    "code": "OUT_OF_MEMORY",
    "message": "GPU out of memory during workflow execution",
    "details": {
      "workflow_id": "character.character-sheet",
      "required_vram_gb": 16,
      "available_vram_gb": 8
    }
  }
}
```

### Retry Strategy

For transient errors (503, 504), implement exponential backoff:

```python
import time
import random

def retry_with_backoff(func, max_retries=3):
    for attempt in range(max_retries):
        try:
            return func()
        except Exception as e:
            if attempt == max_retries - 1:
                raise
            delay = 2 ** attempt + random.random()
            time.sleep(delay)
```

---

## Examples

### Python Examples

#### List All Workflows

```python
import requests

base_url = "http://localhost:8000/api/v1"

# List workflows
response = requests.get(f"{base_url}/workflows")
workflows = response.json()["workflows"]

for workflow in workflows:
    print(f"{workflow['name']} ({workflow['id']})")
```

#### Run a Workflow

```python
import requests
import json

base_url = "http://localhost:8000/api/v1"

# Create job
job_data = {
    "workflow_id": "core.text-to-image-fast",
    "preset": "quality",
    "inputs": {
        "prompt": "A beautiful landscape with mountains",
        "width": 1024,
        "height": 768
    }
}

response = requests.post(f"{base_url}/jobs", json=job_data)
job = response.json()
job_id = job["job_id"]

print(f"Job created: {job_id}")

# Monitor job progress
import time

while True:
    response = requests.get(f"{base_url}/jobs/{job_id}")
    job = response.json()
    
    print(f"Status: {job['status']}, Progress: {job['progress'] * 100:.0f}%")
    
    if job["status"] in ["completed", "failed", "cancelled"]:
        break
    
    time.sleep(1)

# Get outputs
if job["status"] == "completed":
    response = requests.get(f"{base_url}/jobs/{job_id}/outputs")
    outputs = response.json()
    
    for output in outputs["outputs"]:
        print(f"Output: {output['path']}")
```

#### Check Dependencies

```python
import requests

base_url = "http://localhost:8000/api/v1"

# Check workflow dependencies
workflow_id = "character.character-sheet"
response = requests.get(f"{base_url}/workflows/{workflow_id}/dependencies")
dependencies = response.json()

print("Model Dependencies:")
for model in dependencies["models"]["missing"]:
    print(f"  Missing: {model['role']}")

print("Node Dependencies:")
for node in dependencies["custom_nodes"]["missing"]:
    print(f"  Missing: {node}")
```

### JavaScript Examples

#### Create a Workflow Job

```javascript
const axios = require('axios');

const baseUrl = 'http://localhost:8000/api/v1';

async function runWorkflow() {
  try {
    // Create job
    const jobData = {
      workflow_id: 'core.text-to-image-fast',
      preset: 'quality',
      inputs: {
        prompt: 'A beautiful landscape with mountains',
        width: 1024,
        height: 768
      }
    };

    const jobResponse = await axios.post(`${baseUrl}/jobs`, jobData);
    const jobId = jobResponse.data.job_id;
    console.log(`Job created: ${jobId}`);

    // Monitor job
    const monitorJob = async () => {
      const response = await axios.get(`${baseUrl}/jobs/${jobId}`);
      const job = response.data;
      
      console.log(`Status: ${job.status}, Progress: ${job.progress * 100}%`);
      
      if (job.status === 'completed') {
        console.log('Job completed!');
        return job;
      } else if (job.status === 'failed') {
        console.error('Job failed:', job.error);
        return null;
      } else {
        setTimeout(monitorJob, 1000);
      }
    };

    monitorJob();

  } catch (error) {
    console.error('Error:', error.message);
  }
}

runWorkflow();
```

### cURL Examples

#### List Workflows

```bash
curl http://localhost:8000/api/v1/workflows | jq
```

#### Run Workflow

```bash
curl -X POST http://localhost:8000/api/v1/jobs \
  -H "Content-Type: application/json" \
  -d '{
    "workflow_id": "core.text-to-image-fast",
    "preset": "quality",
    "inputs": {
      "prompt": "A beautiful landscape",
      "width": 1024,
      "height": 768
    }
  }' | jq
```

#### Check Job Status

```bash
curl http://localhost:8000/api/v1/jobs/job_01JXYZ | jq
```

#### Get Job Outputs

```bash
curl http://localhost:8000/api/v1/jobs/job_01JXYZ/outputs | jq
```

---

## WebSocket API

### Overview

The WebSocket API provides real-time updates for job execution.

### Connection

```javascript
const ws = new WebSocket('ws://localhost:8000/ws/jobs');

ws.onopen = () => {
  console.log('Connected to WebSocket');
  ws.send(JSON.stringify({
    type: 'subscribe',
    job_id: 'job_01JXYZ'
  }));
};

ws.onmessage = (event) => {
  const message = JSON.parse(event.data);
  console.log('Received:', message);
};

ws.onclose = () => {
  console.log('Disconnected');
};
```

### WebSocket Messages

#### Progress Update

```json
{
  "type": "progress",
  "job_id": "job_01JXYZ",
  "progress": 0.75,
  "node": "node_id",
  "message": "Executing node"
}
```

#### Job Status Update

```json
{
  "type": "status",
  "job_id": "job_01JXYZ",
  "status": "completed"
}
```

#### Output Available

```json
{
  "type": "output",
  "job_id": "job_01JXYZ",
  "outputs": [
    {
      "id": "image",
      "type": "image",
      "path": "/output/job_01JXYZ_image_0.webp"
    }
  ]
}
```

---

*For the latest API updates and more examples, check the `/docs/api/` directory and the `/tests/api/` test suite.*