import { escapeHtml as h } from "/plugin-tab-shared.js";

// The actual 3D scene is /plugins/voice-avatar/public/avatar-original.js — the original
// monolith's avatar.js, essentially unchanged (see that file's own header for the two
// required interop edits). This file is just the minimal plumbing needed to run a
// self-initializing, DOM-id-based, load-once script inside a remountable admin tab:
//   - build the exact element ids avatar.js looks up (avatarCanvas/avatarStatus/
//     avatarEmotion/avatarOptions) once, the first time this tab is opened
//   - dynamically import avatar-original.js exactly once (ES modules only ever run their
//     top-level code once per URL for the page's lifetime, so importing it again on a
//     later visit would be a no-op anyway)
//   - on every later visit, move the same live canvas/status/emotion/options elements
//     into the new root Genesis creates per mount, then ask the already-running script to
//     resize (via window.agentAvatar.resizeRenderer(), which avatar-original.js exposes)
// Everything else on this tab (scene-config editor, asset browser, trust profiles) is
// admin tooling around the scene, not part of avatar.js itself.

const PROP_SLOT_IDS = [
  "backWallLeft", "backWallRight", "wallLeft", "wallRight",
  "besideLeft", "besideRight", "outsideLeft", "outsideRight"
];

const EMOTION_KEYS = [
  "idle", "calm", "agree", "angry", "love", "celebrate", "confused", "dance", "sass",
  "hurt", "reflect", "run", "scheme", "shrug", "rant", "passionate", "explain", "walk",
  "wave", "slam"
];

async function callApi(fetchImpl, path = "", options = {}) {
  const r = await fetchImpl(path, options);
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.ok === false) throw new Error(j.error || `request failed (${r.status})`);
  return j;
}

function propSlotFields(propSlots = {}) {
  return PROP_SLOT_IDS.map((slotId) => `
    <div class="brains-form-row">
      <label>${h(slotId)} model<input data-prop-model="${h(slotId)}" placeholder="props/example.glb" value="${h(propSlots[slotId]?.model || "")}"></label>
      <label>Scale<input data-prop-scale="${h(slotId)}" type="number" step="0.1" min="0.2" max="3" value="${h(String(propSlots[slotId]?.scale ?? 1))}"></label>
    </div>
  `).join("");
}

function setSubtab(root, id) {
  root.dataset.avatarTab = id;
  root.querySelectorAll("[data-avatar-subtab-target]").forEach((b) => b.classList.toggle("active", b.dataset.avatarSubtabTarget === id));
  root.querySelectorAll("[data-avatar-subtab-panel]").forEach((p) => p.classList.toggle("active", p.dataset.avatarSubtabPanel === id));
}

// The live canvas/status/emotion/options elements and whether avatar-original.js has
// been imported yet both need to survive across remounts (a fresh root div is created
// every time this tab is reopened) — cached on window since the module itself is a
// page-lifetime singleton the same way. All four ids live inside one wrapper so they
// move together when a later mount re-parents this into a new root.
function getOrCreateSceneHost() {
  if (!window.__genesisAvatarSceneHost) {
    const wrap = document.createElement("div");
    wrap.innerHTML = `
      <div class="avatar-canvas-wrap">
        <canvas id="avatarCanvas"></canvas>
        <div id="avatarStatus" class="avatar-status"></div>
        <div id="avatarEmotion" class="avatar-emotion"></div>
      </div>
      <div id="avatarOptions" class="panel-subtle avatar-options"></div>
    `;
    window.__genesisAvatarSceneHost = wrap;
    window.__genesisAvatarImported = false;
  }
  return window.__genesisAvatarSceneHost;
}

export async function mountPluginTab(context = {}) {
  const root = context?.root;
  if (!(root instanceof HTMLElement)) return;

  const fetchImpl = context?.pluginAdminFetch || context?.observerApp?.pluginAdminFetch || fetch;
  const api = (path, options) => callApi(fetchImpl, path, options);

  if (!document.getElementById("avatarPluginStyles")) {
    const s = document.createElement("style");
    s.id = "avatarPluginStyles";
    s.textContent = `
      .avatar-subtabs{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:12px}
      .avatar-subtabs button{border:1px solid var(--border);background:var(--panel-strong);color:var(--ink);border-radius:999px;padding:7px 12px;font:inherit;font-weight:700;cursor:pointer}
      .avatar-subtabs button.active{background:var(--accent);color:#1a0f00;border-color:transparent}
      [data-avatar-subtab-panel]{display:none}[data-avatar-subtab-panel].active{display:block}
      .avatar-canvas-wrap{position:relative;width:100%;aspect-ratio:16/10;background:#000;border-radius:10px;overflow:hidden;margin-bottom:10px}
      .avatar-canvas-wrap canvas{width:100%;height:100%;display:block}
      .avatar-status,.avatar-emotion{position:absolute;left:10px;color:#fff;font-size:0.8em;text-shadow:0 1px 3px rgba(0,0,0,0.8);pointer-events:none}
      .avatar-status{top:10px}
      .avatar-emotion{top:30px}
      .avatar-options{display:flex;flex-wrap:wrap;gap:6px;font-size:0.78em;margin-bottom:10px}
      .avatar-pill{border:1px solid var(--border);border-radius:6px;padding:2px 6px;display:inline-flex;gap:4px}
      .avatar-emotion-row{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:10px}
      .avatar-emotion-row button{border:1px solid var(--border);background:var(--panel-strong);color:var(--ink);border-radius:999px;padding:4px 10px;font:inherit;font-size:0.82em;cursor:pointer}
      .brains-form{display:grid;gap:8px;margin-bottom:14px}
      .brains-form input,.brains-form select{border:1px solid var(--border);border-radius:8px;background:var(--panel);color:var(--ink);padding:7px 9px;font:inherit}
      .brains-form-row{display:flex;gap:8px;flex-wrap:wrap}
      .brains-form-row > *{flex:1;min-width:140px}
      .brains-form label{font-size:0.82em;color:var(--muted);display:flex;flex-direction:column;gap:3px}
      .brains-list{display:grid;gap:8px}
      .brains-item{border:1px solid var(--border);border-radius:10px;padding:10px;background:var(--panel)}
      .brains-item .micro{color:var(--muted);font-size:0.8em;margin-top:4px}
      .brains-actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:8px}
      .brains-actions button{border:1px solid var(--border);background:var(--panel-strong);color:var(--ink);border-radius:8px;padding:5px 10px;font:inherit;cursor:pointer}
      .asset-chip-group{margin-bottom:10px}
      .asset-chip-group h4{margin:0 0 6px;font-size:0.85em;color:var(--muted)}
      .asset-chip{display:inline-block;border:1px solid var(--border);background:var(--panel-strong);color:var(--ink);border-radius:6px;padding:3px 8px;margin:0 6px 6px 0;font-size:0.8em;cursor:pointer}
      .tone-bad{color:var(--bad)}
      .tone-ok{color:var(--ok)}
    `;
    document.head.appendChild(s);
  }

  if (!root.dataset.avatarMounted) {
    root.innerHTML = `
      <section>
        <div class="panel-head">
          <div><h2>Avatar</h2><div class="panel-subtle">3D avatar scene, room, and voice trust profiles — owned by the voice-avatar plugin.</div></div>
        </div>
        <div id="avatarHint" class="panel-subtle">Loading&hellip;</div>

        <div class="avatar-subtabs" role="tablist">
          <button type="button" class="active" data-avatar-subtab-target="scene">Scene</button>
          <button type="button" data-avatar-subtab-target="config">Scene config</button>
          <button type="button" data-avatar-subtab-target="assets">Assets</button>
          <button type="button" data-avatar-subtab-target="trust">Trust profiles</button>
        </div>

        <div class="card active" data-avatar-subtab-panel="scene">
          <div id="avatarCanvasSlot"></div>
          <div class="avatar-emotion-row" id="avatarEmotionRow"></div>
          <div class="brains-form-row">
            <input id="avatarAnnotateText" placeholder="Type a line of speech to annotate + preview&hellip;">
            <button id="avatarAnnotateBtn" type="button">Annotate &amp; play</button>
          </div>
        </div>

        <div class="card" data-avatar-subtab-panel="config">
          <div class="brains-form">
            <label>Character model path<input id="cfgCharacterModel" placeholder="characters/example.glb"></label>
            <label>Background/sky image path<input id="cfgBackgroundImage" placeholder="skies/example.png"></label>
            <div class="brains-form-row">
              <label>Wall texture<input id="cfgWalls" placeholder="textures/wall.png"></label>
              <label>Floor texture<input id="cfgFloor" placeholder="textures/floor.png"></label>
            </div>
            <div class="brains-form-row">
              <label>Ceiling texture<input id="cfgCeiling" placeholder="textures/ceiling.png"></label>
              <label>Window frame texture<input id="cfgWindowFrame" placeholder="textures/frame.png"></label>
            </div>
            <div class="brains-form-row">
              <label>Filter preset<select id="cfgFilterPreset"></select></label>
              <label>Effect preset<select id="cfgEffectPreset"></select></label>
            </div>
            <div class="brains-form-row">
              <label>Idle clip name<input id="cfgIdleClip" placeholder="animation clip name in the model"></label>
              <label>Talking clip names (comma-separated)<input id="cfgTalkingClips" placeholder="clip1, clip2"></label>
            </div>
            <div><strong>Prop slots</strong></div>
            <div id="cfgPropSlots"></div>
            <div><strong>Emotion &rarr; clip name mapping</strong></div>
            <div id="cfgEmotionClips" class="brains-form"></div>
            <div><button id="cfgSaveBtn" type="button">Save scene config</button></div>
          </div>
        </div>

        <div class="card" data-avatar-subtab-panel="assets">
          <div class="panel-subtle" style="margin-bottom:10px">Files found under the plugin's configured assets directory. Click one to copy its relative path.</div>
          <div id="assetGroups"></div>
        </div>

        <div class="card" data-avatar-subtab-panel="trust">
          <div class="brains-form">
            <div class="brains-form-row">
              <label>Label<input id="trustLabel" placeholder="e.g. Household member"></label>
              <label>Trust level<select id="trustLevel"><option value="unknown">Unknown</option><option value="known">Known</option><option value="trusted">Trusted</option></select></label>
            </div>
            <label>Notes<input id="trustNotes" placeholder="(optional)"></label>
            <div><button id="trustSaveBtn" type="button">Save profile</button> <button id="trustResetBtn" class="secondary" type="button">New profile</button></div>
          </div>
          <div id="trustList" class="brains-list"><div class="panel-subtle">Loading&hellip;</div></div>
        </div>
      </section>
    `;
    root.dataset.avatarMounted = "1";
  }

  // Move the persistent scene host (canvas + status + emotion overlays) into this mount's
  // slot. The first time, this also imports avatar-original.js, which finds the canvas
  // already in the document and self-initializes exactly like it did as a static page.
  const sceneHost = getOrCreateSceneHost();
  root.querySelector("#avatarCanvasSlot").appendChild(sceneHost);
  if (!window.__genesisAvatarImported) {
    window.__genesisAvatarImported = true;
    await import("/api/plugin-ui/voice-avatar/avatar-original.js");
  } else {
    // The script is already running against this canvas — it just moved to a
    // possibly-different-sized container, so ask it to resize.
    window.agentAvatar?.resizeRenderer?.();
  }

  const hint = root.querySelector("#avatarHint");
  const setHint = (text = "", tone = "") => {
    hint.textContent = text;
    hint.className = tone ? `panel-subtle tone-${tone}` : "panel-subtle";
  };

  const state = { sceneConfig: null, trustProfiles: [], editingTrustId: "" };

  const populateEmotionRow = () => {
    const row = root.querySelector("#avatarEmotionRow");
    row.innerHTML = EMOTION_KEYS.map((emotion) => `<button type="button" data-emotion="${h(emotion)}">${h(emotion)}</button>`).join("");
  };

  const populateFilterPresets = () => {
    const presets = ["none", "soft", "cinematic", "noir", "vivid", "dream", "retro_vhs", "haunted", "surveillance", "crystal", "whimsical", "toon", "anime"];
    root.querySelector("#cfgFilterPreset").innerHTML = presets.map((p) => `<option value="${h(p)}">${h(p)}</option>`).join("");
    const effects = ["none", "toon", "dream", "retro_vhs", "whimsical", "glow", "grain", "comic"];
    root.querySelector("#cfgEffectPreset").innerHTML = effects.map((p) => `<option value="${h(p)}">${h(p)}</option>`).join("");
  };

  const populateEmotionClipInputs = (paths = {}) => {
    root.querySelector("#cfgEmotionClips").innerHTML = EMOTION_KEYS.map((emotion) => `
      <div class="brains-form-row">
        <label style="flex:0 0 90px">${h(emotion)}<input data-emotion-clip="${h(emotion)}" value="${h(paths[emotion] || "")}" placeholder="clip name"></label>
      </div>
    `).join("");
  };

  const fillConfigForm = (config) => {
    root.querySelector("#cfgCharacterModel").value = config.characterModelPath || "";
    root.querySelector("#cfgBackgroundImage").value = config.backgroundImagePath || "";
    root.querySelector("#cfgWalls").value = config.roomTextures?.walls || "";
    root.querySelector("#cfgFloor").value = config.roomTextures?.floor || "";
    root.querySelector("#cfgCeiling").value = config.roomTextures?.ceiling || "";
    root.querySelector("#cfgWindowFrame").value = config.roomTextures?.windowFrame || "";
    root.querySelector("#cfgFilterPreset").value = config.stylization?.filterPreset || "none";
    root.querySelector("#cfgEffectPreset").value = config.stylization?.effectPreset || "none";
    root.querySelector("#cfgIdleClip").value = config.reactionClips?.idleClip || "";
    root.querySelector("#cfgTalkingClips").value = (config.reactionClips?.talkingClips || []).join(", ");
    root.querySelector("#cfgPropSlots").innerHTML = propSlotFields(config.propSlots || {});
    populateEmotionClipInputs(config.reactionClips?.paths || {});
  };

  // Applies scene-config to the live scene via the real avatar-original.js mechanism
  // (window.agentAvatar.reloadAppearance), reshaped the same way loadSavedAppAppearance
  // reshapes it on initial load — not a separate reimplementation of scene-loading.
  const applySceneFromConfig = async (config) => {
    const modelPath = config.characterModelPath || "";
    await window.agentAvatar?.reloadAppearance?.({
      avatarModelPath: modelPath,
      backgroundImagePath: config.backgroundImagePath || "",
      roomTextures: config.roomTextures || {},
      propSlots: config.propSlots || {},
      reactionPathsByModel: modelPath ? { [modelPath]: config.reactionClips || {} } : {},
      stylizationEffectPreset: config.stylization?.effectPreset || "none"
    });
  };

  const loadSceneConfig = async () => {
    const { config } = await api("/api/avatar/scene-config");
    state.sceneConfig = config;
    fillConfigForm(config);
    setHint(config.characterModelPath ? "Scene loaded." : "No character model configured — showing an empty scene.");
  };

  const renderAssetGroups = (assets) => {
    const groups = [
      ["Characters", assets.characters || []],
      ["Props", assets.props || []],
      ["Textures", assets.textures || []],
      ["Skies", assets.skies || []]
    ];
    root.querySelector("#assetGroups").innerHTML = groups.map(([label, files]) => `
      <div class="asset-chip-group">
        <h4>${h(label)} (${files.length})</h4>
        ${files.length ? files.map((f) => `<span class="asset-chip" data-asset-path="${h(f)}">${h(f)}</span>`).join("") : `<div class="panel-subtle">None found.</div>`}
      </div>
    `).join("");
  };

  const loadAssets = async () => {
    const { assets } = await api("/api/avatar/assets");
    renderAssetGroups(assets);
  };

  const resetTrustForm = () => {
    state.editingTrustId = "";
    root.querySelector("#trustLabel").value = "";
    root.querySelector("#trustLevel").value = "known";
    root.querySelector("#trustNotes").value = "";
  };

  const renderTrustList = () => {
    const list = root.querySelector("#trustList");
    list.innerHTML = state.trustProfiles.length
      ? state.trustProfiles.map((p) => `
        <article class="brains-item" data-trust-id="${h(p.id)}">
          <strong>${h(p.label)}</strong> <span class="micro">${h(p.trustLevel)}</span>
          ${p.notes ? `<div class="micro">${h(p.notes)}</div>` : ""}
          <div class="brains-actions">
            <button type="button" data-trust-edit="${h(p.id)}">Edit</button>
            <button type="button" data-trust-remove="${h(p.id)}">Remove</button>
          </div>
        </article>
      `).join("")
      : `<div class="panel-subtle">No voice trust profiles yet.</div>`;
  };

  const loadTrustProfiles = async () => {
    const { profiles } = await api("/api/voice/trust-profiles");
    state.trustProfiles = Array.isArray(profiles) ? profiles : [];
    renderTrustList();
  };

  if (!root.dataset.avatarBound) {
    populateEmotionRow();
    populateFilterPresets();

    root.querySelectorAll("[data-avatar-subtab-target]").forEach((b) => b.addEventListener("click", () => setSubtab(root, b.dataset.avatarSubtabTarget)));

    root.querySelector("#avatarEmotionRow").addEventListener("click", (evt) => {
      const btn = evt.target.closest("[data-emotion]");
      if (!btn) return;
      const emotion = btn.dataset.emotion;
      const clip = state.sceneConfig?.reactionClips?.paths?.[emotion];
      window.agentAvatar?.applyResponseText?.(clip ? `[persona:animation=${clip}]` : `[persona:emotion=${emotion}]`);
    });

    root.querySelector("#avatarAnnotateBtn").addEventListener("click", async () => {
      const text = String(root.querySelector("#avatarAnnotateText").value || "").trim();
      if (!text) return setHint("Type a line of speech first.", "bad");
      try {
        const result = await api("/api/voice/annotate", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text }) });
        window.agentAvatar?.applyResponseText?.(result.text || "");
        setHint(`Annotated as "${result.emotion || "none"}".`, "ok");
      } catch (e) {
        setHint(`Annotate failed: ${e.message}`, "bad");
      }
    });

    root.querySelector("#cfgSaveBtn").addEventListener("click", async () => {
      const propSlots = {};
      PROP_SLOT_IDS.forEach((slotId) => {
        propSlots[slotId] = {
          model: root.querySelector(`[data-prop-model="${CSS.escape(slotId)}"]`).value,
          scale: Number(root.querySelector(`[data-prop-scale="${CSS.escape(slotId)}"]`).value || 1)
        };
      });
      const paths = {};
      EMOTION_KEYS.forEach((emotion) => {
        paths[emotion] = root.querySelector(`[data-emotion-clip="${CSS.escape(emotion)}"]`).value;
      });
      try {
        const { config } = await api("/api/avatar/scene-config", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            characterModelPath: root.querySelector("#cfgCharacterModel").value,
            backgroundImagePath: root.querySelector("#cfgBackgroundImage").value,
            roomTextures: {
              walls: root.querySelector("#cfgWalls").value,
              floor: root.querySelector("#cfgFloor").value,
              ceiling: root.querySelector("#cfgCeiling").value,
              windowFrame: root.querySelector("#cfgWindowFrame").value
            },
            stylization: {
              filterPreset: root.querySelector("#cfgFilterPreset").value,
              effectPreset: root.querySelector("#cfgEffectPreset").value
            },
            reactionClips: {
              idleClip: root.querySelector("#cfgIdleClip").value,
              talkingClips: root.querySelector("#cfgTalkingClips").value.split(",").map((s) => s.trim()).filter(Boolean),
              paths
            },
            propSlots
          })
        });
        state.sceneConfig = config;
        fillConfigForm(config);
        await applySceneFromConfig(config);
        setSubtab(root, "scene");
        setHint("Saved and reloaded.", "ok");
      } catch (e) {
        setHint(`Save failed: ${e.message}`, "bad");
      }
    });

    root.querySelector("#assetGroups").addEventListener("click", (evt) => {
      const chip = evt.target.closest("[data-asset-path]");
      if (!chip) return;
      const path = chip.dataset.assetPath;
      navigator.clipboard?.writeText(path).catch(() => {});
      setHint(`Copied "${path}" to clipboard.`, "ok");
    });

    root.querySelector("#trustResetBtn").addEventListener("click", resetTrustForm);

    root.querySelector("#trustSaveBtn").addEventListener("click", async () => {
      const label = String(root.querySelector("#trustLabel").value || "").trim();
      if (!label) return setHint("Label is required.", "bad");
      try {
        await api("/api/voice/trust-profiles", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            id: state.editingTrustId || undefined,
            label,
            trustLevel: root.querySelector("#trustLevel").value,
            notes: root.querySelector("#trustNotes").value
          })
        });
        resetTrustForm();
        await loadTrustProfiles();
        setHint(`Trust profile "${label}" saved.`, "ok");
      } catch (e) {
        setHint(`Save failed: ${e.message}`, "bad");
      }
    });

    root.querySelector("#trustList").addEventListener("click", async (evt) => {
      const editBtn = evt.target.closest("[data-trust-edit]");
      if (editBtn) {
        const profile = state.trustProfiles.find((p) => p.id === editBtn.dataset.trustEdit);
        if (profile) {
          state.editingTrustId = profile.id;
          root.querySelector("#trustLabel").value = profile.label;
          root.querySelector("#trustLevel").value = profile.trustLevel;
          root.querySelector("#trustNotes").value = profile.notes || "";
        }
        return;
      }
      const removeBtn = evt.target.closest("[data-trust-remove]");
      if (removeBtn) {
        const id = removeBtn.dataset.trustRemove;
        if (!window.confirm("Remove this trust profile?")) return;
        try {
          await api(`/api/voice/trust-profiles/${encodeURIComponent(id)}`, { method: "DELETE" });
          await loadTrustProfiles();
          setHint("Trust profile removed.", "ok");
        } catch (e) {
          setHint(`Remove failed: ${e.message}`, "bad");
        }
      }
    });

    root.dataset.avatarBound = "1";
  }

  resetTrustForm();
  setSubtab(root, root.dataset.avatarTab || "scene");

  try {
    await Promise.all([loadSceneConfig(), loadAssets(), loadTrustProfiles()]);
  } catch (e) {
    setHint(`Avatar unavailable: ${e.message}`, "bad");
  }
}
