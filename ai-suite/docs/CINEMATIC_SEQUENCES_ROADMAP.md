# Cinematic Sequences — Implementation Roadmap

Status: **Phases 1-4 implemented, Phase 5 in progress** (2026-08-06). Written for agents picking up implementation work — each phase is scoped to be doable independently, in order.

## Context

Storyboard and Composer are Studio-app tabs, not Genesis Runtime plugins. They live in:

- Backend: `ai-suite/launcher.py` (Flask routes, storyboard CRUD at lines ~3427–3519)
- Frontend: `ai-suite/launcher/frontend/index.html` (single monolithic file, `data-tab`/`tab-panel` convention)
- Persistence: `ai-suite/storyboards/*.json`, one file per storyboard

Storyboard's model today: `{id, title, created_at, updated_at, shots: [{description, steering, image}], video}`. No camera or scene concept exists anywhere in the codebase (confirmed via grep for `camera|angle|lens|dolly|pan|tilt`). Video generation walks consecutive shot pairs through the `video.keyframe-video` / `video.keyframe-video-fast` ComfyUI workflow (WAN 2.2 first-last-frame-to-video) with a generic transition prompt, then stitches segments via `/api/stitch-videos`.

**Cinematic Sequences** is a new, parallel tab — not a rewrite of Storyboard — adding a scene layer and per-shot camera direction (framing + movement) that feeds into the same generation pipeline via a smarter prompt.

## Phase 1 — Backend data model & persistence

File: `ai-suite/launcher.py` (mirror the storyboard block, don't modify it)

- [x] Add `CINEMATICS_DIR = Path(__file__).resolve().parent / 'cinematics'`, `mkdir(parents=True, exist_ok=True)`
- [x] Define the document shape:

```json
{
  "id": "a1b2c3d4e5f6",
  "title": "Rooftop Chase",
  "created_at": "2026-08-06T09:12:00",
  "updated_at": "2026-08-06T09:40:00",
  "scenes": [
    {
      "id": "sc_01",
      "heading": "EXT. ROOFTOP - NIGHT",
      "action": "Runner vaults the gap as pursuers close in.",
      "shots": [
        {
          "id": "sh_01",
          "description": "Runner sprints toward the ledge, pursuers 20m back.",
          "framing": "wide",
          "camera_movement": "dolly-in",
          "lens_mm": 35,
          "duration_s": 2.5,
          "steering": "harsh sodium streetlight, motion blur",
          "image": null
        }
      ],
      "video": null
    }
  ],
  "video": null
}
```

- [x] `framing` enum: `extreme-wide, wide, medium-wide, medium, medium-close, close-up, extreme-close-up, over-the-shoulder, pov, insert`
- [x] `camera_movement` enum: `static, pan-left, pan-right, tilt-up, tilt-down, dolly-in, dolly-out, truck-left, truck-right, crane-up, crane-down, handheld, whip-pan, zoom-in, zoom-out, orbit`
- [x] `lens_mm` (int, optional) and `duration_s` (number, optional) are planning/reference metadata only — see Constraints below, do not build any code path that assumes they control generation

## Phase 2 — API routes

Copy the storyboard route set exactly (`api_list_storyboards`, `api_create_storyboard`, `api_get_storyboard`, `api_update_storyboard`, `api_delete_storyboard`), same "client owns the object, PUTs it whole" contract:

- [x] `GET /api/cinematics` — list; summary items add `scene_count`, `shot_count` alongside the existing `shots_with_images` / `has_video` / `thumbnail_url` fields
- [x] `POST /api/cinematics` — create, seed with one empty scene containing one empty shot
- [x] `GET /api/cinematics/<id>`
- [x] `PUT /api/cinematics/<id>` — accept `title` / `scenes` / `video` keys, same partial-update pattern as `api_update_storyboard`
- [x] `DELETE /api/cinematics/<id>`
- [x] ID sanitization: reuse the same `re.sub(r'[^a-zA-Z0-9_-]', '', id)` pattern as `_storyboard_path`

Verified 2026-08-06 against a live instance: full create/get/list/update/delete lifecycle over real HTTP, list summary fields correct.

## Phase 3 — Generation pipeline integration

No new ComfyUI workflow needed. Reuse `video.keyframe-video` / `video.keyframe-video-fast` and `/api/stitch-videos` exactly as Storyboard does, at two levels:

- [x] **Within a scene**: for each consecutive shot pair, build the motion prompt from camera fields instead of the generic line:

```js
const motionPrompt = `${toShot.framing} shot, camera ${toShot.camera_movement}. `
  + `Action: ${fromShot.description} → ${toShot.description}. `
  + `${toShot.steering || ''}`.trim();
```

- [x] Run the existing pair→`runComfyWorkflow`→stitch loop per scene (copy `generateStoryboardVideo()` in `index.html` as the base) to produce each scene's `video` — factored into a shared `generateSceneSegments()` helper so both generate actions reuse it
- [x] **Across scenes**: once every scene has a `video`, POST the list of scene videos to `/api/stitch-videos` (already accepts arbitrary output lists — no backend change needed) to produce the sequence-level `video`
- [x] Surface progress across both levels (scene N of M, pair X of Y within scene) — reuse the `setSbProgress`-style callback pattern (`setCinProgress`)

## Phase 4 — Frontend tab & editor UI

File: `ai-suite/launcher/frontend/index.html`. New tab, same skeleton as Storyboard's `tab-storyboard` block:

- [x] Add `<button class="tab-btn" data-tab="cinematic">Cinematic</button>` and `<section class="tab-panel" id="tab-cinematic">`
- [x] List view: same as `sbListView`/`sbList`, pointed at `/api/cinematics`
- [x] Editor view additions beyond Storyboard's shot list:
  - Scene rail: add/delete scenes, each rendered as a card containing its own shot list (repeat the `sbShotList` pattern per scene). Reordering was not built — not in the roadmap's checklist and not requested.
  - Per-shot camera controls: `<select>` for framing, `<select>` for movement, number input for lens, alongside the existing description/steering fields and image picker
- [x] Two generate actions: **Generate Scene Video** button per scene card (current scene only) and **Generate Full Sequence** button (all scenes + cross-scene stitch)
- [x] Init function `initCinematic()` called alongside `initStoryboard()` at startup

## Phase 5 — Verification

- [ ] Create a 2-scene, 2-shot-per-scene sequence end to end through the UI — not yet done in-browser; the `/` route is slow to render in this environment for reasons unrelated to this change (see note below), which blocked a live browser pass. API-level equivalent (create/get/update/delete round-trip) was verified instead.
- [ ] Confirm scene-level stitched video and full-sequence stitched video both save correctly on `PUT /api/cinematics/<id>` — not run; requires a live ComfyUI backend and real (multi-minute) generation, out of scope for this pass per the Constraints section
- [x] Confirm list view shows correct `scene_count`/`shot_count`/`thumbnail_url` after creation — verified via direct API test: creating a sequence and listing it returned `scene_count: 1, shot_count: 1, shots_with_images: 0, has_video: false, thumbnail_url: null` as expected for a freshly seeded sequence

Note: `GET /` did not respond at all within 180s in this environment (confirmed hang, not just slow) — unrelated to anything touched here, since `index()` and `initialize_app()` were not modified. `GET /api/cinematics` and friends, which don't go through that path, responded in well under a second. This blocks any in-browser verification until root-caused; recommend investigating separately (suspect something in `initialize_app()`'s startup sequence — e.g. `ComfyHealthMonitor`/`ComfyProgressMonitor` — blocking against a ComfyUI backend that wasn't running in this environment) before attempting a real UI click-through pass.

## Constraints (do not build around these as if they were solvable now)

- **`lens_mm` and `duration_s` do not control generation.** `packs/video-gen/keyframe-video/manifest.yaml` only exposes prompt text and the two keyframe images — no frame-count or focal-length input exists on the workflow. Label these fields "reference only" in the UI.
- **`camera_movement` is prompt-guided, not enforced.** WAN 2.2 first-last-frame-to-video has no explicit camera-pose conditioning; the enum value steers the text prompt, it does not guarantee the resulting motion. Same "Unverified" caveat that's already on Storyboard's generate button applies here.
- **Hardware cost multiplies with scene count.** Each shot pair is a 14B-model call (already minutes each per the pack's own unverified-at-scale warning). A 4-scene, 3-shot sequence is ~9 pair-generations plus 2 stitch passes. Surface an estimated-time warning before "Generate Full Sequence" on long sequences.

## Open decisions (resolve before or during Phase 1)

1. **Resolved: new tab**, as scoped throughout Phases 1-4 (implemented as `tab-cinematic`, fully separate from `tab-storyboard`).
2. Enum list built as specified in Phase 1; not trimmed or extended. Revisit if the action-scene work in mind needs framings/movements not covered.
3. **Resolved: hard cut.** Each scene generates its own video independently; scenes are stitched together at the sequence level via `/api/stitch-videos` with no generated cross-scene transition. No auto-interpolation between the last shot of scene N and the first shot of scene N+1.
