#!/usr/bin/env python3
import cgi
import copy
import json
import math
import os
import random
import re
import shutil
import subprocess
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
from pathlib import Path

from ai_manager import ROOT, load_config


CONFIG = load_config()
COMFYUI_DIR = Path(CONFIG.get("COMFYUI_DIR", ROOT / "repos/ComfyUI"))
COMFY_OUTPUT = COMFYUI_DIR / "output"
COMFY_INPUT = COMFYUI_DIR / "input"
UPLOAD_SUBDIR = "studio_uploads"
DEFAULT_NEGATIVE = "low quality, bad anatomy, extra digits, missing digits, extra limbs, missing limbs"
CONTROL_LIMIT = 42
JOB_METADATA = {}
CANCELLED_PROMPTS = set()
SKIP_NODE_TYPES = {
    "MarkdownNote",
    "Note",
}
PRIMITIVE_NODE_TYPES = {
    "PrimitiveNode",
    "PrimitiveInt",
    "PrimitiveFloat",
    "PrimitiveString",
    "PrimitiveStringMultiline",
    "PrimitiveBoolean",
}
PROVIDER_TERMS = (
    "api",
    "gemini",
    "tencent",
    "meshy",
    "tripo",
    "rodin",
    "kling",
    "runway",
    "luma",
    "vidu",
    "pixverse",
    "hailuo",
    "topaz",
    "hitpaw",
    "beeble",
    "bria",
    "magnific",
    "recraft",
    "openai",
    "anthropic",
    "veo",
    "seedance",
    "bytedance",
    "minimax",
    "happyhorse",
    "elevenlabs",
)


def browser_host(host):
    return "127.0.0.1" if host in ("0.0.0.0", "::") else host


def json_response(handler, payload, status=200):
    data = json.dumps(payload).encode("utf-8")
    handler.send_response(status)
    handler.send_header("Content-Type", "application/json")
    handler.send_header("Content-Length", str(len(data)))
    handler.end_headers()
    handler.wfile.write(data)


def text_response(handler, text, status=200, content_type="text/plain"):
    data = text.encode("utf-8")
    handler.send_response(status)
    handler.send_header("Content-Type", content_type)
    handler.send_header("Content-Length", str(len(data)))
    handler.end_headers()
    handler.wfile.write(data)


def read_body(handler):
    length = int(handler.headers.get("Content-Length", "0"))
    if length == 0:
        return {}
    return json.loads(handler.rfile.read(length).decode("utf-8"))


def http_json(url, payload=None, timeout=20):
    data = None
    headers = {}
    if payload is not None:
        data = json.dumps(payload).encode("utf-8")
        headers["Content-Type"] = "application/json"
    req = urllib.request.Request(url, data=data, headers=headers)
    with urllib.request.urlopen(req, timeout=timeout) as response:
        raw = response.read()
        if not raw:
            return {}
        return json.loads(raw.decode("utf-8"))


def comfy_base_url(config):
    host = browser_host(config["COMFY_HOST"])
    return f"http://{host}:{config['COMFY_PORT']}"


def comfy_available(config):
    try:
        urllib.request.urlopen(f"{comfy_base_url(config)}/system_stats", timeout=2).read()
        return True
    except Exception:
        return False


def comfy_object_info(config):
    return http_json(f"{comfy_base_url(config)}/object_info", timeout=5)


def comfy_free(config, unload_models=True, free_memory=True):
    return http_json(
        f"{comfy_base_url(config)}/free",
        {"unload_models": unload_models, "free_memory": free_memory},
        timeout=10,
    )


def ensure_comfy(config):
    if comfy_available(config):
        return True, "ComfyUI is running."
    result = subprocess.run(
        [str(ROOT / "ai-switch"), "comfy"],
        cwd=str(ROOT),
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        timeout=90,
    )
    if comfy_available(config):
        return True, result.stdout.strip()
    return False, result.stdout.strip() or "ComfyUI did not become reachable."


def link_parts(link):
    if isinstance(link, dict):
        return (
            link.get("id"),
            link.get("origin_id"),
            link.get("origin_slot"),
            link.get("target_id"),
            link.get("target_slot"),
            link.get("type"),
        )
    if isinstance(link, (list, tuple)) and len(link) >= 5:
        link_type = link[5] if len(link) > 5 else None
        return link[0], link[1], link[2], link[3], link[4], link_type
    return None, None, None, None, None, None


def link_map(workflow):
    links = {}
    for link in workflow.get("links", []):
        link_id, origin_id, origin_slot, _target_id, _target_slot, _link_type = link_parts(link)
        if link_id is not None:
            links[link_id] = [str(origin_id), origin_slot]
    return links


def is_bypassed(node):
    return node.get("mode") == 4


def effective_link_map(workflow):
    links = link_map(workflow)
    link_rows = {}
    for link in workflow.get("links", []):
        link_id, *_ = link_parts(link)
        if link_id is not None:
            link_rows[link_id] = link
    for node in workflow.get("nodes", []):
        if not is_bypassed(node):
            continue
        linked_inputs_by_type = {}
        fallback_link = None
        for item in node.get("inputs", []):
            link_id = item.get("link")
            if link_id is None or link_id not in link_rows:
                continue
            fallback_link = fallback_link or link_id
            linked_inputs_by_type.setdefault(item.get("type"), link_id)
        if fallback_link is None:
            continue
        for output in node.get("outputs", []):
            source_link = linked_inputs_by_type.get(output.get("type"), fallback_link)
            source = links.get(source_link)
            if not source:
                continue
            for output_link in output.get("links") or []:
                links[output_link] = source
    return links


def linked_inputs(node, links, primitive_values=None):
    primitive_values = primitive_values or {}
    inputs = {}
    for item in node.get("inputs", []):
        link_id = item.get("link")
        if link_id is not None and link_id in links:
            origin_id, origin_slot = links[link_id]
            if origin_id in primitive_values:
                inputs[item["name"]] = primitive_values[origin_id]
            else:
                inputs[item["name"]] = [origin_id, origin_slot]
    return inputs


def workflow_slug(path):
    return re.sub(r"[^a-z0-9]+", "-", path.stem.lower()).strip("-")


def workflow_title(path):
    words = re.sub(r"[-_]+", " ", path.stem).strip()
    return words[:1].upper() + words[1:] if words else path.stem


def infer_media_type(path, workflow=None):
    name = path.name.lower()
    if any(term in name for term in ("3d", "mesh", "model", "glb", "gltf", "obj", "stl")):
        return "model"
    if any(term in name for term in ("video", "hunyuan", "wan", "ltx", "mp4", "webm", "animate")):
        return "video"
    if any(term in name for term in ("audio", "wav", "flac", "mp3", "ogg", "m4a", "aac", "aiff")):
        return "audio"
    if workflow:
        node_types = []
        if "nodes" in workflow:
            node_types = [node.get("type", "").lower() for node in workflow.get("nodes", [])]
        else:
            node_types = [node.get("class_type", "").lower() for node in workflow.values() if isinstance(node, dict)]
        joined = " ".join(node_types)
        if any(term in joined for term in ("save3d", "savemesh", "mesh", "glb", "gltf", "obj", "stl")):
            return "model"
        if any(term in joined for term in ("videocombine", "savevideo", "animatedwebp", "vhs_", "video")):
            return "video"
        if any(term in joined for term in ("saveaudio", "vaedecodeaudio", "acestep", "diffrhythm", "audio")):
            return "audio"
    return "image"


def widget_inputs(node):
    return [item for item in node.get("inputs", []) if item.get("widget")]


def widget_name(item):
    widget = item.get("widget") or {}
    return widget.get("name") or item.get("name")


def control_kind(node_type, input_name, value):
    name = input_name.lower()
    if node_type in ("LoadImage", "LoadImageMask", "LoadImageOutput") and name == "image":
        return "file"
    if node_type == "LoadVideo" and name in ("video", "image"):
        return "file"
    if isinstance(value, bool):
        return "checkbox"
    if isinstance(value, int) and not isinstance(value, bool):
        return "number"
    if isinstance(value, float):
        return "number"
    if "prompt" in name or name == "text" or "negative" in name:
        return "textarea"
    if node_type in ("CLIPTextEncode", "SaveImage"):
        return "textarea" if input_name == "text" else "text"
    return "text"


def node_reaches_input(prompt, start_id, input_names):
    seen = set()
    frontier = {str(start_id)}
    wanted = {name.lower() for name in input_names}
    while frontier:
        current = frontier.pop()
        if current in seen:
            continue
        seen.add(current)
        for node_id, node in prompt.items():
            for input_name, value in node.get("inputs", {}).items():
                if not (isinstance(value, list) and str(value[0]) == current):
                    continue
                if input_name.lower() in wanted:
                    return True
                if str(node_id) not in seen:
                    frontier.add(str(node_id))
    return False


def node_directly_links_to_input(prompt, start_id, input_names):
    current = str(start_id)
    wanted = {name.lower() for name in input_names}
    for node in prompt.values():
        for input_name, value in node.get("inputs", {}).items():
            if isinstance(value, list) and str(value[0]) == current and input_name.lower() in wanted:
                return True
    return False


def control_label(node, input_name, fallback_index=0, prompt=None):
    node_type = node.get("type", "")
    node_id = node.get("id")
    title = (node.get("title") or "").lower()
    value = f"{node_type} {input_name}".strip()
    if node_type == "CLIPTextEncode" and input_name == "text":
        if "positive" in title:
            return "Prompt"
        if "negative" in title:
            return "Negative prompt"
        if prompt and node_directly_links_to_input(prompt, node_id, {"positive"}):
            return "Prompt"
        if prompt and node_directly_links_to_input(prompt, node_id, {"negative"}):
            return "Negative prompt"
        if prompt and node_reaches_input(prompt, node_id, {"negative"}):
            return "Negative prompt"
        if prompt:
            return "Prompt"
        return "Prompt" if fallback_index == 0 else "Negative prompt"
    if node_type in ("LoadImage", "LoadImageMask", "LoadImageOutput") and input_name == "image":
        return "Input image"
    if node_type == "LoadVideo" and input_name in ("video", "image"):
        return "Input video"
    labels = {
        "filename_prefix": "Output folder/prefix",
        "batch_size": "Batch",
        "cfg": "CFG",
        "cfg_conds": "CFG",
        "cfg_cond2_negative": "Negative CFG",
        "denoise": "Denoise",
        "fps": "FPS",
        "frame_rate": "Frame rate",
        "height": "Height",
        "length": "Frames",
        "noise_seed": "Seed",
        "seed": "Seed",
        "sampler_name": "Sampler",
        "strength": "Strength",
        "steps": "Steps",
        "style": "Style",
        "width": "Width",
    }
    return labels.get(input_name, value if value else f"Node {node_id}")


def workflow_controls(path, workflow):
    controls = []
    prompt = workflow_to_api(workflow) if "nodes" in workflow else workflow
    ui_nodes = {str(node.get("id")): node for node in workflow.get("nodes", [])} if "nodes" in workflow else {}

    clip_text_count = 0
    for node_id, node in prompt.items():
        node_type = node.get("class_type", "")
        for name, value in node.get("inputs", {}).items():
            if isinstance(value, list):
                continue
            if name in (
                "clip_name",
                "vae_name",
                "unet_name",
                "ckpt_name",
                "weight_dtype",
                "sampler_name",
                "scheduler",
                "type",
                "device",
                "upload",
                "format",
                "codec",
                "bit_depth",
                "add_noise",
                "stretch",
                "terminal",
                "base_shift",
                "max_shift",
                "img_compression",
            ):
                continue
            label_index = clip_text_count
            if node_type == "CLIPTextEncode" and name == "text":
                clip_text_count += 1
            control_id = f"{node_id}.{name}"
            ui_node = ui_nodes.get(str(node_id), {})
            label_node = {"id": node_id, "type": node_type, "title": ui_node.get("title")}
            controls.append(
                {
                    "id": control_id,
                    "node_id": str(node_id),
                    "input": name,
                    "label": control_label(label_node, name, label_index, prompt),
                    "kind": control_kind(node_type, name, value),
                    "accept": "video/mp4,video/webm,video/quicktime,video/x-matroska" if node_type == "LoadVideo" else "image/png,image/jpeg,image/webp,image/bmp",
                    "value": value,
                    "node_type": node_type,
                }
            )

    priority = {
        "Prompt": 0,
        "Negative prompt": 1,
        "Input image": 2,
        "image": 2,
        "width": 3,
        "height": 4,
        "steps": 5,
        "CFG": 6,
        "Strength": 7,
        "Frames": 8,
        "FPS": 9,
        "Frame rate": 10,
        "Batch": 11,
        "Seed": 12,
        "seed": 12,
        "Output folder/prefix": 13,
    }
    controls.sort(key=lambda item: priority.get(item["label"], priority.get(item["input"], 50)))
    label_counts = {}
    for control in controls:
        label_counts[control["label"]] = label_counts.get(control["label"], 0) + 1
    for control in controls:
        if label_counts.get(control["label"], 0) > 1:
            control["label"] = f"{control['label']} ({control['node_type']} {control['node_id']})"
    return controls[:CONTROL_LIMIT]


def workflow_provider_nodes(workflow):
    node_types = []
    if "nodes" in workflow:
        node_types.extend(node.get("type", "") for node in workflow.get("nodes", []))
        subgraphs = workflow.get("definitions", {}).get("subgraphs", [])
        for subgraph in subgraphs:
            node_types.extend(node.get("type", "") for node in subgraph.get("nodes", []))
    else:
        node_types.extend(node.get("class_type", "") for node in workflow.values() if isinstance(node, dict))
    return sorted({node_type for node_type in node_types if any(term in node_type.lower() for term in PROVIDER_TERMS)})


def combo_options(input_spec):
    if not isinstance(input_spec, (list, tuple)) or not input_spec:
        return []
    first = input_spec[0]
    if isinstance(first, list):
        return first
    if len(input_spec) > 1 and isinstance(input_spec[1], dict):
        options = input_spec[1].get("options")
        if isinstance(options, list):
            return options
    return []


def input_default(input_spec):
    if isinstance(input_spec, (list, tuple)) and len(input_spec) > 1 and isinstance(input_spec[1], dict):
        return input_spec[1].get("default")
    return None


def comfy_input_file_exists(value):
    if not isinstance(value, str) or not value.strip():
        return False
    rel = Path(value)
    if rel.is_absolute() or ".." in rel.parts:
        return False
    target = (COMFY_INPUT / rel).resolve()
    input_root = COMFY_INPUT.resolve()
    if target != input_root and input_root not in target.parents:
        return False
    return target.is_file()


def model_requirements(workflow):
    requirements = []
    workflow = expand_subgraphs(workflow) if "nodes" in workflow else workflow
    for node in workflow.get("nodes", []):
        if is_bypassed(node):
            continue
        for model in node.get("properties", {}).get("models", []) or []:
            name = model.get("name")
            directory = model.get("directory")
            if name and directory:
                requirements.append(
                    {
                        "node_id": str(node.get("id")),
                        "node_type": node.get("type", ""),
                        "name": name,
                        "directory": directory,
                        "url": model.get("url", ""),
                    }
                )
    return requirements


def validate_prompt_choices(prompt, object_info, requirements=None):
    messages = []
    requirements_by_node_input = {}
    for item in requirements or []:
        if item["node_type"] == "CLIPLoader":
            input_name = "clip_name"
        elif item["node_type"] == "UNETLoader":
            input_name = "unet_name"
        elif item["node_type"] == "VAELoader":
            input_name = "vae_name"
        elif item["node_type"] == "CheckpointLoaderSimple":
            input_name = "ckpt_name"
        else:
            continue
        requirements_by_node_input[(item["node_id"], input_name)] = item

    for node_id, node in prompt.items():
        class_type = node.get("class_type")
        input_info = (object_info.get(class_type) or {}).get("input", {})
        required_inputs = input_info.get("required", {})
        valid_inputs = dict(required_inputs)
        valid_inputs.update(input_info.get("optional", {}))
        for input_name in required_inputs:
            if input_name not in node.get("inputs", {}):
                messages.append(f"{class_type} {node_id} is missing required input {input_name}.")
        for input_name, value in node.get("inputs", {}).items():
            if isinstance(value, list):
                continue
            if class_type in ("LoadImage", "LoadImageMask", "LoadImageOutput") and input_name == "image":
                if value and comfy_input_file_exists(value):
                    continue
                messages.append(f"{class_type} {node_id} cannot find input image: {value!r}.")
                continue
            options = combo_options(valid_inputs.get(input_name))
            if options and value not in options:
                requirement = requirements_by_node_input.get((str(node_id), input_name))
                if requirement:
                    location = f"models/{requirement['directory']}/{requirement['name']}"
                    if requirement.get("url"):
                        messages.append(f"{location} is not installed. Download: {requirement['url']}")
                    else:
                        messages.append(f"{location} is not installed.")
                else:
                    messages.append(f"{class_type} {node_id} has invalid {input_name}: {value!r}.")
    return messages


def subgraph_definitions(workflow):
    return {
        subgraph.get("id"): subgraph
        for subgraph in workflow.get("definitions", {}).get("subgraphs", []) or []
        if subgraph.get("id")
    }


def next_link_id(workflow):
    highest = 0
    for link in workflow.get("links", []) or []:
        link_id, *_ = link_parts(link)
        if isinstance(link_id, int):
            highest = max(highest, link_id)
    return highest + 1


def input_slot_links(workflow, node):
    link_rows = {}
    for link in workflow.get("links", []) or []:
        link_id, origin_id, origin_slot, target_id, target_slot, link_type = link_parts(link)
        if link_id is None:
            continue
        link_rows[link_id] = (link_id, origin_id, origin_slot, target_id, target_slot, link_type)

    slots = {}
    for index, input_def in enumerate(node.get("inputs", []) or []):
        link_id = input_def.get("link")
        if link_id in link_rows:
            slots[index] = link_rows[link_id]
    return slots


def output_link_targets(workflow):
    targets = {}
    for link in workflow.get("links", []) or []:
        link_id, origin_id, origin_slot, target_id, target_slot, link_type = link_parts(link)
        if link_id is not None:
            targets[link_id] = (link_id, origin_id, origin_slot, target_id, target_slot, link_type)
    return targets


def set_widget_value(node, input_name, value):
    widget_inputs = [item for item in node.get("inputs", []) or [] if item.get("widget")]
    for index, item in enumerate(widget_inputs):
        if item.get("name") != input_name:
            continue
        widgets = list(node.get("widgets_values") or [])
        while len(widgets) <= index:
            widgets.append(None)
        widgets[index] = value
        node["widgets_values"] = widgets
        return True
    return False


def expand_subgraphs(workflow, depth=0):
    subgraphs = subgraph_definitions(workflow)
    if not subgraphs or depth > 8:
        return workflow

    flattened = copy.deepcopy(workflow)
    flattened["nodes"] = []
    flattened["links"] = []
    flattened.pop("definitions", None)
    top_link_targets = output_link_targets(workflow)
    subgraph_node_ids = {
        node.get("id")
        for node in workflow.get("nodes", []) or []
        if node.get("type") in subgraphs
    }
    for link in workflow.get("links", []) or []:
        link_id, origin_id, origin_slot, target_id, target_slot, link_type = link_parts(link)
        if link_id is None:
            continue
        if origin_id in subgraph_node_ids or target_id in subgraph_node_ids:
            continue
        flattened["links"].append([link_id, origin_id, origin_slot, target_id, target_slot, link_type])
    generated_link_id = next_link_id(workflow)

    for node in workflow.get("nodes", []) or []:
        subgraph = subgraphs.get(node.get("type"))
        if not subgraph:
            flattened["nodes"].append(copy.deepcopy(node))
            continue

        prefix = f"{node.get('id')}_sg_"
        node_id_map = {
            inner.get("id"): f"{prefix}{inner.get('id')}"
            for inner in subgraph.get("nodes", []) or []
        }
        internal_link_id_map = {}
        inner_links = {}
        for link in subgraph.get("links", []) or []:
            link_id, origin_id, origin_slot, target_id, target_slot, link_type = link_parts(link)
            if link_id is None:
                continue
            inner_links[link_id] = (link_id, origin_id, origin_slot, target_id, target_slot, link_type)
            if origin_id not in (-10, -20) and target_id not in (-10, -20):
                internal_link_id_map[link_id] = generated_link_id
                generated_link_id += 1

        external_inputs = input_slot_links(workflow, node)
        external_input_link_map = {}
        for link_id, origin_id, origin_slot, target_id, target_slot, link_type in inner_links.values():
            if origin_id != -10:
                continue
            external = external_inputs.get(int(origin_slot))
            if not external:
                continue
            _ext_id, ext_origin_id, ext_origin_slot, _ext_target_id, _ext_target_slot, _ext_type = external
            new_link_id = generated_link_id
            generated_link_id += 1
            external_input_link_map[link_id] = new_link_id
            flattened["links"].append([
                new_link_id,
                ext_origin_id,
                ext_origin_slot,
                node_id_map.get(target_id, target_id),
                target_slot,
                link_type,
            ])

        output_sources = {}
        for link_id, origin_id, origin_slot, target_id, target_slot, link_type in inner_links.values():
            if target_id == -20:
                output_sources[int(target_slot)] = (
                    node_id_map.get(origin_id, origin_id),
                    origin_slot,
                    link_type,
                )

        for output_slot, output_def in enumerate(node.get("outputs", []) or []):
            source = output_sources.get(output_slot)
            if not source:
                continue
            source_id, source_slot, source_type = source
            for top_link_id in output_def.get("links") or []:
                link_id, _origin_id, _origin_slot, target_id, target_slot, link_type = top_link_targets.get(
                    top_link_id,
                    (top_link_id, source_id, source_slot, node.get("id"), output_slot, source_type),
                )
                flattened["links"].append([
                    link_id,
                    source_id,
                    source_slot,
                    target_id,
                    target_slot,
                    link_type or source_type,
                ])

        for link_id, origin_id, origin_slot, target_id, target_slot, link_type in inner_links.values():
            if link_id not in internal_link_id_map:
                continue
            flattened["links"].append([
                internal_link_id_map[link_id],
                node_id_map.get(origin_id, origin_id),
                origin_slot,
                node_id_map.get(target_id, target_id),
                target_slot,
                link_type,
            ])

        proxy_widgets = node.get("properties", {}).get("proxyWidgets") or []
        for inner_node in subgraph.get("nodes", []) or []:
            copied = copy.deepcopy(inner_node)
            copied["id"] = node_id_map.get(inner_node.get("id"), inner_node.get("id"))
            for input_def in copied.get("inputs", []) or []:
                link_id = input_def.get("link")
                if link_id is None:
                    continue
                if link_id in internal_link_id_map:
                    input_def["link"] = internal_link_id_map[link_id]
                elif link_id in external_input_link_map:
                    input_def["link"] = external_input_link_map[link_id]
                else:
                    input_def["link"] = None
            for output_def in copied.get("outputs", []) or []:
                remapped_links = []
                for link_id in output_def.get("links") or []:
                    if link_id in internal_link_id_map:
                        remapped_links.append(internal_link_id_map[link_id])
                    elif link_id in external_input_link_map:
                        remapped_links.append(external_input_link_map[link_id])
                    else:
                        remapped_links.append(link_id)
                if remapped_links:
                    output_def["links"] = remapped_links
            for index, proxy in enumerate(proxy_widgets):
                if not isinstance(proxy, (list, tuple)) or len(proxy) < 2:
                    continue
                proxy_node_id, proxy_input = str(proxy[0]), proxy[1]
                if proxy_node_id == str(inner_node.get("id")) and index < len(node.get("widgets_values") or []):
                    set_widget_value(copied, proxy_input, node["widgets_values"][index])
            flattened["nodes"].append(copied)

    if any(node.get("type") in subgraphs for node in flattened.get("nodes", []) or []):
        flattened["definitions"] = {"subgraphs": list(subgraphs.values())}
        return expand_subgraphs(flattened, depth + 1)
    return flattened


def workflow_to_api(workflow):
    workflow = expand_subgraphs(workflow)
    links = effective_link_map(workflow)
    primitive_values = {}
    for node in workflow.get("nodes", []):
        if node.get("type") in PRIMITIVE_NODE_TYPES:
            values = node.get("widgets_values") or []
            if values:
                primitive_values[str(node["id"])] = values[0]
    prompt = {}
    for node in workflow.get("nodes", []):
        node_id = str(node["id"])
        node_type = node["type"]
        if node_type in SKIP_NODE_TYPES or node_type in PRIMITIVE_NODE_TYPES or is_bypassed(node):
            continue
        widgets = node.get("widgets_values") or []
        inputs = linked_inputs(node, links, primitive_values)

        for item in node.get("inputs", []):
            if item.get("link") is not None:
                continue
            if item.get("shape") == 7:
                continue
            input_type = item.get("type")
            input_name = item.get("name")
            if input_type == "IMAGE":
                loader_id = f"studio_load_image_{node_id}_{input_name}"
                prompt[loader_id] = {"class_type": "LoadImage", "inputs": {"image": "", "upload": "image"}}
                inputs[input_name] = [loader_id, 0]
            elif input_type == "VIDEO":
                loader_id = f"studio_load_video_{node_id}_{input_name}"
                prompt[loader_id] = {"class_type": "LoadVideo", "inputs": {"video": "", "upload": "image"}}
                inputs[input_name] = [loader_id, 0]

        if node_type == "SaveImage":
            inputs["filename_prefix"] = widgets[0] if widgets else "Studio"
        elif node_type == "SaveAudio":
            inputs["filename_prefix"] = widgets[0] if widgets else "Studio"
        elif node_type == "SaveGLB":
            inputs["filename_prefix"] = widgets[0] if widgets else "mesh/ComfyUI"
        elif node_type == "CLIPLoader":
            inputs.update({"clip_name": widgets[0], "type": widgets[1], "device": widgets[2]})
        elif node_type == "VAELoader":
            inputs["vae_name"] = widgets[0]
        elif node_type == "UNETLoader":
            inputs.update({"unet_name": widgets[0], "weight_dtype": widgets[1]})
        elif node_type == "ImageOnlyCheckpointLoader":
            inputs["ckpt_name"] = widgets[0]
        elif node_type in ("LoadImage", "LoadImageMask", "LoadImageOutput"):
            if widgets:
                inputs["image"] = widgets[0]
            if len(widgets) > 1:
                inputs["upload"] = widgets[1]
        elif node_type == "LoadVideo":
            if widgets:
                inputs["video"] = widgets[0]
            if len(widgets) > 1:
                inputs["upload"] = widgets[1]
        elif node_type == "TencentTextToModelNode":
            names = ["model", "prompt", "face_count", "generate_type", "pbr", "seed", "control_after_generate"]
            for name, value in zip(names, widgets):
                if name != "control_after_generate":
                    inputs[name] = value
        elif node_type == "CLIPTextEncode":
            inputs["text"] = widgets[0] if widgets else ""
        elif node_type == "CLIPVisionEncode":
            inputs["crop"] = widgets[0] if widgets else "none"
        elif node_type == "EmptySD3LatentImage":
            inputs.update({"width": widgets[0], "height": widgets[1], "batch_size": widgets[2]})
        elif node_type == "EmptyLatentHunyuan3Dv2":
            inputs.update({"resolution": widgets[0], "batch_size": widgets[1]})
        elif node_type == "ModelSamplingAuraFlow":
            inputs["shift"] = widgets[0]
        elif node_type == "VAEDecodeHunyuan3D":
            inputs.update({"num_chunks": widgets[0], "octree_resolution": widgets[1]})
        elif node_type == "VoxelToMesh":
            inputs.update({"algorithm": widgets[0], "threshold": widgets[1]})
        elif node_type == "KSampler":
            inputs.update(
                {
                    "seed": widgets[0],
                    "steps": widgets[2] if len(widgets) > 6 else widgets[1],
                    "cfg": widgets[3] if len(widgets) > 6 else widgets[2],
                    "sampler_name": widgets[4] if len(widgets) > 6 else widgets[3],
                    "scheduler": widgets[5] if len(widgets) > 6 else widgets[4],
                    "denoise": widgets[6] if len(widgets) > 6 else widgets[5],
                }
            )
        elif node_type == "RandomNoise":
            if widgets:
                inputs["noise_seed"] = widgets[0]
        elif node_type == "KSamplerSelect":
            if widgets:
                inputs["sampler_name"] = widgets[0]
        elif node_type == "BasicScheduler":
            names = ["scheduler", "steps", "denoise"]
            for name, value in zip(names, widgets):
                inputs[name] = value
        elif node_type == "DualCFGGuider":
            names = ["cfg_conds", "cfg_cond2_negative", "style"]
            for name, value in zip(names, widgets):
                inputs[name] = value
        elif node_type == "DualCLIPLoader":
            names = ["clip_name1", "clip_name2", "type", "device"]
            for name, value in zip(names, widgets):
                inputs.setdefault(name, value)
        elif node_type == "KSamplerAdvanced":
            ordered = [
                "add_noise", "noise_seed", None, "steps", "cfg", "sampler_name",
                "scheduler", "start_at_step", "end_at_step", "return_with_leftover_noise",
            ]
            for name, value in zip(ordered, widgets):
                if name:
                    inputs.setdefault(name, value)
        elif node_type == "ImageScaleBy":
            names = ["upscale_method", "scale_by"]
            for name, value in zip(names, widgets):
                inputs.setdefault(name, value)
        elif node_type == "ImageCompare":
            # compare_view is a UI-only before/after slider widget - the node is a
            # dead end in every workflow seen so far (nothing reads its output), but
            # ComfyUI's validator still requires a value for it. Pass through
            # whatever was saved; it doesn't need to resolve to anything real.
            if widgets:
                compare_view = widgets[0]
                if isinstance(compare_view, dict):
                    compare_view = "Slide"
                inputs.setdefault("compare_view", compare_view)
        elif node_type == "LoraLoaderModelOnly":
            names = ["lora_name", "strength_model"]
            for name, value in zip(names, widgets):
                inputs.setdefault(name, value)
        elif node_type == "WanFirstLastFrameToVideo":
            names = ["width", "height", "length", "batch_size"]
            for name, value in zip(names, widgets):
                inputs.setdefault(name, value)
        elif node_type == "ModelSamplingSD3":
            if widgets:
                inputs.setdefault("shift", widgets[0])
        elif node_type == "CreateVideo":
            if widgets:
                inputs.setdefault("fps", widgets[0])
            if len(widgets) > 1:
                inputs.setdefault("bit_depth", widgets[1])
        elif node_type == "EmptyAceStep1.5LatentAudio":
            inputs.setdefault("batch_size", widgets[1] if len(widgets) > 1 else 1)
        elif node_type == "TextEncodeAceStepAudio1.5":
            # Only tags/lyrics/duration are declared as promotable inputs in the exported
            # workflow; the rest (seed, bpm, timesignature, ...) are plain widgets that never
            # appear in node["inputs"], so the generic fallback below can't see them. Map the
            # full widgets_values order (from ComfyUI's object_info) here instead. "seed" is
            # followed by a UI-only "control_after_generate" slot with no backend input.
            ordered = [
                "tags", "lyrics", "seed", None, "bpm", "duration", "timesignature",
                "language", "keyscale", "generate_audio_codes", "cfg_scale",
                "temperature", "top_p", "top_k", "min_p",
            ]
            for name, value in zip(ordered, widgets):
                if name:
                    inputs.setdefault(name, value)
        elif node_type == "ImageScaleToTotalPixels":
            names = ["upscale_method", "megapixels", "resolution_steps"]
            for name, value in zip(names, widgets):
                inputs[name] = value
            inputs.setdefault("resolution_steps", 1)
        else:
            for item, value in zip([i for i in node.get("inputs", []) if i.get("widget")], widgets):
                inputs[item["name"]] = value

        prompt[node_id] = {"class_type": node_type, "inputs": inputs}
    return prompt


def coerce_value(value, original):
    if value is None:
        return original
    if isinstance(original, bool):
        if isinstance(value, str):
            return value.lower() in ("1", "true", "yes", "on")
        return bool(value)
    if isinstance(original, int) and not isinstance(original, bool):
        if value in (None, "", -1, "-1") and "seed" in str(original).lower():
            return random.randint(1, 2**31 - 1)
        return int(value)
    if isinstance(original, float):
        return float(value)
    return str(value)


def apply_controls(prompt, catalog_item, values):
    seed = None
    now = time.strftime("%Y%m%d-%H%M%S")
    media_type = catalog_item.get("media_type", "image")
    default_prefix = f"Studio/{media_type}/{catalog_item['id']}/{now}"

    for control in catalog_item.get("controls", []):
        node_id = control["node_id"]
        input_name = control["input"]
        original = control.get("value")
        raw_value = values.get(control["id"], original)
        value = coerce_value(raw_value, original)
        if input_name in ("seed", "noise_seed") and raw_value in (None, "", -1, "-1"):
            value = random.randint(1, 2**31 - 1)
        if input_name == "filename_prefix" and not str(raw_value or "").strip():
            value = default_prefix
        if input_name == "seed":
            seed = value
        if node_id in prompt:
            prompt[node_id]["inputs"][input_name] = value

    for node in prompt.values():
        if node.get("class_type") in ("SaveImage", "VHS_VideoCombine", "SaveAnimatedWEBP", "SaveAudio"):
            inputs = node.setdefault("inputs", {})
            if not str(inputs.get("filename_prefix", "")).strip():
                inputs["filename_prefix"] = default_prefix

    return seed


def build_workflow_prompt_from_path(path, values, workflow_id=None, media_type=None):
    path = Path(path)
    workflow = json.loads(path.read_text())
    controls = workflow_controls(path, workflow)
    catalog_item = {
        "id": workflow_id or workflow_slug(path),
        "name": workflow_title(path),
        "path": str(path),
        "controls": controls,
        "media_type": media_type or infer_media_type(path, workflow),
    }
    prompt = workflow_to_api(workflow) if "nodes" in workflow else clean_api_prompt(workflow)
    seed = apply_controls(prompt, catalog_item, values)
    return prompt, seed, catalog_item


def build_job_metadata(catalog_item, values, seed):
    text_controls = []
    for control in catalog_item.get("controls", []):
        is_text_control = control.get("kind") == "textarea" or control.get("input") in ("text", "prompt", "negative")
        if not is_text_control:
            continue
        value = values.get(control["id"], control.get("value", ""))
        if value is None:
            value = ""
        text_controls.append(
            {
                "label": control.get("label") or control.get("input") or control["id"],
                "id": control["id"],
                "node_id": control.get("node_id"),
                "input": control.get("input"),
                "node_type": control.get("node_type"),
                "text": str(value),
            }
        )
    return {
        "workflow_id": catalog_item.get("id"),
        "workflow": catalog_item.get("name"),
        "media_type": catalog_item.get("media_type"),
        "seed": seed,
        "created_at": time.strftime("%Y-%m-%d %H:%M:%S"),
        "text_controls": text_controls,
    }


def format_prompt_sidecar(metadata):
    lines = [
        f"Workflow: {metadata.get('workflow') or metadata.get('workflow_id') or 'Unknown'}",
        f"Media type: {metadata.get('media_type') or 'unknown'}",
    ]
    if metadata.get("seed") is not None:
        lines.append(f"Seed: {metadata['seed']}")
    if metadata.get("created_at"):
        lines.append(f"Created: {metadata['created_at']}")
    lines.append("")

    controls = metadata.get("text_controls") or []
    if not controls:
        lines.append("No prompt text controls were recorded.")
    for control in controls:
        lines.append(f"{control.get('label') or control.get('id')}:")
        lines.append(str(control.get("text") or ""))
        lines.append("")
    return "\n".join(lines).rstrip() + "\n"


def output_file_path(output):
    filename = output.get("filename")
    if not filename:
        return None
    subfolder = output.get("subfolder") or ""
    rel = Path(subfolder) / filename if subfolder else Path(filename)
    if rel.is_absolute() or ".." in rel.parts:
        return None
    # Generated files live under COMFY_OUTPUT; user-uploaded files (e.g. an
    # existing song/image supplied directly, rather than generated) land
    # under COMFY_INPUT via the upload endpoint. Try both roots.
    for root in (COMFY_OUTPUT, COMFY_INPUT):
        root_resolved = root.resolve()
        target = (root / rel).resolve()
        if target == root_resolved or root_resolved in target.parents:
            if target.exists():
                return target
    return None


def write_prompt_sidecars(prompt_id, outputs):
    metadata = JOB_METADATA.get(prompt_id)
    if not metadata:
        return
    for output in outputs:
        target = output_file_path(output)
        if not target or not target.exists():
            continue
        txt_path = target.with_suffix(f"{target.suffix}.prompt.txt")
        json_path = target.with_suffix(f"{target.suffix}.prompt.json")
        txt_path.write_text(format_prompt_sidecar(metadata), encoding="utf-8")
        json_path.write_text(json.dumps(metadata, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def ffmpeg_binary():
    binary = shutil.which("ffmpeg")
    if binary:
        return binary
    try:
        import imageio_ffmpeg

        return imageio_ffmpeg.get_ffmpeg_exe()
    except Exception:
        pass
    venv_python = COMFYUI_DIR / ".venv/bin/python"
    if venv_python.exists():
        result = subprocess.run(
            [str(venv_python), "-c", "import imageio_ffmpeg; print(imageio_ffmpeg.get_ffmpeg_exe())"],
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
            timeout=10,
        )
        if result.returncode == 0:
            binary = result.stdout.strip()
            if binary:
                return binary
    return None


def stitch_videos(outputs, workflow_id="sequence"):
    video_paths = []
    for output in outputs:
        if output.get("type") != "video":
            continue
        path = output_file_path(output)
        if path and path.exists():
            video_paths.append(path)
    if len(video_paths) < 2:
        raise ValueError("At least two completed video segments are required.")

    now = time.strftime("%Y%m%d-%H%M%S")
    sequence_dir = COMFY_OUTPUT / "Studio" / "video-sequences" / now
    sequence_dir.mkdir(parents=True, exist_ok=True)
    manifest = sequence_dir / "sequence.json"
    manifest.write_text(
        json.dumps(
            {
                "workflow_id": workflow_id,
                "created_at": time.strftime("%Y-%m-%d %H:%M:%S"),
                "segments": [str(path.relative_to(COMFY_OUTPUT)) for path in video_paths],
            },
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )

    ffmpeg = ffmpeg_binary()
    if not ffmpeg:
        raise ValueError(f"Sequence segments were generated, but ffmpeg is not installed. Manifest: {manifest.relative_to(COMFY_OUTPUT)}")

    list_file = sequence_dir / "concat.txt"
    list_file.write_text("".join(f"file '{path.as_posix()}'\n" for path in video_paths), encoding="utf-8")
    output = sequence_dir / "sequence.mp4"
    copy_cmd = [ffmpeg, "-y", "-f", "concat", "-safe", "0", "-i", str(list_file), "-c", "copy", str(output)]
    result = subprocess.run(copy_cmd, text=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, timeout=600)
    if result.returncode != 0:
        reencode_cmd = [
            ffmpeg,
            "-y",
            "-f",
            "concat",
            "-safe",
            "0",
            "-i",
            str(list_file),
            "-c:v",
            "libx264",
            "-pix_fmt",
            "yuv420p",
            "-c:a",
            "aac",
            str(output),
        ]
        result = subprocess.run(reencode_cmd, text=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, timeout=1200)
        if result.returncode != 0:
            raise ValueError(result.stdout.strip() or "ffmpeg could not stitch the sequence.")

    rel = output.relative_to(COMFY_OUTPUT)
    return {
        "type": "video",
        "filename": output.name,
        "subfolder": str(rel.parent) if rel.parent != Path(".") else "",
        "url": "/" + "/".join(["media", *[urllib.parse.quote(part) for part in rel.parts]]),
    }


def probe_duration_seconds(ffmpeg, path):
    result = subprocess.run(
        [ffmpeg, "-i", str(path)],
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        timeout=30,
    )
    match = re.search(r"Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)", result.stdout)
    if not match:
        return None
    hours, minutes, seconds = match.groups()
    return int(hours) * 3600 + int(minutes) * 60 + float(seconds)


def safe_title_filename(title, fallback="music-video"):
    stem = re.sub(r"[^a-zA-Z0-9 ._-]+", "", str(title or "")).strip()
    stem = re.sub(r"\s+", " ", stem).strip(" ._-")
    return stem or fallback


def mux_music_video(video_output, audio_output, title=None):
    video_path = output_file_path(video_output or {})
    audio_path = output_file_path(audio_output or {})
    if not video_path or not video_path.exists():
        raise ValueError("Film clip output was not found.")
    if not audio_path or not audio_path.exists():
        raise ValueError("Song output was not found.")

    ffmpeg = ffmpeg_binary()
    if not ffmpeg:
        raise ValueError("Song and clip were generated, but ffmpeg is not installed to combine them.")

    now = time.strftime("%Y%m%d-%H%M%S")
    out_dir = COMFY_OUTPUT / "Studio" / "music-videos" / now
    out_dir.mkdir(parents=True, exist_ok=True)
    output = out_dir / f"{safe_title_filename(title)}.mp4"

    audio_duration = probe_duration_seconds(ffmpeg, audio_path)
    video_duration = probe_duration_seconds(ffmpeg, video_path)
    # -shortest doesn't reliably stop mid-loop when the video input uses -stream_loop,
    # so precompute just enough loops to cover the song and trim exactly with -t instead.
    loops = 0
    if audio_duration and video_duration and video_duration > 0:
        loops = max(0, min(2000, math.ceil(audio_duration / video_duration) - 1))

    cmd = [
        ffmpeg,
        "-y",
        "-stream_loop",
        str(loops),
        "-i",
        str(video_path),
        "-i",
        str(audio_path),
        "-map",
        "0:v:0",
        "-map",
        "1:a:0",
        "-c:v",
        "libx264",
        "-pix_fmt",
        "yuv420p",
        "-c:a",
        "aac",
        "-shortest",
    ]
    if audio_duration:
        cmd += ["-t", str(audio_duration)]
    cmd.append(str(output))
    result = subprocess.run(cmd, text=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, timeout=1200)
    if result.returncode != 0:
        raise ValueError(result.stdout.strip() or "ffmpeg could not combine the song and film clip.")

    rel = output.relative_to(COMFY_OUTPUT)
    return {
        "type": "video",
        "filename": output.name,
        "subfolder": str(rel.parent) if rel.parent != Path(".") else "",
        "url": "/" + "/".join(["media", *[urllib.parse.quote(part) for part in rel.parts]]),
    }


def validate_workflow_prompt(config, workflow, prompt):
    try:
        object_info = comfy_object_info(config)
    except Exception:
        return
    messages = validate_prompt_choices(prompt, object_info, model_requirements(workflow))
    if messages:
        raise ValueError(" ".join(messages[:5]))


def clean_api_prompt(prompt):
    return {
        str(node_id): node
        for node_id, node in prompt.items()
        if isinstance(node, dict) and node.get("class_type") not in SKIP_NODE_TYPES
    }


def queue_prompt(config, prompt, media_type="image"):
    prompt_id = str(uuid.uuid4())
    payload = {"prompt": prompt, "client_id": "local-ai-studio", "prompt_id": prompt_id}
    targets = output_targets(prompt, media_type)
    if targets:
        payload["partial_execution_targets"] = targets
    response = http_json(f"{comfy_base_url(config)}/prompt", payload, timeout=20)
    node_errors = response.get("node_errors") or {}
    if node_errors:
        raise ValueError(format_node_errors(node_errors))
    return response.get("prompt_id", prompt_id)


def output_targets(prompt, media_type=None):
    output_classes_by_type = {
        "image": {
            "PreviewImage",
            "SaveImage",
        },
        "video": {
            "SaveAnimatedWEBP",
            "SaveVideo",
            "VHS_VideoCombine",
        },
        "audio": {
            "PreviewAudio",
            "SaveAudio",
            "SaveAudioMP3",
        },
        "model": {
            "Preview3D",
            "SaveGLB",
        },
    }
    output_classes = output_classes_by_type.get(media_type) or {
        "SaveImage",
        "SaveAnimatedWEBP",
        "SaveVideo",
        "VHS_VideoCombine",
        "SaveAudio",
        "SaveAudioMP3",
        "PreviewAudio",
        "SaveGLB",
        "PreviewImage",
        "Preview3D",
    }
    return [str(node_id) for node_id, node in prompt.items() if node.get("class_type") in output_classes]


def format_node_errors(node_errors):
    messages = []
    for node_id, details in node_errors.items():
        class_type = details.get("class_type", "node") if isinstance(details, dict) else "node"
        errors = details.get("errors", []) if isinstance(details, dict) else []
        if not errors:
            messages.append(f"ComfyUI rejected {class_type} {node_id}.")
            continue
        for error in errors[:3]:
            message = error.get("message") or error.get("type") or "validation error"
            details_text = error.get("details")
            if details_text:
                message = f"{message}: {details_text}"
            messages.append(f"ComfyUI rejected {class_type} {node_id}: {message}")
    return " ".join(messages[:5])


def comfy_error_message(detail, fallback):
    if not detail:
        return fallback
    try:
        payload = json.loads(detail)
    except json.JSONDecodeError:
        return detail
    node_errors = payload.get("node_errors")
    if node_errors:
        return format_node_errors(node_errors)
    error = payload.get("error")
    if isinstance(error, dict):
        return error.get("message") or error.get("type") or fallback
    if isinstance(error, str):
        return error
    return fallback


def queue(config):
    return http_json(f"{comfy_base_url(config)}/queue", timeout=10)


def queue_status(config):
    payload = queue(config)
    return {
        "running": [
            queue_item_summary(item, index, "running")
            for index, item in enumerate(payload.get("queue_running", []))
        ],
        "pending": [
            queue_item_summary(item, index, "queued")
            for index, item in enumerate(payload.get("queue_pending", []))
        ],
    }


def queue_item_summary(item, index, state):
    prompt_id = queue_item_prompt_id(item)
    metadata = JOB_METADATA.get(prompt_id, {})
    return {
        "prompt_id": prompt_id,
        "state": state,
        "position": index + 1,
        "workflow": metadata.get("workflow", "Studio job"),
        "media_type": metadata.get("media_type", "output"),
    }


def history(config, prompt_id):
    return http_json(f"{comfy_base_url(config)}/history/{urllib.parse.quote(prompt_id)}", timeout=10)


def queue_item_prompt_id(item):
    if isinstance(item, dict):
        for key in ("prompt_id", "id", "job_id"):
            value = item.get(key)
            if isinstance(value, str) and value:
                return value
        return None
    if isinstance(item, (list, tuple)) and len(item) > 1:
        candidate = item[1]
        if isinstance(candidate, str) and candidate:
            return candidate
        if isinstance(candidate, dict):
            for key in ("prompt_id", "id", "job_id"):
                value = candidate.get(key)
                if isinstance(value, str) and value:
                    return value
    return None


def progress(config, prompt_id):
    history_payload = history(config, prompt_id)
    prompt_data = history_payload.get(prompt_id, {})
    if prompt_data:
        status = prompt_data.get("status", {})
        status_text = status.get("status_str", "history")
        messages = status.get("messages", [])
        interrupted = any(message[0] == "execution_interrupted" for message in messages)
        started = next((msg[1].get("timestamp") for msg in messages if msg[0] == "execution_start"), None)
        ended = next((msg[1].get("timestamp") for msg in messages if msg[0] == "execution_success"), None)
        elapsed = None
        if started and ended:
            elapsed = max(0, (ended - started) / 1000)

        is_terminal = status.get("completed") or status_text in ("success", "completed")
        if interrupted or prompt_id in CANCELLED_PROMPTS or status_text in ("interrupted", "cancelled", "canceled"):
            CANCELLED_PROMPTS.discard(prompt_id)
            return {
                "prompt_id": prompt_id,
                "state": "cancelled",
                "completed": False,
                "status": status_text,
                "elapsed": elapsed,
                "outputs": [],
            }
        if is_terminal:
            outputs = flatten_outputs(history_payload)
            write_prompt_sidecars(prompt_id, outputs)
            return {
                "prompt_id": prompt_id,
                "state": "completed",
                "completed": True,
                "status": status_text,
                "elapsed": elapsed,
                "outputs": outputs,
            }
        return {
            "prompt_id": prompt_id,
            "state": "history",
            "completed": False,
            "status": status_text,
            "elapsed": elapsed,
            "outputs": [],
        }

    queue_payload = queue(config)
    running = queue_payload.get("queue_running", [])
    pending = queue_payload.get("queue_pending", [])
    for item in running:
        if queue_item_prompt_id(item) == prompt_id:
            return {
                "prompt_id": prompt_id,
                "state": "running",
                "completed": False,
                "status": "running",
                "queue_remaining": len(pending),
                "outputs": [],
            }
    for index, item in enumerate(pending):
        if queue_item_prompt_id(item) == prompt_id:
            return {
                "prompt_id": prompt_id,
                "state": "queued",
                "completed": False,
                "status": "queued",
                "queue_position": index + 1,
                "queue_remaining": len(pending),
                "outputs": [],
            }
    if prompt_id in CANCELLED_PROMPTS:
        CANCELLED_PROMPTS.discard(prompt_id)
        return {"prompt_id": prompt_id, "state": "cancelled", "completed": False, "status": "cancelled", "outputs": []}
    return {"prompt_id": prompt_id, "state": "waiting", "completed": False, "status": "waiting", "outputs": []}


def cancel_prompt(config, prompt_id):
    if not prompt_id:
        raise ValueError("prompt_id is required")

    cancelled = False
    try:
        payload = http_json(f"{comfy_base_url(config)}/api/jobs/{urllib.parse.quote(prompt_id)}/cancel", {}, timeout=10)
        cancelled = bool(payload.get("cancelled"))
    except urllib.error.HTTPError as exc:
        if exc.code != 404:
            raise

    if not cancelled:
        queue_payload = queue(config)
        running = queue_payload.get("queue_running", [])
        pending = queue_payload.get("queue_pending", [])
        if any(queue_item_prompt_id(item) == prompt_id for item in running):
            http_json(f"{comfy_base_url(config)}/interrupt", {"prompt_id": prompt_id}, timeout=10)
            cancelled = True
        elif any(queue_item_prompt_id(item) == prompt_id for item in pending):
            http_json(f"{comfy_base_url(config)}/queue", {"delete": [prompt_id]}, timeout=10)
            cancelled = True

    if cancelled:
        CANCELLED_PROMPTS.add(prompt_id)
    return {"prompt_id": prompt_id, "cancelled": cancelled}


VIDEO_EXTENSIONS = {".mp4", ".webm", ".mov", ".mkv", ".avi", ".gif"}


def flatten_outputs(history_payload):
    files = []
    for prompt_data in history_payload.values():
        for output in prompt_data.get("outputs", {}).values():
            for key, media_type in (
                ("images", "image"),
                ("gifs", "video"),
                ("videos", "video"),
                ("audios", "audio"),
                ("audio", "audio"),
                ("3d", "model"),
            ):
                animated_flags = output.get("animated") or []
                for index, item in enumerate(output.get(key, [])):
                    actual_type = media_type
                    if key == "images":
                        # SaveVideo reports its output under "images" in this ComfyUI
                        # version, flagged via "animated", so a video file doesn't get
                        # misclassified and rendered as a broken <img> tag.
                        is_animated = bool(index < len(animated_flags) and animated_flags[index])
                        suffix = Path(item.get("filename") or "").suffix.lower()
                        if is_animated or suffix in VIDEO_EXTENSIONS:
                            actual_type = "video"
                    files.append(
                        {
                            "type": actual_type,
                            "filename": item.get("filename"),
                            "subfolder": item.get("subfolder", ""),
                            "folder_type": item.get("type", "output"),
                            "url": media_url(item.get("filename"), item.get("subfolder", "")),
                        }
                    )
    return files


def media_url(filename, subfolder=""):
    parts = ["/media"]
    if subfolder:
        parts.extend(Path(subfolder).parts)
    parts.append(filename)
    return "/".join(urllib.parse.quote(part) for part in parts)


def gallery_items():
    extensions = {
        ".png": "image",
        ".jpg": "image",
        ".jpeg": "image",
        ".webp": "image",
        ".gif": "video",
        ".mp4": "video",
        ".webm": "video",
        ".wav": "audio",
        ".flac": "audio",
        ".mp3": "audio",
        ".ogg": "audio",
        ".m4a": "audio",
        ".aac": "audio",
        ".aiff": "audio",
        ".aif": "audio",
        ".obj": "model",
        ".glb": "model",
        ".gltf": "model",
        ".stl": "model",
    }
    items = []
    if not COMFY_OUTPUT.exists():
        return items
    for path in COMFY_OUTPUT.rglob("*"):
        if not path.is_file() or path.name.startswith("."):
            continue
        media_type = extensions.get(path.suffix.lower())
        if not media_type:
            continue
        rel = path.relative_to(COMFY_OUTPUT)
        items.append(
            {
                "name": path.name,
                "type": media_type,
                "url": "/" + "/".join(["media", *[urllib.parse.quote(part) for part in rel.parts]]),
                "modified": path.stat().st_mtime,
                "size": path.stat().st_size,
            }
        )
    return sorted(items, key=lambda item: item["modified"], reverse=True)[:120]


def safe_upload_name(name):
    stem = Path(name).stem or "upload"
    suffix = Path(name).suffix.lower()
    if suffix not in (".png", ".jpg", ".jpeg", ".webp", ".bmp", ".mp4", ".webm", ".mov", ".mkv"):
        suffix = ".png"
    clean = re.sub(r"[^a-zA-Z0-9._-]+", "-", stem).strip("-._") or "upload"
    return f"{time.strftime('%Y%m%d-%H%M%S')}-{uuid.uuid4().hex[:8]}-{clean}{suffix}"


def handle_upload(handler):
    content_type = handler.headers.get("Content-Type", "")
    if not content_type.startswith("multipart/form-data"):
        json_response(handler, {"error": "Expected multipart/form-data"}, 400)
        return

    form = cgi.FieldStorage(
        fp=handler.rfile,
        headers=handler.headers,
        environ={
            "REQUEST_METHOD": "POST",
            "CONTENT_TYPE": content_type,
            "CONTENT_LENGTH": handler.headers.get("Content-Length", "0"),
        },
    )
    field = form["file"] if "file" in form else None
    if field is None or not getattr(field, "filename", ""):
        json_response(handler, {"error": "No file uploaded"}, 400)
        return

    upload_dir = COMFY_INPUT / UPLOAD_SUBDIR
    upload_dir.mkdir(parents=True, exist_ok=True)
    filename = safe_upload_name(field.filename)
    target = upload_dir / filename
    with target.open("wb") as output:
        while True:
            chunk = field.file.read(1024 * 1024)
            if not chunk:
                break
            output.write(chunk)

    relative = f"{UPLOAD_SUBDIR}/{filename}"
    json_response(handler, {"name": relative, "filename": filename, "url": f"/input/{urllib.parse.quote(filename)}"})
