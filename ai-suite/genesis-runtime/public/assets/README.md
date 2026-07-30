Optional avatar/room assets for the voice-avatar plugin's Avatar tab can live here
(configurable via `assetsDir` in `/api/avatar/scene-config`; this is just the default).

The plugin's asset browser (`GET /api/avatar/assets`) looks for:

- `characters/*.glb` — the 3D character model, set as `characterModelPath`
- `props/*.glb` — decorative models placed into the room's 8 named prop slots
- `textures/*.png` / `*.jpg` — wall/floor/ceiling/window-frame room textures
- `skies/*.png` / `*.jpg` — not currently used by the scene (Genesis's scene-config has
  no background/sky field; see avatar-tab.js's header comment)

Nothing is bundled here — this repo has no default character or room asset. Place your
own `.glb`/texture files under the matching subfolder above and point the scene config
at them (via the Avatar tab's "Scene config" subtab, or `POST /api/avatar/scene-config`
directly) to use them.
