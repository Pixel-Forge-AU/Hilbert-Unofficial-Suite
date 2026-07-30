import { escapeHtml as h } from "/plugin-tab-shared.js";

let governanceRoot = null;
let observerAppRef = {};
let activeTaskId = "";
let refreshTimer = null;

async function fetchJson(url = "", options = undefined) {
  const response = await fetch(url, options);
  const payload = await response.json();
  if (!response.ok || payload.ok === false) {
    throw new Error(payload.error || "request failed");
  }
  return payload;
}

function ensureMarkup(root = governanceRoot) {
  if (!(root instanceof HTMLElement) || root.dataset.governanceMounted === "1") {
    return;
  }
  root.innerHTML = `
    <section class="inspector">
      <div class="panel-head">
        <div>
          <h2>Governance Surface</h2>
          <div class="panel-subtle">ORCH, GOV, MEM, and MIRROR make each run inspectable instead of implicit.</div>
        </div>
        <div class="brain-row-actions">
          <button type="button" class="secondary" data-governance-refresh>Refresh</button>
        </div>
      </div>
      <div data-governance-summary class="stack-list"></div>
      <div class="split-layout" style="display:grid;grid-template-columns:minmax(280px, 380px) 1fr;gap:16px;align-items:start;">
        <div class="brain-editor-card">
          <div class="panel-head compact">
            <div>
              <h3>Runs</h3>
              <div class="panel-subtle" data-governance-run-count>Loading...</div>
            </div>
          </div>
          <div data-governance-runs class="stack-list"></div>
        </div>
        <div class="brain-editor-card">
          <div class="panel-head compact">
            <div>
              <h3>Inspection</h3>
              <div class="panel-subtle" data-governance-selected>Choose a run to inspect.</div>
            </div>
          </div>
          <div data-governance-detail class="stack-list"></div>
        </div>
      </div>
    </section>
  `;
  root.dataset.governanceMounted = "1";
}

function getElements(root = governanceRoot) {
  if (!(root instanceof HTMLElement)) {
    return {};
  }
  return {
    summaryEl: root.querySelector("[data-governance-summary]"),
    runsEl: root.querySelector("[data-governance-runs]"),
    detailEl: root.querySelector("[data-governance-detail]"),
    selectedEl: root.querySelector("[data-governance-selected]"),
    runCountEl: root.querySelector("[data-governance-run-count]"),
    refreshBtn: root.querySelector("[data-governance-refresh]")
  };
}

function renderSummary(summary = {}) {
  const { summaryEl } = getElements();
  if (!(summaryEl instanceof HTMLElement)) {
    return;
  }
  const planeCoverage = summary?.planeCoverage && typeof summary.planeCoverage === "object"
    ? summary.planeCoverage
    : {};
  const policySurface = summary?.policySurface && typeof summary.policySurface === "object"
    ? summary.policySurface
    : {};
  summaryEl.innerHTML = `
    <div class="brain-row">
      <div class="brain-row-actions">
        <strong>Trusted Surface</strong>
        <span class="brain-pill">${h(String(summary.runCount || 0))} runs</span>
      </div>
      <div class="micro">
        governed ${h(String(summary.governedCount || 0))} | mixed ${h(String(summary.mixedCount || 0))} | improvised ${h(String(summary.improvisedCount || 0))}
      </div>
    </div>
    <div class="brain-row">
      <div class="brain-row-actions">
        <strong>Plane Coverage</strong>
        <span class="brain-pill">ORCH ${h(String(planeCoverage.orch || 0))}</span>
      </div>
      <div class="micro">GOV ${h(String(planeCoverage.gov || 0))} | MEM ${h(String(planeCoverage.mem || 0))} | MIRROR ${h(String(planeCoverage.mirror || 0))}</div>
    </div>
    <div class="brain-row">
      <div class="brain-row-actions">
        <strong>Policy Surface</strong>
        <span class="brain-pill">${policySurface.internetEnabled === false ? "offline" : "internet on"}</span>
      </div>
      <div class="micro">
        mounts ${h(String(policySurface.defaultMountCount || 0))} | queue ${policySurface.queuePaused ? "paused" : "active"}
      </div>
    </div>
  `;
}

function renderRuns(runs = []) {
  const { runsEl, runCountEl } = getElements();
  if (!(runsEl instanceof HTMLElement)) {
    return;
  }
  if (runCountEl) {
    runCountEl.textContent = `${runs.length} recent run${runs.length === 1 ? "" : "s"}.`;
  }
  if (!Array.isArray(runs) || !runs.length) {
    runsEl.innerHTML = `<div class="panel-subtle">No governance runs captured yet.</div>`;
    return;
  }
  if (!activeTaskId) {
    activeTaskId = String(runs[0]?.taskId || "").trim();
  }
  runsEl.innerHTML = runs.map((run) => `
    <button type="button" class="brain-row${String(run.taskId || "") === activeTaskId ? " active" : ""}" data-governance-task-id="${h(run.taskId)}">
      <div class="brain-row-actions">
        <strong>${h(run.label || run.codename || run.taskId)}</strong>
        <span class="brain-pill">${h(run.metrics?.label || "unknown")}</span>
      </div>
      <div class="micro">${h(run.status || "unknown")} | ${h(run.inspect?.governedVsImprovised || "")}</div>
    </button>
  `).join("");
  runsEl.querySelectorAll("[data-governance-task-id]").forEach((button) => {
    button.addEventListener("click", () => {
      activeTaskId = String(button.getAttribute("data-governance-task-id") || "").trim();
      loadRun(activeTaskId).catch(() => {});
    });
  });
}

function renderDetail(run = null) {
  const { detailEl, selectedEl } = getElements();
  if (!(detailEl instanceof HTMLElement)) {
    return;
  }
  if (!run) {
    detailEl.innerHTML = `<div class="panel-subtle">Select a run to inspect ORCH, GOV, MEM, and MIRROR.</div>`;
    if (selectedEl) {
      selectedEl.textContent = "Choose a run to inspect.";
    }
    return;
  }
  if (selectedEl) {
    selectedEl.textContent = `${run.label || run.codename || run.taskId} | ${run.status || "unknown"} | ${run.metrics?.label || "unknown"}`;
  }
  const plane = run.planes || {};
  detailEl.innerHTML = `
    <div class="brain-row">
      <div class="brain-row-actions">
        <strong>ORCH</strong>
        <span class="brain-pill">${h(String((plane.orch?.workflow || []).length))} signals</span>
      </div>
      <div class="micro">${h(run.inspect?.executedWhat || "")}</div>
    </div>
    <div class="brain-row">
      <div class="brain-row-actions">
        <strong>GOV</strong>
        <span class="brain-pill">${h(String((plane.gov?.policyDecisions || []).length))} decisions</span>
      </div>
      <div class="micro">${h(run.inspect?.policyAllowedIt || "")}</div>
    </div>
    <div class="brain-row">
      <div class="brain-row-actions">
        <strong>MEM</strong>
        <span class="brain-pill">${h(String((plane.mem?.contextSources || []).length))} sources</span>
      </div>
      <div class="micro">${h(run.inspect?.memoryShapedIt || "")}</div>
    </div>
    <div class="brain-row">
      <div class="brain-row-actions">
        <strong>MIRROR</strong>
        <span class="brain-pill">${h(String((plane.mirror?.validations || []).length))} checks</span>
      </div>
      <div class="micro">${h(run.inspect?.validatedBeforeAction || "")}</div>
    </div>
    <div class="brain-row">
      <div class="brain-row-actions">
        <strong>Approval Gates</strong>
        <span class="brain-pill">${h(String((plane.gov?.approvals || []).length))} approvals</span>
      </div>
      <div class="micro">${h(run.inspect?.approvalGates || "")}</div>
    </div>
    <div class="brain-row">
      <div class="brain-row-actions">
        <strong>Inspect Afterward</strong>
        <span class="brain-pill">${h(run.metrics?.label || "unknown")}</span>
      </div>
      <div class="micro">${h(run.inspect?.inspectAfterward || "")}</div>
    </div>
  `;
}

async function loadRun(taskId = "") {
  if (!taskId) {
    renderDetail(null);
    return;
  }
  const payload = await fetchJson(`/api/governance/run?taskId=${encodeURIComponent(taskId)}`);
  renderDetail(payload.run || null);
}

async function loadGovernance() {
  const [summaryPayload, runsPayload] = await Promise.all([
    fetchJson("/api/governance/summary"),
    fetchJson("/api/governance/runs?limit=24")
  ]);
  renderSummary(summaryPayload.summary || {});
  renderRuns(runsPayload.runs || []);
  if (activeTaskId) {
    await loadRun(activeTaskId);
  } else if (Array.isArray(runsPayload.runs) && runsPayload.runs[0]?.taskId) {
    activeTaskId = String(runsPayload.runs[0].taskId || "").trim();
    await loadRun(activeTaskId);
  } else {
    renderDetail(null);
  }
}

function bindEvents(root = governanceRoot) {
  if (!(root instanceof HTMLElement) || root.dataset.governanceBound === "1") {
    return;
  }
  const { refreshBtn } = getElements(root);
  refreshBtn?.addEventListener("click", async () => {
    await fetchJson("/api/governance/refresh", {
      method: "POST",
      headers: { "content-type": "application/json" }
    });
    await loadGovernance();
  });
  root.dataset.governanceBound = "1";
}

function startAutoRefresh() {
  clearInterval(refreshTimer);
  refreshTimer = window.setInterval(() => {
    if (!(governanceRoot instanceof HTMLElement) || !governanceRoot.isConnected) {
      return;
    }
    loadGovernance().catch(() => {});
  }, 15000);
}

export async function mountPluginTab(context = {}) {
  const root = context?.root;
  if (!(root instanceof HTMLElement)) {
    return;
  }
  governanceRoot = root;
  observerAppRef = context?.observerApp && typeof context.observerApp === "object"
    ? context.observerApp
    : {};
  ensureMarkup(root);
  bindEvents(root);
  observerAppRef?.loadTaskQueue?.();
  await loadGovernance();
  startAutoRefresh();
}

export async function refreshPluginTab() {
  await loadGovernance();
}
