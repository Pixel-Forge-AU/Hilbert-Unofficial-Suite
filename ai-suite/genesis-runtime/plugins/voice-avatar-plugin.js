// Ported from genesis-core's server/voice-domain.js and
// server/observer-avatar-scene-domain.js. These two Nova domains were small and closely
// related (both feed the "how does the assistant present itself" surface — spoken-word
// emotion tagging and the 3D avatar room/character it drives) so they are combined into a
// single plugin rather than split across two files.
//
// Simplifications vs. the Nova originals:
//   - voice-domain.js's store-loading included a one-time migration path that pulled voice
//     profiles out of a legacy top-level Nova config file (`observerConfig.app.trust.*`).
//     Genesis plugins own their data from a clean, plugin-scoped store from the start (via
//     api.data) — there is no legacy config location to migrate from, so that path is
//     dropped entirely.
//   - observer-avatar-scene-domain.js hardcoded a reaction-clip map keyed by a specific
//     bundled character asset path ("/assets/characters/Nova.glb"). Genesis has no bundled
//     character model, so the character model path is just a configurable string field
//     (empty by default) and the emotion->clip map is a flat, unkeyed table that applies to
//     whatever model the deployer configures. No "Nova.glb"/"Astra.glb" filenames appear
//     anywhere in this file.
//   - Nova's `[nova:emotion=...]` speech tags are renamed to the generic `[persona:emotion=...]`
//     to match the de-branding requested for this port.
//
// Hook vs. capability choice: emotion annotation is exposed as a direct capability
// ("voice:annotate-emotion") rather than requiring callers to go through a hook — any
// plugin that produces outgoing speech text can just call the capability inline, which is
// simpler than wiring a hook indirection for a single-consumer transform. We do still fire
// an observational hook ("voice:response-annotated") after each annotation so other plugins
// (e.g. logging/analytics) can passively observe without being on the critical path.

import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import * as trust from "../observer-compat/server/trust.js";

const DEFAULT_ASSETS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "public", "assets");

// Emotion vocabulary the annotator/animation map understands. Values are intentionally
// blank by default (see class comment above) — the deployer fills in clip names that match
// whatever character rig they configure.
const EMOTION_KEYS = [
  "idle", "calm", "agree", "angry", "love", "celebrate", "confused", "dance", "sass",
  "hurt", "reflect", "run", "scheme", "shrug", "rant", "passionate", "explain", "walk",
  "wave", "slam"
];

const STYLIZATION_FILTER_PRESETS = [
  "none", "soft", "cinematic", "noir", "vivid", "dream", "retro_vhs", "haunted",
  "surveillance", "crystal", "whimsical", "toon", "anime"
];

const STYLIZATION_EFFECT_PRESETS = [
  "none", "toon", "dream", "retro_vhs", "whimsical", "glow", "grain", "comic"
];

function stripEmotionTags(text = "") {
  return String(text || "")
    .replace(/\[persona:(emotion|animation)=[^\]]+\]/gi, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function inferEmotionForText(text = "", context = "reply") {
  const clean = stripEmotionTags(text).toLowerCase();
  const normalizedContext = String(context || "reply").trim().toLowerCase();
  if (!clean) return normalizedContext === "question" ? "shrug" : "calm";
  if (normalizedContext === "question") return "shrug";
  if (normalizedContext === "failure") return /\b(sorry|apolog|regret)\b/.test(clean) ? "hurt" : "angry";
  if (normalizedContext === "success" || normalizedContext === "output") return "celebrate";
  if (/\b(what did you mean|can you clarify|which one|what should i|how should i|could you confirm|do you want)\b/.test(clean)) return "shrug";
  if (/\b(done|finished|complete|completed|wrapped up|ready|created|generated|saved|sent to output|exported|packaged)\b/.test(clean)) return "celebrate";
  if (/\b(failed|error|problem|issue|couldn'?t|cannot|can'?t|blocked|timeout|timed out)\b/.test(clean)) return "angry";
  if (/\b(think|consider|reviewed|checked|looked|found|explained|because)\b/.test(clean)) return "reflect";
  if (/\b(yes|exactly|agreed|correct|right)\b/.test(clean)) return "agree";
  return "explain";
}

function sanitizeToken(value = "") {
  return String(value || "").trim().toLowerCase();
}

function compactText(value = "", max = 220) {
  const raw = String(value || "");
  return raw.length > max ? `${raw.slice(0, max)}…` : raw;
}

function normalizePropScale(value, fallback = 1) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : fallback;
}

function normalizePreset(value, allowed, fallback = "none") {
  const normalized = String(value || "").trim().toLowerCase();
  return allowed.includes(normalized) ? normalized : fallback;
}

function defaultRoomTextures() {
  return { walls: "", floor: "", ceiling: "", windowFrame: "" };
}

function defaultPropSlots() {
  return {
    backWallLeft: { model: "", scale: 1 },
    backWallRight: { model: "", scale: 1 },
    wallLeft: { model: "", scale: 1 },
    wallRight: { model: "", scale: 1 },
    besideLeft: { model: "", scale: 1 },
    besideRight: { model: "", scale: 1 },
    outsideLeft: { model: "", scale: 1 },
    outsideRight: { model: "", scale: 1 }
  };
}

function defaultReactionClips() {
  return {
    idleClip: "",
    talkingClips: [],
    paths: Object.fromEntries(EMOTION_KEYS.map((key) => [key, ""]))
  };
}

function defaultSceneConfig() {
  return {
    // No bundled/default character asset ships with Genesis — the deployer supplies their
    // own model and points this at it (e.g. "/assets/characters/my-avatar.glb").
    characterModelPath: "",
    roomTextures: defaultRoomTextures(),
    propSlots: defaultPropSlots(),
    reactionClips: defaultReactionClips(),
    stylization: { filterPreset: "none", effectPreset: "none" },
    assetsDir: DEFAULT_ASSETS_DIR
  };
}

function normalizeRoomTextures(value = {}) {
  const source = value && typeof value === "object" ? value : {};
  const defaults = defaultRoomTextures();
  return Object.fromEntries(
    Object.keys(defaults).map((key) => [key, String(source[key] || defaults[key] || "").trim()])
  );
}

function normalizePropSlots(value = {}) {
  const source = value && typeof value === "object" ? value : {};
  const defaults = defaultPropSlots();
  return Object.fromEntries(
    Object.keys(defaults).map((key) => {
      const slot = source[key] && typeof source[key] === "object" ? source[key] : {};
      return [key, {
        model: String(slot.model || "").trim(),
        scale: normalizePropScale(slot.scale, 1)
      }];
    })
  );
}

function normalizeReactionClips(value = {}) {
  const source = value && typeof value === "object" ? value : {};
  const rawPaths = source.paths && typeof source.paths === "object" ? source.paths : {};
  const paths = Object.fromEntries(
    EMOTION_KEYS.map((key) => [key, String(rawPaths[key] || "").trim()])
  );
  const idleClip = String(source.idleClip || paths.idle || "").trim();
  if (idleClip) paths.idle = idleClip;
  return {
    idleClip,
    talkingClips: Array.isArray(source.talkingClips)
      ? source.talkingClips.map((clip) => String(clip || "").trim()).filter(Boolean)
      : [],
    paths
  };
}

function normalizeSceneConfig(value = {}, current = defaultSceneConfig()) {
  const source = value && typeof value === "object" ? value : {};
  return {
    characterModelPath: String(
      source.characterModelPath !== undefined ? source.characterModelPath : current.characterModelPath || ""
    ).trim(),
    roomTextures: normalizeRoomTextures(source.roomTextures !== undefined ? source.roomTextures : current.roomTextures),
    propSlots: normalizePropSlots(source.propSlots !== undefined ? source.propSlots : current.propSlots),
    reactionClips: normalizeReactionClips(source.reactionClips !== undefined ? source.reactionClips : current.reactionClips),
    stylization: {
      filterPreset: normalizePreset(
        source.stylization?.filterPreset !== undefined ? source.stylization.filterPreset : current.stylization?.filterPreset,
        STYLIZATION_FILTER_PRESETS,
        "none"
      ),
      effectPreset: normalizePreset(
        source.stylization?.effectPreset !== undefined ? source.stylization.effectPreset : current.stylization?.effectPreset,
        STYLIZATION_EFFECT_PRESETS,
        "none"
      )
    },
    assetsDir: resolveConfinedAssetsDir(
      String(source.assetsDir !== undefined ? source.assetsDir : (current.assetsDir || DEFAULT_ASSETS_DIR)).trim()
    )
  };
}

async function walkAssetDirectory(dirPath, relativePrefix = "") {
  let entries = [];
  try {
    entries = await fs.readdir(dirPath, { withFileTypes: true });
  } catch {
    return [];
  }
  const files = [];
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const entryPath = path.join(dirPath, entry.name);
    const relativePath = relativePrefix ? `${relativePrefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      files.push(...await walkAssetDirectory(entryPath, relativePath));
      continue;
    }
    if (entry.isFile()) {
      files.push(relativePath.replaceAll("\\", "/"));
    }
  }
  return files;
}

// listAssetChoices operates on the real host filesystem (unlike sandbox-plugin.js's
// container-scoped file ops), and its callers accept a caller-suppliable directory (the
// ?dir= query param, and scene-config.assetsDir, which an admin can set via
// POST /api/avatar/scene-config with no prior validation). Confine every request to
// DEFAULT_ASSETS_DIR's own tree so this can't be pointed at an arbitrary host path.
function resolveConfinedAssetsDir(candidate = "") {
  const requested = String(candidate || "").trim();
  if (!requested) return DEFAULT_ASSETS_DIR;
  const root = path.resolve(DEFAULT_ASSETS_DIR);
  const resolved = path.resolve(DEFAULT_ASSETS_DIR, requested);
  if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) {
    throw new Error(`assets directory "${requested}" is outside the allowed assets root (${root})`);
  }
  return resolved;
}

async function listAssetChoices(assetsDir = DEFAULT_ASSETS_DIR) {
  const files = await walkAssetDirectory(resolveConfinedAssetsDir(assetsDir));
  const filterByPath = (pattern) => files.filter((name) => pattern.test(name)).sort((left, right) => left.localeCompare(right));
  return {
    characters: filterByPath(/^characters\/.+\.glb$/i),
    props: filterByPath(/^props\/.+\.glb$/i),
    skies: filterByPath(/^skies\/.+\.(png|jpe?g)$/i),
    textures: filterByPath(/^textures\/.+\.(png|jpe?g)$/i),
    all: files
  };
}

const MANIFEST = {
  schemaVersion: 1,
  startupPriority: 100,
  permissions: {
    routes: true,
    uiPanels: false,
    data: true,
    capabilities: [
      "voice:annotate-emotion",
      "voice:get-trust-profiles",
      "voice:save-trust-profile",
      "voice:remove-trust-profile",
      "avatar:get-scene-config",
      "avatar:update-scene-config",
      "avatar:list-assets"
    ],
    hooks: [],
    runtimeContext: [],
    tools: []
  },
  compatibility: { coreApiMin: "1.0.0", coreApiMax: "" },
  dependencies: { requiredCapabilities: [], optionalCapabilities: [] },
  security: { isolation: "inprocess" }
};

export default function createVoiceAvatarPlugin() {
  let api = null;

  async function hook(name, payload) {
    if (!api || typeof api.runHook !== "function") return payload;
    try {
      const result = await api.runHook(name, payload);
      return result !== undefined ? result : payload;
    } catch {
      return payload;
    }
  }

  // --- voice trust profiles -------------------------------------------------

  async function loadTrustStore() {
    const raw = await api.data.readJson("trust-profiles", { profiles: [] });
    const profiles = Array.isArray(raw?.profiles) ? raw.profiles : [];
    return {
      profiles: profiles
        .map((entry, index) => trust.normalizeVoiceTrustProfile(entry, index))
        .filter((entry) => entry.label || entry.signature.length)
    };
  }

  async function saveTrustStore(store) {
    const normalized = {
      profiles: (Array.isArray(store?.profiles) ? store.profiles : [])
        .map((entry, index) => trust.normalizeVoiceTrustProfile(entry, index))
        .filter((entry) => entry.label || entry.signature.length)
    };
    await api.data.writeJson("trust-profiles", normalized);
    return normalized;
  }

  async function getTrustProfiles() {
    const store = await loadTrustStore();
    return store.profiles;
  }

  async function saveTrustProfile(entry = {}) {
    const store = await loadTrustStore();
    const providedId = String(entry?.id || "").trim();
    const existingIndex = providedId ? store.profiles.findIndex((p) => p.id === providedId) : -1;
    const normalized = trust.normalizeVoiceTrustProfile(entry, existingIndex >= 0 ? existingIndex : store.profiles.length);
    if (existingIndex >= 0) {
      store.profiles[existingIndex] = normalized;
    } else {
      const matchById = store.profiles.findIndex((p) => p.id === normalized.id);
      if (matchById >= 0) store.profiles[matchById] = normalized;
      else store.profiles.push(normalized);
    }
    const saved = await saveTrustStore(store);
    await hook("voice:trust-profile-saved", { profile: normalized });
    return saved.profiles.find((p) => p.id === normalized.id) || normalized;
  }

  async function removeTrustProfile(id = "") {
    const normalizedId = String(id || "").trim();
    if (!normalizedId) throw new Error("id is required");
    const store = await loadTrustStore();
    const nextProfiles = store.profiles.filter((p) => p.id !== normalizedId);
    const removed = nextProfiles.length !== store.profiles.length;
    if (removed) {
      await saveTrustStore({ profiles: nextProfiles });
      await hook("voice:trust-profile-removed", { id: normalizedId });
    }
    return removed;
  }

  // --- emotion annotation ----------------------------------------------------

  async function annotateEmotion(text = "", context = "reply") {
    const raw = String(text || "").trim();
    const normalizedContext = sanitizeToken(context) || "reply";
    if (!raw || /\[persona:(emotion|animation)=/i.test(raw)) {
      if (raw) {
        await hook("voice:response-annotated", {
          at: Date.now(),
          context: normalizedContext,
          reusedExistingTag: true,
          emotion: "",
          rawPreview: compactText(raw),
          annotatedPreview: compactText(raw)
        });
      }
      return { text: raw, emotion: "", context: normalizedContext, reusedExistingTag: true };
    }
    const emotion = inferEmotionForText(raw, normalizedContext);
    const annotated = emotion ? `[persona:emotion=${emotion}] ${raw}` : raw;
    await hook("voice:response-annotated", {
      at: Date.now(),
      context: normalizedContext,
      reusedExistingTag: false,
      emotion: sanitizeToken(emotion),
      rawPreview: compactText(raw),
      annotatedPreview: compactText(annotated)
    });
    return { text: annotated, emotion, context: normalizedContext, reusedExistingTag: false };
  }

  // --- avatar scene config ----------------------------------------------------

  async function getSceneConfig() {
    const stored = await api.data.readJson("scene-config", null);
    return normalizeSceneConfig(stored || {}, defaultSceneConfig());
  }

  async function updateSceneConfig(patch = {}) {
    const current = await getSceneConfig();
    const next = normalizeSceneConfig(patch, current);
    await api.data.writeJson("scene-config", next);
    await hook("avatar:scene-config-updated", { config: next });
    return next;
  }

  return {
    id: "voice-avatar",
    name: "Voice & Avatar",
    version: "0.1.0",
    description: "Voice trust profiles and emotion-tag annotation for outgoing speech, plus 3D avatar scene/room configuration.",
    manifest: MANIFEST,

    async init(pluginApi) {
      api = pluginApi;

      api.provideCapability("voice:annotate-emotion", async ({ text, context } = {}) => annotateEmotion(text, context));
      api.provideCapability("voice:get-trust-profiles", async () => getTrustProfiles());
      api.provideCapability("voice:save-trust-profile", async (entry = {}) => saveTrustProfile(entry));
      api.provideCapability("voice:remove-trust-profile", async ({ id } = {}) => removeTrustProfile(id));

      api.provideCapability("avatar:get-scene-config", async () => getSceneConfig());
      api.provideCapability("avatar:update-scene-config", async (patch = {}) => updateSceneConfig(patch));
      api.provideCapability("avatar:list-assets", async () => {
        const config = await getSceneConfig();
        return listAssetChoices(config.assetsDir || DEFAULT_ASSETS_DIR);
      });
    },

    async registerRoutes({ app }) {
      app.get("/api/voice/trust-profiles", async (_req, res) => {
        try {
          res.json({ ok: true, profiles: await getTrustProfiles() });
        } catch (err) {
          res.status(500).json({ ok: false, error: String(err?.message || err || "failed to list trust profiles") });
        }
      });

      app.post("/api/voice/trust-profiles", async (req, res) => {
        try {
          res.json({ ok: true, profile: await saveTrustProfile(req.body || {}) });
        } catch (err) {
          res.status(400).json({ ok: false, error: String(err?.message || err || "failed to save trust profile") });
        }
      });

      app.delete("/api/voice/trust-profiles/:id", async (req, res) => {
        try {
          const removed = await removeTrustProfile(req.params?.id);
          if (!removed) {
            return res.status(404).json({ ok: false, error: "trust profile not found" });
          }
          res.json({ ok: true, removed: true });
        } catch (err) {
          res.status(400).json({ ok: false, error: String(err?.message || err || "failed to remove trust profile") });
        }
      });

      app.post("/api/voice/annotate", async (req, res) => {
        try {
          const { text, context } = req.body || {};
          res.json({ ok: true, ...(await annotateEmotion(text, context)) });
        } catch (err) {
          res.status(400).json({ ok: false, error: String(err?.message || err || "failed to annotate text") });
        }
      });

      app.get("/api/avatar/scene-config", async (_req, res) => {
        try {
          res.json({ ok: true, config: await getSceneConfig() });
        } catch (err) {
          res.status(500).json({ ok: false, error: String(err?.message || err || "failed to load scene config") });
        }
      });

      app.post("/api/avatar/scene-config", async (req, res) => {
        try {
          res.json({ ok: true, config: await updateSceneConfig(req.body || {}) });
        } catch (err) {
          res.status(400).json({ ok: false, error: String(err?.message || err || "failed to update scene config") });
        }
      });

      app.get("/api/avatar/assets", async (req, res) => {
        try {
          const config = await getSceneConfig();
          const dirOverride = String(req.query?.dir || "").trim();
          res.json({ ok: true, assets: await listAssetChoices(dirOverride || config.assetsDir || DEFAULT_ASSETS_DIR) });
        } catch (err) {
          res.status(500).json({ ok: false, error: String(err?.message || err || "failed to list assets") });
        }
      });
    }
  };
}
