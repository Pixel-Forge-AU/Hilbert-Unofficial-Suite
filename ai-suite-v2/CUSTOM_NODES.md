# Custom ComfyUI nodes required by the workflow packs

Every workflow pack manifest (`packs/*/*/manifest.yaml`) declares the ComfyUI
extras it needs. `comfyui` itself (stock/built-in) is listed as required by
all 62 workflows and needs no action beyond the base ComfyUI install.

Beyond that, these are listed as *optional* per-workflow dependencies - a
workflow will still show up and mostly work without them, but the specific
nodes they add (impact-pack detailers, controlnet preprocessors, face/ID
tools, etc.) won't be available until installed. Install what you actually
plan to use; you don't need all of these for a fresh setup.

**How to install**: open the ComfyUI web UI (`:8188`) → Manager → "Install
Custom Nodes" → search by the name below. This project deliberately does not
hardcode git URLs for these (beyond the one exception noted below) - names
get renamed/forked/moved over time, and ComfyUI-Manager's own search index is
the reliable source of truth for where each one currently lives.

| Custom node package    | Needed by (workflow id : name)                                                                                                                                                                                                                                                                     |
|-------------------------|------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| `comfyui-impact-pack`    | character.character-sheet, character.expression-sheet, character.full-body, character.portrait, core.text-to-image-batch, core.text-to-image-extreme, core.text-to-image-fast, core.text-to-image-low-vram, core.text-to-image-quality, horror.battle-damage, horror.blood-overlay, horror.creature-mutation, horror.eldritch-corruption, horror.zombie-progression, weird.ai-telephone, weird.alternate-universe, weird.corporate-nightmare (17) |
| `comfyui-controlnet-aux` | same 17 workflows as impact-pack above                                                                                                                                                                                                                                                            |
| `comfyui-better-images`  | horror.battle-damage, horror.blood-overlay, horror.creature-mutation, horror.eldritch-corruption, horror.zombie-progression (5)                                                                                                                                                                   |
| `comfyui-faceanalysis`   | character.expression-sheet (1)                                                                                                                                                                                                                                                                     |
| `comfyui-instantid`      | character.portrait (1)                                                                                                                                                                                                                                                                             |
| `comfyui-pulid`          | character.portrait (1)                                                                                                                                                                                                                                                                             |
| `comfyui-logo-overlay`   | weird.corporate-nightmare (1)                                                                                                                                                                                                                                                                      |
| `comfyui-reality-shifter`| weird.alternate-universe (1)                                                                                                                                                                                                                                                                       |
| `comfyui-diffrhythm`     | audio.diffrhythm (1) - **note:** this is a different pack workflow from the legacy `studio-migrated.audio-diffrhythm` one, which instead uses the `diffrhythm_mw` node already bundled in `extra/custom_nodes/` (`install.sh` copies it into place automatically since it has no public git remote to search for). If `audio.diffrhythm` needs a distinct package under this exact name, search for it by name in Manager the same way; I could not confirm a specific verified repo for it, so it isn't pre-installed. |

## Where this list came from / its limits

Generated directly from the `custom_nodes.optional` field of every
`packs/*/*/manifest.yaml` in this release - not guessed. The package *names*
are what the manifests declare; I did not resolve each one to a specific git
URL, both because ComfyUI-Manager already does that reliably and because a
couple of these names (`comfyui-better-images`, `comfyui-reality-shifter`,
`comfyui-logo-overlay`) aren't ones I could independently verify as an
existing public repo - they may be internal/renamed/deprecated. If Manager's
search comes up empty for one of those, that workflow may need node support
you write or source yourself.

Model weights are a separate concern from custom nodes - see `README.md` and
each manifest's `models.required[].url` for what a given workflow needs.
