import { escapeHtml as h } from "/plugin-tab-shared.js";

let pluginAdminFetchRef = null;

async function api(path = "", options = {}) {
  const fetcher = pluginAdminFetchRef || fetch;
  const response = await fetcher(path, options);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.ok === false) {
    throw new Error(payload.error || `request failed (${response.status})`);
  }
  return payload;
}

function renderBrainOptions(brains = []) {
  return brains.map((brain) => {
    const details = [
      brain.model,
      brain.kind,
      brain.specialty ? `specialty=${brain.specialty}` : "",
      brain.queueLane ? `lane=${brain.queueLane}` : "",
      brain.toolCapable ? "toolCapable" : "not toolCapable"
    ].filter(Boolean).join(" | ");
    return `<option value="${h(brain.id)}">${h(brain.label || brain.id)} (${h(details)})</option>`;
  }).join("");
}

function renderVariantOptions(variants = []) {
  return variants.map((variant) => `
    <label class="micro brain-tool-check">
      <input type="checkbox" value="${h(variant.id)}" data-brain-tool-variant ${variant.id === "exact_envelope" ? "checked" : ""}>
      <span>${h(variant.label || variant.id)}</span>
    </label>
  `).join("");
}

function renderGradeSummary(summary = {}) {
  const entries = [
    ["strict_pass", "Strict"],
    ["recoverable_pass", "Recovered"],
    ["partial", "Partial"],
    ["fail", "Fail"],
    ["transport_fail", "Transport"]
  ];
  return `
    <div class="brain-tool-grade-row">
      ${entries.map(([key, label]) => `
        <span class="brain-pill">${h(label)} ${Number(summary?.[key] || 0)}</span>
      `).join("")}
    </div>
  `;
}

function renderBreakdown(title = "", summary = {}) {
  const entries = Object.entries(summary || {});
  if (!entries.length) return "";
  return `
    <div class="brain-tool-breakdown">
      <strong>${h(title)}</strong>
      ${entries.map(([key, value]) => {
        const total = Number(value?.total || 0);
        const passed = Number(value?.passed || 0);
        return `<span class="brain-pill">${h(key)} ${passed}/${total}</span>`;
      }).join("")}
    </div>
  `;
}

function renderDiagnosis(diagnosis = null) {
  if (!diagnosis || typeof diagnosis !== "object") return "";
  const issues = Array.isArray(diagnosis.topIssues) ? diagnosis.topIssues : [];
  const actions = Array.isArray(diagnosis.actions) ? diagnosis.actions : [];
  const best = diagnosis.variantPerformance?.best || null;
  const weakest = diagnosis.variantPerformance?.weakest || null;
  return `
    <div class="brain-tool-diagnosis">
      <strong>Diagnosis: ${h(diagnosis.status || "unknown")}</strong>
      ${best ? `<span class="brain-pill">best ${h(best.id)} ${Number(best.passRate || 0).toFixed(3)}</span>` : ""}
      ${weakest ? `<span class="brain-pill">weakest ${h(weakest.id)} ${Number(weakest.passRate || 0).toFixed(3)}</span>` : ""}
      ${issues.length ? `<div class="micro brain-tool-guidance">${issues.slice(0, 3).map((issue) => `<div><b>${h(issue.code)}</b> ${h(issue.guidance || "")}</div>`).join("")}</div>` : ""}
      ${actions.length ? `<ul class="micro brain-tool-guidance">${actions.map((action) => `<li>${h(action)}</li>`).join("")}</ul>` : ""}
    </div>
  `;
}

function renderHistory(history = [], trend = null) {
  if (!Array.isArray(history) || !history.length) {
    return `<section class="brain-tool-card"><div class="panel-subtle">No saved workout history for this brain yet.</div></section>`;
  }
  const trendText = trend && trend.sampleCount
    ? [
      `trend=${trend.direction || "unknown"}`,
      trend.delta == null ? "" : `delta=${Number(trend.delta || 0) >= 0 ? "+" : ""}${Number(trend.delta || 0).toFixed(3)}`,
      `avg5=${Number(trend.recentAverage || 0).toFixed(3)}`,
      `pass streak=${Number(trend.passStreak || 0)}`
    ].filter(Boolean).join(" | ")
    : "";
  return `
    <section class="brain-tool-card">
      <div class="panel-head compact">
        <div>
          <h3>Recent Workouts</h3>
          <div class="panel-subtle">${h(trendText || "Latest saved tool-envelope scores for the selected brain.")}</div>
        </div>
      </div>
      <div class="brain-tool-history-list">
        ${history.map((record) => {
          const date = record.completedAt ? new Date(Number(record.completedAt)).toLocaleString() : "unknown time";
          const statusClass = record.passed ? "tone-ok" : "tone-warn";
          const issueEntries = Object.entries(record.issueSummary || {}).slice(0, 4);
          return `
            <div class="brain-tool-history-row">
              <div>
                <strong>${h(date)}</strong>
                <div class="panel-subtle">${h([
                  `${Number(record.passedCount || 0)}/${Number(record.totalCount || 0)} passed`,
                  `score=${Number(record.weightedScore || 0).toFixed(3)}`,
                  record.recommendation || ""
                ].filter(Boolean).join(" | "))}</div>
                ${issueEntries.length ? `<div class="brain-tool-breakdown">${issueEntries.map(([key, value]) => `<span class="brain-pill">${h(key)} ${h(String(value))}</span>`).join("")}</div>` : ""}
              </div>
              <span class="brain-pill ${statusClass}">${record.passed ? "PASS" : "CHECK"}</span>
            </div>
          `;
        }).join("")}
      </div>
    </section>
  `;
}

function renderReadiness(readiness = []) {
  if (!Array.isArray(readiness) || !readiness.length) {
    return `<section class="brain-tool-card"><div class="panel-subtle">No brain readiness history yet.</div></section>`;
  }
  return `
    <section class="brain-tool-card">
      <div class="panel-head compact">
        <div>
          <h3>Brain Readiness</h3>
          <div class="panel-subtle">Latest saved tool-workout evidence by brain.</div>
        </div>
      </div>
      <div class="brain-tool-readiness-list">
        ${readiness.map((entry) => {
          const latest = entry.latest || {};
          const status = String(entry.readiness?.status || "no_data");
          const statusClass = status === "ready" ? "tone-ok" : (status === "usable_with_repair" ? "tone-info" : "tone-warn");
          const trend = entry.trend || {};
          return `
            <button type="button" class="brain-tool-readiness-row" data-brain-readiness-id="${h(entry.brain?.id || "")}">
              <div>
                <strong>${h(entry.brain?.label || entry.brain?.id || "Brain")}</strong>
                <div class="panel-subtle">${h([
                  entry.brain?.model || "",
                  latest.totalCount ? `${Number(latest.passedCount || 0)}/${Number(latest.totalCount || 0)} passed` : "no runs",
                  latest.totalCount ? `score=${Number(latest.weightedScore || 0).toFixed(3)}` : "",
                  trend.direction && trend.direction !== "unknown" ? `trend=${trend.direction}` : "",
                  trend.delta == null ? "" : `delta=${Number(trend.delta || 0) >= 0 ? "+" : ""}${Number(trend.delta || 0).toFixed(3)}`
                ].filter(Boolean).join(" | "))}</div>
                <div class="panel-subtle">${h(entry.readiness?.reason || "No readiness reason available.")}</div>
              </div>
              <span class="brain-pill ${statusClass}">${h(status)}</span>
            </button>
          `;
        }).join("")}
      </div>
    </section>
  `;
}

function renderResultSummary(report = null) {
  if (!report) {
    return `<div class="panel-subtle">No workout has been run yet.</div>`;
  }
  const status = report.passed ? "PASS" : "CHECK";
  const statusClass = report.passed ? "tone-ok" : "tone-warn";
  return `
    <section class="brain-tool-card">
      <div class="panel-head compact">
        <div>
          <h3>${h(report.brain?.label || report.brain?.id || "Brain")} <span class="brain-pill ${statusClass}">${status}</span></h3>
          <div class="panel-subtle">${h([
            report.brain?.model || "",
            report.brain?.specialty ? `specialty=${report.brain.specialty}` : "",
            report.brain?.queueLane ? `lane=${report.brain.queueLane}` : "",
            `${report.passedCount || 0}/${(report.results || []).length} passed`,
            `score=${Number(report.weightedScore || 0).toFixed(3)}`,
            `${Math.round(Number(report.durationMs || 0) / 1000)}s`
          ].filter(Boolean).join(" | "))}</div>
          <div class="panel-subtle">Recommendation: ${h(report.recommendation || "needs more samples")}</div>
        </div>
      </div>
      ${renderGradeSummary(report.gradeSummary || {})}
      ${renderBreakdown("By category", report.categorySummary || {})}
      ${renderBreakdown("By variant", report.variantSummary || {})}
      ${Object.keys(report.issueSummary || {}).length ? `<div class="brain-tool-breakdown"><strong>Issue codes</strong>${Object.entries(report.issueSummary || {}).map(([key, value]) => `<span class="brain-pill">${h(key)} ${h(String(value))}</span>`).join("")}</div>` : ""}
      ${renderDiagnosis(report.diagnosis || null)}
      <div class="brain-tool-results">
        ${(report.results || []).map(renderCaseResult).join("")}
      </div>
    </section>
  `;
}

function renderCaseResult(result = {}) {
  const passed = result.passed === true;
  const grade = String(result.grade || (passed ? "strict_pass" : "fail"));
  const statusClass = grade === "strict_pass" ? "tone-ok" : (grade === "recoverable_pass" ? "tone-info" : "tone-warn");
  const failures = Array.isArray(result.failures) ? result.failures : [];
  const calls = Array.isArray(result.toolCalls) ? result.toolCalls : [];
  return `
    <section class="brain-tool-case">
      <div class="brain-tool-case-head">
        <div>
          <strong>${h(result.label || result.id || "Case")}</strong>
          <div class="panel-subtle">${h([
            `Expected: ${result.expectedTool || "(unknown)"}`,
            result.variantId ? `variant=${result.variantId}` : "",
            result.category ? `category=${result.category}` : ""
          ].filter(Boolean).join(" | "))}</div>
        </div>
        <span class="brain-pill ${statusClass}">${h(grade)}</span>
      </div>
      ${failures.length ? `<ul class="micro brain-tool-failures">${failures.map((failure) => `<li>${h(failure)}</li>`).join("")}</ul>` : ""}
      ${Array.isArray(result.issueCodes) && result.issueCodes.length ? `<div class="micro"><strong>Issue codes:</strong> ${h(result.issueCodes.join(", "))}</div>` : ""}
      ${Array.isArray(result.warnings) && result.warnings.length ? `<ul class="micro brain-tool-warnings">${result.warnings.map((warning) => `<li>${h(warning)}</li>`).join("")}</ul>` : ""}
      ${calls.length ? `
        <div class="micro"><strong>Tool calls:</strong></div>
        <pre class="json-box brain-tool-raw">${h(JSON.stringify(calls, null, 2))}</pre>
      ` : ""}
      ${result.rawText ? `
        <details>
          <summary class="micro">Raw response</summary>
          <pre class="json-box brain-tool-raw">${h(result.rawText)}</pre>
        </details>
      ` : ""}
      ${result.prompt ? `
        <details>
          <summary class="micro">Prompt</summary>
          <pre class="json-box brain-tool-raw">${h(result.prompt)}</pre>
        </details>
      ` : ""}
    </section>
  `;
}

function ensureStyles() {
  if (document.getElementById("brainToolWorkoutStyles")) {
    return;
  }
  const style = document.createElement("style");
  style.id = "brainToolWorkoutStyles";
  style.textContent = `
    .brain-tool-controls {
      display: grid;
      grid-template-columns: minmax(220px, 1fr) minmax(220px, 0.8fr) auto;
      gap: 10px;
      align-items: end;
    }
    .brain-tool-controls label {
      display: grid;
      gap: 6px;
    }
    .brain-tool-card,
    .brain-tool-case {
      border: 1px solid var(--border);
      border-radius: 8px;
      background: var(--panel);
      padding: 12px;
    }
    .brain-tool-results {
      display: grid;
      gap: 10px;
      margin-top: 12px;
    }
    .brain-tool-history-list {
      display: grid;
      gap: 8px;
      margin-top: 10px;
    }
    .brain-tool-readiness-list {
      display: grid;
      gap: 8px;
      margin-top: 10px;
    }
    .brain-tool-history-row {
      display: flex;
      justify-content: space-between;
      gap: 10px;
      align-items: flex-start;
      border-top: 1px solid var(--border);
      padding-top: 8px;
    }
    .brain-tool-readiness-row {
      display: flex;
      width: 100%;
      justify-content: space-between;
      gap: 10px;
      align-items: flex-start;
      border: 1px solid var(--border);
      border-radius: 6px;
      background: transparent;
      color: inherit;
      text-align: left;
      padding: 8px;
      cursor: pointer;
    }
    .brain-tool-readiness-row:hover {
      background: var(--hover, rgba(127, 127, 127, 0.08));
    }
    .brain-tool-variant-list {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
      align-items: center;
      min-height: 32px;
    }
    .brain-tool-check {
      display: inline-flex;
      gap: 5px;
      align-items: center;
      white-space: nowrap;
    }
    .brain-tool-grade-row {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
      margin-top: 10px;
    }
    .brain-tool-breakdown {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
      align-items: center;
      margin-top: 8px;
      font-size: 0.88rem;
    }
    .brain-tool-diagnosis {
      display: grid;
      gap: 8px;
      margin-top: 10px;
      padding: 10px;
      border: 1px solid var(--border);
      border-radius: 6px;
      background: var(--panel-muted, rgba(127, 127, 127, 0.06));
    }
    .brain-tool-guidance {
      margin: 0;
    }
    .brain-tool-case-head {
      display: flex;
      justify-content: space-between;
      gap: 10px;
      align-items: flex-start;
    }
    .brain-tool-failures {
      margin: 8px 0;
      color: var(--danger, #b42318);
    }
    .brain-tool-warnings {
      margin: 8px 0;
      color: var(--warning, #a16207);
    }
    .brain-tool-raw {
      max-height: 260px;
      overflow: auto;
      white-space: pre-wrap;
      margin-top: 8px;
    }
    @media (max-width: 720px) {
      .brain-tool-controls {
        grid-template-columns: 1fr;
      }
    }
  `;
  document.head.appendChild(style);
}

export async function mountPluginTab(context = {}) {
  const root = context?.root;
  if (!(root instanceof HTMLElement)) {
    return;
  }
  pluginAdminFetchRef = context?.pluginAdminFetch || null;
  ensureStyles();

  if (!root.dataset.brainToolWorkoutMounted) {
    root.innerHTML = `
      <div class="tab-stack">
        <div class="panel-head">
          <div>
            <h2>Brain Tool Workout</h2>
            <div class="panel-subtle">Run harmless strict tool-envelope checks against any configured brain.</div>
          </div>
          <button id="brainToolRefreshBtn" class="secondary" type="button">Refresh brains</button>
        </div>
        <section class="brain-tool-card">
          <div class="brain-tool-controls">
            <label class="micro">
              Brain
              <select id="brainToolBrainSelect"></select>
            </label>
            <label class="micro">
              Variants
              <span id="brainToolVariantList" class="brain-tool-variant-list"></span>
            </label>
            <button id="brainToolRunBtn" type="button">Run workout</button>
          </div>
        </section>
        <div class="hint" id="brainToolHint">Loading brains...</div>
        <div id="brainToolReadiness">${renderReadiness([])}</div>
        <div id="brainToolResults">${renderResultSummary(null)}</div>
        <div id="brainToolHistory">${renderHistory([], null)}</div>
      </div>
    `;
    root.dataset.brainToolWorkoutMounted = "1";
  }

  const selectEl = root.querySelector("#brainToolBrainSelect");
  const variantListEl = root.querySelector("#brainToolVariantList");
  const refreshBtn = root.querySelector("#brainToolRefreshBtn");
  const runBtn = root.querySelector("#brainToolRunBtn");
  const hintEl = root.querySelector("#brainToolHint");
  const readinessEl = root.querySelector("#brainToolReadiness");
  const resultsEl = root.querySelector("#brainToolResults");
  const historyEl = root.querySelector("#brainToolHistory");

  const loadHistory = async () => {
    const brainId = String(selectEl?.value || "").trim();
    if (!brainId) {
      if (historyEl) historyEl.innerHTML = renderHistory([]);
      return;
    }
    try {
      const payload = await api(`/api/plugins/developer-tools/brain-tool-workout/history?brainId=${encodeURIComponent(brainId)}&limit=8`);
      if (historyEl) historyEl.innerHTML = renderHistory(Array.isArray(payload.history) ? payload.history : [], payload.trend || null);
    } catch (error) {
      if (historyEl) historyEl.innerHTML = `<section class="brain-tool-card"><div class="panel-subtle">History unavailable: ${h(error.message)}</div></section>`;
    }
  };

  const loadReadiness = async () => {
    try {
      const payload = await api("/api/plugins/developer-tools/brain-tool-workout/readiness");
      if (readinessEl) {
        readinessEl.innerHTML = renderReadiness(Array.isArray(payload.readiness) ? payload.readiness : []);
        readinessEl.querySelectorAll("[data-brain-readiness-id]").forEach((button) => {
          button.addEventListener("click", () => {
            const brainId = String(button.getAttribute("data-brain-readiness-id") || "").trim();
            if (selectEl && brainId) {
              selectEl.value = brainId;
              loadHistory().catch(() => {});
            }
          });
        });
      }
    } catch (error) {
      if (readinessEl) readinessEl.innerHTML = `<section class="brain-tool-card"><div class="panel-subtle">Readiness unavailable: ${h(error.message)}</div></section>`;
    }
  };

  const loadBrains = async () => {
    if (hintEl) hintEl.textContent = "Loading brains...";
    const [brainPayload, casePayload] = await Promise.all([
      api("/api/plugins/developer-tools/brain-tool-workout/brains"),
      api("/api/plugins/developer-tools/brain-tool-workout/cases")
    ]);
    const brains = Array.isArray(brainPayload.brains) ? brainPayload.brains : [];
    const variants = Array.isArray(casePayload.variants) ? casePayload.variants : [];
    if (selectEl) {
      const previous = selectEl.value;
      selectEl.innerHTML = renderBrainOptions(brains);
      if (previous && brains.some((brain) => brain.id === previous)) {
        selectEl.value = previous;
      }
    }
    if (variantListEl && !variantListEl.dataset.loaded) {
      variantListEl.innerHTML = renderVariantOptions(variants);
      variantListEl.dataset.loaded = "1";
    }
    if (hintEl) {
      hintEl.textContent = brains.length
        ? `Loaded ${brains.length} brain${brains.length === 1 ? "" : "s"}.`
        : "No brains are available.";
    }
    await loadReadiness();
    await loadHistory();
  };

  const runWorkout = async () => {
    const brainId = String(selectEl?.value || "").trim();
    if (!brainId) {
      if (hintEl) hintEl.textContent = "Choose a brain first.";
      return;
    }
    const variantIds = [...root.querySelectorAll("[data-brain-tool-variant]:checked")]
      .map((input) => String(input.value || "").trim())
      .filter(Boolean);
    if (runBtn) runBtn.disabled = true;
    if (hintEl) hintEl.textContent = `Running tool workout for ${brainId}...`;
    if (resultsEl) resultsEl.innerHTML = `<div class="panel-subtle">Running workout...</div>`;
    try {
      const report = await api("/api/plugins/developer-tools/brain-tool-workout/run", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ brainId, variantIds })
      });
      if (hintEl) {
        hintEl.textContent = report.passed
          ? `Workout passed for ${report.brain?.label || brainId}.`
          : `Workout found ${report.failedCount || 0} failing case${Number(report.failedCount || 0) === 1 ? "" : "s"} for ${report.brain?.label || brainId}.`;
      }
      if (resultsEl) resultsEl.innerHTML = renderResultSummary(report);
      await loadReadiness();
      await loadHistory();
    } catch (error) {
      if (hintEl) hintEl.textContent = `Workout failed: ${error.message}`;
      if (resultsEl) resultsEl.innerHTML = `<div class="panel-subtle">Workout failed: ${h(error.message)}</div>`;
    } finally {
      if (runBtn) runBtn.disabled = false;
    }
  };

  if (refreshBtn && !refreshBtn.dataset.bound) {
    refreshBtn.addEventListener("click", () => {
      loadBrains().catch((error) => {
        if (hintEl) hintEl.textContent = `Failed to load brains: ${error.message}`;
      });
    });
    refreshBtn.dataset.bound = "1";
  }
  if (runBtn && !runBtn.dataset.bound) {
    runBtn.addEventListener("click", () => {
      runWorkout().catch(() => {});
    });
    runBtn.dataset.bound = "1";
  }
  if (selectEl && !selectEl.dataset.historyBound) {
    selectEl.addEventListener("change", () => {
      loadHistory().catch(() => {});
    });
    selectEl.dataset.historyBound = "1";
  }

  await loadBrains().catch((error) => {
    if (hintEl) hintEl.textContent = `Failed to load brains: ${error.message}`;
  });
}
