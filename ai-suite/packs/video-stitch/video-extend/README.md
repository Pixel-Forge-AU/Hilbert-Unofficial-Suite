# Extend Video

Continue an existing video past its last frame, using ComfyUI's native
`WanInfiniteTalkToVideo` node in its built-in "extend" mode.

## How it works

Unlike a plain image-to-video workflow, this doesn't just animate a single
still frame. The source video's entire frame sequence is fed into
`WanInfiniteTalkToVideo` as `previous_frames`: the node uses the last few
frames (`motion_frame_count`) as motion context so the new segment continues
the subject's motion and identity, and aligns the continuation audio to start
right where the source clip's own audio leaves off.

The newly generated frames are trimmed of their motion-context overlap and
appended after the original clip's frames; the original audio (if any) is
concatenated with the continuation audio before the final mux.

## Inputs

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| video | file | smoke-input.mp4 | Video to continue past its last frame |
| prompt | textarea | continues naturally... | Motion/action direction for the new segment |
| audio | file | example.wav | Continuation speech audio, appended after the source's own audio |
| width / height | integer | 832 / 480 | Output resolution |
| frames | integer | 81 | Frame count of the *new* segment (normalized to 4n+1) |
| steps | integer | 4 | Sampling steps |
| cfg | number | 1.0 | Guidance scale |
| sampler_name / scheduler | select | euler / normal | Sampler settings |
| seed | integer | 42 | Random seed |
| audio_scale | number | 1.0 | Audio conditioning strength |
| motion_frame_count | integer | 9 | How many trailing frames of the source video are used as motion context |
| lora_strength | number | 1.0 | LightX2V LoRA strength |

## Runtime notes

- This reuses the same Wan2.1 + InfiniteTalk model stack as the `talking-head`
  and `lip-sync` packs, so it carries the same experimental status: Wan 14B
  generation is slow, and audio/frame-rate alignment assumes the model's
  internal timing convention rather than the container's actual fps.
- If you don't need the video's own motion carried forward — just a fresh
  clip from a single picture — use `image-to-video` instead.
- If you just need to attach a different audio track to an existing video
  with no new frames generated, use `video-mux` instead.
