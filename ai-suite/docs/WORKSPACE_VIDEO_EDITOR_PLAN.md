# Workspace video editor: Concat integration plan

Status: **First release implemented and tested on the target machine (2026-10-16).** See [Phase 0 results](#phase-0-results-2026-10-16) and [Implementation and acceptance results](#implementation-and-acceptance-results-2026-10-16). Milestones 2 (titles, transitions, effects, clip position), 3 (keyframes, crop, blend, flip, duplicate) and 4 (templates, effect keyframes, automatic captions) added the same day; see [Milestone 2](#milestone-2-titles-transitions-effects-position-2026-10-16), [Milestone 3](#milestone-3-keyframes-crop-blend-duplicate-2026-10-16) and [Milestone 4](#milestone-4-templates-effect-keyframes-automatic-captions-2026-10-16).

## Goal

Add a **Workspace** tab to the AI Suite Studio web UI for assembling and exporting video from local footage and AI Suite outputs. Use [Concat](https://github.com/jub0t/concat) as the editing and rendering engine. The first release should support a real, saved multitrack edit without trying to reproduce every control in Concat's native window.

## Why this shape

Studio is a Flask app in `launcher.py` with its browser UI in `launcher/frontend/index.html`. Its main tabs use `data-tab` buttons and matching `tab-<name>` panels; the Library already lists reusable media. Concat is a separate Rust engine with a native Slint window. Its [documented API](https://concatenate.pages.dev/docs/) exposes projects, media import, edits, undo/redo, single-frame preview, and export over JSON-RPC. A Studio tab can use those operations through Flask. Embedding Concat's native window in the browser is not part of this design.

Concat's repository README advertises MCP, but its [architecture notes](https://github.com/jub0t/concat/blob/main/ARCHITECTURE.md) and [developer docs](https://concatenate.pages.dev/docs/) say the MCP transport is not in the tree as of 0.2.6. Use the shipped JSON-RPC socket API. Verify the installed version and capabilities with `version` on the target machine before coding against it.

## First-release scope

1. Create, list, open, save, and close Workspace projects.
2. Import video, image, and audio files from Studio Library and from local upload.
3. Show a media bin and multitrack timeline with clip placement, trim, split, move, delete, undo, and redo. Add more commands only after checking the installed Concat command vocabulary.
4. Show a browser preview with transport controls. Use local source playback for responsive navigation where possible, and Concat's `preview.frame` for an accurate still at the playhead after edits. Clearly identify when the moving preview is approximate. Do not call `preview.frame` at playback frame rate.
5. Export an MP4, show progress and errors, allow cancellation, and register the result with Studio Library.
6. Persist the Concat project in its native folder format so a project can be reopened after a Studio or Concat restart.

Later milestones may add titles, transitions, effect parameter controls, captions, audio mixing, keyframes, templates, and closer preview parity. These are outside the first-release acceptance gate.

## Target architecture

```text
Studio Workspace tab
    | HTTP /api/workspace/*
    v
launcher.py: identity checks, path mapping, API validation, event relay
    | authenticated JSON-RPC over 127.0.0.1 or Unix socket
    v
concat-cli serve: project model, edit commands, preview, export
    |
    +-- per-user project folders under a configured local root
    +-- export files made visible through Studio Library
```

- Run Concat as a managed local service beside Studio, with a pinned release or commit and a recorded `apiVersion`. Keep its socket off the public network. Store its token server-side; never send it to the browser. The [transport docs](https://concatenate.pages.dev/docs/transports/json-rpc/) require a token even on loopback and warn that the API can read files accessible to its process.
- Add a small Python client module instead of scattering socket calls through `launcher.py`. Match JSON-RPC responses by `id`; export events can arrive between a request and its response. Use one owner for connection lifecycle, timeouts, reconnects, and event handling.
- Put projects under a configurable directory such as `CONCAT_PROJECTS_DIR`, with separate directories derived from `resolve_identity(request)`. Validate every project path against that root on the server. Keep generated runtime data out of git.
- Studio's existing output paths and uploads are the source of truth for Library media. Resolve a Library item to a server-side local file path, verify access and existence, then call `media.import`. The browser must never submit an arbitrary filesystem path to Concat.
- Concat's native window and API refuse concurrent edits to the same open project folder. Treat a Workspace project as owned by Studio while open; show a clear conflict message if Concat reports `refused` or `busy`.
- Keep Concat calls and exports out of Flask request threads where they can block indefinitely. Use bounded calls and a job/event relay for progress. Polling is acceptable for the first UI if the backend retains job state and reconnects cleanly.

## Implementation phases

### 0. Target-machine proof of capability

- Inspect OS, CPU/GPU, FFmpeg and runtime dependencies, available disk, and how Studio is launched on the actual machine.
- Install or build a pinned Concat release outside the AI Suite source tree. Start `concat-cli serve` on loopback with a restricted project root and a server-side token.
- Call `version`; record `apiVersion`, Concat version, and capabilities. Run a disposable end-to-end probe: create project, import a short media file, apply one edit, request `preview.frame`, export a short MP4, reopen the project.
- Check preview latency and export load alongside ComfyUI. Decide service scheduling if GPU contention is material. Stop here and revise the design if the installed Concat API cannot complete this probe reliably.

### 1. Backend adapter and project lifecycle

- Add the Concat client module, config, service health reporting, and controlled startup/shutdown in the existing service manager.
- Add `/api/workspace/health`, project list/create/open/get/save/close, and media-import routes. Return stable Studio-facing errors for Concat `refused`, `busy`, missing media, unavailable service, and version mismatch.
- Enforce identity and canonical path checks for every route. Use the same identity model as Studio outputs; do not trust a client-supplied user name, project root, or absolute media path.
- Test the adapter with a fake JSON-RPC server for response/event interleaving and reconnection, then run the project lifecycle against the real service.

### 2. Workspace tab and core editing

- Add a `Workspace` button to Studio's Creative tab group, a `tab-workspace` panel, and initialization on tab activation in `launcher/frontend/index.html`. Keep existing tabs and routes intact.
- Build project picker, media bin, timeline, playhead, selection/inspector, save state, and keyboard undo/redo. Send edits as Concat commands; refresh from the returned `EditorView` rather than maintaining a second authoritative document.
- Use a small initial edit-command set confirmed against Concat's [command reference](https://concatenate.pages.dev/docs/api/edit-commands/). Define explicit UI behavior for rejected edits and unsaved changes.
- Add responsive mobile layout only after the desktop editing interaction is usable; the first target is the existing desktop Studio UI.

### 3. Preview, export, and Library handoff

- Add accurate still preview through `preview.frame`; cache by project revision, timestamp, and preview size. Cancel obsolete requests during rapid scrubbing.
- Add practical moving playback using browser-readable source media or a temporary preview render. Source playback does not represent effects or stacked composition; show an accurate still when paused and use exported media for final review. Measure whether richer preview is needed before building a streaming renderer.
- Add export start/progress/cancel/result routes. Write to a managed output directory, handle partial or failed files, and show the result in Library's Video view with a usable thumbnail or fallback.
- Confirm export jobs survive a browser refresh; after a server restart, show the actual Concat state or a clear interrupted status rather than a fabricated completion.

### 4. Hardening and handoff

- Verify two identities cannot list, open, import into, or export over each other's projects. Check path traversal, symlinks, and malformed Library references.
- Exercise large-file import, missing source media, project reopen, service outage/restart, export cancellation, and GPU contention with a ComfyUI job.
- Document setup, pinned version, config values, service commands, project and export locations, backup/recovery, and known preview limits in `docs/SERVICES.md` and the user guide.
- Record actual tested commands and outcomes in this plan when implementation is complete.

## Acceptance gate for the first release

- A Studio user can make a Workspace project, import an existing Library video and audio file, arrange clips on at least two tracks, trim or split a clip, undo and redo, save, refresh the page, and reopen the same edit.
- The paused preview reflects the edited composition at a chosen time. The UI distinguishes that exact still from any approximate moving preview.
- The user can export an MP4, see progress or a useful failure, cancel an active export, and open the completed file from Library.
- The Concat token and raw filesystem paths are absent from browser responses. A second identity cannot access the first identity's projects or exports.
- Studio remains usable when Concat is stopped; Workspace shows a service error without breaking other tabs.

## Licensing and source boundary

AI Suite is MIT licensed. Concat is AGPL-3.0-or-later. Keep AI Suite's integration independently implemented against Concat's documented API; do not copy or link its internal editor/engine source into this repository. Concat's [plugin exception](https://github.com/jub0t/concat/blob/main/LICENSE-EXCEPTIONS.md) describes this API boundary. If Concat itself is modified or distributed, retain its AGPL obligations and source notices. Review the exact packaging before release.

## Transfer notes for implementation on the actual machine

- This checkout already has substantial unrelated local changes, including `launcher.py` and `launcher/frontend/index.html`. Inspect `git status` and the relevant diffs before editing; preserve that work.
- Confirm the real machine's filesystem paths, service manager, Studio URL, authentication proxy, and whether its checkout matches this one.
- Recheck Concat's current release and API docs against the installed build. The plan uses the repository and docs available on 2026-10-15 and assumes no Concat binary is installed here.
- Start with Phase 0's disposable probe and report its results before expanding the UI.

## Phase 0 results (2026-10-16)

Machine: `pop-os`, Pop!_OS 24.04, kernel 7.0.11, 32 cores, 124 GB RAM, AMD Strix Halo iGPU (ROCm). Studio runs as `.venv/bin/python launcher.py --host 0.0.0.0 --port 39000`. No system FFmpeg.

### What is installed, and where

Everything lives outside the AI Suite tree under `~/.local/opt/concat/`:

| Path | What |
|---|---|
| `0.2.7/root/opt/concat/` | Release v0.2.7 `.deb`, SHA256 verified, extracted (GUI only; not installed system-wide) |
| `src-0.2.7/` | Source at tag `v0.2.7`, commit `14b5998d793d90858ac982926374044bba4bf39f` |
| `ffmpeg-8.1/` | BtbN `ffmpeg-n8.1-latest-linux64-gpl-shared` (libavcodec 62.28.103, the same as the release bundles) |
| `target/`, `bin/concat-cli` | `cargo build --locked --release -p concat-cli` with the pinned Rust 1.93.1 (rustup, `~/.cargo`, PATH not modified) |

**The release packages do not contain `concat-cli`.** They ship only the GUI, which serves the API only while its window is open (Settings › Remote). A headless service requires the source build above. Build prerequisites on this machine: `libasound2-dev` and `libssl-dev` (installed via apt), cmake/g++ (present), and these environment variables:

```sh
export PATH=$HOME/.cargo/bin:$PATH
export FFMPEG_DIR=$HOME/.local/opt/concat/ffmpeg-8.1
export PKG_CONFIG_PATH=$FFMPEG_DIR/lib/pkgconfig
export CARGO_TARGET_DIR=$HOME/.local/opt/concat/target
export LIBCLANG_PATH=/opt/rocm/llvm/lib                       # no system libclang.so
export BINDGEN_EXTRA_CLANG_ARGS="-isystem /opt/rocm/llvm/lib/clang/22/include"   # else stddef.h not found
```

Run with `LD_LIBRARY_PATH=$FFMPEG_DIR/lib concat-cli serve --json 127.0.0.1:7420 --root <projects-root>` and `CONCAT_API_TOKEN` in the environment.

### Version

`{"apiVersion": "0.2", "concat": "0.2.7", "capabilities": ["events", "json-rpc"]}`. There is no `gpu` capability, so frames composite and encode on the CPU (libx264). Export does not contend with ComfyUI for the GPU.

### Probe (all against `--root ~/.local/opt/concat/probe-root`)

Media: a 180 s 768×512 H.264/AAC Studio music video (`output/Studio/music-videos/…/ai-suite_00039.mp4`) and a 10 s FLAC (`output/audio/ai-suite_00014.flac`).

| Step | Result |
|---|---|
| `project.create` → `{location}/{name}/concat.json` | OK, 102 ms. View keys: `activeTimelineId, fonts, media, timelines`; starter tracks `T1..T4` |
| `media.import` video, audio | OK, 30–40 ms each; ids `m1`, `m2`; kind and duration reported |
| `addClip` video → T1, audio → T2 | OK; new ids in `createdId` |
| `trimClip` end (video 180 → 10 s; audio 10 → 5 s) | OK |
| `splitClips` at 2 s | OK; tail minted as a new clip |
| `edit.undo` / `edit.redo` | OK; `canUndo`/`canRedo` correct |
| `preview.frame` 640×360 inline (base64 PNG) | 197 ms first call, 21 ms after; correct letterboxed composite |
| `preview.frame` 1080p to file | 12 ms |
| second `export.run` while one is running | refused, `busy` (-32004) |
| `export.cancel` | `export.failed` event with `cancelled`; **no partial file left** |
| `export.run` 10 s @ 1280×720, preset veryfast | done in 1.5 s; valid H.264+AAC MP4, 10.0 s |
| `export.run` 180 s @ 1920×1080, defaults | done in 57.6 s (about 3× real time); about 1.4 GB RSS; several cores busy |
| `project.close save:true`, then `project.open` | OK; 3 clips, 2 media restored |
| server killed and restarted, then `project.open` | OK; same clips and positions; history not persisted (`canUndo` false) |
| `project.create` at `/etc` | refused: "outside where this API writes" |
| wrong token on `auth` | `unauthorized` (-32006), connection closed |

### Findings that change the implementation

- **A no-op edit is not an error.** `moveClips` into an overlap on the same track returns success with the clip unmoved, and unknown ids are ignored the same way. The UI must compare the returned `EditorView` with what it asked for and tell the user when nothing changed.
- **The server prints its token to stdout.** Studio's service manager must not write that stream to a world-readable log; pass the token through `CONCAT_API_TOKEN` and keep the log file mode 0600, or discard the token line.
- **`--root` limits writes only, not reads.** `media.import` reads any file the process can read, and media paths are stored as absolute paths in `concat.json`. That confirms the plan: Flask must resolve Library ids to paths itself and never pass a client path through.
- **Projects store absolute media paths.** Moving `repos/ComfyUI/output` breaks existing projects until media is relinked (`updateMediaPath` exists in the command set).
- **Undo history is per session.** Reopening a project starts with empty history, so the UI should not offer undo past a reopen.
- Preview stills are fast enough (about 20 ms warm at 640×360) to update on scrub-release and pause, but still not at playback rate.

The probe server was stopped after the run, and its log (which contained the token) was deleted. `probe-root/` keeps the small `Probe` project and its 10 s export for inspection.

## Implementation and acceptance results (2026-10-16)

### What was built

| File | Role |
|---|---|
| `concat_client.py` | JSON-RPC client: one connection, a reader thread matching responses by `id`, events relayed to a callback, per-call timeouts, reconnect on the next call after a drop |
| `workspace.py` | Flask blueprint `/api/workspace/*`: identity and path checks, Library/upload import, sanitised views, edit allowlist, cached exact-frame preview, export jobs and Library handoff |
| `ai_manager.py` | `concat` / `concat-stop` service, token minting, log redaction, `CONCAT_CLI`, `CONCAT_LIB_DIR`, `WORKSPACE_DATA_DIR` defaults; included in `status` and `stop` |
| `launcher.py` | Registers the blueprint; adds `concat` / `concat-stop` to `SERVICE_COMMANDS` |
| `launcher/frontend/workspace.js`, `workspace.css` | The Workspace tab UI |
| `launcher/frontend/index.html` | Workspace tab button, panel, includes, and activation hook only |
| `tests/test_concat_client.py`, `tests/test_workspace.py` | 29 tests: fake JSON-RPC server (event/response interleaving, out-of-order ids, error codes, bad token, drop and reconnect, timeout); blueprint against a fake engine (identity isolation on every route, traversal, symlinks including a symlinked `output/`, path scrubbing, edit and patch allowlists, upload naming, private jobs) |

Decisions made during implementation:

- **Unix socket, not TCP.** It sits inside the 0700 data directory, so other local users cannot reach it at all; the token is still required.
- **Projects are named by a Studio-minted id** (`p-<12 hex>`), and the display name is stored in Concat's settings via `project.save {name}` (which does not move the folder). Listing is read from disk, not from Concat's machine-wide recents.
- **Edit allowlist:** `addClip`, `addClipAtFirstFree`, `moveClips`, `trimClip`, `splitClips`, `removeClips`, `updateClip` (patch limited to name, volume, opacity, fades, mute), `addTrack`, `removeTrack`, `setTrackFlag`, `removeMedia`. No command that carries a file path is accepted from the browser.
- **No-op detection:** every edit compares the project before and after and returns `changed`; the UI explains no-ops ("Clips on one track can't overlap").
- **Dirty state** is computed by comparing `project.document` with `concat.json` on disk, so it is right even after a Studio restart.
- **Exports** render to `<project>/.exports/` and are moved into `output/studio/<identity>/workspace/` only on success; failed, cancelled, and interrupted jobs delete their partial files and Concat's intermediates.
- ComfyUI's `output/` on this machine is a symlink to `/media/hilbert/Elements/ai-suite-outputs`; Library roots are resolved before comparison.

### Acceptance gate

All exercised on 2026-10-16 against the real engine (`./ai-switch concat`), through a second Studio instance on 127.0.0.1:39100, with headless Chromium (Playwright) driving the UI.

| Gate item | Result |
|---|---|
| Make a project, import a Library video and audio file | Pass. Via the Library picker; source shown as its Library path |
| Arrange clips on two tracks, trim, split, undo, redo | Pass. Drag from bin to T1 and T2, drag the end handle (180 s to 12.8 s), S to split, Ctrl+Z / Ctrl+Shift+Z |
| Save, refresh, reopen the same edit | Pass. Clip positions identical after reload; also after a Studio client reset and after an engine restart (saved state) |
| Paused preview reflects the composition; exact vs approximate is distinguished | Pass. Badge "Exact frame" when paused (about 20–70 ms per frame, cached by revision); "Approximate preview: source playback, no layering or effects" while playing |
| Export an MP4, progress, useful failure, cancel, open from Library | Pass. Progress bar, Cancel (job shows "Export cancelled", no file left), finished dialog opens Library > Video showing the file; missing-source export fails with "open failed for …/media/big.mp4: No such file or directory" |
| No token or raw paths in browser responses | Pass. Every response checked for the suite root, `/media/`, and `/tmp/`; engine messages scrubbed |
| Second identity cannot access the first's projects or exports | Pass. 404 on list, get, import, edit, frame, media, export, delete, job get, job list, and cancel |
| Studio usable with Concat stopped | Pass. Studio's routes return 200; Workspace health reports offline with a Start button; project list still works from disk |

### Hardening

| Case | Result |
|---|---|
| 1.1 GB, 4 min 1080p upload | Upload and import 1.2 s; frame at 120 s in 69 ms; ranged reads deep in the file served |
| Engine stopped mid-export | Job becomes "The Workspace engine stopped during the export"; no partial or intermediate files left; other Studio routes unaffected |
| Engine restart | Saved project reopens intact; unsaved edits and undo history are lost (engine memory) |
| Missing source media | Bin marks it missing; preview badge says so; streaming returns 404; export fails with a clear message |
| Path traversal, absolute paths, symlink out of Library, another user's output, unsafe identity | Rejected (unit tests) |
| GPU contention | Not applicable in this build: Concat composites and encodes on the CPU (no `gpu` capability). A 180 s 1080p export took 58 s on several cores of 32 |

### Known limits

- Moving preview plays only the topmost visual clip and one audio clip, from source; layering, opacity, and fades appear only in the paused exact frame and the export.
- Unsaved edits do not survive an engine restart; there is no autosave.
- The layout collapses to one column below 1100 px but is not tuned for phones.
- Speed ramps, cutouts (background removal) and text-to-speech are not exposed.
- One export at a time across all users (a Concat limit); a second request gets "Another export is running".

## Milestone 2: titles, transitions, effects, position (2026-10-16)

| Feature | Concat API used | Studio-side checks |
|---|---|---|
| Titles | `addTextClip {start, above, duration, style}`; `updateClip {text}` | Style keys limited to TextStyle's plain fields; strings ≤ 80 chars (content ≤ 2000). Fonts are referenced by family name only |
| Position | `setClipTransform {scale, offsetX, offsetY, rotation}` | Concat clamps the values |
| Transitions | `updateClip {transitionIn: {id, duration} \| null}` | `id` must be in `catalogue.list {kind: transition}`; duration 0.05–10 s |
| Picture effects and looks | `updateClip {videoEffects: [...]}` (looks, kind `filter`, go on the same chain) | Every id in the `effect` or `filter` catalogue; params limited to that package's keys, numbers only; no keyframes; ≤ 16 entries |
| Audio effects | `updateClip {filters: [...]}` | Ids from the `audio` catalogue, same rules |
| Catalogue | `GET /api/workspace/catalogue` → `catalogue.list` per kind, cached per engine connection | — |

Findings:

- **Track order.** Concat stores lanes bottom first: the last track draws on top (`AddTrack` pushes "on top of the stack"). The timeline now draws lanes top-down (T4 above T1 by default), and the approximate playback picks the topmost lane's clip. The first release had this inverted.
- **Transitions play before the cut.** A 1 s transition on a clip starting at 4.0 s renders over 3.0–4.0 s, revealing the incoming clip, which is pre-rolled from source frames before its in-point. The timeline shows that span as a striped band.
- **Captions are not reachable.** Transcription and text-to-speech live in `concat-speech`, which only the desktop window links; the API has no method for them. Manual captions can be made with titles.
- **UI fixes found in browser testing.** Studio's toasts sat over the timeline's bottom-right and swallowed drags, so they are click-through while Workspace is active. The inspector now scrolls inside the row the monitor sets, so selecting a clip no longer shifts the timeline under the pointer.

Tests: 47 unit tests (adds catalogue validation: unknown ids, wrong chain, non-numeric or unknown params, keyframes, unknown transitions, out-of-range durations, unknown style keys; plus the accepted forms of each command). Browser run (Playwright): add a title, edit its text, colour, background, and vertical position; add Mono and Vignette and change Vignette's strength; scale 0.7; add Echo; add an Iris transition; undo/redo; save; export. Frames were checked across the cut. The first-release acceptance run was repeated after the track-order change and passed.

## Milestone 3: keyframes, crop, blend, duplicate (2026-10-16)

| Feature | Concat API used | Studio-side checks |
|---|---|---|
| Clip keyframes | `setClipKey {clipId, property, at, value, ease}`, `clearClipKey`, `clearClipKeys` | `property` in scale, offsetX, offsetY, rotation, opacity, volume; `at` in 0–1; numeric value; ease a preset name or four numbers |
| Crop | `updateClip {crop: {left, top, right, bottom} \| null}` | All four edges, each 0 ≤ v < 1 |
| Blend, flip | `updateClip {blend, flipH, flipV}` | Blend one of Concat's six modes; flips boolean |
| Duplicate | Studio copies the folder (without `.exports/`), then `updateMediaPath` for media uploaded into the source, `project.save {name}`, and close/reopen | Same-owner only; the relink is server-side (`updateMediaPath` stays off the browser allowlist) and is not left in the copy's undo history |

The UI computes a keyed property's value at the playhead the way Concat does: each key's ease is a cubic-bezier for the approach from the key before. A browser test checked this against expected values (scale keyed 0.5 → 1.0 over 0–9 s reads 0.75 at 4.5 s linear and 0.55 at 2 s with ease-in-out), and the engine's frames were measured at 0, 5 and 9.9 s (picture width 108, 162, 214 px at 320 px wide).

**Concat templates were left out on purpose.** `template.save` copies the project's non-placeholder media into Concat's machine-wide config folder, and `template.list` is machine-wide, so a template saved by one identity would expose that identity's footage to every other. Duplicate covers the "start from an earlier edit" case within each identity's own folder. A per-identity template feature would need Studio to own the bundle location; Concat's API does not take one.

**Effect-parameter keyframes** (`setEffectKey`) are supported by the engine but not yet exposed. They would reuse the same diamond controls on each effect's sliders.

Tests: 64 unit tests (adds keyframe, crop, blend and flip validation, rejection of unexposed key commands, and duplicate's media repointing, isolation, and survival of the original's deletion). Browser run: key scale at two points, check the interpolated value, change the ease, navigate keys, crop, blend, flip, then save-and-duplicate; the copy opened with its keyframes and no undo history.

## Milestone 4: templates, effect keyframes, automatic captions (2026-10-16)

### Templates (Concat's own, per identity)

Milestone 3 left Concat templates out because `template.save` writes into Concat's machine-wide config folder and `template.list` is machine-wide. They are now in, isolated:

- **Save:** for chosen slots, a single `batch` of `setMediaPlaceholder` is applied. Then `template.save` writes into Concat's config folder under a unique name, the bundle is moved at once to `WORKSPACE_DATA_DIR/templates/<identity>/t-<12 hex>/`, and the placeholder batch is undone. The source project's document is unchanged; Redo can re-apply the marking, which only changes the media's slot flag. Studio adds `studio-template.json` (display name, slots, frame size) and renders `poster.png` with `preview.frame`, since Concat's poster comes from a file only its window writes.
- **Use:** `template.instantiate {template: <bundle>, location: <identity's folder>, name: p-…, fills}`. Every fill goes through the same Library resolution as import (own or shared output, no traversal or symlinks out). Every slot must be filled, and only slots. Concat copies the bundle's assets into the new project, so it stands alone.
- Studio never calls `template.list`, and Concat ships no built-in templates (0.2.7 lists none).
- Size note: media not marked as slots is copied into the template.

### Effect keyframes

`setEffectKey {clipId, entry, key, at, value, ease}`, `clearEffectKey`, and `clearEffectKeys` are allowed. Before applying, Studio checks against the clip's current chain: the link must exist and `key` must be one of that package's parameters. Chain entries resent by the UI may now carry `keys` (validated: known params, `at` 0–1, numeric values, preset or bezier ease). Before this, editing any effect setting would have dropped the chain's keys.

### Automatic captions

Concat's transcription is in `concat-speech`, which only the window links, so Studio runs whisper.cpp v1.9.5 (MIT, built under `~/.local/opt/whisper.cpp/`) with Concat's pinned `ggml-base` and `ggml-small` models (SHA-256 checked against Concat's table). For a chosen clip:

1. FFmpeg extracts the clip's source window (`sourceStart`, `duration × speed`) as 16 kHz mono WAV in the project's `.captions/`.
2. whisper-cli runs with per-word timestamps (`-ml 1 -sow -oj`), reporting progress.
3. Words are grouped into lines like Concat's captions (42 characters; a sentence end, a pause over 0.7 s, a comma once the line is long, or a capital starting a new unpunctuated line all break). Lines are held across short gaps so they do not flicker.
4. Lines are mapped through the clip's start and speed, clamped to the clip, and added as `addTextClip {above: true, offsetY, style}` in Concat's caption look (Hanken Grotesk 600; placement 0.35 / 0 / −0.35; size 0.04 / 0.05 / 0.065; optional `#000000aa` box) in **one `batch`**, so one Undo removes them all.

Jobs share the export job store (`kind: captions`), survive a page refresh, can be cancelled (the subprocess is terminated), and run one at a time.

### Tests

106 unit tests overall (Workspace: templates per identity and staging emptied, slot and fill rules, Library checks on fills, effect keys checked against the clip's chain, chains keeping their keys, caption grouping, caption request validation). On the real engine: a template saved with the video as a slot copied only the audio into the bundle, left the staging folder empty and the source project unchanged, and instantiated with another Library video; a 40 s sung clip gave 17 captions in 2.7 s (small model, English detected), all removed by one Undo. Browser run: Vignette strength keyed 20 → 90 reads 55 midway; Captions… on a 3-minute music video added 49 captions; Save as template → From template… with a different video kept the captions, keyed effect, and timing; no errors.
