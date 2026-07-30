import { escapeHtml } from "/plugin-tab-shared.js";

function formatAmount(amount = 0, currency = "AUD") {
  const numeric = Number(amount || 0);
  const sign = numeric < 0 ? "-" : "";
  return `${sign}${String(currency || "AUD").trim().toUpperCase()} ${Math.abs(numeric).toFixed(2)}`;
}

function toIsoLocalInput(value = Date.now()) {
  const date = new Date(value);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hour = String(date.getHours()).padStart(2, "0");
  const minute = String(date.getMinutes()).padStart(2, "0");
  return `${year}-${month}-${day}T${hour}:${minute}`;
}

async function fetchFinance(path = "/api/finance/entries", options = {}) {
  const response = await fetch(path, options);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.ok === false) {
    throw new Error(payload.error || `request failed (${response.status})`);
  }
  return payload;
}

function setFinancePluginSubtab(root, tabId = "entries") {
  const nextId = String(tabId || "entries").trim() || "entries";
  root.dataset.financePluginActiveTab = nextId;
  root.querySelectorAll("[data-finance-plugin-subtab-target]").forEach((button) => {
    const active = button.getAttribute("data-finance-plugin-subtab-target") === nextId;
    button.classList.toggle("active", active);
  });
  root.querySelectorAll("[data-finance-plugin-subtab-panel]").forEach((panel) => {
    const active = panel.getAttribute("data-finance-plugin-subtab-panel") === nextId;
    panel.classList.toggle("active", active);
  });
}

function dominantCurrency(entries = []) {
  const counts = {};
  for (const e of Array.isArray(entries) ? entries : []) {
    const c = String(e.currency || "AUD").trim().toUpperCase() || "AUD";
    counts[c] = (counts[c] || 0) + 1;
  }
  let best = "AUD", bestCount = 0;
  for (const [c, n] of Object.entries(counts)) {
    if (n > bestCount) { best = c; bestCount = n; }
  }
  return best;
}

function renderEntries(container, entries = []) {
  if (!container) {
    return;
  }
  if (!Array.isArray(entries) || !entries.length) {
    container.innerHTML = `<div class="panel-subtle">No finance entries tracked yet.</div>`;
    return;
  }
  container.innerHTML = entries.map((entry) => {
    const entryId = String(entry.id || "").trim();
    const amountValue = Number(entry.amountValue || 0);
    const currency = String(entry.currency || "AUD").trim().toUpperCase() || "AUD";
    const occurredAtIso = toIsoLocalInput(entry.occurredAt || Date.now());
    return `
      <article class="finance-plugin-entry-item card" data-finance-entry-id="${escapeHtml(entryId)}">
        <div class="finance-plugin-entry-grid">
          <label class="stack-field">
            <strong>Title</strong>
            <input data-finance-field="title" value="${escapeHtml(entry.title || "")}" />
          </label>
          <label class="stack-field">
            <strong>Counterparty</strong>
            <input data-finance-field="counterparty" value="${escapeHtml(entry.counterparty || "")}" />
          </label>
          <label class="stack-field">
            <strong>Type</strong>
            <select data-finance-field="type">
              <option value="expense"${String(entry.type || "expense").toLowerCase() === "expense" ? " selected" : ""}>Expense</option>
              <option value="income"${String(entry.type || "expense").toLowerCase() === "income" ? " selected" : ""}>Income</option>
            </select>
          </label>
          <label class="stack-field">
            <strong>Status</strong>
            <select data-finance-field="status">
              <option value="unpaid"${String(entry.status || "unpaid").toLowerCase() === "unpaid" ? " selected" : ""}>Unpaid</option>
              <option value="paid"${String(entry.status || "unpaid").toLowerCase() === "paid" ? " selected" : ""}>Paid</option>
            </select>
          </label>
          <label class="stack-field">
            <strong>Category</strong>
            <input data-finance-field="category" value="${escapeHtml(entry.category || "")}" />
          </label>
          <label class="stack-field">
            <strong>Amount</strong>
            <input data-finance-field="amount" type="number" step="0.01" value="${escapeHtml(amountValue.toFixed(2))}" />
          </label>
          <label class="stack-field">
            <strong>Currency</strong>
            <input data-finance-field="currency" value="${escapeHtml(currency)}" maxlength="8" />
          </label>
          <label class="stack-field">
            <strong>Date</strong>
            <input data-finance-field="occurredAt" type="datetime-local" value="${escapeHtml(occurredAtIso)}" />
          </label>
          <div class="stack-field">
            <strong>Total</strong>
            <div>${escapeHtml(formatAmount(amountValue, currency))}</div>
          </div>
        </div>
        <div class="finance-plugin-entry-actions">
          <button class="secondary" type="button" data-finance-action="save" data-finance-id="${escapeHtml(entryId)}">Save</button>
          <button class="secondary" type="button" data-finance-action="delete" data-finance-id="${escapeHtml(entryId)}">Delete</button>
        </div>
      </article>
    `;
  }).join("");
}

function renderYearSummary(container, years = [], currency = "AUD") {
  if (!container) {
    return;
  }
  if (!Array.isArray(years) || !years.length) {
    container.innerHTML = `<div class="panel-subtle">No financial-year summary yet.</div>`;
    return;
  }
  container.innerHTML = years.map((year) => {
    const summary = year?.summary || {};
    const totals = summary.totals || year?.totals || {};
    const entryCount = Number(year?.entryCount || summary?.trackedCount || 0);
    return `
      <article class="card finance-plugin-year-card">
        <div class="finance-plugin-year-head">
          <div>
            <strong>${escapeHtml(year.label || year.key || "Financial year")}</strong>
            <div class="panel-subtle finance-plugin-year-range">${escapeHtml(year.rangeLabel || "")}</div>
          </div>
          <div class="micro finance-plugin-year-meta">${escapeHtml(String(entryCount))} entries</div>
        </div>
        <div class="finance-plugin-year-grid">
          <div class="finance-plugin-year-stat"><span>Income</span><strong class="finance-plugin-year-amount">${escapeHtml(formatAmount(totals.income || 0, currency))}</strong></div>
          <div class="finance-plugin-year-stat"><span>Expense</span><strong class="finance-plugin-year-amount">${escapeHtml(formatAmount(totals.expense || 0, currency))}</strong></div>
          <div class="finance-plugin-year-stat"><span>Net</span><strong class="finance-plugin-year-amount">${escapeHtml(formatAmount(totals.net || 0, currency))}</strong></div>
        </div>
      </article>
    `;
  }).join("");
}

function renderMonthlySummary(container, months = [], currency = "AUD") {
  if (!container) {
    return;
  }
  if (!Array.isArray(months) || !months.length) {
    container.innerHTML = `<div class="panel-subtle">No monthly summary yet.</div>`;
    return;
  }
  container.innerHTML = months.map((month) => {
    const summary = month?.summary || {};
    const totals = summary.totals || month?.totals || {};
    const entryCount = Number(month?.entryCount || summary?.trackedCount || 0);
    return `
      <article class="card finance-plugin-year-card">
        <div class="finance-plugin-year-head">
          <div>
            <strong>${escapeHtml(month.label || month.key || "Month")}</strong>
            <div class="panel-subtle finance-plugin-year-range">${escapeHtml(month.financialYearLabel || "")}</div>
          </div>
          <div class="micro finance-plugin-year-meta">${escapeHtml(String(entryCount))} entries</div>
        </div>
        <div class="finance-plugin-year-grid">
          <div class="finance-plugin-year-stat"><span>Income</span><strong class="finance-plugin-year-amount">${escapeHtml(formatAmount(totals.income || 0, currency))}</strong></div>
          <div class="finance-plugin-year-stat"><span>Expense</span><strong class="finance-plugin-year-amount">${escapeHtml(formatAmount(totals.expense || 0, currency))}</strong></div>
          <div class="finance-plugin-year-stat"><span>Net</span><strong class="finance-plugin-year-amount">${escapeHtml(formatAmount(totals.net || 0, currency))}</strong></div>
        </div>
      </article>
    `;
  }).join("");
}

export async function mountPluginTab(context = {}) {
  const root = context?.root;
  if (!(root instanceof HTMLElement)) {
    return;
  }

  if (!document.getElementById("financePluginTabStyles")) {
    const styleEl = document.createElement("style");
    styleEl.id = "financePluginTabStyles";
    styleEl.textContent = `
      .finance-plugin-status-strip { margin-bottom: 16px; }
      .finance-plugin-subtab-bar { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 12px; }
      .finance-plugin-subtab-button { border: 1px solid var(--border); background: rgba(255,252,246,0.82); color: var(--ink); border-radius: 999px; padding: 7px 12px; font: inherit; font-weight: 700; cursor: pointer; }
      .finance-plugin-subtab-button.active { background: var(--accent); color: #fff; border-color: transparent; }
      .finance-plugin-subtab-panel { display: none; }
      .finance-plugin-subtab-panel.active { display: block; }
      .finance-plugin-entry-list { display: grid; gap: 12px; }
      .finance-plugin-entry-item { display: grid; gap: 10px; }
      .finance-plugin-entry-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 10px; }
      .finance-plugin-entry-actions { justify-content: flex-end; display: flex; gap: 8px; }
      .finance-plugin-years { display: grid; grid-template-columns: minmax(0, 1fr); gap: 12px; }
      .finance-plugin-year-card { display: grid; gap: 12px; }
      .finance-plugin-year-head { display: flex; justify-content: space-between; gap: 12px; align-items: flex-start; }
      .finance-plugin-year-range { margin-top: 4px; }
      .finance-plugin-year-meta { text-align: right; }
      .finance-plugin-year-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(120px, 1fr)); gap: 10px; }
      .finance-plugin-year-stat { display: grid; gap: 4px; padding: 10px 12px; border: 1px solid var(--border); border-radius: 12px; background: rgba(255, 255, 255, 0.45); }
      .finance-plugin-year-amount { font-size: 12px; line-height: 1.3; }
    `;
    document.head.appendChild(styleEl);
  }

  if (!root.dataset.financePluginMounted) {
    root.innerHTML = `
      <section class="inspector">
        <div class="panel-head">
          <div>
            <h2>Finance</h2>
            <div class="panel-subtle">Plugin-owned finance ledger, summary, and sync controls.</div>
          </div>
          <div class="controls" style="grid-template-columns: repeat(2, minmax(0, 1fr)); margin-bottom: 0;">
            <button id="financePluginRefreshBtn" class="secondary" type="button">Refresh</button>
            <button id="financePluginSyncMailBtn" class="secondary" type="button">Sync Mail</button>
          </div>
        </div>

        <div id="financePluginHint" class="hint">Loading finance plugin...</div>

        <section class="status-strip finance-plugin-status-strip">
          <div class="card"><div class="metric-label">Tracked</div><div id="financePluginTracked" class="metric-value">0</div></div>
          <div class="card"><div class="metric-label">Paid</div><div id="financePluginPaid" class="metric-value">0</div></div>
          <div class="card"><div class="metric-label">Unpaid</div><div id="financePluginUnpaid" class="metric-value">0</div></div>
          <div class="card"><div class="metric-label">Net</div><div id="financePluginNet" class="metric-value">AUD 0.00</div></div>
        </section>

        <div class="finance-plugin-subtab-bar" role="tablist" aria-label="Finance sections">
          <button class="finance-plugin-subtab-button active" type="button" data-finance-plugin-subtab-target="entries">Entries</button>
          <button class="finance-plugin-subtab-button" type="button" data-finance-plugin-subtab-target="year">Financial Year</button>
          <button class="finance-plugin-subtab-button" type="button" data-finance-plugin-subtab-target="monthly">Monthly</button>
          <button class="finance-plugin-subtab-button" type="button" data-finance-plugin-subtab-target="add">Add Entry</button>
        </div>

        <section class="brain-editor-card finance-plugin-subtab-panel active" data-finance-plugin-subtab-panel="entries">
          <div class="panel-head compact"><h3>Entries</h3></div>
          <div id="financePluginEntries" class="finance-plugin-entry-list">Loading...</div>
        </section>

        <section class="brain-editor-card finance-plugin-subtab-panel" data-finance-plugin-subtab-panel="year">
          <div class="panel-head compact"><h3>Financial Years</h3></div>
          <div id="financePluginYears" class="finance-plugin-years">Loading...</div>
        </section>

        <section class="brain-editor-card finance-plugin-subtab-panel" data-finance-plugin-subtab-panel="monthly">
          <div class="panel-head compact"><h3>Monthly Summary</h3></div>
          <div id="financePluginMonths" class="finance-plugin-years">Loading...</div>
        </section>

        <section class="brain-editor-card finance-plugin-subtab-panel" data-finance-plugin-subtab-panel="add">
          <div class="panel-head compact"><h3>Add Entry</h3></div>
          <div class="controls">
            <input id="financePluginTitle" placeholder="Title" />
            <input id="financePluginCounterparty" placeholder="Counterparty" />
          </div>
          <div class="controls">
            <select id="financePluginType"><option value="expense">Expense</option><option value="income">Income</option></select>
            <select id="financePluginStatus"><option value="unpaid">Unpaid</option><option value="paid">Paid</option></select>
            <input id="financePluginCategory" placeholder="Category" />
          </div>
          <div class="controls">
            <input id="financePluginAmount" type="number" step="0.01" placeholder="Amount" />
            <input id="financePluginCurrency" value="AUD" maxlength="8" placeholder="AUD" />
            <input id="financePluginOccurredAt" type="datetime-local" />
          </div>
          <div class="controls">
            <input id="financePluginNotes" placeholder="Notes (optional)" />
            <button id="financePluginAddBtn" type="button">Add Entry</button>
          </div>
        </section>
      </section>
    `;
    root.dataset.financePluginMounted = "1";
  }

  const hintEl = root.querySelector("#financePluginHint");
  const trackedEl = root.querySelector("#financePluginTracked");
  const paidEl = root.querySelector("#financePluginPaid");
  const unpaidEl = root.querySelector("#financePluginUnpaid");
  const netEl = root.querySelector("#financePluginNet");
  const entriesEl = root.querySelector("#financePluginEntries");
  const yearsEl = root.querySelector("#financePluginYears");
  const monthsEl = root.querySelector("#financePluginMonths");
  const refreshBtn = root.querySelector("#financePluginRefreshBtn");
  const syncMailBtn = root.querySelector("#financePluginSyncMailBtn");
  const addBtn = root.querySelector("#financePluginAddBtn");

  const load = async () => {
    hintEl.textContent = "Loading finance entries...";
    try {
      const payload = await fetchFinance("/api/finance/entries");
      const summary = payload.summary || {};
      const totals = summary.totals || {};
      const currency = dominantCurrency(payload.entries || []);
      trackedEl.textContent = String(Number(summary.trackedCount || 0));
      paidEl.textContent = String(Number(summary.paidCount || 0));
      unpaidEl.textContent = String(Number(summary.unpaidCount || 0));
      netEl.textContent = formatAmount(totals.net || 0, currency);
      renderEntries(entriesEl, payload.entries || []);
      renderYearSummary(yearsEl, payload.financialYears || [], currency);
      renderMonthlySummary(monthsEl, payload.monthlySummaries || [], currency);
      hintEl.textContent = "Finance plugin loaded.";
    } catch (error) {
      hintEl.textContent = `Finance unavailable: ${error.message}`;
      renderEntries(entriesEl, []);
      renderYearSummary(yearsEl, []);
      renderMonthlySummary(monthsEl, []);
    }
  };

  if (!root.dataset.financePluginBound) {
    root.querySelectorAll("[data-finance-plugin-subtab-target]").forEach((button) => {
      button.addEventListener("click", () => {
        setFinancePluginSubtab(root, button.getAttribute("data-finance-plugin-subtab-target") || "entries");
      });
    });

    refreshBtn?.addEventListener("click", () => load().catch(() => {}));

    syncMailBtn?.addEventListener("click", async () => {
      syncMailBtn.disabled = true;
      hintEl.textContent = "Syncing finance from mail...";
      try {
        const payload = await fetchFinance("/api/finance/sync-mail", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({})
        });
        const synced = Number(payload.syncedCount || 0);
        const removed = Number(payload.removedCount || 0);
        hintEl.textContent = `Mail sync complete (${synced} synced, ${removed} removed).`;
      } catch (error) {
        hintEl.textContent = `Mail sync failed: ${error.message}`;
      } finally {
        syncMailBtn.disabled = false;
        await load();
      }
    });

    addBtn?.addEventListener("click", async () => {
      addBtn.disabled = true;
      hintEl.textContent = "Adding finance entry...";
      try {
        const title = String(root.querySelector("#financePluginTitle")?.value || "").trim();
        if (!title) {
          throw new Error("Title is required.");
        }
        await fetchFinance("/api/finance/entries", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            title,
            counterparty: String(root.querySelector("#financePluginCounterparty")?.value || "").trim(),
            type: String(root.querySelector("#financePluginType")?.value || "expense").trim(),
            status: String(root.querySelector("#financePluginStatus")?.value || "unpaid").trim(),
            category: String(root.querySelector("#financePluginCategory")?.value || "").trim(),
            amount: String(root.querySelector("#financePluginAmount")?.value || "").trim(),
            currency: String(root.querySelector("#financePluginCurrency")?.value || "AUD").trim(),
            occurredAt: String(root.querySelector("#financePluginOccurredAt")?.value || "").trim(),
            notes: String(root.querySelector("#financePluginNotes")?.value || "").trim()
          })
        });
        root.querySelector("#financePluginTitle").value = "";
        root.querySelector("#financePluginCounterparty").value = "";
        root.querySelector("#financePluginCategory").value = "";
        root.querySelector("#financePluginAmount").value = "";
        root.querySelector("#financePluginNotes").value = "";
        root.querySelector("#financePluginOccurredAt").value = toIsoLocalInput(Date.now());
        hintEl.textContent = "Finance entry added.";
        setFinancePluginSubtab(root, "entries");
      } catch (error) {
        hintEl.textContent = `Add failed: ${error.message}`;
      } finally {
        addBtn.disabled = false;
        await load();
      }
    });

    entriesEl?.addEventListener("click", async (event) => {
      const target = event.target;
      if (!(target instanceof Element)) {
        return;
      }
      const button = target.closest("[data-finance-action]");
      if (!(button instanceof HTMLButtonElement)) {
        return;
      }
      const action = String(button.dataset.financeAction || "").trim();
      const entryId = String(button.dataset.financeId || "").trim();
      if (!action || !entryId) {
        return;
      }

      button.disabled = true;
      try {
        if (action === "delete") {
          await fetchFinance(`/api/finance/entries/${encodeURIComponent(entryId)}`, { method: "DELETE" });
          hintEl.textContent = "Entry deleted.";
        } else if (action === "save") {
          const card = button.closest("[data-finance-entry-id]");
          if (!(card instanceof HTMLElement)) {
            throw new Error("Entry form missing.");
          }
          const payload = {
            title: String(card.querySelector("[data-finance-field='title']")?.value || "").trim(),
            counterparty: String(card.querySelector("[data-finance-field='counterparty']")?.value || "").trim(),
            type: String(card.querySelector("[data-finance-field='type']")?.value || "expense").trim(),
            status: String(card.querySelector("[data-finance-field='status']")?.value || "unpaid").trim(),
            category: String(card.querySelector("[data-finance-field='category']")?.value || "").trim(),
            amount: String(card.querySelector("[data-finance-field='amount']")?.value || "").trim(),
            currency: String(card.querySelector("[data-finance-field='currency']")?.value || "AUD").trim(),
            occurredAt: String(card.querySelector("[data-finance-field='occurredAt']")?.value || "").trim()
          };
          await fetchFinance(`/api/finance/entries/${encodeURIComponent(entryId)}`, {
            method: "PATCH",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(payload)
          });
          hintEl.textContent = "Entry updated.";
        }
      } catch (error) {
        hintEl.textContent = `Entry action failed: ${error.message}`;
      } finally {
        button.disabled = false;
        await load();
      }
    });

    root.dataset.financePluginBound = "1";
  }

  if (!root.querySelector("#financePluginOccurredAt")?.value) {
    root.querySelector("#financePluginOccurredAt").value = toIsoLocalInput(Date.now());
  }

  const activeTab = String(root.dataset.financePluginActiveTab || "entries").trim() || "entries";
  setFinancePluginSubtab(root, activeTab);
  await load();
}
