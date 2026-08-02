import { escapeHtml } from "/plugin-tab-shared.js";

function formatTime(value = 0) {
  const timestamp = Number(value || 0);
  if (!timestamp) return "Never";
  return new Date(timestamp).toLocaleString();
}

async function infoAgentFetch(path = "/api/information-agent/state", options = {}) {
  const response = await fetch(path, options);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.ok === false) {
    throw new Error(payload.error || `request failed (${response.status})`);
  }
  return payload;
}

function renderInterestOptions(select, interests = []) {
  if (!select) return;
  select.innerHTML = interests.length
    ? interests.map((interest) => `<option value="${escapeHtml(interest.id)}">${escapeHtml(interest.name)}</option>`).join("")
    : `<option value="">No interests yet</option>`;
}

function renderInterests(container, interests = [], sources = []) {
  if (!container) return;
  if (!interests.length) {
    container.innerHTML = `<div class="panel-subtle">No interests configured yet.</div>`;
    return;
  }
  container.innerHTML = interests.map((interest) => {
    const ownedSources = sources.filter((source) => source.interestId === interest.id);
    return `
      <article class="card info-agent-item">
        <div class="info-agent-row">
          <div>
            <strong>${escapeHtml(interest.name)}</strong>
            <div class="panel-subtle">${escapeHtml(interest.prompt || "")}</div>
          </div>
          <span class="micro">Priority ${escapeHtml(String(interest.priority || 3))}</span>
        </div>
        <div class="info-agent-tags">
          ${(interest.keywords || []).map((keyword) => `<span>${escapeHtml(keyword)}</span>`).join("")}
        </div>
        <div class="panel-subtle">${ownedSources.length} source${ownedSources.length === 1 ? "" : "s"}</div>
      </article>
    `;
  }).join("");
}

function renderSources(container, sources = [], interests = []) {
  if (!container) return;
  if (!sources.length) {
    container.innerHTML = `<div class="panel-subtle">No sources configured yet.</div>`;
    return;
  }
  const interestNames = new Map(interests.map((entry) => [entry.id, entry.name]));
  container.innerHTML = sources.map((source) => `
    <article class="card info-agent-source">
      <div class="info-agent-row">
        <div>
          <strong>${escapeHtml(source.label)}</strong>
          <div class="panel-subtle">${escapeHtml(interestNames.get(source.interestId) || source.interestId)}</div>
        </div>
        <span class="micro">${escapeHtml(source.type)}</span>
      </div>
      <a href="${escapeHtml(source.url)}" target="_blank" rel="noreferrer">${escapeHtml(source.url)}</a>
      <div class="info-agent-source-meta">
        <span>Every ${escapeHtml(String(source.intervalMinutes || 30))} min</span>
        <span>Last scan: ${escapeHtml(formatTime(source.lastScanAt))}</span>
        ${source.lastError ? `<span class="info-agent-error">${escapeHtml(source.lastError)}</span>` : ""}
      </div>
      <button class="secondary" type="button" data-info-agent-scan-source="${escapeHtml(source.id)}">Scan</button>
    </article>
  `).join("");
}

function renderUpdates(container, updates = []) {
  if (!container) return;
  if (!updates.length) {
    container.innerHTML = `<div class="panel-subtle">No updates yet. Run a scan after adding sources.</div>`;
    return;
  }
  container.innerHTML = updates.map((update) => `
    <article class="card info-agent-update ${update.acknowledged ? "is-acknowledged" : ""}">
      <div class="info-agent-row">
        <div>
          <strong>${escapeHtml(update.title)}</strong>
          <div class="panel-subtle">${escapeHtml(update.sourceLabel || update.sourceType || "source")} - ${escapeHtml(formatTime(update.createdAt))}</div>
        </div>
        <span class="micro">Importance ${escapeHtml(String(update.importance || 1))}</span>
      </div>
      <p>${escapeHtml(update.summary)}</p>
      ${(update.evidence || []).length ? `<ul>${update.evidence.map((entry) => `<li>${escapeHtml(entry)}</li>`).join("")}</ul>` : ""}
      <div class="info-agent-update-actions">
        ${update.sourceUrl ? `<a href="${escapeHtml(update.sourceUrl)}" target="_blank" rel="noreferrer">Open source</a>` : ""}
        <button class="secondary" type="button" data-info-agent-ack-update="${escapeHtml(update.id)}">${update.acknowledged ? "Reopen" : "Acknowledge"}</button>
      </div>
    </article>
  `).join("");
}

export async function mountPluginTab(context = {}) {
  const root = context?.root;
  if (!(root instanceof HTMLElement)) return;

  if (!document.getElementById("informationAgentTabStyles")) {
    const styleEl = document.createElement("style");
    styleEl.id = "informationAgentTabStyles";
    styleEl.textContent = `
      .info-agent-layout { display: grid; grid-template-columns: minmax(280px, 0.9fr) minmax(360px, 1.4fr); gap: 14px; }
      .info-agent-stack { display: grid; gap: 12px; align-content: start; }
      .info-agent-grid { display: grid; gap: 10px; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); }
      .info-agent-row { display: flex; justify-content: space-between; gap: 12px; align-items: flex-start; }
      .info-agent-item, .info-agent-source, .info-agent-update { display: grid; gap: 10px; }
      .info-agent-tags { display: flex; flex-wrap: wrap; gap: 6px; }
      .info-agent-tags span { border: 1px solid var(--border); border-radius: 999px; padding: 3px 8px; font-size: 12px; background: rgba(255,255,255,0.5); }
      .info-agent-source-meta { display: flex; flex-wrap: wrap; gap: 8px; font-size: 12px; color: var(--muted); }
      .info-agent-error { color: #a13d2d; }
      .info-agent-update.is-acknowledged { opacity: 0.68; }
      .info-agent-update p { margin: 0; line-height: 1.45; }
      .info-agent-update ul { margin: 0; padding-left: 18px; color: var(--muted); }
      .info-agent-update-actions { display: flex; justify-content: space-between; gap: 10px; align-items: center; }
      @media (max-width: 900px) { .info-agent-layout { grid-template-columns: 1fr; } }
    `;
    document.head.appendChild(styleEl);
  }

  if (!root.dataset.informationAgentMounted) {
    root.innerHTML = `
      <section class="inspector">
        <div class="panel-head">
          <div>
            <h2>Information Agent</h2>
            <div class="panel-subtle">Continuous web monitoring for the things Nova should care about.</div>
          </div>
          <div class="controls" style="grid-template-columns: repeat(2, minmax(0, 1fr)); margin-bottom: 0;">
            <button id="infoAgentRefreshBtn" class="secondary" type="button">Refresh</button>
            <button id="infoAgentRunScanBtn" type="button">Run Scan</button>
          </div>
        </div>

        <div id="infoAgentHint" class="hint">Loading Information Agent...</div>

        <section class="status-strip">
          <div class="card"><div class="metric-label">Interests</div><div id="infoAgentInterestCount" class="metric-value">0</div></div>
          <div class="card"><div class="metric-label">Sources</div><div id="infoAgentSourceCount" class="metric-value">0</div></div>
          <div class="card"><div class="metric-label">New Updates</div><div id="infoAgentNewCount" class="metric-value">0</div></div>
          <div class="card"><div class="metric-label">Due</div><div id="infoAgentDueCount" class="metric-value">0</div></div>
        </section>

        <div class="info-agent-layout">
          <div class="info-agent-stack">
            <section class="brain-editor-card">
              <div class="panel-head compact"><h3>Tell Nova What Matters</h3></div>
              <div class="info-agent-grid">
                <input id="infoAgentInterestName" placeholder="Interest name" />
                <select id="infoAgentPriority">
                  <option value="3">Priority 3</option>
                  <option value="4">Priority 4</option>
                  <option value="5">Priority 5</option>
                  <option value="2">Priority 2</option>
                  <option value="1">Priority 1</option>
                </select>
              </div>
              <textarea id="infoAgentPrompt" rows="4" placeholder="What changes should Nova watch for?"></textarea>
              <input id="infoAgentKeywords" placeholder="Keywords, comma separated" />
              <button id="infoAgentSaveInterestBtn" type="button">Save Interest</button>
            </section>

            <section class="brain-editor-card">
              <div class="panel-head compact"><h3>Add Source</h3></div>
              <div class="info-agent-grid">
                <select id="infoAgentSourceInterest"></select>
                <select id="infoAgentSourceType">
                  <option value="news">News</option>
                  <option value="blog">Blog</option>
                  <option value="social">Social</option>
                  <option value="finance">Finance</option>
                  <option value="shopping">Shopping</option>
                  <option value="web">Web</option>
                </select>
              </div>
              <input id="infoAgentSourceLabel" placeholder="Source label" />
              <input id="infoAgentSourceUrl" placeholder="https://..." />
              <div class="info-agent-grid">
                <input id="infoAgentSourceSelector" placeholder="CSS selector (optional)" />
                <input id="infoAgentInterval" type="number" min="5" step="5" value="30" />
              </div>
              <label class="stack-field"><span><input id="infoAgentUseBrowser" type="checkbox" /> Use browser for dynamic pages</span></label>
              <button id="infoAgentSaveSourceBtn" type="button">Save Source</button>
            </section>

            <section class="brain-editor-card">
              <div class="panel-head compact"><h3>Interests</h3></div>
              <div id="infoAgentInterests" class="info-agent-stack"></div>
            </section>
          </div>

          <div class="info-agent-stack">
            <section class="brain-editor-card">
              <div class="panel-head compact"><h3>Updates</h3></div>
              <div id="infoAgentUpdates" class="info-agent-stack"></div>
            </section>
            <section class="brain-editor-card">
              <div class="panel-head compact"><h3>Sources</h3></div>
              <div id="infoAgentSources" class="info-agent-stack"></div>
            </section>
          </div>
        </div>
      </section>
    `;
    root.dataset.informationAgentMounted = "1";
  }

  const hintEl = root.querySelector("#infoAgentHint");
  const interestCountEl = root.querySelector("#infoAgentInterestCount");
  const sourceCountEl = root.querySelector("#infoAgentSourceCount");
  const newCountEl = root.querySelector("#infoAgentNewCount");
  const dueCountEl = root.querySelector("#infoAgentDueCount");
  const interestsEl = root.querySelector("#infoAgentInterests");
  const sourcesEl = root.querySelector("#infoAgentSources");
  const updatesEl = root.querySelector("#infoAgentUpdates");
  const sourceInterestSelect = root.querySelector("#infoAgentSourceInterest");

  let lastState = null;
  const load = async () => {
    hintEl.textContent = "Loading monitoring state...";
    const state = await infoAgentFetch("/api/information-agent/state");
    lastState = state;
    interestCountEl.textContent = String(state.summary?.interestCount || 0);
    sourceCountEl.textContent = String(state.summary?.sourceCount || 0);
    newCountEl.textContent = String(state.summary?.unacknowledgedCount || 0);
    dueCountEl.textContent = String(state.summary?.dueSourceCount || 0);
    renderInterestOptions(sourceInterestSelect, state.interests || []);
    renderInterests(interestsEl, state.interests || [], state.sources || []);
    renderSources(sourcesEl, state.sources || [], state.interests || []);
    renderUpdates(updatesEl, state.updates || []);
    hintEl.textContent = "Information Agent ready.";
  };

  if (!root.dataset.informationAgentBound) {
    root.querySelector("#infoAgentRefreshBtn")?.addEventListener("click", () => load().catch((error) => {
      hintEl.textContent = `Refresh failed: ${error.message}`;
    }));

    root.querySelector("#infoAgentRunScanBtn")?.addEventListener("click", async () => {
      hintEl.textContent = "Scanning sources...";
      try {
        const result = await infoAgentFetch("/api/information-agent/scan", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ includeNotDue: true, limit: 20, emitBaseline: true })
        });
        hintEl.textContent = `Scan complete: ${result.scannedCount || 0} scanned, ${result.updateCount || 0} update${Number(result.updateCount || 0) === 1 ? "" : "s"}.`;
        await load();
      } catch (error) {
        hintEl.textContent = `Scan failed: ${error.message}`;
      }
    });

    root.querySelector("#infoAgentSaveInterestBtn")?.addEventListener("click", async () => {
      const name = String(root.querySelector("#infoAgentInterestName")?.value || "").trim();
      if (!name) {
        hintEl.textContent = "Interest name is required.";
        return;
      }
      hintEl.textContent = "Saving interest...";
      try {
        await infoAgentFetch("/api/information-agent/interests", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            name,
            prompt: String(root.querySelector("#infoAgentPrompt")?.value || "").trim(),
            keywords: String(root.querySelector("#infoAgentKeywords")?.value || "").trim(),
            priority: Number(root.querySelector("#infoAgentPriority")?.value || 3)
          })
        });
        root.querySelector("#infoAgentInterestName").value = "";
        root.querySelector("#infoAgentPrompt").value = "";
        root.querySelector("#infoAgentKeywords").value = "";
        await load();
      } catch (error) {
        hintEl.textContent = `Save failed: ${error.message}`;
      }
    });

    root.querySelector("#infoAgentSaveSourceBtn")?.addEventListener("click", async () => {
      const interestId = String(root.querySelector("#infoAgentSourceInterest")?.value || "").trim();
      const url = String(root.querySelector("#infoAgentSourceUrl")?.value || "").trim();
      if (!interestId || !url) {
        hintEl.textContent = "Interest and source URL are required.";
        return;
      }
      hintEl.textContent = "Saving source...";
      try {
        await infoAgentFetch("/api/information-agent/sources", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            interestId,
            type: String(root.querySelector("#infoAgentSourceType")?.value || "web").trim(),
            label: String(root.querySelector("#infoAgentSourceLabel")?.value || "").trim(),
            url,
            selector: String(root.querySelector("#infoAgentSourceSelector")?.value || "").trim(),
            intervalMinutes: Number(root.querySelector("#infoAgentInterval")?.value || 30),
            useBrowser: root.querySelector("#infoAgentUseBrowser")?.checked === true
          })
        });
        root.querySelector("#infoAgentSourceLabel").value = "";
        root.querySelector("#infoAgentSourceUrl").value = "";
        root.querySelector("#infoAgentSourceSelector").value = "";
        root.querySelector("#infoAgentUseBrowser").checked = false;
        await load();
      } catch (error) {
        hintEl.textContent = `Source save failed: ${error.message}`;
      }
    });

    sourcesEl?.addEventListener("click", async (event) => {
      const button = event.target instanceof Element ? event.target.closest("[data-info-agent-scan-source]") : null;
      if (!(button instanceof HTMLButtonElement)) return;
      hintEl.textContent = "Scanning source...";
      try {
        await infoAgentFetch("/api/information-agent/scan", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ sourceId: button.dataset.infoAgentScanSource, emitBaseline: true })
        });
        await load();
      } catch (error) {
        hintEl.textContent = `Source scan failed: ${error.message}`;
      }
    });

    updatesEl?.addEventListener("click", async (event) => {
      const button = event.target instanceof Element ? event.target.closest("[data-info-agent-ack-update]") : null;
      if (!(button instanceof HTMLButtonElement)) return;
      const updateId = String(button.dataset.infoAgentAckUpdate || "").trim();
      const current = (lastState?.updates || []).find((entry) => entry.id === updateId);
      try {
        await infoAgentFetch(`/api/information-agent/updates/${encodeURIComponent(updateId)}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ acknowledged: current?.acknowledged !== true })
        });
        await load();
      } catch (error) {
        hintEl.textContent = `Update action failed: ${error.message}`;
      }
    });

    root.dataset.informationAgentBound = "1";
  }

  await load().catch((error) => {
    hintEl.textContent = `Information Agent unavailable: ${error.message}`;
  });
}
