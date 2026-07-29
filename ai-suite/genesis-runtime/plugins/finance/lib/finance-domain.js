import {
  analyzeMailForFinance,
  normalizeFinanceCurrency,
  parseMoneyValue
} from "./finance-mail-domain.js";
import { compactText } from "../../../observer-general-utils.js";

const FINANCE_FINANCIAL_YEAR_START_MONTH = 7;
const FINANCE_FINANCIAL_YEAR_TIME_ZONE = "Australia/Sydney";
const financeFinancialYearDateFormatter = new Intl.DateTimeFormat("en-AU", {
  timeZone: FINANCE_FINANCIAL_YEAR_TIME_ZONE,
  year: "numeric",
  month: "numeric"
});
const financeMonthLabelFormatter = new Intl.DateTimeFormat("en-AU", {
  timeZone: FINANCE_FINANCIAL_YEAR_TIME_ZONE,
  year: "numeric",
  month: "short"
});

function parseTimestamp(value = null, fallback = 0) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value > 0 ? value : Number(fallback || 0);
  }
  const text = String(value || "").trim();
  if (!text) {
    return Number(fallback || 0);
  }
  const parsed = Date.parse(text);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : Number(fallback || 0);
}

function normalizeFinanceType(value = "", fallback = "expense") {
  return String(value || "").trim().toLowerCase() === "income" ? "income" : fallback;
}

function normalizeFinanceStatus(value = "", fallback = "unpaid") {
  return String(value || "").trim().toLowerCase() === "paid" ? "paid" : fallback;
}

function normalizeFinanceCategory(value = "", fallback = "uncategorized") {
  const normalized = compactText(String(value || "").trim().toLowerCase(), 80);
  return normalized || fallback;
}

function createFinanceSummary() {
  return {
    trackedCount: 0,
    paidCount: 0,
    unpaidCount: 0,
    totals: {
      income: 0,
      expense: 0,
      net: 0
    },
    categoryCounts: {}
  };
}

function applyFinanceEntryToSummary(summary = createFinanceSummary(), entry = {}) {
  if (!entry || typeof entry !== "object") {
    return summary;
  }
  summary.trackedCount += 1;
  if (entry.status === "paid") {
    summary.paidCount += 1;
  } else {
    summary.unpaidCount += 1;
  }
  summary.categoryCounts[entry.category] = Number(summary.categoryCounts[entry.category] || 0) + 1;
  const amountValue = Number(entry.amountValue || 0);
  if (amountValue > 0) {
    if (entry.type === "income") {
      summary.totals.income += amountValue;
      summary.totals.net += amountValue;
    } else {
      summary.totals.expense += amountValue;
      summary.totals.net -= amountValue;
    }
  }
  return summary;
}

function finalizeFinanceSummary(summary = createFinanceSummary()) {
  summary.totals.income = Number(summary.totals.income.toFixed(2));
  summary.totals.expense = Number(summary.totals.expense.toFixed(2));
  summary.totals.net = Number(summary.totals.net.toFixed(2));
  return summary;
}

function summarizeFinanceEntries(entries = []) {
  const summary = createFinanceSummary();
  for (const entry of Array.isArray(entries) ? entries : []) {
    applyFinanceEntryToSummary(summary, entry);
  }
  return finalizeFinanceSummary(summary);
}

function getFinanceFinancialYearParts(timestamp = 0) {
  const date = new Date(Number(timestamp || 0));
  if (!Number.isFinite(date.getTime()) || date.getTime() <= 0) {
    return null;
  }
  let month = 0;
  let year = 0;
  for (const part of financeFinancialYearDateFormatter.formatToParts(date)) {
    if (part.type === "month") {
      month = Number(part.value || 0);
    } else if (part.type === "year") {
      year = Number(part.value || 0);
    }
  }
  if (!month || !year) {
    return null;
  }
  const startYear = month >= FINANCE_FINANCIAL_YEAR_START_MONTH ? year : year - 1;
  const endYear = startYear + 1;
  return {
    key: `${startYear}-${endYear}`,
    startYear,
    endYear,
    label: `FY ${startYear}/${String(endYear).slice(-2)}`,
    rangeLabel: `1 Jul ${startYear} to 30 Jun ${endYear}`
  };
}

function summarizeFinanceEntriesByFinancialYear(entries = []) {
  const buckets = new Map();
  const currentFinancialYear = getFinanceFinancialYearParts(Date.now());
  for (const entry of Array.isArray(entries) ? entries : []) {
    const timestamp = Number(entry.occurredAt || entry.updatedAt || entry.createdAt || 0);
    const financialYear = getFinanceFinancialYearParts(timestamp);
    if (!financialYear) {
      continue;
    }
    let bucket = buckets.get(financialYear.key);
    if (!bucket) {
      bucket = {
        ...financialYear,
        summary: createFinanceSummary()
      };
      buckets.set(financialYear.key, bucket);
    }
    applyFinanceEntryToSummary(bucket.summary, entry);
  }
  return Array.from(buckets.values())
    .sort((left, right) => right.startYear - left.startYear)
    .map((bucket) => {
      const summary = finalizeFinanceSummary(bucket.summary);
      return {
        ...bucket,
        isCurrent: currentFinancialYear ? bucket.key === currentFinancialYear.key : false,
        entryCount: Number(summary.trackedCount || 0),
        totals: { ...(summary.totals || {}) },
        summary
      };
    });
}

function getFinanceMonthParts(timestamp = 0) {
  const date = new Date(Number(timestamp || 0));
  if (!Number.isFinite(date.getTime()) || date.getTime() <= 0) {
    return null;
  }
  let month = 0;
  let year = 0;
  for (const part of financeFinancialYearDateFormatter.formatToParts(date)) {
    if (part.type === "month") {
      month = Number(part.value || 0);
    } else if (part.type === "year") {
      year = Number(part.value || 0);
    }
  }
  if (!month || !year) {
    return null;
  }
  return {
    key: `${year}-${String(month).padStart(2, "0")}`,
    year,
    month,
    label: financeMonthLabelFormatter.format(date)
  };
}

function summarizeFinanceEntriesByMonth(entries = []) {
  const buckets = new Map();
  for (const entry of Array.isArray(entries) ? entries : []) {
    const timestamp = Number(entry.occurredAt || entry.updatedAt || entry.createdAt || 0);
    const month = getFinanceMonthParts(timestamp);
    const financialYear = getFinanceFinancialYearParts(timestamp);
    if (!month || !financialYear) {
      continue;
    }
    let bucket = buckets.get(month.key);
    if (!bucket) {
      bucket = {
        ...month,
        financialYearKey: financialYear.key,
        financialYearLabel: financialYear.label,
        summary: createFinanceSummary()
      };
      buckets.set(month.key, bucket);
    }
    applyFinanceEntryToSummary(bucket.summary, entry);
  }
  return Array.from(buckets.values())
    .sort((left, right) => {
      if (right.year !== left.year) {
        return right.year - left.year;
      }
      return right.month - left.month;
    })
    .map((bucket) => {
      const summary = finalizeFinanceSummary(bucket.summary);
      return {
        ...bucket,
        entryCount: Number(summary.trackedCount || 0),
        totals: { ...(summary.totals || {}) },
        summary
      };
    });
}

function normalizeFinanceEntry(record = {}) {
  const now = Date.now();
  const amountValue = parseMoneyValue(record.amountValue || record.amount);
  const currency = normalizeFinanceCurrency(record.currency, "AUD");
  return {
    id: String(record.id || `finance-${now}`).trim() || `finance-${now}`,
    title: compactText(String(record.title || record.subject || "").trim(), 200) || "Finance entry",
    counterparty: compactText(String(record.counterparty || "").trim(), 160),
    type: normalizeFinanceType(record.type, "expense"),
    status: normalizeFinanceStatus(record.status, "unpaid"),
    category: normalizeFinanceCategory(record.category, "uncategorized"),
    amountValue,
    currency,
    amountDisplay: amountValue > 0 ? `${currency} ${amountValue.toFixed(2)}` : "",
    occurredAt: parseTimestamp(record.occurredAt, Number(record.createdAt || now) || now),
    dueAt: parseTimestamp(record.dueAt, 0),
    sourceType: String(record.sourceType || "manual").trim().toLowerCase() === "mail" ? "mail" : "manual",
    sourceMessageId: String(record.sourceMessageId || "").trim(),
    sourceMessageSubject: compactText(String(record.sourceMessageSubject || "").trim(), 240),
    sourceMessageFrom: compactText(String(record.sourceMessageFrom || "").trim(), 160),
    detectionKind: compactText(String(record.detectionKind || "").trim(), 40),
    confidence: Math.max(0, Math.min(Number(record.confidence || 0) || 0, 10)),
    notes: compactText(String(record.notes || "").trim(), 1000),
    createdAt: Number(record.createdAt || now) || now,
    updatedAt: Number(record.updatedAt || record.createdAt || now) || now,
    manualType: record.manualType === true,
    manualStatus: record.manualStatus === true,
    manualCategory: record.manualCategory === true,
    manualCounterparty: record.manualCounterparty === true,
    manualAmount: record.manualAmount === true,
    manualOccurredAt: record.manualOccurredAt === true,
    manualNotes: record.manualNotes === true
  };
}

function normalizeFinanceState(state = {}) {
  const entries = Array.isArray(state?.entries)
    ? state.entries.map((entry) => normalizeFinanceEntry(entry)).filter((entry) => entry.title)
    : [];
  return {
    version: 1,
    entries
  };
}

function financeEntryHasManualOverrides(entry = {}) {
  return entry?.manualType === true
    || entry?.manualStatus === true
    || entry?.manualCategory === true
    || entry?.manualCounterparty === true
    || entry?.manualAmount === true
    || entry?.manualOccurredAt === true
    || entry?.manualNotes === true
    || Boolean(String(entry?.notes || "").trim());
}

export function createFinanceDomain({
  dataApi = null,
  broadcast = () => {}
} = {}) {
  const ledgerDataKey = "ledger";

  async function readFinanceState() {
    if (!dataApi) {
      return normalizeFinanceState();
    }
    const saved = await dataApi.readJson(ledgerDataKey, {});
    return normalizeFinanceState(saved);
  }

  async function writeFinanceState(state = {}) {
    const normalized = normalizeFinanceState(state);
    if (dataApi) {
      await dataApi.writeJson(ledgerDataKey, normalized);
    }
    return normalized;
  }

  async function listEntries() {
    const state = await readFinanceState();
    const entries = [...state.entries].sort((left, right) => {
      const leftTs = Number(left.occurredAt || left.updatedAt || left.createdAt || 0);
      const rightTs = Number(right.occurredAt || right.updatedAt || right.createdAt || 0);
      return rightTs - leftTs;
    });
    return {
      entries,
      summary: summarizeFinanceEntries(entries),
      financialYears: summarizeFinanceEntriesByFinancialYear(entries),
      monthlySummaries: summarizeFinanceEntriesByMonth(entries)
    };
  }

  async function saveEntry(entryInput = {}, options = {}) {
    const state = await readFinanceState();
    const now = Date.now();
    const explicitId = String(entryInput.id || "").trim();
    const existingIndex = state.entries.findIndex((entry) => String(entry.id || "") === explicitId);
    const existing = existingIndex >= 0 ? state.entries[existingIndex] : null;
    const fromMailSync = options.fromMailSync === true;
    const isManual = String(entryInput.sourceType || existing?.sourceType || "manual").trim().toLowerCase() !== "mail";
    const next = normalizeFinanceEntry({
      ...(existing || {}),
      ...entryInput,
      id: explicitId || existing?.id || `finance-${now}`,
      sourceType: isManual ? "manual" : "mail",
      createdAt: existing?.createdAt || now,
      updatedAt: now,
      type: fromMailSync && existing?.manualType ? existing.type : entryInput.type,
      status: fromMailSync && existing?.manualStatus ? existing.status : entryInput.status,
      category: fromMailSync && existing?.manualCategory ? existing.category : entryInput.category,
      counterparty: fromMailSync && existing?.manualCounterparty ? existing.counterparty : entryInput.counterparty,
      amountValue: fromMailSync && existing?.manualAmount ? existing.amountValue : (entryInput.amountValue ?? entryInput.amount),
      currency: fromMailSync && existing?.manualAmount ? existing.currency : entryInput.currency,
      occurredAt: fromMailSync && existing?.manualOccurredAt ? existing.occurredAt : entryInput.occurredAt,
      notes: fromMailSync && existing?.manualNotes ? existing.notes : entryInput.notes,
      manualType: isManual || existing?.manualType === true,
      manualStatus: isManual || existing?.manualStatus === true,
      manualCategory: isManual || existing?.manualCategory === true,
      manualCounterparty: isManual || existing?.manualCounterparty === true,
      manualAmount: isManual || existing?.manualAmount === true,
      manualOccurredAt: isManual || existing?.manualOccurredAt === true,
      manualNotes: isManual || existing?.manualNotes === true
    });
    if (existingIndex >= 0) {
      state.entries[existingIndex] = next;
    } else {
      state.entries.push(next);
    }
    await writeFinanceState(state);
    broadcast({
      type: existingIndex >= 0 ? "finance.updated" : "finance.created",
      finance: next
    });
    return next;
  }

  async function updateEntry(entryId = "", patch = {}) {
    const normalizedId = String(entryId || "").trim();
    if (!normalizedId) {
      throw new Error("entryId is required");
    }
    const state = await readFinanceState();
    const existing = state.entries.find((entry) => String(entry.id || "") === normalizedId);
    if (!existing) {
      throw new Error("finance entry not found");
    }
    return saveEntry({
      ...existing,
      ...patch,
      id: normalizedId,
      manualType: Object.prototype.hasOwnProperty.call(patch, "type") ? true : existing.manualType,
      manualStatus: Object.prototype.hasOwnProperty.call(patch, "status") ? true : existing.manualStatus,
      manualCategory: Object.prototype.hasOwnProperty.call(patch, "category") ? true : existing.manualCategory,
      manualCounterparty: Object.prototype.hasOwnProperty.call(patch, "counterparty") ? true : existing.manualCounterparty,
      manualAmount: Object.prototype.hasOwnProperty.call(patch, "amount")
        || Object.prototype.hasOwnProperty.call(patch, "amountValue")
        || Object.prototype.hasOwnProperty.call(patch, "currency")
          ? true
          : existing.manualAmount,
      manualOccurredAt: Object.prototype.hasOwnProperty.call(patch, "occurredAt") ? true : existing.manualOccurredAt,
      manualNotes: Object.prototype.hasOwnProperty.call(patch, "notes") ? true : existing.manualNotes
    });
  }

  async function removeEntry(entryId = "") {
    const normalizedId = String(entryId || "").trim();
    if (!normalizedId) {
      return false;
    }
    const state = await readFinanceState();
    const index = state.entries.findIndex((entry) => String(entry.id || "") === normalizedId);
    if (index < 0) {
      return false;
    }
    const [removed] = state.entries.splice(index, 1);
    await writeFinanceState(state);
    broadcast({
      type: "finance.removed",
      finance: removed
    });
    return true;
  }

  async function removeAutoSyncedEntryForMessage(messageId = "") {
    const normalizedMessageId = String(messageId || "").trim();
    if (!normalizedMessageId) {
      return false;
    }
    const state = await readFinanceState();
    const index = state.entries.findIndex((entry) =>
      String(entry.id || "").trim() === `mail-finance:${normalizedMessageId}`
      || String(entry.sourceMessageId || "").trim() === normalizedMessageId
    );
    if (index < 0) {
      return false;
    }
    const existing = state.entries[index];
    if (String(existing.sourceType || "").trim().toLowerCase() !== "mail" || financeEntryHasManualOverrides(existing)) {
      return false;
    }
    state.entries.splice(index, 1);
    await writeFinanceState(state);
    broadcast({
      type: "finance.removed",
      finance: existing
    });
    return true;
  }

  async function syncEntryFromMail(message = {}) {
    const analysis = analyzeMailForFinance({
      fromName: String(message.fromName || "").trim(),
      fromAddress: String(message.fromAddress || "").trim(),
      subject: String(message.subject || "").trim(),
      text: String(message.text || "").trim(),
      receivedAt: Number(message.receivedAt || 0)
    });
    message.finance = {
      ...(message.finance || {}),
      ...analysis,
      entryId: ""
    };
    if (analysis.detected !== true) {
      const removed = await removeAutoSyncedEntryForMessage(message.id);
      return {
        entry: null,
        removed,
        unavailable: false
      };
    }
    const entry = await saveEntry({
      id: `mail-finance:${String(message.id || "").trim()}`,
      title: String(message.subject || "").trim() || "Finance email",
      counterparty: String(message.fromName || message.fromAddress || "").trim(),
      type: analysis.type,
      status: analysis.status,
      category: analysis.category,
      amountValue: analysis.amountValue,
      currency: analysis.currency,
      occurredAt: analysis.occurredAt || message.receivedAt,
      sourceType: "mail",
      sourceMessageId: String(message.id || "").trim(),
      sourceMessageSubject: String(message.subject || "").trim(),
      sourceMessageFrom: String(message.fromAddress || "").trim(),
      detectionKind: String(analysis.detectionKind || "").trim(),
      confidence: Number(analysis.confidence || 0),
      notes: ""
    }, { fromMailSync: true });
    message.finance.entryId = entry.id;
    return {
      entry,
      removed: false,
      unavailable: false
    };
  }

  async function syncEntriesFromRecentMail(messages = []) {
    const sourceMessages = Array.isArray(messages) ? messages : [];
    if (!sourceMessages.length) {
      return { synced: [], syncedCount: 0, removedCount: 0, unavailable: false };
    }
    const state = await readFinanceState();
    const now = Date.now();
    const synced = [];
    const broadcastEvents = [];
    let removedCount = 0;

    for (const message of sourceMessages) {
      const analysis = analyzeMailForFinance({
        fromName: String(message.fromName || "").trim(),
        fromAddress: String(message.fromAddress || "").trim(),
        subject: String(message.subject || "").trim(),
        text: String(message.text || "").trim(),
        receivedAt: Number(message.receivedAt || 0)
      });
      message.finance = { ...(message.finance || {}), ...analysis, entryId: "" };
      const normalizedMessageId = String(message.id || "").trim();

      if (analysis.detected !== true) {
        if (normalizedMessageId) {
          const idx = state.entries.findIndex((e) =>
            String(e.id || "").trim() === `mail-finance:${normalizedMessageId}`
            || String(e.sourceMessageId || "").trim() === normalizedMessageId
          );
          if (idx >= 0) {
            const existing = state.entries[idx];
            if (String(existing.sourceType || "").trim().toLowerCase() === "mail" && !financeEntryHasManualOverrides(existing)) {
              const [removed] = state.entries.splice(idx, 1);
              broadcastEvents.push({ type: "finance.removed", finance: removed });
              removedCount += 1;
            }
          }
        }
        continue;
      }

      const entryId = `mail-finance:${normalizedMessageId}`;
      const existingIndex = state.entries.findIndex((e) => String(e.id || "") === entryId);
      const existing = existingIndex >= 0 ? state.entries[existingIndex] : null;
      const next = normalizeFinanceEntry({
        ...(existing || {}),
        id: entryId,
        title: String(message.subject || "").trim() || "Finance email",
        counterparty: String(message.fromName || message.fromAddress || "").trim(),
        type: existing?.manualType ? existing.type : analysis.type,
        status: existing?.manualStatus ? existing.status : analysis.status,
        category: existing?.manualCategory ? existing.category : analysis.category,
        amountValue: existing?.manualAmount ? existing.amountValue : analysis.amountValue,
        currency: existing?.manualAmount ? existing.currency : analysis.currency,
        occurredAt: existing?.manualOccurredAt ? existing.occurredAt : (analysis.occurredAt || message.receivedAt),
        notes: existing?.manualNotes ? existing.notes : "",
        sourceType: "mail",
        sourceMessageId: normalizedMessageId,
        sourceMessageSubject: String(message.subject || "").trim(),
        sourceMessageFrom: String(message.fromAddress || "").trim(),
        detectionKind: String(analysis.detectionKind || "").trim(),
        confidence: Number(analysis.confidence || 0),
        createdAt: existing?.createdAt || now,
        updatedAt: now,
        manualType: existing?.manualType === true,
        manualStatus: existing?.manualStatus === true,
        manualCategory: existing?.manualCategory === true,
        manualCounterparty: existing?.manualCounterparty === true,
        manualAmount: existing?.manualAmount === true,
        manualOccurredAt: existing?.manualOccurredAt === true,
        manualNotes: existing?.manualNotes === true
      });
      if (existingIndex >= 0) {
        state.entries[existingIndex] = next;
      } else {
        state.entries.push(next);
      }
      broadcastEvents.push({ type: existingIndex >= 0 ? "finance.updated" : "finance.created", finance: next });
      message.finance.entryId = next.id;
      synced.push(next);
    }

    if (synced.length > 0 || removedCount > 0) {
      await writeFinanceState(state);
      for (const event of broadcastEvents) {
        broadcast(event);
      }
    }

    return { synced, syncedCount: synced.length, removedCount, unavailable: false };
  }

  async function importLegacyState(legacy = {}) {
    const normalized = normalizeFinanceState(legacy);
    await writeFinanceState(normalized);
    return normalized;
  }

  return {
    importLegacyState,
    listEntries,
    readFinanceState,
    removeEntry,
    saveEntry,
    syncEntriesFromRecentMail,
    syncEntryFromMail,
    updateEntry,
    writeFinanceState
  };
}
