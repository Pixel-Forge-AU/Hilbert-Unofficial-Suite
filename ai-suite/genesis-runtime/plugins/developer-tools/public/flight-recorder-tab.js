import { escapeHtml as h } from "/plugin-tab-shared.js";

let flightRecorderRoot = null;
let pluginAdminFetchRef = null;
let currentTaskId = "";

function getElements(root = flightRecorderRoot) {
  if (!(root instanceof HTMLElement)) return {};
  return {
    taskIdInput: root.querySelector("#frTaskIdInput"),
    loadBtn: root.querySelector("#frLoadBtn"),
    validateBtn: root.querySelector("#frValidateBtn"),
    recentEvalBtn: root.querySelector("#frRecentEvalBtn"),
    harnessCheckBtn: root.querySelector("#frHarnessCheckBtn"),
    statusEl: root.querySelector("#frStatus"),
    recentEvalEl: root.querySelector("#frRecentEval"),
    packetEl: root.querySelector("#frPacket")
  };
}

function renderStatus(root, message = "", isError = false) {
  const { statusEl } = getElements(root);
  if (!statusEl) return;
  statusEl.textContent = message;
  statusEl.className = isError ? "fr-status fr-status-error" : "fr-status";
}

function formatTs(ts) {
  if (!ts) return "-";
  try {
    return new Date(Number(ts)).toLocaleString();
  } catch {
    return String(ts);
  }
}

function renderTimeline(events) {
  if (!Array.isArray(events) || !events.length) return "<em>No timeline events.</em>";
  return `<table class="fr-table">
    <thead><tr><th>Seq</th><th>Type</th><th>Status</th><th>Time</th></tr></thead>
    <tbody>${events.map((e) => `<tr>
      <td>${h(String(e.eventSeq ?? ""))}</td>
      <td>${h(String(e.type || e.eventType || ""))}</td>
      <td>${h(String(e.status || ""))}</td>
      <td>${h(formatTs(e.at))}</td>
    </tr>`).join("")}</tbody>
  </table>`;
}

function renderProviderHistory(entries) {
  if (!Array.isArray(entries) || !entries.length) return "<em>No provider history.</em>";
  return `<table class="fr-table">
    <thead><tr><th>Step</th><th>Provider</th><th>Model</th><th>Role</th><th>OK</th><th>Time</th></tr></thead>
    <tbody>${entries.map((e) => `<tr>
      <td>${h(String(e.step ?? ""))}</td>
      <td>${h(String(e.provider || ""))}</td>
      <td>${h(String(e.model || ""))}</td>
      <td>${h(String(e.role || ""))}</td>
      <td>${e.ok ? "&#x2713;" : "&#x2717;"}</td>
      <td>${h(formatTs(e.at))}</td>
    </tr>`).join("")}</tbody>
  </table>`;
}

function renderToolSteps(steps) {
  if (!Array.isArray(steps) || !steps.length) return "<em>No tool steps.</em>";
  return `<table class="fr-table">
    <thead><tr><th>Step</th><th>Tool</th><th>OK</th><th>TxID</th><th>Duration</th><th>Time</th></tr></thead>
    <tbody>${steps.map((s) => `<tr>
      <td>${h(String(s.step ?? ""))}</td>
      <td>${h(String(s.name || ""))}</td>
      <td>${s.semanticOk ? "&#x2713;" : "&#x2717;"}</td>
      <td>${h(String(s.transactionId || ""))}</td>
      <td>${h(String(s.durationMs ? `${s.durationMs}ms` : ""))}</td>
      <td>${h(formatTs(s.at))}</td>
    </tr>`).join("")}</tbody>
  </table>`;
}

function renderTransactions(transactions, root) {
  if (!Array.isArray(transactions) || !transactions.length) return "<em>No transactions.</em>";
  return `<table class="fr-table">
    <thead><tr><th>ID</th><th>Op</th><th>Path</th><th>Status</th><th>Risk</th><th>Time</th><th></th></tr></thead>
    <tbody>${transactions.map((t) => `<tr data-txn-id="${h(t.id || "")}">
      <td class="fr-id">${h((t.id || "").slice(0, 20))}</td>
      <td>${h(String(t.operation || ""))}</td>
      <td class="fr-path">${h(String(t.target?.path || ""))}</td>
      <td class="fr-status-cell fr-status-${h(String(t.status || ""))}">${h(String(t.status || ""))}</td>
      <td>${h(String(t.risk?.level || ""))}</td>
      <td>${h(formatTs(t.createdAt))}</td>
      <td>${t.status === "applied" && t.checkpoint?.reversible
        ? `<button class="fr-rollback-btn" data-txn-id="${h(t.id || "")}">Rollback</button>`
        : ""
      }</td>
    </tr>`).join("")}</tbody>
  </table>`;
}

function renderHookTraces(traces) {
  if (!Array.isArray(traces) || !traces.length) return "<em>No hook traces.</em>";
  return `<table class="fr-table">
    <thead><tr><th>Hook</th><th>Plugin</th><th>Effect</th><th>Time</th></tr></thead>
    <tbody>${traces.map((t) => `<tr>
      <td>${h(String(t.hook || ""))}</td>
      <td>${h(String(t.pluginId || ""))}</td>
      <td>${h(String(t.effect || ""))}</td>
      <td>${h(formatTs(t.at))}</td>
    </tr>`).join("")}</tbody>
  </table>`;
}

function renderReadBasis(entries) {
  if (!Array.isArray(entries) || !entries.length) return "<em>No read-basis entries.</em>";
  return `<table class="fr-table">
    <thead><tr><th>Tool Call</th><th>Path</th><th>Scope</th><th>Size</th><th>Source</th><th>Time</th></tr></thead>
    <tbody>${entries.map((e) => `<tr>
      <td class="fr-id">${h(String(e.toolCallId || ""))}</td>
      <td class="fr-path">${h(String(e.path || ""))}</td>
      <td>${h(String(e.scope || ""))}</td>
      <td>${h(e.size ? `${e.size}B` : "")}</td>
      <td>${h(String(e.source || ""))}</td>
      <td>${h(formatTs(e.at))}</td>
    </tr>`).join("")}</tbody>
  </table>`;
}

function renderProviderSummary(summary) {
  if (!summary) return "";
  const cont = summary.continuation || {};
  const outcomeHtml = summary.lastRunOutcome
    ? `<span><b>Last run:</b> ${h(String(summary.lastRunOutcome || ""))}${summary.lastRunStopReason ? ` - ${h(String(summary.lastRunStopReason || ""))}` : ""}</span>`
    : "";
  return `<div class="fr-summary">
    <span><b>Provider:</b> ${h(String(summary.provider || ""))}</span>
    <span><b>Model:</b> ${h(String(summary.model || ""))}</span>
    <span><b>Same-provider resume:</b> ${cont.sameProviderResumeAvailable ? "&#x2713;" : "&#x2717;"}</span>
    <span><b>Cross-provider resume:</b> ${cont.crossProviderResumeAvailable ? "&#x2713;" : "&#x2717;"}</span>
    ${outcomeHtml}
  </div>`;
}

function renderHarnessEval(evalSummary) {
  if (!evalSummary || typeof evalSummary !== "object") return "";
  const prompt = evalSummary.prompt || {};
  const tools = evalSummary.tools || {};
  const signals = Array.isArray(evalSummary.signals) ? evalSummary.signals : [];
  const recommendations = Array.isArray(evalSummary.recommendations) ? evalSummary.recommendations : [];
  const visibleTools = Array.isArray(tools.latestVisibleTools) ? tools.latestVisibleTools : [];
  const failureClasses = tools.failureClasses && typeof tools.failureClasses === "object" ? tools.failureClasses : {};
  const completion = evalSummary.completion && typeof evalSummary.completion === "object" ? evalSummary.completion : {};
  const completionReasons = Array.isArray(completion.rejectionReasons) ? completion.rejectionReasons : [];
  const health = evalSummary.health && typeof evalSummary.health === "object" ? evalSummary.health : {};
  const healthReasons = Array.isArray(health.reasons) ? health.reasons : [];
  const matchedFamilies = Array.isArray(tools.matchedToolFamilies) ? tools.matchedToolFamilies : [];
  return `<div class="fr-eval">
    <div class="fr-eval-grid">
      <span><b>Health:</b> ${h(String(health.status || "unknown"))}</span>
      <span><b>Context reduced:</b> ${prompt.latestContextReduced ? "&#x2713;" : "&#x2717;"}</span>
      <span><b>Prompt chars:</b> ${h(String(prompt.latestPromptChars || 0))}</span>
      <span><b>User request:</b> ${h(String(prompt.latestUserRequestChars || 0))}/${h(String(prompt.latestOriginalUserRequestChars || 0))}</span>
      <span><b>Visible tools:</b> ${h(String(tools.latestVisibleToolCount || visibleTools.length || 0))}</span>
      <span><b>Selector:</b> ${tools.toolSelectionConfident ? "confident" : "uncertain"}${tools.toolSelectionReason ? ` / ${h(String(tools.toolSelectionReason))}` : ""}</span>
      <span><b>Hidden tool hits:</b> ${h(String(tools.hiddenToolViolationCount || 0))}</span>
      <span><b>Read/action OK:</b> ${h(String(tools.readOnlyOkCount || 0))}/${h(String(tools.actionOkCount || 0))}</span>
      <span><b>Completion rejects:</b> ${h(String(completion.policyRejectionCount || 0))}</span>
    </div>
    ${healthReasons.length ? `<div class="fr-eval-line"><b>Health reasons:</b> ${h(healthReasons.join(", "))}</div>` : ""}
    ${matchedFamilies.length ? `<div class="fr-eval-line"><b>Matched tool families:</b> ${h(matchedFamilies.join(", "))}${tools.totalOptionalToolFamilies ? ` (${h(String(tools.optionalToolFamiliesMatched || 0))}/${h(String(tools.totalOptionalToolFamilies))})` : ""}</div>` : ""}
    ${visibleTools.length ? `<div class="fr-eval-line"><b>Visible:</b> ${h(visibleTools.join(", "))}</div>` : ""}
    ${signals.length ? `<div class="fr-eval-line"><b>Signals:</b> ${h(signals.join(", "))}</div>` : ""}
    ${Object.keys(failureClasses).length ? `<div class="fr-eval-line"><b>Failure classes:</b> ${h(JSON.stringify(failureClasses))}</div>` : ""}
    ${completionReasons.length ? `<div class="fr-eval-line"><b>Completion rejection reasons:</b> ${h(completionReasons.join(" | "))}</div>` : ""}
    ${recommendations.length ? `<ul class="fr-eval-recs">${recommendations.map((item) => `<li>${h(item)}</li>`).join("")}</ul>` : ""}
  </div>`;
}

function renderRecentHarnessEval(report, root = flightRecorderRoot) {
  const { recentEvalEl } = getElements(root);
  if (!recentEvalEl) return;
  if (!report || !report.ok) {
    recentEvalEl.innerHTML = "";
    return;
  }
  const totals = report.totals || {};
  const rates = report.rates || {};
  const signalCounts = report.signalCounts || {};
  const recommendations = Array.isArray(report.recommendations) ? report.recommendations : [];
  const backlog = Array.isArray(report.backlog) ? report.backlog : [];
  const health = report.health && typeof report.health === "object" ? report.health : {};
  const healthReasons = Array.isArray(health.reasons) ? health.reasons : [];
  recentEvalEl.innerHTML = `
    <div class="fr-section">
      <h3>Recent Harness Eval</h3>
      <div class="fr-eval">
        <div class="fr-eval-grid">
          <span><b>Health:</b> ${h(String(health.status || "unknown"))}</span>
          <span><b>Tasks:</b> ${h(String(totals.taskCount || 0))}</span>
          <span><b>Context reduced:</b> ${h(`${Math.round(Number(rates.contextReducedTaskRate || 0) * 100)}%`)}</span>
          <span><b>Focused tools:</b> ${h(`${Math.round(Number(rates.focusedToolsRecordedTaskRate || 0) * 100)}%`)}</span>
          <span><b>Selector uncertain:</b> ${h(`${Math.round(Number(rates.toolSelectionUncertainTaskRate || 0) * 100)}%`)}</span>
          <span><b>Workspace progress:</b> ${h(`${Math.round(Number(rates.workspaceProgressTaskRate || 0) * 100)}%`)}</span>
          <span><b>Inspection-heavy:</b> ${h(`${Math.round(Number(rates.inspectionHeavyTaskRate || 0) * 100)}%`)}</span>
          <span><b>Hidden tool hits:</b> ${h(String(totals.hiddenToolViolationCount || 0))}</span>
          <span><b>Completion rejects:</b> ${h(`${totals.completionPolicyRejectionCount || 0} / ${Math.round(Number(rates.completionPolicyRejectionTaskRate || 0) * 100)}%`)}</span>
        </div>
        ${healthReasons.length ? `<div class="fr-eval-line"><b>Health reasons:</b> ${h(healthReasons.join(", "))}</div>` : ""}
        ${Object.keys(signalCounts).length ? `<div class="fr-eval-line"><b>Signals:</b> ${h(JSON.stringify(signalCounts))}</div>` : ""}
        ${Array.isArray(report.tasks) && report.tasks.length ? `<div class="fr-eval-line"><b>Latest completion rejections:</b> ${h(report.tasks.slice(0, 5).flatMap((task) => task.completion?.rejectionReasons || []).slice(0, 3).join(" | ") || "none")}</div>` : ""}
        ${Array.isArray(report.tasks) && report.tasks.length ? `<div class="fr-eval-line"><b>Latest selector reasons:</b> ${h(report.tasks.slice(0, 5).map((task) => task.tools?.toolSelectionReason).filter(Boolean).join(", ") || "none")}</div>` : ""}
        ${backlog.length ? `
          <div class="fr-backlog">
            <b>Improvement Backlog</b>
            ${backlog.slice(0, 5).map((item) => `
              <div class="fr-backlog-item">
                <div><b>${h(String(item.rank || ""))}. ${h(item.title || item.id || "Harness item")}</b> <span>${h(item.severity || "")}</span></div>
                <div>${h(item.evidence || "")}</div>
                <div>${h(item.action || "")}</div>
                ${Array.isArray(item.taskIds) && item.taskIds.length ? `<div class="fr-id">${h(item.taskIds.join(", "))}</div>` : ""}
              </div>
            `).join("")}
          </div>
        ` : ""}
        ${recommendations.length ? `<ul class="fr-eval-recs">${recommendations.map((item) => `<li>${h(item)}</li>`).join("")}</ul>` : ""}
      </div>
    </div>`;
}

function renderHarnessCheckReport(payload, root = flightRecorderRoot) {
  const { recentEvalEl } = getElements(root);
  if (!recentEvalEl) return;
  const report = payload?.report || payload;
  if (!report || typeof report !== "object") {
    recentEvalEl.innerHTML = "";
    return;
  }
  const audit = report.audit || {};
  const totals = report.totals || {};
  const checks = Array.isArray(report.checks) ? report.checks : [];
  const failed = report.failedCheck || null;
  recentEvalEl.innerHTML = `
    <div class="fr-section">
      <h3>Harness Check Report</h3>
      <div class="fr-eval">
        <div class="fr-eval-grid">
          <span><b>Status:</b> ${report.ok ? "PASS" : "FAIL"}</span>
          <span><b>Completed:</b> ${h(formatTs(report.completedAt))}</span>
          <span><b>Duration:</b> ${h(String(report.durationMs || 0))}ms</span>
          <span><b>Checks:</b> ${h(`${totals.passedCount || 0}/${totals.checkCount || checks.length || 0}`)}</span>
          <span><b>Syntax targets:</b> ${h(String(audit.syntaxTargetCount || 0))}</span>
          <span><b>Test targets:</b> ${h(String(audit.testTargetCount || 0))}</span>
          <span><b>Feature tokens:</b> ${h(String(audit.featureTokenCount || 0))}</span>
          <span><b>Audit:</b> ${audit.ok ? "PASS" : "CHECK"}</span>
        </div>
        ${failed ? `<div class="fr-eval-line"><b>Failed check:</b> ${h(failed.command || failed.label || "")}${failed.error ? ` - ${h(failed.error)}` : ""}</div>` : ""}
        ${report.error ? `<div class="fr-eval-line"><b>Error:</b> ${h(report.error)}</div>` : ""}
        ${checks.length ? `<table class="fr-table">
          <thead><tr><th>Check</th><th>OK</th><th>Duration</th><th>Output</th></tr></thead>
          <tbody>${checks.map((check) => `<tr>
            <td>${h(check.command || check.label || "")}</td>
            <td>${check.ok ? "&#x2713;" : "&#x2717;"}</td>
            <td>${h(String(check.durationMs || 0))}ms</td>
            <td>${h(`${check.stdoutChars || 0}/${check.stderrChars || 0}`)}</td>
          </tr>`).join("")}</tbody>
        </table>` : ""}
      </div>
    </div>
  `;
}

function renderHarnessCheckHistory(payload, root = flightRecorderRoot) {
  const { recentEvalEl } = getElements(root);
  if (!recentEvalEl) return;
  const history = Array.isArray(payload?.history) ? payload.history : [];
  const trend = payload?.trend && typeof payload.trend === "object" ? payload.trend : {};
  if (!history.length) {
    recentEvalEl.innerHTML = `<div class="fr-section"><h3>Harness Check History</h3><em>No harness check history yet.</em></div>`;
    return;
  }
  recentEvalEl.innerHTML = `
    <div class="fr-section">
      <h3>Harness Check History</h3>
      <div class="fr-eval">
        <div class="fr-eval-grid">
          <span><b>Status:</b> ${h(String(trend.status || "unknown"))}</span>
          <span><b>Recent pass rate:</b> ${h(`${Math.round(Number(trend.passRate || 0) * 100)}%`)}</span>
          <span><b>Recent samples:</b> ${h(String(trend.recentCount || history.length || 0))}</span>
          <span><b>Total samples:</b> ${h(String(trend.sampleCount || history.length || 0))}</span>
          <span><b>Avg duration:</b> ${h(String(trend.avgDurationMs || 0))}ms</span>
          <span><b>Duration delta:</b> ${trend.durationDeltaMs == null ? "-" : h(`${Number(trend.durationDeltaMs || 0) >= 0 ? "+" : ""}${Number(trend.durationDeltaMs || 0)}ms`)}</span>
          <span><b>Latest:</b> ${trend.latestOk === true ? "PASS" : trend.latestOk === false ? "FAIL" : "unknown"}</span>
        </div>
        ${Array.isArray(trend.reasons) && trend.reasons.length ? `<div class="fr-eval-line"><b>Trend reasons:</b> ${h(trend.reasons.join(", "))}</div>` : ""}
        ${trend.lastFailureCommand ? `<div class="fr-eval-line"><b>Last failure:</b> ${h(trend.lastFailureCommand)}</div>` : ""}
        <table class="fr-table">
          <thead><tr><th>Completed</th><th>OK</th><th>Duration</th><th>Checks</th><th>Audit</th></tr></thead>
          <tbody>${history.map((record) => `
            <tr>
              <td>${h(formatTs(record.completedAt))}</td>
              <td>${record.ok ? "&#x2713;" : "&#x2717;"}</td>
              <td>${h(String(record.durationMs || 0))}ms</td>
              <td>${h(`${record.totals?.passedCount || 0}/${record.totals?.checkCount || 0}`)}</td>
              <td>${h(`${record.audit?.syntaxTargetCount || 0}/${record.audit?.testTargetCount || 0}/${record.audit?.featureTokenCount || 0}`)}</td>
            </tr>
          `).join("")}</tbody>
        </table>
      </div>
    </div>
  `;
}

function renderPacket(packet, root) {
  const { packetEl } = getElements(root);
  if (!packetEl) return;
  if (!packet || !packet.ok) {
    packetEl.innerHTML = `<em>No data.</em>`;
    return;
  }
  const txnHtml = renderTransactions(packet.transactions, root);
  packetEl.innerHTML = `
    <div class="fr-section">
      <h3>Provider Summary</h3>
      ${renderProviderSummary(packet.providerSummary)}
    </div>
    <div class="fr-section">
      <h3>Harness Eval</h3>
      ${renderHarnessEval(packet.harnessEval) || "<em>No harness eval summary.</em>"}
    </div>
    <div class="fr-section">
      <h3>Timeline (${(packet.timeline || []).length})</h3>
      ${renderTimeline(packet.timeline)}
    </div>
    <div class="fr-section">
      <h3>Provider History (${(packet.providerHistory || []).length})</h3>
      ${renderProviderHistory(packet.providerHistory)}
    </div>
    <div class="fr-section">
      <h3>Tool Steps (${(packet.toolSteps || []).length})</h3>
      ${renderToolSteps(packet.toolSteps)}
    </div>
    <div class="fr-section" id="frTransactionSection">
      <h3>Transactions (${(packet.transactions || []).length})</h3>
      ${txnHtml}
    </div>
    <div class="fr-section">
      <h3>Read Basis (${(packet.readBasis || []).length})</h3>
      ${renderReadBasis(packet.readBasis)}
    </div>
    <div class="fr-section">
      <h3>Hook Traces (${(packet.hookTrace || []).length})</h3>
      ${renderHookTraces(packet.hookTrace)}
    </div>
  `;
  packetEl.querySelectorAll(".fr-rollback-btn").forEach((btn) => {
    btn.addEventListener("click", () => handleRollback(btn.dataset.txnId, root));
  });
}

async function handleRollback(transactionId, root) {
  if (!transactionId || !pluginAdminFetchRef) return;
  if (!confirm(`Roll back transaction ${transactionId}?`)) return;
  renderStatus(root, "Rolling back...");
  try {
    const result = await pluginAdminFetchRef(`/api/tasks/transactions/${encodeURIComponent(transactionId)}/rollback`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ force: false })
    });
    const data = await result.json();
    if (data.ok) {
      renderStatus(root, `Rolled back ${transactionId}`);
      if (currentTaskId) await loadPacket(currentTaskId, root);
    } else {
      renderStatus(root, `Rollback failed: ${data.error || "unknown"}`, true);
    }
  } catch (error) {
    renderStatus(root, `Rollback error: ${error.message}`, true);
  }
}

async function loadPacket(taskId, root) {
  if (!taskId || !pluginAdminFetchRef) return;
  renderStatus(root, "Loading...");
  const { packetEl, validateBtn } = getElements(root);
  if (packetEl) packetEl.innerHTML = "";
  if (validateBtn) validateBtn.disabled = true;
  try {
    const result = await pluginAdminFetchRef(`/api/plugins/developer-tools/task-debug?taskId=${encodeURIComponent(taskId)}&limit=80`);
    const data = await result.json();
    renderPacket(data, root);
    renderStatus(root, data.ok ? `Loaded task ${taskId}` : `Error: ${data.error || "unknown"}`);
    if (validateBtn && data.ok) validateBtn.disabled = false;
  } catch (error) {
    renderStatus(root, `Load error: ${error.message}`, true);
  }
}

async function handleValidate(root) {
  if (!currentTaskId || !pluginAdminFetchRef) return;
  renderStatus(root, "Validating provider history...");
  try {
    const result = await pluginAdminFetchRef(`/api/tasks/provider-history/validate?taskId=${encodeURIComponent(currentTaskId)}`);
    const data = await result.json();
    if (data.ok) {
      renderStatus(root, `Provider history OK - ${data.providerRecordCount} provider records, ${data.toolStepCount} tool steps.`);
    } else {
      renderStatus(root, `Validation failures (${data.failureCount}): ${(data.failures || []).slice(0, 3).join("; ")}`, true);
    }
  } catch (error) {
    renderStatus(root, `Validate error: ${error.message}`, true);
  }
}

async function loadRecentHarnessEval(root) {
  if (!pluginAdminFetchRef) return;
  renderStatus(root, "Loading recent harness eval...");
  try {
    const result = await pluginAdminFetchRef("/api/plugins/developer-tools/harness-eval/recent?limit=40&perTaskLimit=80");
    const data = await result.json();
    renderRecentHarnessEval(data, root);
    renderStatus(root, data.ok ? `Loaded recent harness eval for ${data.totals?.taskCount || 0} task(s).` : `Error: ${data.error || "unknown"}`, !data.ok);
  } catch (error) {
    renderStatus(root, `Harness eval error: ${error.message}`, true);
  }
}

async function loadHarnessCheckReport(root) {
  if (!pluginAdminFetchRef) return;
  renderStatus(root, "Loading harness check report...");
  try {
    const [lastRunResult, historyResult] = await Promise.all([
      pluginAdminFetchRef("/api/plugins/developer-tools/harness-check/last-run"),
      pluginAdminFetchRef("/api/plugins/developer-tools/harness-check/history?limit=12")
    ]);
    const data = await lastRunResult.json();
    const historyData = await historyResult.json();
    if (data.ok) {
      renderHarnessCheckReport(data, root);
      if (historyData.ok && Array.isArray(historyData.history) && historyData.history.length) {
        const { recentEvalEl } = getElements(root);
        const existing = recentEvalEl?.innerHTML || "";
        renderHarnessCheckHistory(historyData, root);
        if (recentEvalEl) recentEvalEl.innerHTML = `${existing}${recentEvalEl.innerHTML}`;
      }
    } else {
      renderHarnessCheckHistory(historyData, root);
    }
    renderStatus(root, data.ok ? `Loaded harness check report (${data.report?.totals?.passedCount || 0}/${data.report?.totals?.checkCount || 0} checks).` : `Error: ${data.error || "unknown"}`, !data.ok);
  } catch (error) {
    renderStatus(root, `Harness check report error: ${error.message}`, true);
  }
}

function ensureMarkup(root = flightRecorderRoot) {
  if (!(root instanceof HTMLElement) || root.dataset.frMounted === "1") return;
  root.dataset.frMounted = "1";
  root.innerHTML = `
    <style>
      .fr-controls { display: flex; gap: 8px; align-items: center; padding: 12px 0; flex-wrap: wrap; }
      .fr-controls input { flex: 1; min-width: 200px; }
      .fr-status { padding: 4px 0; font-size: 0.85em; color: var(--text-muted, #888); min-height: 1.4em; }
      .fr-status-error { color: var(--danger, #c33); }
      .fr-summary { display: flex; gap: 16px; flex-wrap: wrap; padding: 6px 0; font-size: 0.9em; }
      .fr-eval { padding: 8px 0; font-size: 0.88em; }
      .fr-eval-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 6px 12px; margin-bottom: 8px; }
      .fr-eval-line { margin: 4px 0; word-break: break-word; }
      .fr-eval-recs { margin: 6px 0 0; padding-left: 20px; }
      .fr-backlog { display: grid; gap: 8px; margin-top: 10px; }
      .fr-backlog-item { border: 1px solid var(--border, #333); border-radius: 6px; padding: 8px; display: grid; gap: 4px; }
      .fr-section { margin-bottom: 20px; }
      .fr-section h3 { margin: 0 0 6px; font-size: 0.95em; color: var(--text-muted, #888); text-transform: uppercase; letter-spacing: 0.05em; }
      .fr-table { width: 100%; border-collapse: collapse; font-size: 0.85em; }
      .fr-table th, .fr-table td { text-align: left; padding: 4px 6px; border-bottom: 1px solid var(--border, #333); }
      .fr-table th { font-weight: 600; color: var(--text-muted, #888); }
      .fr-id, .fr-path { font-family: monospace; font-size: 0.8em; max-width: 200px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .fr-status-applied { color: var(--success, #4a4); }
      .fr-status-failed, .fr-status-rollback_failed { color: var(--danger, #c33); }
      .fr-status-rolled_back { color: var(--text-muted, #888); }
      .fr-rollback-btn { font-size: 0.8em; padding: 2px 8px; cursor: pointer; }
    </style>
    <div class="inspector">
      <div class="panel-head">
        <div>
          <h2>Flight Recorder</h2>
          <div class="panel-subtle">Inspect provider history, tool steps, transactions, and hook traces for a task.</div>
        </div>
      </div>
      <div class="fr-controls">
        <input id="frTaskIdInput" type="text" placeholder="Task ID (e.g. task-...)" />
        <button id="frLoadBtn" disabled>Load</button>
        <button id="frValidateBtn" disabled>Validate History</button>
        <button id="frRecentEvalBtn">Recent Harness Eval</button>
        <button id="frHarnessCheckBtn">Harness Check Report</button>
      </div>
      <div id="frStatus" class="fr-status"></div>
      <div id="frRecentEval"></div>
      <div id="frPacket"></div>
    </div>
  `;
  const { taskIdInput, loadBtn, validateBtn, recentEvalBtn, harnessCheckBtn } = getElements(root);
  if (taskIdInput) {
    taskIdInput.addEventListener("input", () => {
      currentTaskId = taskIdInput.value.trim();
      if (loadBtn) loadBtn.disabled = !currentTaskId;
      if (!currentTaskId && validateBtn) validateBtn.disabled = true;
    });
    taskIdInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") loadBtn?.click();
    });
  }
  if (loadBtn) {
    loadBtn.addEventListener("click", () => {
      if (currentTaskId) loadPacket(currentTaskId, root);
    });
  }
  if (validateBtn) {
    validateBtn.addEventListener("click", () => handleValidate(root));
  }
  if (recentEvalBtn) {
    recentEvalBtn.addEventListener("click", () => loadRecentHarnessEval(root));
  }
  if (harnessCheckBtn) {
    harnessCheckBtn.addEventListener("click", () => loadHarnessCheckReport(root));
  }
}

export async function mountPluginTab(context = {}) {
  const root = context?.root;
  if (!(root instanceof HTMLElement)) return;
  if (flightRecorderRoot !== root) {
    currentTaskId = "";
  }
  flightRecorderRoot = root;
  pluginAdminFetchRef = context?.pluginAdminFetch || null;
  ensureMarkup(root);
}
