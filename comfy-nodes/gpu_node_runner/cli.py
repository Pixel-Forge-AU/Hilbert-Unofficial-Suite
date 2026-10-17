from __future__ import annotations

import argparse
from pathlib import Path

import requests
import uvicorn

from .api import create_app
from .comfy import ComfyClient
from .config import load_config
from .scheduler import Scheduler
from .shards import ShardManager
from .store import JobStore


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(description="Run and route ComfyUI nodes across multiple GPUs.")
    parser.add_argument("--config", default="config.yaml")
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("serve")
    sub.add_parser("start-shards")
    sub.add_parser("stop-shards")
    sub.add_parser("workers")
    submit = sub.add_parser("submit")
    submit.add_argument("prompt_json")
    submit.add_argument("--workflow-type", default="image")

    args = parser.parse_args(argv)
    config = load_config(args.config)

    if args.command == "serve":
        app = create_app(args.config)
        uvicorn.run(app, host=config.server.host, port=config.server.port)
    elif args.command == "start-shards":
        ShardManager(config).start_all()
    elif args.command == "stop-shards":
        ShardManager(config).stop_all()
    elif args.command == "workers":
        scheduler = Scheduler(config, JobStore(config.storage.sqlite_path), ComfyClient(config.server.request_timeout_seconds))
        for worker in scheduler.statuses():
            print(worker.model_dump_json())
    elif args.command == "submit":
        url = f"http://127.0.0.1:{config.server.port}/v1/jobs"
        prompt = Path(args.prompt_json).read_text()
        response = requests.post(
            url,
            data=prompt if args.workflow_type == "image" else None,
            json={"workflow_type": args.workflow_type, "prompt": __import__("json").loads(prompt)}
            if args.workflow_type != "image"
            else None,
            headers={"content-type": "application/json"},
            timeout=config.server.request_timeout_seconds,
        )
        response.raise_for_status()
        print(response.text)
