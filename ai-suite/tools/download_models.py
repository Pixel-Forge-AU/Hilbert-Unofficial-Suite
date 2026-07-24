#!/usr/bin/env python3
"""Download known AI Suite V2 / migrated Studio model files.

The v2 pack manifests often describe model roles instead of exact files. This
script focuses on exact filenames referenced by migrated workflows and v2
workflow-api files, using URLs from bundled ComfyUI blueprints where possible.
"""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import time
import urllib.request
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
COMFY_MODELS = Path("/home/hilbert/ai-suite-v2/repos/ComfyUI/models")
REPORT = ROOT / "logs/model-download-report.json"


MODELS = [
    # Core v2 pack exact filenames
    ("checkpoints", "sdxl.safetensors", "https://huggingface.co/stabilityai/stable-diffusion-xl-base-1.0/resolve/main/sd_xl_base_1.0.safetensors"),
    ("checkpoints", "juggernaut-xl-v9.safetensors", "https://huggingface.co/RunDiffusion/Juggernaut-XL-v9/resolve/main/Juggernaut-XL_v9_RunDiffusionPhoto_v2.safetensors"),
    ("checkpoints", "flux_realism.safetensors", None),
    ("checkpoints", "stable-diffusion-xl-1.0-inpainting-0.1.safetensors", "https://huggingface.co/diffusers/stable-diffusion-xl-1.0-inpainting-0.1/resolve/main/unet/diffusion_pytorch_model.safetensors"),
    ("segmentation", "sam2_swin_b_large.pt", "https://huggingface.co/facebook/sam2.1-hiera-large/resolve/main/sam2.1_hiera_large.pt"),
    ("depth_estimation", "depth_anything_v2_vitb.pth", "https://huggingface.co/depth-anything/Depth-Anything-V2-Base/resolve/main/depth_anything_v2_vitb.pth"),

    # Migrated v1 / Comfy blueprint exact filenames
    ("loras", "Qwen-Image-Edit-Lightning-4steps-V1.0-bf16.safetensors", "https://huggingface.co/lightx2v/Qwen-Image-Lightning/resolve/main/Qwen-Image-Edit-Lightning-4steps-V1.0-bf16.safetensors"),
    ("controlnet", "Qwen-Image-InstantX-ControlNet-Inpainting.safetensors", "https://huggingface.co/Comfy-Org/Qwen-Image-InstantX-ControlNets/resolve/main/split_files/controlnet/Qwen-Image-InstantX-ControlNet-Inpainting.safetensors"),
    ("loras", "Qwen-Image-Lightning-4steps-V1.0.safetensors", "https://huggingface.co/lightx2v/Qwen-Image-Lightning/resolve/main/Qwen-Image-Lightning-4steps-V1.0.safetensors"),
    ("upscale_models", "RealESRGAN_x4plus.safetensors", "https://huggingface.co/Comfy-Org/Real-ESRGAN_repackaged/resolve/main/RealESRGAN_x4plus.safetensors"),
    ("vae", "Wan2_1_VAE_bf16.safetensors", "https://huggingface.co/Kijai/WanVideo_comfy/resolve/main/Wan2_1_VAE_bf16.safetensors"),
    ("background_removal", "birefnet.safetensors", "https://huggingface.co/Comfy-Org/BiRefNet/resolve/main/background_removal/birefnet.safetensors"),
    ("vae", "cogvideox_vae.safetensors", "https://huggingface.co/Comfy-Org/void-model/resolve/main/vae/cogvideox_vae.safetensors"),
    ("geometry_estimation", "depth_anything_3_base.safetensors", "https://huggingface.co/Comfy-Org/Depth-Anything-3/resolve/main/geometry_estimation/depth_anything_3_base.safetensors"),
    ("geometry_estimation", "depth_anything_3_metric_large.safetensors", "https://huggingface.co/Comfy-Org/Depth-Anything-3/resolve/main/geometry_estimation/depth_anything_3_metric_large.safetensors"),
    ("geometry_estimation", "depth_anything_3_mono_large.safetensors", "https://huggingface.co/Comfy-Org/Depth-Anything-3/resolve/main/geometry_estimation/depth_anything_3_mono_large.safetensors"),
    ("geometry_estimation", "depth_anything_3_small.safetensors", "https://huggingface.co/Comfy-Org/Depth-Anything-3/resolve/main/geometry_estimation/depth_anything_3_small.safetensors"),
    ("frame_interpolation", "film_net_fp16.safetensors", "https://huggingface.co/Comfy-Org/frame_interpolation/resolve/main/frame_interpolation/film_net_fp16.safetensors"),
    ("diffusion_models", "flux.1-fill-dev-OneReward-transformer_fp8.safetensors", "https://huggingface.co/Comfy-Org/OneReward_repackaged/resolve/main/split_files/diffusion_models/flux.1-fill-dev-OneReward-transformer_fp8.safetensors"),
    ("diffusion_models", "hunyuanvideo1.5_1080p_sr_distilled_fp16.safetensors", "https://huggingface.co/Comfy-Org/HunyuanVideo_1.5_repackaged/resolve/main/split_files/diffusion_models/hunyuanvideo1.5_1080p_sr_distilled_fp16.safetensors"),
    ("latent_upscale_models", "hunyuanvideo15_latent_upsampler_1080p.safetensors", "https://huggingface.co/Comfy-Org/HunyuanVideo_1.5_repackaged/resolve/main/split_files/latent_upscale_models/hunyuanvideo15_latent_upsampler_1080p.safetensors"),
    ("loras", "lightx2v_T2V_14B_cfg_step_distill_v2_lora_rank64_bf16.safetensors", "https://huggingface.co/Kijai/WanVideo_comfy/resolve/main/Lightx2v/lightx2v_T2V_14B_cfg_step_distill_v2_lora_rank64_bf16.safetensors"),
    ("checkpoints", "ltx-video-2b-v0.9.5.safetensors", None),
    ("text_encoders", "gemma_3_12B_it_fp8_scaled.safetensors", "https://huggingface.co/Comfy-Org/LTX-2/resolve/main/split_files/text_encoders/gemma_3_12B_it_fp8_scaled.safetensors"),
    ("diffusion_models", "qwen_image_edit_fp8_e4m3fn.safetensors", "https://huggingface.co/Comfy-Org/Qwen-Image-Edit_ComfyUI/resolve/main/split_files/diffusion_models/qwen_image_edit_fp8_e4m3fn.safetensors"),
    ("diffusion_models", "qwen_image_fp8_e4m3fn.safetensors", "https://huggingface.co/Comfy-Org/Qwen-Image_ComfyUI/resolve/main/split_files/diffusion_models/qwen_image_fp8_e4m3fn.safetensors"),
    ("vae", "qwen_image_vae.safetensors", "https://huggingface.co/Comfy-Org/Qwen-Image_ComfyUI/resolve/main/split_files/vae/qwen_image_vae.safetensors"),
    ("optical_flow", "raft_large_C_T_SKHT_V2-ff5fadd5.safetensors", "https://huggingface.co/Comfy-Org/void-model/resolve/main/optical_flow/raft_large_C_T_SKHT_V2-ff5fadd5.safetensors"),
    ("loras", "removal_timestep_alpha-2-1740.safetensors", "https://huggingface.co/lrzjason/ObjectRemovalFluxFill/resolve/main/removal_timestep_alpha-2-1740.safetensors"),
    ("frame_interpolation", "rife_v4.25.safetensors", "https://huggingface.co/Comfy-Org/frame_interpolation/resolve/main/frame_interpolation/rife_v4.25.safetensors"),
    ("frame_interpolation", "rife_v4.25_heavy.safetensors", "https://huggingface.co/Comfy-Org/frame_interpolation/resolve/main/frame_interpolation/rife_v4.25_heavy.safetensors"),
    ("frame_interpolation", "rife_v4.25_lite.safetensors", "https://huggingface.co/Comfy-Org/frame_interpolation/resolve/main/frame_interpolation/rife_v4.25_lite.safetensors"),
    ("frame_interpolation", "rife_v4.26.safetensors", "https://huggingface.co/Comfy-Org/frame_interpolation/resolve/main/frame_interpolation/rife_v4.26.safetensors"),
    ("frame_interpolation", "rife_v4.26_heavy.safetensors", "https://huggingface.co/Comfy-Org/frame_interpolation/resolve/main/frame_interpolation/rife_v4.26_heavy.safetensors"),
    ("diffusion_models", "rt_detr_v4-x-hgnet_fp16.safetensors", "https://huggingface.co/Comfy-Org/SDPose/resolve/main/diffusion_models/rt_detr_v4-x-hgnet_fp16.safetensors"),
    ("diffusion_models", "rt_detr_v4-x-hgnet_fp32.safetensors", "https://huggingface.co/Comfy-Org/SDPose/resolve/main/diffusion_models/rt_detr_v4-x-hgnet_fp32.safetensors"),
    ("checkpoints", "sam3.1_multiplex_fp16.safetensors", "https://huggingface.co/Comfy-Org/sam3.1/resolve/main/checkpoints/sam3.1_multiplex_fp16.safetensors"),
    ("checkpoints", "sdpose_wholebody_fp16.safetensors", "https://huggingface.co/Comfy-Org/SDPose/resolve/main/checkpoints/sdpose_wholebody_fp16.safetensors"),
    ("text_encoders", "umt5_xxl_fp8_e4m3fn_scaled.safetensors", "https://huggingface.co/Comfy-Org/Wan_2.1_ComfyUI_repackaged/resolve/main/split_files/text_encoders/umt5_xxl_fp8_e4m3fn_scaled.safetensors"),
    ("diffusion_models", "void_pass1.safetensors", "https://huggingface.co/Comfy-Org/void-model/resolve/main/diffusion_models/void_pass1.safetensors"),
    ("diffusion_models", "void_pass2.safetensors", "https://huggingface.co/Comfy-Org/void-model/resolve/main/diffusion_models/void_pass2.safetensors"),
    ("diffusion_models", "wan2.2_bernini_r_high_noise_fp8_scaled.safetensors", "https://huggingface.co/Comfy-Org/Bernini-R/resolve/main/diffusion_models/wan2.2_bernini_r_high_noise_fp8_scaled.safetensors"),
    ("diffusion_models", "wan2.2_bernini_r_low_noise_fp8_scaled.safetensors", "https://huggingface.co/Comfy-Org/Bernini-R/resolve/main/diffusion_models/wan2.2_bernini_r_low_noise_fp8_scaled.safetensors"),
    ("diffusion_models", "wan2.2_i2v_high_noise_14B_fp8_scaled.safetensors", "https://huggingface.co/Comfy-Org/Wan_2.2_ComfyUI_Repackaged/resolve/main/split_files/diffusion_models/wan2.2_i2v_high_noise_14B_fp8_scaled.safetensors"),
    ("loras", "wan2.2_i2v_lightx2v_4steps_lora_v1_high_noise.safetensors", "https://huggingface.co/Comfy-Org/Wan_2.2_ComfyUI_Repackaged/resolve/main/split_files/loras/wan2.2_i2v_lightx2v_4steps_lora_v1_high_noise.safetensors"),
    ("loras", "wan2.2_i2v_lightx2v_4steps_lora_v1_low_noise.safetensors", "https://huggingface.co/Comfy-Org/Wan_2.2_ComfyUI_Repackaged/resolve/main/split_files/loras/wan2.2_i2v_lightx2v_4steps_lora_v1_low_noise.safetensors"),
    ("diffusion_models", "wan2.2_i2v_low_noise_14B_fp8_scaled.safetensors", "https://huggingface.co/Comfy-Org/Wan_2.2_ComfyUI_Repackaged/resolve/main/split_files/diffusion_models/wan2.2_i2v_low_noise_14B_fp8_scaled.safetensors"),
    ("vae", "wan_2.1_vae.safetensors", "https://huggingface.co/Comfy-Org/Wan_2.2_ComfyUI_Repackaged/resolve/main/split_files/vae/wan_2.1_vae.safetensors"),

    # audio.ace-step-1-5
    ("diffusion_models", "acestep_v1.5_xl_turbo_bf16.safetensors", "https://huggingface.co/Comfy-Org/ace_step_1.5_ComfyUI_files/resolve/main/split_files/diffusion_models/acestep_v1.5_xl_turbo_bf16.safetensors"),
    ("vae", "ace_1.5_vae.safetensors", "https://huggingface.co/Comfy-Org/ace_step_1.5_ComfyUI_files/resolve/main/split_files/vae/ace_1.5_vae.safetensors"),
    ("text_encoders", "qwen_0.6b_ace15.safetensors", "https://huggingface.co/Comfy-Org/ace_step_1.5_ComfyUI_files/resolve/main/split_files/text_encoders/qwen_0.6b_ace15.safetensors"),
    ("text_encoders", "qwen_1.7b_ace15.safetensors", "https://huggingface.co/Comfy-Org/ace_step_1.5_ComfyUI_files/resolve/main/split_files/text_encoders/qwen_1.7b_ace15.safetensors"),

    # audio.stable-audio-sfx
    ("checkpoints", "stable_audio_open_1.0.safetensors", "https://huggingface.co/Comfy-Org/stable-audio-open-1.0_repackaged/resolve/main/stable-audio-open-1.0.safetensors"),
    ("text_encoders", "t5_base.safetensors", "https://huggingface.co/google-t5/t5-base/resolve/main/model.safetensors"),

    # audio.diffrhythm (comfyui-diffrhythm / diffrhythm_mw custom node)
    ("TTS/DiffRhythm", "cfm_model_v1_2.pt", "https://huggingface.co/ASLP-lab/DiffRhythm-1_2/resolve/main/cfm_model.pt"),
    ("TTS/DiffRhythm", "config.json", "https://huggingface.co/ASLP-lab/DiffRhythm-1_2/resolve/main/config.json"),
    ("TTS/DiffRhythm", "vae_model.pt", "https://huggingface.co/ASLP-lab/DiffRhythm-vae/resolve/main/vae_model.pt"),
    ("TTS/DiffRhythm/eval-model", "eval.yaml", "https://huggingface.co/spaces/ASLP-lab/DiffRhythm/resolve/main/pretrained/eval.yaml"),
    ("TTS/DiffRhythm/eval-model", "eval.safetensors", "https://huggingface.co/spaces/ASLP-lab/DiffRhythm/resolve/main/pretrained/eval.safetensors"),
    ("TTS/DiffRhythm/MuQ-large-msd-iter", "config.json", "https://huggingface.co/OpenMuQ/MuQ-large-msd-iter/resolve/main/config.json"),
    ("TTS/DiffRhythm/MuQ-large-msd-iter", "model.safetensors", "https://huggingface.co/OpenMuQ/MuQ-large-msd-iter/resolve/main/model.safetensors"),
    ("TTS/DiffRhythm/MuQ-MuLan-large", "config.json", "https://huggingface.co/OpenMuQ/MuQ-MuLan-large/resolve/main/config.json"),
    ("TTS/DiffRhythm/MuQ-MuLan-large", "pytorch_model.bin", "https://huggingface.co/OpenMuQ/MuQ-MuLan-large/resolve/main/pytorch_model.bin"),
    ("TTS/DiffRhythm/xlm-roberta-base", "config.json", "https://huggingface.co/FacebookAI/xlm-roberta-base/resolve/main/config.json"),
    ("TTS/DiffRhythm/xlm-roberta-base", "model.safetensors", "https://huggingface.co/FacebookAI/xlm-roberta-base/resolve/main/model.safetensors"),
    ("TTS/DiffRhythm/xlm-roberta-base", "sentencepiece.bpe.model", "https://huggingface.co/FacebookAI/xlm-roberta-base/resolve/main/sentencepiece.bpe.model"),
    ("TTS/DiffRhythm/xlm-roberta-base", "tokenizer.json", "https://huggingface.co/FacebookAI/xlm-roberta-base/resolve/main/tokenizer.json"),
    ("TTS/DiffRhythm/xlm-roberta-base", "tokenizer_config.json", "https://huggingface.co/FacebookAI/xlm-roberta-base/resolve/main/tokenizer_config.json"),
]


def file_size(path: Path) -> int:
    try:
        return path.stat().st_size
    except FileNotFoundError:
        return 0


def download_with_wget(url: str, target: Path) -> tuple[bool, str]:
    target.parent.mkdir(parents=True, exist_ok=True)
    tmp = target.with_suffix(target.suffix + ".part")
    cmd = [
        "wget",
        "--continue",
        "--tries=5",
        "--timeout=30",
        "--progress=dot:giga",
        "--output-document",
        str(tmp),
        url,
    ]
    result = subprocess.run(cmd, text=True)
    if result.returncode != 0:
        return False, f"wget exited {result.returncode}"
    tmp.replace(target)
    return True, "downloaded"


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--model-root", default=str(COMFY_MODELS))
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--only-missing", action="store_true", default=True)
    parser.add_argument("--include-unresolved", action="store_true", help="show unresolved entries in output")
    args = parser.parse_args()

    model_root = Path(args.model_root)
    report = {
        "started_at": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
        "model_root": str(model_root),
        "downloaded": [],
        "present": [],
        "failed": [],
        "unresolved": [],
    }

    for subdir, filename, url in MODELS:
        target = model_root / subdir / filename
        item = {"subdir": subdir, "filename": filename, "target": str(target), "url": url}
        if file_size(target) > 0:
            item["bytes"] = file_size(target)
            report["present"].append(item)
            print(f"present  {target}")
            continue
        if not url:
            report["unresolved"].append(item)
            if args.include_unresolved:
                print(f"missing unresolved {filename}")
            continue
        if args.dry_run:
            print(f"would download {filename} -> {target}")
            report["downloaded"].append({**item, "dry_run": True})
            continue
        print(f"download {filename}")
        ok, message = download_with_wget(url, target)
        item["message"] = message
        if ok:
            item["bytes"] = file_size(target)
            report["downloaded"].append(item)
            print(f"done     {target} ({item['bytes']} bytes)")
        else:
            report["failed"].append(item)
            print(f"failed   {filename}: {message}", file=sys.stderr)

    REPORT.parent.mkdir(parents=True, exist_ok=True)
    REPORT.write_text(json.dumps(report, indent=2) + "\n")
    print(f"report   {REPORT}")
    print(
        f"summary  present={len(report['present'])} downloaded={len(report['downloaded'])} "
        f"failed={len(report['failed'])} unresolved={len(report['unresolved'])}"
    )
    return 1 if report["failed"] else 0


if __name__ == "__main__":
    raise SystemExit(main())
