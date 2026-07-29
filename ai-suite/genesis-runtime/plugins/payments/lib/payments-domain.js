import { randomUUID } from "node:crypto";

const DEFAULT_POLICY = {
  enabled: false,
  dailyBudgetCap: 500,
  transactionCap: 100,
  requireApprovalAbove: 50,
  currency: "USD",
  vendorAllowlist: [],
  processorMode: "stub"
};

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

function normalizeVendorString(value = "") {
  return String(value || "").trim().toLowerCase();
}

function vendorMatchesAllowlist(vendor = "", vendorRef = "", allowlist = []) {
  if (!allowlist.length) return true;
  const nv = normalizeVendorString(vendor);
  const nr = normalizeVendorString(vendorRef);
  for (const entry of allowlist) {
    const ne = normalizeVendorString(entry);
    if (!ne) continue;
    if (nv === ne || nr === ne) return true;
    if (nr.endsWith("@" + ne) || nr.endsWith("." + ne)) return true;
  }
  return false;
}

export function createPaymentsDomain({ dataApi, broadcast = () => {} }) {
  async function readPolicy() {
    return dataApi.readJson("policy", { ...DEFAULT_POLICY });
  }

  async function updatePolicy(patch = {}) {
    await dataApi.updateJson("policy", (current = {}) => {
      const merged = { ...DEFAULT_POLICY, ...current };
      if (typeof patch.enabled === "boolean") merged.enabled = patch.enabled;
      if (typeof patch.dailyBudgetCap === "number") merged.dailyBudgetCap = Math.max(0, patch.dailyBudgetCap);
      if (typeof patch.transactionCap === "number") merged.transactionCap = Math.max(0, patch.transactionCap);
      if (typeof patch.requireApprovalAbove === "number") merged.requireApprovalAbove = Math.max(0, patch.requireApprovalAbove);
      if (typeof patch.currency === "string" && patch.currency.trim()) {
        merged.currency = patch.currency.trim().toUpperCase().slice(0, 8);
      }
      if (Array.isArray(patch.vendorAllowlist)) {
        merged.vendorAllowlist = patch.vendorAllowlist
          .map((v) => String(v || "").trim().toLowerCase())
          .filter(Boolean);
      }
      if (typeof patch.processorMode === "string" && patch.processorMode.trim()) {
        merged.processorMode = patch.processorMode.trim().toLowerCase();
      }
      return merged;
    }, { ...DEFAULT_POLICY });
    return readPolicy();
  }

  async function getDailySpend(dayKey = todayKey()) {
    const store = await dataApi.readJson("transactions", { transactions: [] });
    const txs = Array.isArray(store.transactions) ? store.transactions : [];
    return txs
      .filter((tx) => tx.status === "completed" && String(tx.createdAt || "").slice(0, 10) === dayKey)
      .reduce((sum, tx) => sum + Number(tx.amount || 0), 0);
  }

  async function checkPolicy(amount, vendor, vendorRef, approvalOverride = false) {
    const policy = await readPolicy();
    const errors = [];

    const amt = Number(amount);
    if (!Number.isFinite(amt) || amt <= 0) {
      errors.push("amount must be a positive number");
    }

    if (policy.vendorAllowlist.length > 0) {
      if (!vendorMatchesAllowlist(vendor, vendorRef, policy.vendorAllowlist)) {
        errors.push(`vendor "${vendor || vendorRef || "unknown"}" is not on the allowlist`);
      }
    }

    if (Number.isFinite(amt) && amt > policy.transactionCap) {
      errors.push(`${amt} exceeds the per-transaction cap of ${policy.transactionCap} ${policy.currency}`);
    }

    const dailySpend = await getDailySpend();
    if (Number.isFinite(amt) && dailySpend + amt > policy.dailyBudgetCap) {
      errors.push(
        `would exceed daily budget cap of ${policy.dailyBudgetCap} ${policy.currency}` +
        ` (${dailySpend.toFixed(2)} spent today, ${(policy.dailyBudgetCap - dailySpend).toFixed(2)} remaining)`
      );
    }

    if (Number.isFinite(amt) && amt > policy.requireApprovalAbove && !approvalOverride) {
      errors.push(
        `${amt} exceeds the approval threshold of ${policy.requireApprovalAbove} ${policy.currency}` +
        ` — set approvalOverride: true to confirm this payment has human authorisation`
      );
    }

    const dailySpendFinal = Number.isFinite(amt) ? dailySpend : await getDailySpend();
    return {
      ok: errors.length === 0,
      errors,
      policy,
      dailySpend: dailySpendFinal,
      dailyRemaining: Math.max(0, policy.dailyBudgetCap - dailySpendFinal)
    };
  }

  async function _saveTransaction(record) {
    await dataApi.updateJson("transactions", (store = {}) => {
      const txs = Array.isArray(store.transactions) ? store.transactions : [];
      txs.unshift(record);
      if (txs.length > 5000) txs.length = 5000;
      return { ...store, transactions: txs };
    }, { transactions: [] });
  }

  async function _patchTransaction(txId, patch = {}) {
    await dataApi.updateJson("transactions", (store = {}) => {
      const txs = Array.isArray(store.transactions) ? store.transactions : [];
      const idx = txs.findIndex((tx) => tx.id === txId);
      if (idx >= 0) txs[idx] = { ...txs[idx], ...patch };
      return { ...store, transactions: txs };
    }, { transactions: [] });
  }

  async function _dispatchToProcessor(record, policy) {
    if (!policy.processorMode || policy.processorMode === "stub") {
      return { ref: `stub-${randomUUID().slice(0, 8)}`, mode: "stub" };
    }
    throw new Error(
      `Unknown processorMode "${policy.processorMode}". ` +
      `Set processorMode to "stub" or configure a supported processor.`
    );
  }

  async function processPayment({ amount, currency, vendor, vendorRef, description, approvalOverride = false, source = "agent" }) {
    const policy = await readPolicy();

    if (!policy.enabled) {
      return {
        ok: false,
        status: "rejected",
        reason: "payments plugin is disabled — enable it in the Payments policy settings before making payments"
      };
    }

    const policyCheck = await checkPolicy(amount, vendor, vendorRef, approvalOverride);

    const txId = `tx-${randomUUID()}`;
    const baseRecord = {
      id: txId,
      amount: Number(amount),
      currency: String(currency || policy.currency || "USD").toUpperCase().slice(0, 8),
      vendor: String(vendor || "").trim(),
      vendorRef: String(vendorRef || "").trim(),
      description: String(description || "").trim(),
      source,
      approvalOverride: Boolean(approvalOverride),
      createdAt: new Date().toISOString(),
      completedAt: null,
      processorRef: null,
      policySnapshot: {
        dailyBudgetCap: policyCheck.policy.dailyBudgetCap,
        transactionCap: policyCheck.policy.transactionCap,
        requireApprovalAbove: policyCheck.policy.requireApprovalAbove,
        vendorAllowlistSize: policyCheck.policy.vendorAllowlist.length,
        dailySpendBefore: policyCheck.dailySpend
      }
    };

    if (!policyCheck.ok) {
      const record = { ...baseRecord, status: "rejected", rejectionReason: policyCheck.errors.join("; ") };
      await _saveTransaction(record);
      broadcast({ type: "payments:rejected", txId, reason: policyCheck.errors[0] });
      return {
        ok: false,
        status: "rejected",
        txId,
        reason: policyCheck.errors.join("; "),
        dailySpend: policyCheck.dailySpend,
        dailyRemaining: policyCheck.dailyRemaining
      };
    }

    const pendingRecord = { ...baseRecord, status: "pending", rejectionReason: null };
    await _saveTransaction(pendingRecord);

    let processorResult;
    try {
      processorResult = await _dispatchToProcessor(pendingRecord, policy);
    } catch (err) {
      await _patchTransaction(txId, { status: "failed", processorError: String(err.message) });
      broadcast({ type: "payments:failed", txId, error: String(err.message) });
      return { ok: false, status: "failed", txId, error: String(err.message) };
    }

    await _patchTransaction(txId, {
      status: "completed",
      completedAt: new Date().toISOString(),
      processorRef: processorResult.ref || null,
      processorMode: processorResult.mode || null
    });

    broadcast({ type: "payments:completed", txId, amount: baseRecord.amount, vendor: baseRecord.vendor });

    return {
      ok: true,
      status: "completed",
      txId,
      amount: baseRecord.amount,
      currency: baseRecord.currency,
      vendor: baseRecord.vendor,
      processorRef: processorResult.ref || null
    };
  }

  async function getTransaction(txId) {
    const store = await dataApi.readJson("transactions", { transactions: [] });
    const txs = Array.isArray(store.transactions) ? store.transactions : [];
    return txs.find((tx) => tx.id === String(txId || "").trim()) || null;
  }

  async function listTransactions({ limit = 20, status, vendor } = {}) {
    const store = await dataApi.readJson("transactions", { transactions: [] });
    let txs = Array.isArray(store.transactions) ? store.transactions.slice() : [];
    if (status) txs = txs.filter((tx) => tx.status === status);
    if (vendor) {
      const nv = normalizeVendorString(vendor);
      txs = txs.filter(
        (tx) => normalizeVendorString(tx.vendor) === nv || normalizeVendorString(tx.vendorRef) === nv
      );
    }
    const capped = Math.max(1, Math.min(Number(limit) || 20, 200));
    const result = txs.slice(0, capped);
    const dailySpend = await getDailySpend();
    return { transactions: result, total: txs.length, dailySpend };
  }

  return {
    readPolicy,
    updatePolicy,
    checkPolicy,
    processPayment,
    getTransaction,
    listTransactions,
    getDailySpend
  };
}
