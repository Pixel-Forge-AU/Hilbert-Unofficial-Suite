import { escapeHtml } from "/plugin-tab-shared.js";

function formatAmount(amount = 0, currency = "USD") {
  return `${String(currency || "USD").toUpperCase()} ${Number(amount || 0).toFixed(2)}`;
}

function statusBadge(status = "") {
  const map = {
    completed: "status-ok",
    rejected: "status-warn",
    failed: "status-error",
    pending: "status-pending"
  };
  return `<span class="badge ${map[status] || ""}">${escapeHtml(status)}</span>`;
}

async function fetchPayments(path = "/api/payments/policy", options = {}) {
  const response = await fetch(path, options);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.ok === false) {
    throw new Error(payload.error || `request failed (${response.status})`);
  }
  return payload;
}

function setSubtab(root, tabId = "transactions") {
  const nextId = String(tabId || "transactions").trim();
  root.dataset.paymentsActiveTab = nextId;
  root.querySelectorAll("[data-payments-subtab-target]").forEach((btn) => {
    btn.classList.toggle("active", btn.getAttribute("data-payments-subtab-target") === nextId);
  });
  root.querySelectorAll("[data-payments-subtab-panel]").forEach((panel) => {
    panel.classList.toggle("active", panel.getAttribute("data-payments-subtab-panel") === nextId);
  });
}

function renderTransactions(container, transactions = [], currency = "USD") {
  if (!container) return;
  if (!transactions.length) {
    container.innerHTML = `<div class="panel-subtle">No transactions recorded yet.</div>`;
    return;
  }
  container.innerHTML = transactions.map((tx) => {
    const date = tx.createdAt ? new Date(tx.createdAt).toLocaleString() : "—";
    const vendor = escapeHtml(tx.vendor || tx.vendorRef || "unknown");
    const desc = escapeHtml(tx.description || "");
    const policySnap = tx.policySnapshot || {};
    const rejectionReason = tx.rejectionReason ? `<div class="payments-rejection-reason">Reason: ${escapeHtml(tx.rejectionReason)}</div>` : "";
    const processorRef = tx.processorRef ? `<span class="payments-proc-ref">ref: ${escapeHtml(tx.processorRef)}</span>` : "";
    return `
      <article class="payments-tx card" data-tx-id="${escapeHtml(tx.id)}">
        <div class="payments-tx-header">
          <span class="payments-tx-amount">${escapeHtml(formatAmount(tx.amount, tx.currency || currency))}</span>
          <span class="payments-tx-vendor">${vendor}</span>
          ${statusBadge(tx.status)}
          ${processorRef}
        </div>
        ${desc ? `<div class="payments-tx-desc">${desc}</div>` : ""}
        ${rejectionReason}
        <div class="payments-tx-meta">
          <span class="payments-tx-id">${escapeHtml(tx.id)}</span>
          <span class="payments-tx-date">${date}</span>
          ${tx.source ? `<span class="payments-tx-source">via ${escapeHtml(tx.source)}</span>` : ""}
          ${tx.approvalOverride ? `<span class="badge status-warn">approval-override</span>` : ""}
        </div>
      </article>`;
  }).join("");
}

function renderPolicy(form, policy = {}, dailySpend = 0) {
  if (!form) return;
  const remaining = Math.max(0, Number(policy.dailyBudgetCap || 0) - dailySpend);
  const pct = policy.dailyBudgetCap > 0
    ? Math.min(100, Math.round((dailySpend / policy.dailyBudgetCap) * 100))
    : 0;
  const barColor = pct >= 90 ? "#e74c3c" : pct >= 60 ? "#e67e22" : "#2ecc71";

  const vendorList = Array.isArray(policy.vendorAllowlist) ? policy.vendorAllowlist.join("\n") : "";

  form.innerHTML = `
    <div class="payments-budget-bar-wrap">
      <div class="payments-budget-label">
        Daily spend: <strong>${formatAmount(dailySpend, policy.currency)}</strong> of
        <strong>${formatAmount(policy.dailyBudgetCap || 0, policy.currency)}</strong>
        (${formatAmount(remaining, policy.currency)} remaining)
      </div>
      <div class="payments-budget-bar" style="background:#2a2a2a;border-radius:4px;height:8px;margin:6px 0 14px;">
        <div style="width:${pct}%;height:100%;background:${barColor};border-radius:4px;transition:width .3s;"></div>
      </div>
    </div>
    <label class="stack-field">
      <strong>Payments enabled</strong>
      <input type="checkbox" id="payments-policy-enabled" ${policy.enabled ? "checked" : ""} />
    </label>
    <label class="stack-field">
      <strong>Daily budget cap (${escapeHtml(policy.currency || "USD")})</strong>
      <input type="number" id="payments-policy-daily" min="0" step="1" value="${escapeHtml(String(policy.dailyBudgetCap ?? 500))}" />
    </label>
    <label class="stack-field">
      <strong>Per-transaction cap (${escapeHtml(policy.currency || "USD")})</strong>
      <input type="number" id="payments-policy-tx-cap" min="0" step="1" value="${escapeHtml(String(policy.transactionCap ?? 100))}" />
    </label>
    <label class="stack-field">
      <strong>Require approval above (${escapeHtml(policy.currency || "USD")})</strong>
      <input type="number" id="payments-policy-approval" min="0" step="1" value="${escapeHtml(String(policy.requireApprovalAbove ?? 50))}" />
    </label>
    <label class="stack-field">
      <strong>Base currency</strong>
      <input type="text" id="payments-policy-currency" maxlength="8" value="${escapeHtml(policy.currency || "USD")}" />
    </label>
    <label class="stack-field">
      <strong>Processor mode</strong>
      <input type="text" id="payments-policy-processor" value="${escapeHtml(policy.processorMode || "stub")}" />
    </label>
    <label class="stack-field">
      <strong>Vendor allowlist</strong>
      <span class="field-hint">One per line. Domain or email. Leave empty to allow all vendors.</span>
      <textarea id="payments-policy-vendors" rows="5" style="font-family:monospace;width:100%;">${escapeHtml(vendorList)}</textarea>
    </label>
    <div class="payments-policy-actions">
      <button id="payments-policy-save" class="btn btn-primary">Save Policy</button>
      <button id="payments-policy-check" class="btn">Check Policy</button>
    </div>
    <div id="payments-policy-status" class="panel-subtle" style="margin-top:10px;"></div>`;
}

function mountPaymentsTab(root) {
  root.innerHTML = `
    <style>
      .payments-tab { padding: 16px; }
      .payments-subtab-bar { display: flex; gap: 8px; margin-bottom: 16px; }
      .payments-subtab-bar button { padding: 6px 14px; border: 1px solid var(--border, #444); background: transparent; color: var(--text, #eee); border-radius: 4px; cursor: pointer; }
      .payments-subtab-bar button.active { background: var(--accent, #1a73e8); color: #fff; border-color: var(--accent, #1a73e8); }
      [data-payments-subtab-panel] { display: none; }
      [data-payments-subtab-panel].active { display: block; }
      .payments-tx { padding: 12px; margin-bottom: 8px; }
      .payments-tx-header { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
      .payments-tx-amount { font-weight: bold; font-size: 1.05em; }
      .payments-tx-vendor { color: var(--text-muted, #aaa); }
      .payments-tx-desc { margin-top: 4px; font-size: 0.9em; color: var(--text-muted, #aaa); }
      .payments-rejection-reason { margin-top: 4px; font-size: 0.85em; color: #e74c3c; }
      .payments-tx-meta { display: flex; gap: 12px; flex-wrap: wrap; margin-top: 6px; font-size: 0.8em; color: var(--text-muted, #aaa); }
      .payments-proc-ref { font-size: 0.8em; color: var(--text-muted, #aaa); }
      .badge { font-size: 0.75em; padding: 2px 7px; border-radius: 10px; font-weight: 600; letter-spacing: .04em; }
      .badge.status-ok { background: #1a4d2e; color: #2ecc71; }
      .badge.status-warn { background: #4d3800; color: #f39c12; }
      .badge.status-error { background: #4d1a1a; color: #e74c3c; }
      .badge.status-pending { background: #1a2a4d; color: #5dade2; }
      .stack-field { display: flex; flex-direction: column; gap: 4px; margin-bottom: 12px; }
      .stack-field input, .stack-field textarea { padding: 6px 8px; background: var(--input-bg, #1a1a1a); border: 1px solid var(--border, #444); color: var(--text, #eee); border-radius: 4px; }
      .field-hint { font-size: 0.8em; color: var(--text-muted, #aaa); }
      .payments-policy-actions { display: flex; gap: 8px; margin-top: 8px; }
      .payments-filters { display: flex; gap: 8px; margin-bottom: 10px; flex-wrap: wrap; align-items: center; }
      .payments-filters input, .payments-filters select { padding: 5px 8px; background: var(--input-bg, #1a1a1a); border: 1px solid var(--border, #444); color: var(--text, #eee); border-radius: 4px; }
      .payments-budget-bar-wrap { margin-bottom: 4px; }
      .payments-budget-label { font-size: 0.9em; }
      .payments-check-result { margin-top: 8px; padding: 8px; border-radius: 4px; font-size: 0.9em; }
      .payments-check-result.ok { background: #1a4d2e; color: #2ecc71; }
      .payments-check-result.fail { background: #4d1a1a; color: #e74c3c; }
    </style>
    <div class="payments-tab">
      <div class="payments-subtab-bar">
        <button data-payments-subtab-target="transactions" class="active">Transactions</button>
        <button data-payments-subtab-target="policy">Policy</button>
        <button data-payments-subtab-target="check">Check Payment</button>
      </div>

      <div data-payments-subtab-panel="transactions" class="active">
        <div class="payments-filters">
          <select id="payments-filter-status">
            <option value="">All statuses</option>
            <option value="completed">Completed</option>
            <option value="rejected">Rejected</option>
            <option value="failed">Failed</option>
            <option value="pending">Pending</option>
          </select>
          <input id="payments-filter-vendor" type="text" placeholder="Vendor filter…" style="width:160px;" />
          <button id="payments-load-btn" class="btn">Refresh</button>
        </div>
        <div id="payments-tx-list"><div class="panel-subtle">Loading…</div></div>
      </div>

      <div data-payments-subtab-panel="policy">
        <div id="payments-policy-form"><div class="panel-subtle">Loading policy…</div></div>
      </div>

      <div data-payments-subtab-panel="check">
        <div style="max-width:480px;">
          <h3 style="margin-top:0;">Check a payment against policy</h3>
          <label class="stack-field"><strong>Amount</strong><input type="number" id="check-amount" min="0" step="0.01" placeholder="0.00" /></label>
          <label class="stack-field"><strong>Vendor name</strong><input type="text" id="check-vendor" placeholder="Acme Corp" /></label>
          <label class="stack-field"><strong>Vendor ref (email/domain)</strong><input type="text" id="check-vendor-ref" placeholder="billing@acme.com" /></label>
          <label class="stack-field">
            <strong>Approval override</strong>
            <input type="checkbox" id="check-approval" />
          </label>
          <button id="check-run-btn" class="btn btn-primary">Check Policy</button>
          <div id="check-result" style="margin-top:12px;"></div>
        </div>
      </div>
    </div>`;

  root.querySelectorAll("[data-payments-subtab-target]").forEach((btn) => {
    btn.addEventListener("click", () => {
      setSubtab(root, btn.getAttribute("data-payments-subtab-target"));
      if (btn.getAttribute("data-payments-subtab-target") === "policy") {
        loadPolicy();
      }
    });
  });

  let _policy = {};

  async function loadPolicy() {
    const form = root.querySelector("#payments-policy-form");
    try {
      const { policy, dailySpend } = await fetchPayments("/api/payments/policy");
      _policy = policy;
      renderPolicy(form, policy, dailySpend || 0);
      bindPolicyActions(form);
    } catch (err) {
      if (form) form.innerHTML = `<div class="panel-subtle" style="color:#e74c3c;">Failed to load policy: ${escapeHtml(String(err.message))}</div>`;
    }
  }

  function bindPolicyActions(form) {
    const statusEl = form.querySelector("#payments-policy-status");

    form.querySelector("#payments-policy-save")?.addEventListener("click", async () => {
      const vendorRaw = form.querySelector("#payments-policy-vendors")?.value || "";
      const vendorAllowlist = vendorRaw.split(/[\n,]+/).map((v) => v.trim()).filter(Boolean);
      const patch = {
        enabled: form.querySelector("#payments-policy-enabled")?.checked ?? false,
        dailyBudgetCap: Number(form.querySelector("#payments-policy-daily")?.value || 0),
        transactionCap: Number(form.querySelector("#payments-policy-tx-cap")?.value || 0),
        requireApprovalAbove: Number(form.querySelector("#payments-policy-approval")?.value || 0),
        currency: String(form.querySelector("#payments-policy-currency")?.value || "USD").trim().toUpperCase(),
        processorMode: String(form.querySelector("#payments-policy-processor")?.value || "stub").trim(),
        vendorAllowlist
      };
      if (statusEl) statusEl.textContent = "Saving…";
      try {
        const { policy } = await fetchPayments("/api/payments/policy", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(patch)
        });
        _policy = policy;
        if (statusEl) statusEl.textContent = "Policy saved.";
      } catch (err) {
        if (statusEl) statusEl.textContent = `Error: ${err.message}`;
      }
    });

    form.querySelector("#payments-policy-check")?.addEventListener("click", async () => {
      if (statusEl) {
        try {
          const { policy, dailySpend } = await fetchPayments("/api/payments/policy");
          _policy = policy;
          renderPolicy(form, policy, dailySpend || 0);
          bindPolicyActions(form);
        } catch (err) {
          statusEl.textContent = `Error: ${err.message}`;
        }
      }
    });
  }

  async function loadTransactions() {
    const list = root.querySelector("#payments-tx-list");
    const status = root.querySelector("#payments-filter-status")?.value || "";
    const vendor = root.querySelector("#payments-filter-vendor")?.value.trim() || "";
    if (list) list.innerHTML = `<div class="panel-subtle">Loading…</div>`;
    try {
      const params = new URLSearchParams({ limit: "50" });
      if (status) params.set("status", status);
      if (vendor) params.set("vendor", vendor);
      const { transactions, total, dailySpend } = await fetchPayments(`/api/payments/transactions?${params}`);
      if (list) {
        const header = `<div style="margin-bottom:8px;font-size:0.85em;color:var(--text-muted,#aaa);">
          ${total} total transaction(s). Daily spend: ${formatAmount(dailySpend, _policy.currency || "USD")}.
        </div>`;
        list.innerHTML = header;
        const txContainer = document.createElement("div");
        renderTransactions(txContainer, transactions, _policy.currency || "USD");
        list.appendChild(txContainer);
      }
    } catch (err) {
      if (list) list.innerHTML = `<div class="panel-subtle" style="color:#e74c3c;">Failed to load: ${escapeHtml(String(err.message))}</div>`;
    }
  }

  root.querySelector("#payments-load-btn")?.addEventListener("click", loadTransactions);
  root.querySelector("#payments-filter-status")?.addEventListener("change", loadTransactions);

  root.querySelector("#check-run-btn")?.addEventListener("click", async () => {
    const resultEl = root.querySelector("#check-result");
    const amount = Number(root.querySelector("#check-amount")?.value || 0);
    const vendor = String(root.querySelector("#check-vendor")?.value || "").trim();
    const vendorRef = String(root.querySelector("#check-vendor-ref")?.value || "").trim();
    const approvalOverride = root.querySelector("#check-approval")?.checked ?? false;
    if (!amount) {
      if (resultEl) resultEl.innerHTML = `<div class="payments-check-result fail">Amount is required.</div>`;
      return;
    }
    if (resultEl) resultEl.innerHTML = `<div class="panel-subtle">Checking…</div>`;
    try {
      const result = await fetchPayments("/api/payments/check-policy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amount, vendor, vendorRef, approvalOverride })
      });
      if (result.ok) {
        if (resultEl) resultEl.innerHTML = `<div class="payments-check-result ok">
          Policy check PASSED. Daily remaining: ${formatAmount(result.dailyRemaining, result.policy?.currency)}.
        </div>`;
      } else {
        const errLines = Array.isArray(result.errors) ? result.errors : ["Policy check failed"];
        if (resultEl) resultEl.innerHTML = `<div class="payments-check-result fail">
          <strong>Policy check FAILED:</strong><br>${errLines.map(escapeHtml).join("<br>")}
        </div>`;
      }
    } catch (err) {
      if (resultEl) resultEl.innerHTML = `<div class="payments-check-result fail">Error: ${escapeHtml(err.message)}</div>`;
    }
  });

  loadPolicy();
  loadTransactions();
}

if (typeof window !== "undefined") {
  window.__paymentsTabMount = mountPaymentsTab;
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => {
      const root = document.getElementById("payments-tab-root") || document.getElementById("plugin-tab-root");
      if (root) mountPaymentsTab(root);
    });
  } else {
    const root = document.getElementById("payments-tab-root") || document.getElementById("plugin-tab-root");
    if (root) mountPaymentsTab(root);
  }
}
