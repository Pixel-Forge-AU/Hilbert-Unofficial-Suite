# Talking Head Animation

Experimental portrait animation using ComfyUI's native
`WanInfiniteTalkToVideo` node.

This pack takes one portrait/reference image plus speech audio and generates a
short lip-synced talking-head video with the audio embedded.

## Inputs

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| image | file | example.png | Source portrait or character image |
| audio | file | example.wav | Speech audio used to drive motion |
| prompt | textarea | natural close portrait | Motion and camera direction |
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

For simple image-to-video motion without speech audio, use an image-to-video pack
instead.
