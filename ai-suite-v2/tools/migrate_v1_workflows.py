#!/usr/bin/env python3
"""Convert V1 Studio workflow JSON files into first-class V2 pack workflows."""

from __future__ import annotations

import argparse
import json
import shutil
import sys
from pathlib import Path
from typing import Any, Dict

import yaml

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from comfy_studio import infer_media_type, model_requirements, workflow_controls, workflow_slug, workflow_title  # noqa: E402


CATEGORY_MAP = {
    "3d": "three-d",
    "audio": "audio",
    "depth": "image-analysis",
    "extract-video-frame": "image-analysis",
    "frame-interpolation": "video-animation",
    "hunyuan": "video-animation",
    "image-inpaint": "image-editing",
    "image-outpaint": "image-editing",
    "image-to-3d": "three-d",
    "image-to-image": "image-editing",
    "image-upscale": "image-enhancement",
    "ltx": "video-animation",
    "multi-image-to-3d": "three-d",
    "pose": "image-analysis",
    "remove-background": "image-editing",
    "start-end-image-to-video": "video-animation",
    "text-to-3d": "three-d",
    "video": "video-animation",
    "z-image": "core-generation",
}


def category_for(slug: str, media_type: str) -> str:
    for prefix, category in CATEGORY_MAP.items():
        if slug.startswith(prefix) or prefix in slug:
            return category
    if media_type == "video":
        return "video-animation"
    if media_type == "model":
        return "three-d"
    return "core-generation"


def input_type(control: Dict[str, Any]) -> str:
    kind = control.get("kind")
    value = control.get("value")
    if kind == "file":
        return "file"
    if kind == "checkbox" or isinstance(value, bool):
        return "boolean"
    if isinstance(value, int) and not isinstance(value, bool):
        return "int"
    if isinstance(value, float):
        return "float"
    if kind == "textarea":
        return "textarea"
    return "text"


def manifest_input(control: Dict[str, Any]) -> Dict[str, Any]:
    item: Dict[str, Any] = {
        "id": control.get("id"),
        "label": control.get("label") or control.get("input") or control.get("id"),
        "type": input_type(control),
        "required": False,
        "default": control.get("value") if control.get("value") is not None else "",
        "legacy_kind": control.get("kind"),
        "node_id": control.get("node_id"),
        "node_type": control.get("node_type"),
        "input": control.get("input"),
    }
    if control.get("accept"):
        item["accept"] = control["accept"]
    return item


def migrate_workflow(source: Path, output_root: Path, overwrite: bool = False) -> Path:
    workflow = json.loads(source.read_text())
    slug = workflow_slug(source)
    media_type = infer_media_type(source, workflow)
    category = category_for(slug, media_type)
    controls = workflow_controls(source, workflow)
    models = model_requirements(workflow)

    target_dir = output_root / slug
    if target_dir.exists() and overwrite:
        shutil.rmtree(target_dir)
    target_dir.mkdir(parents=True, exist_ok=True)

    workflow_target = target_dir / "workflow.json"
    if overwrite or not workflow_target.exists():
        workflow_target.write_text(json.dumps(workflow, indent=2) + "\n")

    manifest = {
        "id": f"studio.{slug}",
        "name": workflow_title(source),
        "version": "2.0.0",
        "category": category,
        "description": f"Migrated V1 Studio {media_type} workflow from {source.name}",
        "status": "migrated",
        "media_type": media_type,
        "source": {
            "suite": "v1",
            "path": str(source),
        },
        "entrypoints": {
            "ui": "workflow.json",
        },
        "inputs": [manifest_input(control) for control in controls],
        "outputs": [
            {
                "id": media_type,
                "type": "model" if media_type == "model" else media_type,
                "description": f"Generated {media_type} output",
            }
        ],
        "models": {
            "required": models,
            "optional": [],
        },
        "custom_nodes": {
            "required": ["comfyui"],
            "optional": [],
        },
        "hardware": {
            "minimum_vram_gb": 8,
            "recommended_vram_gb": 16,
            "supports_low_vram": True,
            "supports_cpu_offload": False,
        },
    }
    (target_dir / "manifest.yaml").write_text(yaml.safe_dump(manifest, sort_keys=False))
    return target_dir


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, default=ROOT / "legacy-workflows")
    parser.add_argument("--output", type=Path, default=ROOT / "packs" / "studio-migrated")
    parser.add_argument("--overwrite", action="store_true")
    args = parser.parse_args()

    migrated = []
    for source in sorted(args.source.glob("*.json")):
        migrated.append(migrate_workflow(source, args.output, args.overwrite))

    print(f"migrated={len(migrated)} output={args.output}")
    for path in migrated:
        print(path)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
