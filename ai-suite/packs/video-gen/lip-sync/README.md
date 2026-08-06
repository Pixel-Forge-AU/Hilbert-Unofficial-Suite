# Lip Sync Animation

Experimental image-and-audio lip-sync generation using ComfyUI's native
`WanInfiniteTalkToVideo` node.

This pack takes a still source image plus speech audio and generates a short
Wan2.1 InfiniteTalk video with the audio embedded. It is not an existing-video
dubbing workflow.

## Inputs

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| image | file | example.png | Source face or character image |
| audio | file | example.wav | Speech audio used for lip motion |
| prompt | textarea | natural speech motion | Motion and stability direction |
| width | integer | 832 | Output width |
| height | integer | 480 | Output height |
| frames | integer | 17 | Output frame count; normalized to 4n+1 |
| fps | number | 16 | Video frame rate |
| steps | integer | 4 | Sampling steps |
| cfg | number | 1.0 | Guidance scale |
| sampler_name | select | euler | Sampler |
| scheduler | select | normal | Scheduler |
| seed | integer | -1 | Random seed |
| audio_scale | number | 1.0 | Audio conditioning strength |
| motion_frame_count | integer | 9 | Motion context frames |
| lora_strength | number | 1.0 | LightX2V LoRA strength |

## Runtime Notes

The graph validates with the installed InfiniteTalk/Wan model stack, but Wan 14B
video generation is heavy. Treat this as experimental until a local run writes a
completed MP4 on the target machine. Use short frame counts for tests.

For existing-video dubbing, this is the wrong pack; this pack starts from a still
image.
