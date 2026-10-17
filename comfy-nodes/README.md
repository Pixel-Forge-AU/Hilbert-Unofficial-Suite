# Comfy Nodes GPU Runner

Infrastructure for running heavy ComfyUI node workflows on an Ubuntu multi-GPU box.
It is designed for Tesla P40/P100/P4 style hosts where each GPU runs an isolated
ComfyUI shard and a small API routes user jobs to the right shard.

## What This Provides

- One stable HTTP API for Studio and direct users.
- One ComfyUI process per GPU, pinned with `CUDA_VISIBLE_DEVICES`.
- Routing by workflow type, tags, VRAM class, and capacity.
- Persistent job tracking in SQLite.
- Direct prompt submission compatible with ComfyUI prompt API JSON.
- Optional Studio integration through the AI Suite remote worker settings.
- Ubuntu systemd service templates.

## Layout

```text
gpu_node_runner/        Python package: API, scheduler, shard manager, CLI
configs/example.yaml    Example P40/P100/P4 host configuration
scripts/                Ubuntu setup and local run helpers
systemd/                Service templates
```

## Ubuntu Quick Start

```bash
cd /opt/comfy-nodes
python3 -m venv .venv
. .venv/bin/activate
pip install -r requirements.txt
cp configs/example.yaml config.yaml
```

Edit `config.yaml`:

- Set `comfy.root` to the local ComfyUI checkout.
- Set `comfy.python` to the ComfyUI venv Python.
- Match `gpu_id` values to `nvidia-smi`.
- Point ComfyUI at shared models via its `extra_model_paths.yaml`.

Start the ComfyUI shards:

```bash
./scripts/start-shards.sh config.yaml
```

Start the runner API:

```bash
. .venv/bin/activate
python -m gpu_node_runner serve --config config.yaml
```

API defaults to `0.0.0.0:39018`; shards default to `127.0.0.1:39100+`.

## Direct Use

Submit a raw ComfyUI prompt API JSON:

```bash
curl -X POST http://GPU_BOX:39018/v1/jobs \
  -H "content-type: application/json" \
  -d @workflow-api.json
```

Submit with routing hints:

```bash
curl -X POST http://GPU_BOX:39018/v1/jobs \
  -H "content-type: application/json" \
  -d '{"workflow_type":"image-to-3d","prompt":{}}'
```

Check progress:

```bash
curl http://GPU_BOX:39018/v1/jobs/JOB_ID
curl http://GPU_BOX:39018/v1/workers
curl http://GPU_BOX:39018/health
```

## Studio Integration

In AI Suite `config.env` on the Studio/main inference box:

```text
REMOTE_GPU_WORKER_ENABLED=1
REMOTE_GPU_WORKER_URL=http://GPU_BOX:39018
```

Studio can then offload video and image-to-3D workflows while keeping normal image
jobs on the main inference box.
