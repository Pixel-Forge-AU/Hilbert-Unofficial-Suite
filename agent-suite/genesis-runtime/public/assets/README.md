Avatar/room assets for the voice-avatar plugin's Avatar tab live here (configurable via
`assetsDir` in `/api/avatar/scene-config`; this is just the default).

The plugin's asset browser (`GET /api/avatar/assets`) looks for:

- `characters/*.glb` — the 3D character model, set as `characterModelPath`
- `props/*.glb` — decorative models placed into the room's 8 named prop slots
- `textures/*.png` / `*.jpg` — wall/floor/ceiling/window-frame room textures
- `skies/*.png` / `*.jpg` — the sky dome background, set as `backgroundImagePath`

`characters/Nova.glb` and the `skies/*.png` files are the real assets from the original
monolith, ported alongside the rest of the avatar system — not placeholders. Add your
own files under `props/` and `textures/` the same way to extend the room.
