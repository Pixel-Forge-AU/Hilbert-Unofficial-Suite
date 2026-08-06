# Detailifier (Krea2 LoRA)

Standalone preset for the detailifier_epoch_20 detail-enhancer LoRA, applied over the Moody Cutie Mix Krea2 v2.0 checkpoint. Lower default strength since detail LoRAs tend to be strong.

- Base checkpoint: `moodyCutieMixKrea2_v20.safetensors` (diffusion_models/)
- LoRA: `detailifier_epoch_20.safetensors` (loras/), default strength 0.6
- Text encoder: `qwen3vl_4b_fp8_scaled.safetensors` (text_encoders/)
- VAE: `qwen_image_vae.safetensors` (vae/)
