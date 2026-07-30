import { escapeHtml as h } from "/plugin-tab-shared.js";

async function callApi(fetchImpl, path = "", options = {}) {
  const r = await fetchImpl(path, options);
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.ok === false) throw new Error(j.error || `request failed (${r.status})`);
  return j;
}

function setSubtab(root, id = "brains") {
  root.dataset.brainsTab = id;
  root.querySelectorAll("[data-brains-subtab-target]").forEach((b) => b.classList.toggle("active", b.dataset.brainsSubtabTarget === id));
  root.querySelectorAll("[data-brains-subtab-panel]").forEach((p) => p.classList.toggle("active", p.dataset.brainsSubtabPanel === id));
}

export async function mountPluginTab(context = {}) {
  const root = context?.root;
  if (!(root instanceof HTMLElement)) return;

  const fetchImpl = context?.pluginAdminFetch || context?.observerApp?.pluginAdminFetch || fetch;
  const api = (path, options) => callApi(fetchImpl, path, options);

  if (!document.getElementById("brainsPluginStyles")) {
    const s = document.createElement("style");
    s.id = "brainsPluginStyles";
    s.textContent = `
      .brains-subtabs{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:12px}
      .brains-subtabs button{border:1px solid var(--border);background:var(--panel-strong);color:var(--ink);border-radius:999px;padding:7px 12px;font:inherit;font-weight:700;cursor:pointer}
      .brains-subtabs button.active{background:var(--accent);color:#1a0f00;border-color:transparent}
      [data-brains-subtab-panel]{display:none}[data-brains-subtab-panel].active{display:block}
      .brains-list{display:grid;gap:8px;margin-bottom:14px}
      .brains-item{border:1px solid var(--border);border-radius:10px;padding:10px;background:var(--panel)}
      .brains-item .micro{color:var(--muted);font-size:0.8em;margin-top:4px}
      .brains-actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:8px}
      .brains-actions button{border:1px solid var(--border);background:var(--panel-strong);color:var(--ink);border-radius:8px;padding:5px 10px;font:inherit;cursor:pointer}
      .brains-form{display:grid;gap:8px;margin-bottom:14px}
      .brains-form input,.brains-form select{border:1px solid var(--border);border-radius:8px;background:var(--panel);color:var(--ink);padding:7px 9px;font:inherit}
      .brains-form-row{display:flex;gap:8px;flex-wrap:wrap}
      .brains-form-row > *{flex:1;min-width:140px}
      .brains-form label{font-size:0.82em;color:var(--muted);display:flex;flex-direction:column;gap:3px}
      .brains-form label.inline{flex-direction:row;align-items:center;gap:6px}
      .tone-bad{color:var(--bad)}
      .tone-ok{color:var(--ok)}
    `;
    document.head.appendChild(s);
  }

  if (!root.dataset.brainsMounted) {
    root.innerHTML = `
      <section>
        <div class="panel-head">
          <div><h2>Brains</h2><div class="panel-subtle">Registered model endpoints and brains — owned by the model-provider plugin.</div></div>
          <button id="brainsRefreshBtn" type="button">Refresh</button>
        </div>
        <div id="brainsHint" class="panel-subtle">Loading&hellip;</div>

        <div class="brains-subtabs" role="tablist">
          <button type="button" class="active" data-brains-subtab-target="brains">Brains</button>
          <button type="button" data-brains-subtab-target="endpoints">Endpoints</button>
        </div>

        <div class="card active" data-brains-subtab-panel="brains">
          <div class="brains-form" data-brain-form>
            <div class="brains-form-row">
              <label>ID<input id="brainId" placeholder="e.g. planner"></label>
              <label>Label<input id="brainLabel" placeholder="Display name"></label>
            </div>
            <div class="brains-form-row">
              <label>Model<input id="brainModel" placeholder="e.g. llama3.1"></label>
              <label>Specialty<input id="brainSpecialty" placeholder="e.g. planning"></label>
            </div>
            <div class="brains-form-row">
              <label>Endpoint<select id="brainEndpoint"></select></label>
              <label>GPU index<input id="brainNumGpu" type="number" placeholder="(optional)"></label>
            </div>
            <label>Description<input id="brainDescription" placeholder="(optional)"></label>
            <div class="brains-form-row">
              <label class="inline"><input id="brainToolCapable" type="checkbox"> Tool-capable</label>
              <label class="inline"><input id="brainEnabled" type="checkbox"> Enabled</label>
            </div>
            <div><button id="brainSaveBtn" type="button">Save brain</button> <button id="brainResetBtn" class="secondary" type="button">New brain</button></div>
          </div>
          <div id="brainsList" class="brains-list"><div class="panel-subtle">Loading&hellip;</div></div>
        </div>

        <div class="card" data-brains-subtab-panel="endpoints">
          <div class="brains-form" data-endpoint-form>
            <div class="brains-form-row">
              <label>ID<input id="endpointId" placeholder="e.g. openai"></label>
              <label>Label<input id="endpointLabel" placeholder="Display name"></label>
            </div>
            <div class="brains-form-row">
              <label>Provider<select id="endpointProvider"><option value="ollama">Ollama</option><option value="openai-compatible">OpenAI-compatible</option></select></label>
              <label>Base URL<input id="endpointBaseUrl" placeholder="http://127.0.0.1:11434"></label>
            </div>
            <label>API key<input id="endpointApiKey" type="password" placeholder="(leave blank to keep existing)"></label>
            <div><button id="endpointSaveBtn" type="button">Save endpoint</button> <button id="endpointResetBtn" class="secondary" type="button">New endpoint</button></div>
          </div>
          <div id="endpointsList" class="brains-list"><div class="panel-subtle">Loading&hellip;</div></div>
        </div>
      </section>
    `;
    root.dataset.brainsMounted = "1";
  }

  const hint = root.querySelector("#brainsHint");
  const setHint = (text = "", tone = "") => {
    hint.textContent = text;
    hint.className = tone ? `panel-subtle tone-${tone}` : "panel-subtle";
  };

  const state = { brains: [], endpoints: [], editingBrainId: "", editingEndpointId: "" };

  const resetBrainForm = () => {
    state.editingBrainId = "";
    root.querySelector("#brainId").value = "";
    root.querySelector("#brainId").disabled = false;
    root.querySelector("#brainLabel").value = "";
    root.querySelector("#brainModel").value = "";
    root.querySelector("#brainSpecialty").value = "";
    root.querySelector("#brainNumGpu").value = "";
    root.querySelector("#brainDescription").value = "";
    root.querySelector("#brainToolCapable").checked = true;
    root.querySelector("#brainEnabled").checked = true;
  };

  const fillBrainForm = (brain) => {
    state.editingBrainId = brain.id;
    root.querySelector("#brainId").value = brain.id;
    root.querySelector("#brainId").disabled = true;
    root.querySelector("#brainLabel").value = brain.label || "";
    root.querySelector("#brainModel").value = brain.model || "";
    root.querySelector("#brainSpecialty").value = brain.specialty || "";
    root.querySelector("#brainEndpoint").value = brain.endpointId || "local";
    root.querySelector("#brainNumGpu").value = brain.numGpu ?? "";
    root.querySelector("#brainDescription").value = brain.description || "";
    root.querySelector("#brainToolCapable").checked = brain.toolCapable !== false;
    root.querySelector("#brainEnabled").checked = brain.enabled !== false;
  };

  const resetEndpointForm = () => {
    state.editingEndpointId = "";
    root.querySelector("#endpointId").value = "";
    root.querySelector("#endpointId").disabled = false;
    root.querySelector("#endpointLabel").value = "";
    root.querySelector("#endpointProvider").value = "ollama";
    root.querySelector("#endpointBaseUrl").value = "";
    root.querySelector("#endpointApiKey").value = "";
  };

  const fillEndpointForm = (endpoint) => {
    state.editingEndpointId = endpoint.id;
    root.querySelector("#endpointId").value = endpoint.id;
    root.querySelector("#endpointId").disabled = true;
    root.querySelector("#endpointLabel").value = endpoint.label || "";
    root.querySelector("#endpointProvider").value = endpoint.provider || "ollama";
    root.querySelector("#endpointBaseUrl").value = endpoint.baseUrl || "";
    root.querySelector("#endpointApiKey").value = "";
  };

  const renderBrainItem = (brain) => `
    <article class="brains-item" data-brain-id="${h(brain.id)}">
      <strong>${h(brain.label || brain.id)}</strong> <span class="micro">${h(brain.id)}</span>
      <div class="micro">model: ${h(brain.model)} &middot; specialty: ${h(brain.specialty || "general")} &middot; endpoint: ${h(brain.endpointLabel || brain.endpointId)} (${h(brain.provider)})</div>
      <div class="micro">${brain.enabled ? '<span class="tone-ok">enabled</span>' : '<span class="tone-bad">disabled</span>'}${brain.toolCapable ? " &middot; tool-capable" : ""}${brain.numGpu != null ? ` &middot; gpu ${h(String(brain.numGpu))}` : ""}</div>
      <div id="brainHealth_${h(brain.id)}" class="micro"></div>
      <div class="brains-actions">
        <button type="button" data-brain-edit="${h(brain.id)}">Edit</button>
        <button type="button" data-brain-health="${h(brain.id)}">Check health</button>
        <button type="button" data-brain-remove="${h(brain.id)}">Remove</button>
      </div>
    </article>
  `;

  const renderEndpointItem = (endpoint) => `
    <article class="brains-item" data-endpoint-id="${h(endpoint.id)}">
      <strong>${h(endpoint.label || endpoint.id)}</strong> <span class="micro">${h(endpoint.id)}</span>
      <div class="micro">provider: ${h(endpoint.provider)} &middot; ${h(endpoint.baseUrl)}${endpoint.hasApiKey ? " &middot; API key set" : ""}</div>
      <div id="endpointHealth_${h(endpoint.id)}" class="micro"></div>
      <div class="brains-actions">
        <button type="button" data-endpoint-edit="${h(endpoint.id)}">Edit</button>
        <button type="button" data-endpoint-health="${h(endpoint.id)}">Check health</button>
        ${endpoint.provider === "ollama" ? `<button type="button" data-endpoint-models="${h(endpoint.id)}">List models</button>` : ""}
        ${endpoint.id !== "local" ? `<button type="button" data-endpoint-remove="${h(endpoint.id)}">Remove</button>` : ""}
      </div>
    </article>
  `;

  const populateEndpointSelect = () => {
    const select = root.querySelector("#brainEndpoint");
    const current = select.value;
    select.innerHTML = state.endpoints.map((e) => `<option value="${h(e.id)}">${h(e.label || e.id)}</option>`).join("");
    if (current) select.value = current;
  };

  const loadAll = async () => {
    const [brainsRes, endpointsRes] = await Promise.all([
      api("/api/brains?includeDisabled=true"),
      api("/api/brains/endpoints")
    ]);
    state.brains = Array.isArray(brainsRes.brains) ? brainsRes.brains : [];
    state.endpoints = Array.isArray(endpointsRes.endpoints) ? endpointsRes.endpoints : [];
    populateEndpointSelect();
    root.querySelector("#brainsList").innerHTML = state.brains.length
      ? state.brains.map(renderBrainItem).join("")
      : `<div class="panel-subtle">No brains registered.</div>`;
    root.querySelector("#endpointsList").innerHTML = state.endpoints.length
      ? state.endpoints.map(renderEndpointItem).join("")
      : `<div class="panel-subtle">No endpoints registered.</div>`;
    setHint("Brains loaded.");
  };

  if (!root.dataset.brainsBound) {
    root.querySelectorAll("[data-brains-subtab-target]").forEach((b) => b.addEventListener("click", () => setSubtab(root, b.dataset.brainsSubtabTarget)));

    root.querySelector("#brainsRefreshBtn").addEventListener("click", () => loadAll().catch((e) => setHint(`Refresh failed: ${e.message}`, "bad")));

    root.querySelector("#brainResetBtn").addEventListener("click", resetBrainForm);
    root.querySelector("#endpointResetBtn").addEventListener("click", resetEndpointForm);

    root.querySelector("#brainSaveBtn").addEventListener("click", async () => {
      const id = String(root.querySelector("#brainId").value || "").trim();
      if (!id) return setHint("Brain ID is required.", "bad");
      const model = String(root.querySelector("#brainModel").value || "").trim();
      if (!model) return setHint("Model is required.", "bad");
      const numGpuRaw = String(root.querySelector("#brainNumGpu").value || "").trim();
      try {
        await api("/api/brains", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            id,
            label: root.querySelector("#brainLabel").value,
            model,
            specialty: root.querySelector("#brainSpecialty").value,
            endpointId: root.querySelector("#brainEndpoint").value,
            numGpu: numGpuRaw ? Number(numGpuRaw) : undefined,
            description: root.querySelector("#brainDescription").value,
            toolCapable: root.querySelector("#brainToolCapable").checked,
            enabled: root.querySelector("#brainEnabled").checked
          })
        });
        resetBrainForm();
        await loadAll();
        setHint(`Brain "${id}" saved.`, "ok");
      } catch (e) {
        setHint(`Save failed: ${e.message}`, "bad");
      }
    });

    root.querySelector("#endpointSaveBtn").addEventListener("click", async () => {
      const id = String(root.querySelector("#endpointId").value || "").trim();
      if (!id) return setHint("Endpoint ID is required.", "bad");
      try {
        await api("/api/brains/endpoints", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            id,
            label: root.querySelector("#endpointLabel").value,
            provider: root.querySelector("#endpointProvider").value,
            baseUrl: root.querySelector("#endpointBaseUrl").value,
            apiKey: root.querySelector("#endpointApiKey").value
          })
        });
        resetEndpointForm();
        await loadAll();
        setHint(`Endpoint "${id}" saved.`, "ok");
      } catch (e) {
        setHint(`Save failed: ${e.message}`, "bad");
      }
    });

    root.addEventListener("click", async (evt) => {
      const t = evt.target;
      if (!(t instanceof Element)) return;

      const editBrain = t.closest("[data-brain-edit]");
      if (editBrain instanceof HTMLElement) {
        const brain = state.brains.find((b) => b.id === editBrain.dataset.brainEdit);
        if (brain) { fillBrainForm(brain); setSubtab(root, "brains"); }
        return;
      }

      const healthBrain = t.closest("[data-brain-health]");
      if (healthBrain instanceof HTMLElement) {
        const id = healthBrain.dataset.brainHealth;
        const target = root.querySelector(`#brainHealth_${CSS.escape(id)}`);
        target.textContent = "Checking health…";
        try {
          const result = await api(`/api/brains/${encodeURIComponent(id)}/health`);
          target.innerHTML = result.running || result.ok
            ? `<span class="tone-ok">healthy</span>`
            : `<span class="tone-bad">unhealthy${result.error ? `: ${h(result.error)}` : ""}</span>`;
        } catch (e) {
          target.innerHTML = `<span class="tone-bad">${h(e.message)}</span>`;
        }
        return;
      }

      const removeBrain = t.closest("[data-brain-remove]");
      if (removeBrain instanceof HTMLElement) {
        const id = removeBrain.dataset.brainRemove;
        if (!window.confirm(`Remove brain "${id}"?`)) return;
        try {
          await api(`/api/brains/${encodeURIComponent(id)}`, { method: "DELETE" });
          await loadAll();
          setHint(`Brain "${id}" removed.`, "ok");
        } catch (e) {
          setHint(`Remove failed: ${e.message}`, "bad");
        }
        return;
      }

      const editEndpoint = t.closest("[data-endpoint-edit]");
      if (editEndpoint instanceof HTMLElement) {
        const endpoint = state.endpoints.find((e) => e.id === editEndpoint.dataset.endpointEdit);
        if (endpoint) { fillEndpointForm(endpoint); setSubtab(root, "endpoints"); }
        return;
      }

      const healthEndpoint = t.closest("[data-endpoint-health]");
      if (healthEndpoint instanceof HTMLElement) {
        const id = healthEndpoint.dataset.endpointHealth;
        const target = root.querySelector(`#endpointHealth_${CSS.escape(id)}`);
        target.textContent = "Checking health…";
        try {
          const result = await api(`/api/brains/endpoints/${encodeURIComponent(id)}/health`);
          target.innerHTML = result.running || result.ok
            ? `<span class="tone-ok">healthy</span>`
            : `<span class="tone-bad">unhealthy${result.error ? `: ${h(result.error)}` : ""}</span>`;
        } catch (e) {
          target.innerHTML = `<span class="tone-bad">${h(e.message)}</span>`;
        }
        return;
      }

      const modelsEndpoint = t.closest("[data-endpoint-models]");
      if (modelsEndpoint instanceof HTMLElement) {
        const id = modelsEndpoint.dataset.endpointModels;
        const target = root.querySelector(`#endpointHealth_${CSS.escape(id)}`);
        target.textContent = "Listing models…";
        try {
          const result = await api(`/api/brains/endpoints/${encodeURIComponent(id)}/models`);
          const names = (result.models || []).map((m) => m.name).join(", ");
          target.textContent = names ? `Models: ${names}` : "No models found.";
        } catch (e) {
          target.innerHTML = `<span class="tone-bad">${h(e.message)}</span>`;
        }
        return;
      }

      const removeEndpoint = t.closest("[data-endpoint-remove]");
      if (removeEndpoint instanceof HTMLElement) {
        const id = removeEndpoint.dataset.endpointRemove;
        if (!window.confirm(`Remove endpoint "${id}"?`)) return;
        try {
          await api(`/api/brains/endpoints/${encodeURIComponent(id)}`, { method: "DELETE" });
          await loadAll();
          setHint(`Endpoint "${id}" removed.`, "ok");
        } catch (e) {
          setHint(`Remove failed: ${e.message}`, "bad");
        }
      }
    });

    root.dataset.brainsBound = "1";
  }

  setSubtab(root, root.dataset.brainsTab || "brains");
  resetBrainForm();
  resetEndpointForm();
  try {
    await loadAll();
  } catch (e) {
    setHint(`Brains unavailable: ${e.message}`, "bad");
  }
}
