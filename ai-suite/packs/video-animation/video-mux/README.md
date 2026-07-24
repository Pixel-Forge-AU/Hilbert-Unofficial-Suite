# Combine Video & Audio

Mux an existing video clip with a separate audio file into a single output video,
using ComfyUI's native `LoadVideo` / `GetVideoComponents` / `CreateVideo` /
`SaveVideo` nodes.

## What it does

- Loads the source video and extracts its frames and frame rate.
- Loads the audio file you provide.
- Combines the video's frames with the new audio track at the video's original
  frame rate.
- Any audio the source video already had is discarded and replaced by the
  supplied track.

## Inputs

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| video | file | smoke-input.mp4 | Source video (frames are kept, audio is discarded) |
| audio | file | example.wav | Audio track to combine with the video |
| filename_prefix | text | video/video-mux | Output folder/prefix |

## Notes

- This is a pure container operation (demux/mux) — no diffusion model or GPU
  inference is involved, so it runs almost instantly regardless of video length.
- If the audio is longer or shorter than the video, the output duration follows
  whichever container format's player convention applies; trim either input
  first (e.g. with a video/audio trim workflow) if you need an exact match.
- To layer new audio *on top of* an existing track instead of replacing it, use
  a workflow with `AudioMerge` instead of this one.
