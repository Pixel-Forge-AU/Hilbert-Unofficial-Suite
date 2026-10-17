import { escapeAttr, escapeHtml } from "/plugin-tab-shared.js";

const FILTER_PRESETS = [
  { id: "none", label: "None" },
  { id: "soft", label: "Soft" },
  { id: "cinematic", label: "Cinematic" },
  { id: "noir", label: "Noir" },
  { id: "vivid", label: "Vivid" },
  { id: "dream", label: "Dream" },
  { id: "retro_vhs", label: "Retro VHS" },
  { id: "haunted", label: "Haunted" },
  { id: "surveillance", label: "Surveillance" },
  { id: "crystal", label: "Crystal" },
  { id: "whimsical", label: "Whimsical" },
  { id: "toon", label: "Toon" }
];

const EFFECT_PRESETS = [
  { id: "none", label: "None" },
  { id: "toon", label: "Toon" },
  { id: "dream", label: "Dream" },
  { id: "retro_vhs", label: "Retro VHS" },
  { id: "whimsical", label: "Whimsical" }
];

const ROOM_TEXTURE_FIELDS = [
  ["walls", "Walls"],
  ["floor", "Floor"],
  ["ceiling", "Ceiling"],
  ["windowFrame", "Window Frame"]
];

const PROP_SLOT_FIELDS = [
  ["backWallLeft", "Back Wall Left"],
  ["backWallRight", "Back Wall Right"],
  ["wallLeft", "Wall Left"],
  ["wallRight", "Wall Right"],
  ["besideLeft", "Beside Left"],
  ["besideRight", "Beside Right"],
  ["outsideLeft", "Outside Left"],
  ["outsideRight", "Outside Right"]
];

const recreationStateByRoot = new WeakMap();

function cloneJson(value = null) {
  return JSON.parse(JSON.stringify(value == null ? null : value));
}

function formatDateTime(observerApp, value) {
  if (typeof observerApp?.formatDateTime === "function") {
    return observerApp.formatDateTime(value);
  }
  return value ? new Date(value).toLocaleString() : "Never";
}

function formatTime(observerApp, value) {
  if (typeof observerApp?.formatTime === "function") {
    return observerApp.formatTime(value);
  }
  return value ? new Date(value).toLocaleTimeString() : "Never";
}

function formatDurationMs(observerApp, value) {
  if (typeof observerApp?.formatDurationMs === "function") {
    return observerApp.formatDurationMs(value);
  }
  const numeric = Number(value || 0);
  return `${Math.round(numeric / 1000)}s`;
}

function formatEntityRef(observerApp, kind, id) {
  if (typeof observerApp?.formatEntityRef === "function") {
    return observerApp.formatEntityRef(kind, id);
  }
  return `${kind}:${id}`;
}

function renderOptions(options = [], selectedValue = "", emptyLabel = "None") {
  const normalized = options
    .map((value) => String(value || "").trim())
    .filter(Boolean);
  const values = selectedValue && !normalized.includes(selectedValue)
    ? [selectedValue, ...normalized]
    : normalized;
  const rendered = [`<option value="">${escapeHtml(emptyLabel)}</option>`];
  rendered.push(...values.map((value) => (
    `<option value="${escapeAttr(value)}"${value === selectedValue ? " selected" : ""}>${escapeHtml(value.replace(/^\/assets\//, ""))}</option>`
  )));
  return rendered.join("");
}

function getDraft(observerApp) {
  const existing = typeof observerApp?.getNovaConfigDraft === "function"
    ? observerApp.getNovaConfigDraft()
    : null;
  return existing && typeof existing === "object" ? existing : null;
}

function ensureDraftShape(draft) {
  if (!draft || typeof draft !== "object") {
    return null;
  }
  if (!draft.app || typeof draft.app !== "object") {
    draft.app = {};
  }
  if (!draft.assets || typeof draft.assets !== "object") {
    draft.assets = {};
  }
  draft.app.quietMode = draft.app.quietMode === true;
  if (!draft.app.roomTextures || typeof draft.app.roomTextures !== "object") {
    draft.app.roomTextures = {};
  }
  for (const [key] of ROOM_TEXTURE_FIELDS) {
    draft.app.roomTextures[key] = String(draft.app.roomTextures[key] || "");
  }
  if (!draft.app.propSlots || typeof draft.app.propSlots !== "object") {
    draft.app.propSlots = {};
  }
  for (const [key] of PROP_SLOT_FIELDS) {
    const entry = draft.app.propSlots[key];
    draft.app.propSlots[key] = {
      model: String((entry && typeof entry === "object" ? entry.model : entry) || ""),
      scale: normalizeScale(entry && typeof entry === "object" ? entry.scale : 1)
    };
  }
  return draft;
}

function normalizeScale(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return 1;
  }
  return Math.max(0.2, Math.min(numeric, 3));
}

async function applyAppearance(observerApp, appConfig, options = {}) {
  observerApp?.applyAppConfigToStage?.(appConfig);
  if (options.fullReload && typeof window.agentAvatar?.reloadAppearance === "function") {
    await window.agentAvatar.reloadAppearance(appConfig);
  }
}

function renderBehaviorTab(root, observerApp) {
  const draft = ensureDraftShape(getDraft(observerApp));
  if (!draft?.app) {
    root.innerHTML = `<div class="panel-subtle">Nova settings are unavailable.</div>`;
    return;
  }
  const app = draft.app;
  root.innerHTML = `
    <div class="brain-editor-card">
      <div class="panel-head">
        <div>
          <strong>Behavior</strong>
          <div class="panel-subtle">Control how Nova reports activity during tasks.</div>
        </div>
      </div>
      <div class="stack-list">
        <div class="micro">Changes take effect immediately and save with the main <code>Save Nova</code> button.</div>
        <label class="stack-field">
          <strong>Voice reports</strong>
          <select data-behavior-field="quietMode">
            <option value=""${!app.quietMode ? " selected" : ""}>Chatty — report all progress updates</option>
            <option value="true"${app.quietMode ? " selected" : ""}>Quiet — completions and calendar reminders only</option>
          </select>
        </label>
      </div>
    </div>
  `;

  root.querySelectorAll("[data-behavior-field]").forEach((input) => {
    input.onchange = () => {
      const field = String(input.dataset.behaviorField || "").trim();
      if (!field) {
        return;
      }
      if (field === "quietMode") {
        app.quietMode = input.value === "true";
      }
    };
  });
}

function renderEnvironmentTab(root, observerApp) {
  const draft = ensureDraftShape(getDraft(observerApp));
  if (!draft?.app) {
    root.innerHTML = `<div class="panel-subtle">Nova settings are unavailable.</div>`;
    return;
  }

  const backgrounds = Array.isArray(draft.assets?.backgrounds)
    ? draft.assets.backgrounds
    : (Array.isArray(draft.assets?.skies) ? draft.assets.skies : []);
  const textures = Array.isArray(draft.assets?.textures) ? draft.assets.textures : [];
  const app = draft.app;

  root.innerHTML = `
    <div class="brain-editor-card">
      <div class="panel-head">
        <div>
          <strong>Environment</strong>
          <div class="panel-subtle">Background, atmosphere, and room materials around Nova.</div>
        </div>
      </div>
      <div class="stack-list">
        <div class="micro">Changes here stage immediately and save with the main <code>Save Nova</code> button.</div>
        <label class="stack-field">
          <strong>Background</strong>
          <select data-environment-field="backgroundImagePath">${renderOptions(backgrounds, String(app.backgroundImagePath || ""), "No background")}</select>
        </label>
        <label class="stack-field">
          <strong>Filter</strong>
          <select data-environment-field="stylizationFilterPreset">
            ${FILTER_PRESETS.map((entry) => `<option value="${escapeAttr(entry.id)}"${entry.id === String(app.stylizationFilterPreset || "none") ? " selected" : ""}>${escapeHtml(entry.label)}</option>`).join("")}
          </select>
        </label>
        <label class="stack-field">
          <strong>Effect</strong>
          <select data-environment-field="stylizationEffectPreset">
            ${EFFECT_PRESETS.map((entry) => `<option value="${escapeAttr(entry.id)}"${entry.id === String(app.stylizationEffectPreset || "none") ? " selected" : ""}>${escapeHtml(entry.label)}</option>`).join("")}
          </select>
        </label>
        ${ROOM_TEXTURE_FIELDS.map(([key, label]) => `
          <label class="stack-field">
            <strong>${escapeHtml(label)}</strong>
            <select data-room-texture="${escapeAttr(key)}">${renderOptions(textures, String(app.roomTextures?.[key] || ""), `No ${label.toLowerCase()} texture`)}</select>
          </label>
        `).join("")}
      </div>
    </div>
  `;

  root.querySelectorAll("[data-environment-field]").forEach((input) => {
    input.onchange = async () => {
      const field = String(input.dataset.environmentField || "").trim();
      if (!field) {
        return;
      }
      app[field] = String(input.value || "").trim();
      await applyAppearance(observerApp, app, { fullReload: true });
    };
  });

  root.querySelectorAll("[data-room-texture]").forEach((input) => {
    input.onchange = async () => {
      const key = String(input.dataset.roomTexture || "").trim();
      if (!key) {
        return;
      }
      app.roomTextures[key] = String(input.value || "").trim();
      await applyAppearance(observerApp, app, { fullReload: true });
    };
  });
}

function renderPropsTab(root, observerApp) {
  const draft = ensureDraftShape(getDraft(observerApp));
  if (!draft?.app) {
    root.innerHTML = `<div class="panel-subtle">Nova settings are unavailable.</div>`;
    return;
  }

  const props = Array.isArray(draft.assets?.props) ? draft.assets.props : [];
  const app = draft.app;
  root.innerHTML = `
    <div class="brain-editor-card">
      <div class="panel-head">
        <div>
          <strong>Props</strong>
          <div class="panel-subtle">Assign stage props and adjust their scale by slot.</div>
        </div>
      </div>
      <div class="stack-list">
        <div class="micro">Changes here update the room preview and save with the main <code>Save Nova</code> button.</div>
        ${PROP_SLOT_FIELDS.map(([key, label]) => {
          const entry = app.propSlots[key] || { model: "", scale: 1 };
          const scale = normalizeScale(entry.scale);
          return `
            <div class="brain-editor-card">
              <label class="stack-field">
                <strong>${escapeHtml(label)}</strong>
                <select data-prop-slot="${escapeAttr(key)}">${renderOptions(props, String(entry.model || ""), "No prop")}</select>
              </label>
              <label class="stack-field">
                <strong>Scale</strong>
                <input type="range" min="0.2" max="3" step="0.05" value="${escapeAttr(scale)}" data-prop-scale="${escapeAttr(key)}" />
                <div class="micro">Current scale: <span data-prop-scale-value="${escapeAttr(key)}">${escapeHtml(scale.toFixed(2).replace(/0+$/, "").replace(/\.$/, ""))}</span></div>
              </label>
            </div>
          `;
        }).join("")}
      </div>
    </div>
  `;

  root.querySelectorAll("[data-prop-slot]").forEach((input) => {
    input.onchange = async () => {
      const key = String(input.dataset.propSlot || "").trim();
      if (!key) {
        return;
      }
      app.propSlots[key].model = String(input.value || "").trim();
      await applyAppearance(observerApp, app, { fullReload: true });
    };
  });

  root.querySelectorAll("[data-prop-scale]").forEach((input) => {
    input.oninput = () => {
      const key = String(input.dataset.propScale || "").trim();
      if (!key) {
        return;
      }
      const scale = normalizeScale(input.value);
      app.propSlots[key].scale = scale;
      const output = root.querySelector(`[data-prop-scale-value="${key}"]`);
      if (output) {
        output.textContent = scale.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
      }
    };
    input.onchange = async () => {
      const key = String(input.dataset.propScale || "").trim();
      if (!key) {
        return;
      }
      app.propSlots[key].scale = normalizeScale(input.value);
      await applyAppearance(observerApp, app, { fullReload: true });
    };
  });
}

function getRecreationState(root) {
  let state = recreationStateByRoot.get(root);
  if (!state) {
    state = {
      loading: false,
      error: "",
      status: null
    };
    recreationStateByRoot.set(root, state);
  }
  return state;
}

function renderRecreationTab(root, observerApp) {
  const state = getRecreationState(root);
  const status = state.status || {};
  const scheduled = status.scheduled || null;
  const running = status.running || null;
  const recent = Array.isArray(status.recent) ? status.recent : [];
  let summary = "No recreation cycle scheduled yet.";
  if (state.error) {
    summary = `Failed to load: ${state.error}`;
  } else if (running) {
    summary = `Running now - started ${formatTime(observerApp, running.startedAt)} on ${running.brain || "worker"}.`;
  } else if (scheduled?.notBeforeAt) {
    const notBefore = Number(scheduled.notBeforeAt || 0);
    const msUntil = notBefore - Date.now();
    if (msUntil > 0) {
      const minUntil = Math.round(msUntil / 60000);
      const label = minUntil >= 60
        ? `${Math.floor(minUntil / 60)}h ${minUntil % 60}m`
        : `${minUntil}m`;
      summary = `Next recreation in ${label} (${formatTime(observerApp, notBefore)}).`;
    } else {
      summary = "Recreation queued - waiting for a free brain slot.";
    }
  } else if (state.loading) {
    summary = "Loading recreation status...";
  }

  root.innerHTML = `
    <div class="brain-editor-card">
      <div class="panel-head">
        <div>
          <strong>Recreation</strong>
          <div class="panel-subtle">Nova's free-time cycles and the most recent recreation runs.</div>
        </div>
        <div class="controls" style="grid-template-columns: 1fr 1fr; margin-bottom: 0;">
          <button type="button" class="secondary" data-recreation-action="refresh"${state.loading ? " disabled" : ""}>Refresh</button>
          <button type="button" class="secondary" data-recreation-action="trigger"${state.loading ? " disabled" : ""}>Trigger now</button>
        </div>
      </div>
      <div class="hint">${escapeHtml(summary)}</div>
      <div class="stack-list">
        ${recent.length ? recent.map((entry) => {
          const completedLabel = entry.completedAt ? formatDateTime(observerApp, entry.completedAt) : "Not finished";
          const durationLabel = entry.startedAt && entry.completedAt
            ? formatDurationMs(observerApp, Number(entry.completedAt) - Number(entry.startedAt))
            : "";
          const statusTone = entry.status === "completed" ? "ok" : (entry.status === "failed" ? "error" : "neutral");
          const summaryText = String(entry.summary || "").trim();
          return `
            <div class="queue-item">
              <div class="queue-item-head">
                <div class="queue-item-actions">
                  <span class="status-chip ${escapeHtml(statusTone)}">${escapeHtml(entry.status || "unknown")}</span>
                </div>
                <div class="micro">${escapeHtml(completedLabel)}${durationLabel ? ` - ${escapeHtml(durationLabel)}` : ""}</div>
              </div>
              <div class="micro">Code: ${escapeHtml(entry.codename || formatEntityRef(observerApp, "task", entry.id || "unknown"))}</div>
              ${entry.brain ? `<div class="micro">Brain: ${escapeHtml(entry.brain)}</div>` : ""}
              ${summaryText ? `<div class="history-body">${escapeHtml(summaryText)}</div>` : `<div class="panel-subtle">No summary recorded.</div>`}
            </div>
          `;
        }).join("") : `<div class="panel-subtle">${state.loading ? "Loading recreation history..." : "No recent recreation cycles."}</div>`}
      </div>
    </div>
  `;
}

async function loadRecreationStatus(root, observerApp, pluginAdminFetch, options = {}) {
  const state = getRecreationState(root);
  state.loading = true;
  state.error = "";
  renderRecreationTab(root, observerApp);
  try {
    const response = await pluginAdminFetch("/api/personality/recreation/status?limit=10");
    const payload = await response.json();
    if (!response.ok || !payload.ok) {
      throw new Error(payload.error || "failed to load recreation status");
    }
    state.status = cloneJson({
      scheduled: payload.scheduled || null,
      running: payload.running || null,
      recent: Array.isArray(payload.recent) ? payload.recent : []
    });
  } catch (error) {
    state.error = String(error?.message || error || "failed to load recreation status");
    if (options.keepExisting !== true) {
      state.status = null;
    }
  } finally {
    state.loading = false;
    renderRecreationTab(root, observerApp);
    bindRecreationActions(root, observerApp, pluginAdminFetch);
  }
}

function bindRecreationActions(root, observerApp, pluginAdminFetch) {
  root.querySelectorAll("[data-recreation-action]").forEach((button) => {
    button.onclick = async () => {
      const action = String(button.dataset.recreationAction || "").trim();
      if (action === "refresh") {
        await loadRecreationStatus(root, observerApp, pluginAdminFetch, { keepExisting: true });
        return;
      }
      if (action !== "trigger") {
        return;
      }
      const state = getRecreationState(root);
      state.loading = true;
      state.error = "";
      renderRecreationTab(root, observerApp);
      try {
        const response = await pluginAdminFetch("/api/personality/recreation/trigger", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({})
        });
        const payload = await response.json();
        if (!response.ok || !payload.ok) {
          throw new Error(payload.error || "failed to trigger recreation");
        }
        state.status = cloneJson({
          scheduled: payload.scheduled || null,
          running: payload.running || null,
          recent: Array.isArray(payload.recent) ? payload.recent : []
        });
      } catch (error) {
        state.error = String(error?.message || error || "failed to trigger recreation");
      } finally {
        state.loading = false;
        renderRecreationTab(root, observerApp);
        bindRecreationActions(root, observerApp, pluginAdminFetch);
      }
    };
  });
}

function renderTab(tab, root, observerApp) {
  const tabId = String(tab?.id || "").trim().toLowerCase();
  if (tabId === "behavior") {
    renderBehaviorTab(root, observerApp);
    return;
  }
  if (tabId === "environment") {
    renderEnvironmentTab(root, observerApp);
    return;
  }
  if (tabId === "props") {
    renderPropsTab(root, observerApp);
    return;
  }
  if (tabId === "recreation") {
    renderRecreationTab(root, observerApp);
    return;
  }
  root.innerHTML = `<div class="panel-subtle">Unknown personality tab.</div>`;
}

export async function mountPluginTab({ tab, root, observerApp, pluginAdminFetch }) {
  if (!(root instanceof HTMLElement)) {
    return;
  }
  renderTab(tab, root, observerApp);
  if (String(tab?.id || "").trim().toLowerCase() === "recreation") {
    bindRecreationActions(root, observerApp, pluginAdminFetch);
    await loadRecreationStatus(root, observerApp, pluginAdminFetch, { keepExisting: false });
  }
}

export async function refreshPluginTab({ tab, root, observerApp, pluginAdminFetch }) {
  if (!(root instanceof HTMLElement)) {
    return;
  }
  renderTab(tab, root, observerApp);
  if (String(tab?.id || "").trim().toLowerCase() === "recreation") {
    bindRecreationActions(root, observerApp, pluginAdminFetch);
    await loadRecreationStatus(root, observerApp, pluginAdminFetch, { keepExisting: true });
  }
}
