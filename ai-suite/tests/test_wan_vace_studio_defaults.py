import json
from pathlib import Path

import yaml

from launcher import WorkflowManager


ROOT = Path(__file__).resolve().parents[1]
PACK = ROOT / "packs" / "itv" / "wan21-vace-causvid-1.3b"


def _schema(required=None, optional=None):
    required = required or {}
    optional = optional or {}
    return {
        "input": {"required": required, "optional": optional},
        "input_order": {
            "required": list(required),
            "optional": list(optional),
        },
    }


def _object_info():
    return {
        "LoadAndResizeImage": _schema(
            {
                "image": ("STRING", {"default": ""}),
                "keep_proportion": ("BOOLEAN", {"default": False}),
                "width": ("INT", {"default": 848}),
                "height": ("INT", {"default": 480}),
                "upscale_method": (["lanczos"],),
                "divisible_by": ("INT", {"default": 2}),
                "crop": (["disabled"],),
                "pad_color": ("STRING", {"default": ""}),
                "mode": (["image"],),
            }
        ),
        "WanVaceToVideo": _schema(
            {
                "width": ("INT", {"default": 848}),
                "height": ("INT", {"default": 480}),
                "length": ("INT", {"default": 81}),
                "batch_size": ("INT", {"default": 1}),
                "strength": ("FLOAT", {"default": 1.0}),
            }
        ),
        "SolidMask": _schema(
            {
                "value": ("FLOAT", {"default": 1.0}),
                "width": ("INT", {"default": 512}),
                "height": ("INT", {"default": 512}),
            }
        ),
        "MaskToImage": _schema(),
        "RepeatImageBatch": _schema({"amount": ("INT", {"default": 1})}),
        "ImageToMask": _schema({"channel": (["red", "green", "blue", "alpha"],)}),
        "CLIPTextEncode": _schema({"text": ("STRING", {"default": ""})}),
        "KSampler": _schema(
            {
                "seed": ("INT", {"default": 0, "control_after_generate": True}),
                "steps": ("INT", {"default": 20}),
                "cfg": ("FLOAT", {"default": 6.0}),
                "sampler_name": (["uni_pc"],),
                "scheduler": (["simple"],),
                "denoise": ("FLOAT", {"default": 1.0}),
            }
        ),
        "LoraLoader": _schema(
            {
                "lora_name": (["Wan21_CausVid_bidirect2_T2V_1_3B_lora_rank32.safetensors"],),
                "strength_model": ("FLOAT", {"default": 0.0}),
                "strength_clip": ("FLOAT", {"default": 1.0}),
            }
        ),
    }


def _workflow_manager():
    manager = WorkflowManager.__new__(WorkflowManager)
    manager._get_comfy_object_info = lambda: _object_info()
    return manager


def test_uploaded_reference_reaches_wan_vace_and_quality_defaults_are_applied():
    manifest = yaml.safe_load((PACK / "manifest.yaml").read_text(encoding="utf-8"))
    workflow = json.loads((PACK / "workflow.json").read_text(encoding="utf-8"))
    manager = _workflow_manager()

    prompt = manager._build_comfy_prompt(
        {"manifest": manifest, "workflow": workflow, "workflow_api": None},
        {"164.image": "studio_uploads/my-reference.png"},
    )

    assert prompt["164"]["inputs"]["image"] == "studio_uploads/my-reference.png"
    assert prompt["109"]["inputs"]["reference_image"] == ["164", 0]
    # Image-to-video: the upload is also frame 1 of the control video, masked "keep" (0),
    # so the clip starts from it rather than treating it only as a subject hint.
    assert prompt["109"]["inputs"]["control_video"] == ["164", 0]
    # WanVaceToVideo downsamples the mask to latent frames, so a 1-frame keep mask is lost;
    # the chain repeats a value-0 SolidMask to cover the first 4 frames.
    mask_node = prompt[prompt["109"]["inputs"]["control_masks"][0]]
    assert mask_node["class_type"] == "ImageToMask"
    repeat = prompt[mask_node["inputs"]["image"][0]]
    assert repeat["class_type"] == "RepeatImageBatch" and repeat["inputs"]["amount"] == 4
    solid = prompt[prompt[repeat["inputs"]["image"][0]]["inputs"]["mask"][0]]
    assert solid["class_type"] == "SolidMask" and solid["inputs"]["value"] == 0.0
    assert prompt["109"]["inputs"]["strength"] == 1.0
    assert prompt["108"]["inputs"]["steps"] == 20
    assert prompt["108"]["inputs"]["cfg"] == 6.0
    assert prompt["115"]["inputs"]["strength_model"] == 0.0


def test_vace_run_rejects_an_empty_reference_before_dispatch():
    manifest = yaml.safe_load((PACK / "manifest.yaml").read_text(encoding="utf-8"))
    manager = _workflow_manager()
    manager.workflows = {
        manifest["id"]: {"manifest": manifest, "workflow": {}, "workflow_api": None}
    }

    success, result = manager.run_workflow(manifest["id"], {})

    assert success is False
    assert result["error"] == "Missing required input: Reference image"
