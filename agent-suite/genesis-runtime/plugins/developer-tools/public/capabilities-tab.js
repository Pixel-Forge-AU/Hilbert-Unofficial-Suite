import { escapeHtml as h } from "/plugin-tab-shared.js";

function ensureMarkup(root) {
  if (root.dataset.capabilitiesMounted === "1") return;
  root.innerHTML = `
    <div class="inspector">
      <div class="panel-head">
        <div>
          <h2>Capabilities</h2>
          <div class="panel-subtle">Every tool registered across all active plugins, aggregated from /api/plugins/list.</div>
        </div>
        <button id="capabilitiesRefreshBtn" class="secondary" type="button">Refresh</button>
      </div>
      <input id="capabilitiesSearch" type="search" placeholder="Filter by tool name, description, or plugin&hellip;" style="width:100%;margin-bottom:12px;padding:0.4rem 0.6rem;border:1px solid var(--border);border-radius:6px;background:rgba(255,255,255,0.05);color:var(--ink);font:inherit">
      <div id="capabilitiesHint" class="panel-subtle">Loading&hellip;</div>
      <div id="capabilitiesList"></div>
    </div>
  `;
  root.dataset.capabilitiesMounted = "1";
}

const RISK_TONE = { normal: "ok", medium: "warn", high: "bad", approval: "warn" };

function renderPluginGroup(plugin) {
  const tools = Array.isArray(plugin.tools) ? plugin.tools : [];
  if (!tools.length) return "";
  return `
    <section class="card" style="margin-bottom:12px">
      <div class="panel-head"><h3 style="margin:0">${h(plugin.pluginName || plugin.id)}</h3><span class="panel-subtle">${tools.length} tool${tools.length === 1 ? "" : "s"}</span></div>
      <div style="display:grid;gap:8px">
        ${tools.map((tool) => `
          <article style="border:1px solid var(--border);border-radius:10px;padding:10px;background:var(--panel)">
            <strong>${h(tool.name)}</strong>
            <span class="badge tone-${RISK_TONE[tool.risk] || "ok"}" style="margin-left:6px;font-size:0.72em;padding:0.1rem 0.5rem;border-radius:999px;border:1px solid var(--border)">${h(tool.risk || "normal")}</span>
            ${tool.description ? `<div class="panel-subtle" style="margin-top:4px">${h(tool.description)}</div>` : ""}
            ${Array.isArray(tool.scopes) && tool.scopes.length ? `<div class="panel-subtle" style="margin-top:4px;font-size:0.8em">scopes: ${tool.scopes.map(h).join(", ")}</div>` : ""}
          </article>
        `).join("")}
      </div>
    </section>
  `;
}

export async function mountPluginTab(context = {}) {
  const root = context?.root;
  if (!(root instanceof HTMLElement)) return;

  const fetchImpl = context?.pluginAdminFetch || context?.observerApp?.pluginAdminFetch || fetch;

  ensureMarkup(root);

  const hintEl = root.querySelector("#capabilitiesHint");
  const listEl = root.querySelector("#capabilitiesList");
  const searchEl = root.querySelector("#capabilitiesSearch");
  const refreshBtn = root.querySelector("#capabilitiesRefreshBtn");

  let plugins = [];

  const applyFilter = () => {
    const term = String(searchEl.value || "").trim().toLowerCase();
    const filtered = !term
      ? plugins
      : plugins
          .map((plugin) => ({
            ...plugin,
            tools: (plugin.tools || []).filter((tool) =>
              String(tool.name || "").toLowerCase().includes(term)
              || String(tool.description || "").toLowerCase().includes(term)
              || String(plugin.pluginName || plugin.id || "").toLowerCase().includes(term)
            )
          }))
          .filter((plugin) => plugin.tools.length);
    const totalTools = filtered.reduce((sum, plugin) => sum + (plugin.tools?.length || 0), 0);
    listEl.innerHTML = filtered.length
      ? filtered.map(renderPluginGroup).join("")
      : `<div class="panel-subtle">No tools match "${h(term)}".</div>`;
    hintEl.textContent = `${totalTools} tool${totalTools === 1 ? "" : "s"} across ${filtered.length} plugin${filtered.length === 1 ? "" : "s"}.`;
  };

  const loadAll = async () => {
    hintEl.textContent = "Loading…";
    const response = await fetchImpl("/api/plugins/list");
    const payload = await response.json();
    if (!response.ok || payload.ok === false) {
      throw new Error(payload.error || "failed to load plugins");
    }
    plugins = (Array.isArray(payload.plugins) ? payload.plugins : [])
      .filter((plugin) => Array.isArray(plugin.tools) && plugin.tools.length)
      .sort((a, b) => String(a.pluginName || a.id).localeCompare(String(b.pluginName || b.id)));
    applyFilter();
  };

  if (!root.dataset.capabilitiesBound) {
    searchEl.addEventListener("input", applyFilter);
    refreshBtn.addEventListener("click", () => loadAll().catch((e) => (hintEl.textContent = `Failed to load: ${e.message}`)));
    root.dataset.capabilitiesBound = "1";
  }

  try {
    await loadAll();
  } catch (e) {
    hintEl.textContent = `Capabilities unavailable: ${e.message}`;
  }
}
