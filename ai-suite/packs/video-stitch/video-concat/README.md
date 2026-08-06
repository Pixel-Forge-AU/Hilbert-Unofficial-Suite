# Concatenate Videos

Join two existing video clips end-to-end into a single output video, using
ComfyUI's native `LoadVideo` / `GetVideoComponents` / `ImageBatch` /
`AudioConcat` / `CreateVideo` / `SaveVideo` nodes.

## What it does

- Loads both source videos and extracts each one's frames, audio, and frame
  rate.
- Concatenates the frame sequences (second video's frames appended after the
  first's) and concatenates the audio tracks in the same order.
- Encodes the result at the first video's frame rate.

## Inputs

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| video1 | file | smoke-input.mp4 | Clip that plays first |
| video2 | file | smoke-input.mp4 | Clip that plays second |
| filename_prefix | text | video/video-concat | Output folder/prefix |

## Notes

- This is a pure container/frame-batch operation — no diffusion model or GPU
  inference is involved, so it runs almost instantly regardless of video
  length.
- Both clips should share the same resolution: `ImageBatch` concatenates raw
  frame batches and will error on a size mismatch rather than resizing.
- Output frame rate follows `video1`; if `video2` was encoded at a different
  fps, its frames still play back at `video1`'s rate (no retiming).
- If a source clip has no audio, feed it through a workflow with `LoadAudio`
  / silence generation first — `AudioConcat` expects an audio input from each
  side.
- To generate new, AI-continued frames instead of splicing two pre-existing
  clips, use `video-extend` instead. To replace a clip's audio track rather
  than append clips, use `video-mux`.
