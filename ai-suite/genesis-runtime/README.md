# Genesis Runtime

A minimal runtime for hosting plugins, tools, and orchestration components. Genesis supplies
infrastructure only — behaviour comes from plugins. See the Genesis Core Extraction Directive
and `../genesis-core/docs/GENESIS-EXTRACTION-CLASSIFICATION.md` for the full extraction plan
this package implements.

## What's here

- `server.js` — entrypoint. Boots Express, the Observer Compat static mount, admin security,
  the plugin host, and a handful of runtime-status endpoints.
- `lib/` — the 9 KEEP_CORE modules from the classification pass: the plugin manager
  (`plugin-system.js`), plugin discovery/bootstrap (`plugin-loader.js`), admin auth
  (`admin-security.js`), HTTP request→hook dispatch (`http-hooks.js`), deployment profiles
  (`profile-manager.js`), and low-level plugin data/fs primitives.
- `observer-compat/` — the Observer Compat contract, copied verbatim (byte-identical) from
  `nova-observer/observer-compat`. Do not edit without updating all compatible orchestrators.
- `plugins/` — where `*-plugin.js` files are auto-discovered from. Ships **empty** by design
  (Architectural Rule: Genesis boots with zero optional plugins).
- `profiles/` — deployment profiles (see "Starter profiles" below).
- `public/` — a minimal status page (`/`) that lists runtime status and installed plugins.

## Running against an external plugin catalog

`plugins/` ships empty by design, but a real deployment points `GENESIS_PLUGIN_DIR` at wherever
its plugins actually live — e.g. `E:\AI\genesis-plugins`, a much larger catalog developed
separately from this repo. Two things to know before doing that:

1. **Import trust.** By default, plugins discovered outside this repo's own `plugins/`
   directory must be on a hash allowlist (`runtime-data/plugin-trust.json`) — a real security
   feature, not a bug, meant for genuinely third-party code. For your own trusted plugin
   directory, set `GENESIS_EXTERNAL_PLUGIN_IMPORT_MODE=permissive` to skip that check.
2. **Shared dependencies.** Node resolves bare imports (`imapflow`, `keytar`, ...) and relative
   imports by walking up from the importing file — it does *not* reach into this repo's
   `node_modules` or `observer-compat/` from a sibling directory. An external plugin catalog
   needs its own `package.json`/`node_modules`, and any shared Nova-era utility files its
   plugins import by relative path (e.g. `observer-general-utils.js`, `observer-core-state.js`,
   `observer-compat/`) need to actually exist at the path those plugins expect. For
   `E:\AI\genesis-plugins`, those turned out to all resolve to `E:\AI\` itself (one level above
   the catalog) — trimmed-down versions of those files (only the exports actually imported)
   now live there.

Example:
```
PORT=3300 GENESIS_PLUGIN_DIR="E:\AI\genesis-plugins" GENESIS_EXTERNAL_PLUGIN_IMPORT_MODE=permissive GENESIS_PROFILE=developer node server.js
```

**Known issue in that catalog:** both `E:\AI\genesis-plugins\mail-plugin.js` (this repo's
original mail plugin, copied out) and `E:\AI\genesis-plugins\mail\mail-plugin.js` (a fuller,
independently-developed version with its own `lib/`/`public/`) declare `id: "mail"`. Both load;
whichever registers second wins on conflicting routes. Recommend deleting the flat
`mail-plugin.js` copy at the catalog root now that the richer `mail/` version exists.

## Starter profiles

Five profiles in `profiles/`, all validated against the 46-plugin catalog at
`E:\AI\genesis-plugins` (boots clean, 0 load errors):

| Profile | `GENESIS_PROFILE=` | Enables |
|---|---|---|
| Minimal | `minimal` | `secrets`, `model-provider` only — verify the runtime boots before adding anything |
| Personal Assistant | `personal-assistant` | agent-runtime, memory, mail, calendar, voice/avatar, presence, home automation (Home Assistant/Matter/MQTT), skills, philosophy/personality — no dev or business tooling |
| Developer | `developer` | agent-runtime, sandbox, workspace, code-review, deploy, github, qa, security-audit, vscode bridge, sprint/design tooling |
| 3D Printing Ballarat | `3dpb-business` | agent-runtime, mail, calendar, the `3dpb-hub` business API bridge, finance, payments, wordpress, social-media-manager, projects — successor to `genesis-core`'s old `printshop.json` |
| Full Catalog | `full` | everything — for integration testing, not a real deployment (broad tool/capability surface) |

Each profile's `disabledPlugins` list is the full-catalog complement of its `enabledPlugins`
(profiles enable-by-default otherwise — an empty `enabledPlugins` list does *not* mean "nothing
on," see `lib/profile-manager.js`'s `resolveProfilePluginState`). Disabling a plugin via profile
stops its routes from mounting and hides it from the enabled-plugin list, but its `init()` still
runs and its capabilities stay registered (that's `plugin-system.js` behavior, not
profile-specific) — a fully inert "disabled" plugin isn't something the current plugin host
guarantees.

## Identity notes

This is a from-scratch entrypoint, not a copy of `genesis-core/server.js` — it only wires the
modules classified KEEP_CORE/KEEP_COMPAT. Along the way, two Nova-specific assumptions baked
into otherwise-generic core code were found and fixed here (not yet back-ported to
`genesis-core`):

- `plugin-system.js` restricted tool `scopes` to the literal values `"intake"`/`"worker"`
  (Nova's agent architecture). Genesis core has no such concept — scopes are now an opaque,
  plugin-defined label.
- The "Nova tab" UI descriptor category was renamed to "primary tab" throughout.
- `OBSERVER_*` env vars were renamed to `GENESIS_*`; `[observer]` log lines to `[genesis]`.
- Admin security defaults to protecting **all** unsafe-method `/api/*` requests (with a small
  public-path exemption list) rather than an opt-in per-path allowlist — see the comment in
  `lib/admin-security.js`. An opt-in list is the wrong default for a plugin host, since a
  plugin author adding a mutating route has no way to know they need to register it as
  "protected" too.

## Try it

```
npm install
npm start   # listens on PORT (default 3300)
```

With zero plugins, `GET /api/plugins/list` returns an empty plugin/capability/tool set and
`GET /api/runtime/status` reports zero plugin load errors — the zero-plugin boot success
criterion from the extraction directive.

## Plugins (all of them, as of this extraction)

Boots with 11 plugins, 0 load errors, 67 capabilities, 93 routes:

| Plugin | From (genesis-core) | Depends on |
|---|---|---|
| `secrets-plugin.js` | `observer-secrets-service.js` | — |
| `model-provider-plugin.js` | `observer-brain-config.js`, `ollama-runtime-service.js`, `lib/brain-*.js` | secrets (optional) |
| `homeassistant-plugin.js` | `observer-iot-domain.js`, `observer-iot-routes.js` | — |
| `memory-plugin.js` | `memory-trust-domain.js` (prompt-memory half; trust half already lives in `observer-compat/server/trust.js`) | — |
| `retrieval-plugin.js` | `retrieval-domain.js`, `observer-document-domain.js` | secrets, model-provider (optional) |
| `sandbox-plugin.js` (+`sandbox-output-compression.js` helper) | `observer-sandbox-service.js`, `sandbox-io-service.js`, `sandbox-state-store.js`, `output-semantic-compression.js`, `shell-hook-compression.js`, `observer-output-semantic-utils.js` | — |
| `skills-marketplace-plugin.js` | `skill-library.js`, `observer-agent-skills-service.js`, `observer-agent-skill-routes.js` | model-provider (optional) |
| `voice-avatar-plugin.js` | `voice-domain.js`, `observer-avatar-scene-domain.js` | — |
| `workspace-plugin.js` | `sandbox-workspace-service.js`, `observer-workspace-file-utils.js`, `observer-workspace-tracking.js`, `workspace-transaction-service.js` | sandbox (optional) |
| `mail-plugin.js` | `observer-periodic-jobs.js` (mail-watch portion) | secrets |
| `agent-runtime-plugin.js` | task queue / execution runner / intake / cron cluster (~44 files, ~19k lines — see below) | model-provider, sandbox, workspace, memory (all optional) |

All were built following the pattern proven by `homeassistant-plugin.js`: manifest-declared
permissions, `api.data` for persistence instead of a shared config file, `api.provideCapability`
for cross-plugin calls, hooks for extension points. Cross-plugin dependencies are called via
`api.getCapability(...)` at call time and fail with a clear error (not a crash) if the
providing plugin isn't installed.

**`agent-runtime-plugin.js` is a deliberate simplification, not a mechanical port.** Its source
cluster is Nova's largest and most product-specific: the tool-calling execution loop, task
queue/lifecycle/storage, intake/triage, and — explicitly **not ported**, left for a dedicated
follow-up — opportunity scanning, escalation-review retry heuristics, helper-scout/maintenance
jobs, the "recreation" reflective job, Nova's native chat-response builders (calendar/finance/
inbox summaries), and tool-loop-repair-helpers' sandbox-specific JSON-repair heuristics. What's
here is a genuinely working task queue + tool-calling loop + intake split + cron, at a fraction
of the original's size, capturing the *shape* of the mechanism rather than Nova's full feature
set. See the file's header comment for the full list.

**Also explicitly excluded from this extraction** (not mechanically portable — see
`genesis-core/docs/GENESIS-EXTRACTION-CLASSIFICATION.md`): the ~4,300-line regression test
suite (`regression-suites.js` + friends) is Nova's product test *content*, not infrastructure —
nothing to extract. The ~17k-line admin dashboard (`public/*.js`) is explicitly out of scope per
the mission ("minimal admin UI... written fresh", not carved from Nova's DOM-specific code);
`genesis-runtime/public/index.html` is that fresh (much smaller) start.

**A real cross-plugin bug found and fixed post-integration:** `model-provider-plugin.js`'s
`brain:generate`/`brain:generate-json` capabilities were built expecting `{prompt}`, but
`agent-runtime-plugin.js` and `skills-marketplace-plugin.js` (built independently, in parallel)
both called them with `{messages: [...]}`. Fixed by making the capability accept either shape
rather than picking a side — verified via a full task create→dispatch→execute round trip.
