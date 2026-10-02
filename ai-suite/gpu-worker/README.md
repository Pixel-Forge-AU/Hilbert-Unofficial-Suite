# GPU Worker

GPU Worker is a small control-plane service for a separate Ubuntu CUDA box that runs
multiple ComfyUI instances and routes heavier image, video, and image-to-3D jobs to
the best available GPU.

The intended topology is:

- AI Suite / Studio stays on the main inference box.
- The Ubuntu GPU box mounts or syncs the same workflow/model/output storage.
- One ComfyUI process runs per GPU, pinned with `CUDA_VISIBLE_DEVICES`.
- `gpu-worker` exposes one HTTP API on port `39018`.
- Studio can later target `gpu-worker` instead of the local ComfyUI endpoint for
  heavy workflows.

## Quick Start On The Ubuntu GPU Box

```bash
cd /path/to/ai-suite/gpu-worker
python3 -m venv .venv
. .venv/bin/activate
pip install -r requirements.txt
cp config.example.yaml config.yaml
```

Edit `config.yaml` so `comfy_root` points at the local ComfyUI checkout and the
GPU ids match `nvidia-smi`.

Start one ComfyUI shard per configured GPU:

```bash
./scripts/start-comfy-shards.sh config.yaml
```

Start the dispatcher:

```bash
uvicorn worker_api:app --host 0.0.0.0 --port 39018
```

If this folder is part of the AI Suite checkout on the Ubuntu box, the dispatcher can
also be managed with:

```bash
../ai-switch gpu-worker
../ai-switch gpu-worker-stop
```

## Direct API

Submit a ComfyUI prompt:

```bash
curl -X POST http://GPU_BOX:39018/v1/jobs \
  -H "content-type: application/json" \
  -d @workflow-api.json
```

Submit with routing hints:

```json
{
  "prompt": { "3": { "class_type": "KSampler", "inputs": {} } },
  "workflow_type": "video",
  "priority": 50,
  "client_id": "studio"
}
```

Check status:

```bash
curl http://GPU_BOX:39018/v1/jobs/JOB_ID
curl http://GPU_BOX:39018/v1/workers
```

## Routing Defaults

The example config assumes three 16GB Tesla P100 workers. Studio keeps jobs
requiring more than 16GB, and explicitly unsupported workflows such as MiniMax
H3, on its main ComfyUI instance.

Adjust tags and `max_inflight` in `config.yaml` after watching real VRAM pressure.
