import { escapeHtml as h } from "/plugin-tab-shared.js";

async function api(path = "", options = {}) {
  const response = await fetch(path, options);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.ok === false) {
    throw new Error(payload.error || `request failed (${response.status})`);
  }
  return payload;
}

function renderEntries(target = null, entries = []) {
  if (!(target instanceof HTMLElement)) {
    return;
  }
  if (!Array.isArray(entries) || !entries.length) {
    target.innerHTML = `<div class="panel-subtle">No prompt entries are available.</div>`;
    return;
  }
  target.innerHTML = entries.map((entry) => `
    <section class="prompt-review-card">
      <div class="panel-head compact">
        <div>
          <h3>${h(String(entry.label || entry.id || "Prompt"))}</h3>
          <div class="panel-subtle">${h([
            String(entry.kind || "").trim(),
            String(entry.model || "").trim(),
            String(entry.specialty || "").trim() ? `specialty=${String(entry.specialty || "").trim()}` : "",
            String(entry.queueLane || "").trim() ? `lane=${String(entry.queueLane || "").trim()}` : ""
          ].filter(Boolean).join(" | "))}</div>
        </div>
      </div>
      <div class="micro"><strong>Scenario:</strong> ${h(String(entry.scenario || "Review sample"))}</div>
      <div class="micro"><strong>Sample message:</strong> ${h(String(entry.sampleMessage || "(none)"))}</div>
      <pre class="json-box prompt-review-text">${h(String(entry.prompt || ""))}</pre>
    </section>
  `).join("");
}

function ensurePromptReviewStyles() {
  if (document.getElementById("promptReviewPluginStyles")) {
    return;
  }
  const style = document.createElement("style");
  style.id = "promptReviewPluginStyles";
  style.textContent = `
    .prompt-review-list {
      display: grid;
      gap: 14px;
    }
    .prompt-review-card {
      border: 1px solid var(--border);
      border-radius: 14px;
      background: var(--panel);
      padding: 14px;
    }
    .prompt-review-text {
      margin-top: 10px;
      max-height: 480px;
      overflow: auto;
      white-space: pre-wrap;
    }
  `;
  document.head.appendChild(style);
}

export async function mountPluginTab(context = {}) {
  const root = context?.root;
  if (!(root instanceof HTMLElement)) {
    return;
  }
  ensurePromptReviewStyles();

  if (!root.dataset.promptReviewMounted) {
    root.innerHTML = `
      <div class="tab-stack">
        <div class="panel-head">
          <div>
            <h2>Prompt Review</h2>
            <div class="panel-subtle">Live constructed instruction sets for intake and worker brains.</div>
          </div>
          <button id="promptReviewPluginRefreshBtn" class="secondary" type="button">Refresh prompts</button>
        </div>
        <div class="hint" id="promptReviewPluginHint">Loading prompt review...</div>
        <div id="promptReviewPluginList" class="prompt-review-list">
          <div class="panel-subtle">Loading prompt review...</div>
        </div>
      </div>
    `;
    root.dataset.promptReviewMounted = "1";
  }

  const hintEl = root.querySelector("#promptReviewPluginHint");
  const listEl = root.querySelector("#promptReviewPluginList");
  const refreshBtn = root.querySelector("#promptReviewPluginRefreshBtn");

  const load = async () => {
    if (hintEl) {
      hintEl.textContent = "Loading prompt review...";
    }
    if (listEl) {
      listEl.innerHTML = `<div class="panel-subtle">Loading prompt review...</div>`;
    }
    try {
      const payload = await api("/api/prompts/review");
      const entries = Array.isArray(payload?.entries) ? payload.entries : [];
      if (hintEl) {
        hintEl.textContent = entries.length
          ? `Showing ${entries.length} live prompt set${entries.length === 1 ? "" : "s"}.`
          : "No prompt entries are available.";
      }
      renderEntries(listEl, entries);
    } catch (error) {
      if (hintEl) {
        hintEl.textContent = `Prompt review failed: ${error.message}`;
      }
      if (listEl) {
        listEl.innerHTML = `<div class="panel-subtle">Prompt review failed: ${h(error.message)}</div>`;
      }
    }
  };

  if (refreshBtn && !refreshBtn.dataset.bound) {
    refreshBtn.addEventListener("click", () => {
      load().catch(() => {});
    });
    refreshBtn.dataset.bound = "1";
  }

  await load();
}
