# LLM Song Structure & Lyrics

Turn a short song concept into a structured plan: tempo, key, and a section-by-section
breakdown (intro/verse/chorus/etc.) with real lyrics and a scene description per section.

## Overview

This is the planning step ahead of a chained song + cover art + film clip pipeline
(the Music Video pipeline). Rather than feeding a one-line concept straight into an
audio model's lyrics input, this workflow asks the local LLM to turn that concept into:

- A suggested `bpm` and musical `key`
- An ordered list of sections (e.g. `intro`, `verse-1`, `chorus-1`, `verse-2`,
  `chorus-2`, `outro`), each with:
  - `name` - the section label
  - `duration_seconds` - a rough length guess (normalized against the requested
    total duration downstream, not treated as exact)
  - `lyrics` - actual lyric lines for that section (empty for instrumental sections
    like `intro`/`outro`)
  - `scene` - a short visual description used to generate that section's own
    cover-art/scene image

## Input Parameters

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| concept | text | required | Short description of the song - story, mood, genre, instruments |
| tags | text | optional | Style tags (genre, mood, instruments) to keep the plan consistent with |
| duration | int | 180 | Target song duration in seconds |
| llm_model | text | "gpt-4o" | LLM model to use for planning |

## Output

Returns JSON with `sections` (array), `bpm`, and `key`, alongside the raw LLM
response. Consumers should treat `duration_seconds` as approximate and normalize/
snap section boundaries to their own timing needs (e.g. a beat grid) rather than
using them verbatim.

## See Also

- [LLM Prompt Engineer](../llm.prompt-engineer) - enhances image-generation prompts
- ACE Step 1.5 Audio Generation (`packs/audio/ace-step-1-5`) - the audio model this
  plan's `bpm`/`key`/lyrics feed into
